import type { FastifyInstance, FastifyRequest } from "fastify";
import { basename } from "node:path";
import {
  MAX_WHITEBOARD_SNAPSHOT_BYTES,
  WhiteboardSnapshotSchema,
} from "../../domain/whiteboard.js";
import type { WhiteboardRepository } from "../repositories/whiteboard-repository.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function formatMegabytes(bytes: number): number {
  return Math.max(1, Math.ceil(bytes / 1024 / 1024));
}

export const MAX_WHITEBOARD_ASSET_BYTES = 200 * 1024 * 1024;
const MAX_WHITEBOARD_ASSET_UPLOAD_BYTES =
  Math.ceil(MAX_WHITEBOARD_ASSET_BYTES * 4 / 3) + 2 * 1024 * 1024;
const WHITEBOARD_ASSET_CONTENT_TYPE = "application/x-moki-whiteboard-asset";
const MAX_WHITEBOARD_LINK_METADATA_BYTES = 512 * 1024;

function readImageDataUrl(value: unknown): { mimeType: string; content: Buffer } | undefined {
  if (typeof value !== "string") return undefined;
  const match = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/isu.exec(value);
  if (!match) return undefined;
  try {
    const content = Buffer.from(match[2]!, "base64");
    return content.byteLength > 0
      ? { mimeType: match[1]!.toLowerCase(), content }
      : undefined;
  } catch {
    return undefined;
  }
}

function whiteboardAssetMimeType(value: string | undefined): string | undefined {
  const mimeType = value?.trim().toLowerCase();
  return mimeType && /^(?:image|audio|video)\/[a-z0-9.+-]+$/u.test(mimeType)
    ? mimeType
    : undefined;
}

function requestedByteRange(value: string | undefined, size: number): { start: number; end: number } | undefined {
  const match = /^bytes=(\d*)-(\d*)$/u.exec(value?.trim() ?? "");
  if (!match || size <= 0) return undefined;
  const rawStart = match[1] ? Number(match[1]) : undefined;
  const rawEnd = match[2] ? Number(match[2]) : undefined;
  if (rawStart === undefined && rawEnd === undefined) return undefined;
  const start = rawStart === undefined
    ? Math.max(0, size - Math.max(1, rawEnd ?? 0))
    : rawStart;
  const end = rawStart === undefined
    ? size - 1
    : Math.min(size - 1, rawEnd ?? size - 1);
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && start <= end && start < size
    ? { start, end }
    : undefined;
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function decodeAssetFileName(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return decodeURIComponent(value).slice(0, 240);
  } catch {
    return value.slice(0, 240);
  }
}

function safeRemoteUrl(value: unknown): URL | undefined {
  if (typeof value !== "string" || value.length > 4_096) return undefined;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return undefined;
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/gu, "");
    if (
      host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") ||
      host === "::1" || host === "0.0.0.0" || host.startsWith("127.") ||
      host.startsWith("10.") || host.startsWith("192.168.") ||
      /^172\.(?:1[6-9]|2\d|3[01])\./u.test(host) || host.startsWith("169.254.")
    ) return undefined;
    return url;
  } catch {
    return undefined;
  }
}

async function readLimitedResponseText(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > maxBytes) throw new Error("网页内容超过标题读取限制");
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const content = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    content.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(content);
}

function decodeHtmlTitle(value: string): string {
  return value
    .replace(/<[^>]*>/gu, " ")
    .replace(/&#(\d+);/gu, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/giu, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/giu, (_match, entity: string) => ({
      amp: "&",
      lt: "<",
      gt: ">",
      quot: '"',
      apos: "'",
      nbsp: " ",
    } as Record<string, string>)[entity.toLowerCase()] ?? " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 240);
}

function remotePageTitle(html: string): string {
  const openGraph = /<meta\b(?=[^>]*\bproperty\s*=\s*["']og:title["'])(?=[^>]*\bcontent\s*=\s*["']([^"']+)["'])[^>]*>/iu.exec(html)?.[1]
    ?? /<meta\b(?=[^>]*\bcontent\s*=\s*["']([^"']+)["'])(?=[^>]*\bproperty\s*=\s*["']og:title["'])[^>]*>/iu.exec(html)?.[1];
  const title = openGraph ?? /<title\b[^>]*>([\s\S]*?)<\/title>/iu.exec(html)?.[1] ?? "";
  return decodeHtmlTitle(title);
}

export async function registerWhiteboardRoutes(
  app: FastifyInstance,
  options: {
    repository: WhiteboardRepository | ((request: FastifyRequest) => WhiteboardRepository);
    maxSnapshotBytes?: number;
    now?: () => Date;
    fetcher?: typeof fetch;
  },
): Promise<void> {
  const repository = (request: FastifyRequest) => typeof options.repository === "function" ? options.repository(request) : options.repository;
  const maxBytes =
    options.maxSnapshotBytes ?? MAX_WHITEBOARD_SNAPSHOT_BYTES;
  const now = options.now ?? (() => new Date());
  const fetcher = options.fetcher ?? fetch;

  if (!app.hasContentTypeParser(WHITEBOARD_ASSET_CONTENT_TYPE)) {
    app.addContentTypeParser(
      WHITEBOARD_ASSET_CONTENT_TYPE,
      { parseAs: "buffer", bodyLimit: MAX_WHITEBOARD_ASSET_UPLOAD_BYTES },
      (_request, body, done) => done(null, body),
    );
  }

  app.get<{ Querystring: { pageId?: string } }>(
    "/api/whiteboard",
    async (request) => repository(request).latest(request.query.pageId),
  );
  app.get<{ Querystring: { pageId?: string } }>(
    "/api/whiteboard/versions",
    async (request) => repository(request).list(request.query.pageId),
  );
  app.get<{
    Params: { version: string };
  }>("/api/whiteboard/versions/:version", async (request, reply) => {
    const version = Number(request.params.version);
    if (!Number.isSafeInteger(version) || version <= 0) {
      return reply.code(400).send({ error: "白板版本无效" });
    }
    const value = repository(request).find(version);
    if (!value) {
      return reply.code(404).send({ error: "白板版本不存在" });
    }
    return value;
  });
  app.get<{ Params: { id: string } }>(
    "/api/whiteboard/assets/:id",
    async (request, reply) => {
      if (!/^[a-f0-9]{64}$/u.test(request.params.id)) {
        return reply.code(400).send({ error: "图片资源标识无效" });
      }
      const asset = repository(request).findAsset(request.params.id);
      if (!asset) return reply.code(404).send({ error: "白板资源不存在" });
      const range = requestedByteRange(firstHeader(request.headers.range), asset.byteSize);
      if (range) {
        return reply
          .code(206)
          .header("accept-ranges", "bytes")
          .header("cache-control", "public, max-age=31536000, immutable")
          .header("content-range", `bytes ${range.start}-${range.end}/${asset.byteSize}`)
          .header("content-length", range.end - range.start + 1)
          .type(asset.mimeType)
          .send(asset.content.subarray(range.start, range.end + 1));
      }
      return reply
        .header("accept-ranges", "bytes")
        .header("cache-control", "public, max-age=31536000, immutable")
        .header("content-length", asset.byteSize)
        .type(asset.mimeType)
        .send(asset.content);
    },
  );
  app.post(
    "/api/whiteboard/assets",
    { bodyLimit: MAX_WHITEBOARD_ASSET_UPLOAD_BYTES },
    async (request, reply) => {
      const body = isRecord(request.body) ? request.body : {};
      const rawMimeType = firstHeader(request.headers["x-moki-asset-mime"]);
      const rawContent = Buffer.isBuffer(request.body) ? request.body : undefined;
      const binaryMimeType = whiteboardAssetMimeType(rawMimeType);
      const image = rawContent && binaryMimeType
        ? { mimeType: binaryMimeType, content: rawContent }
        : readImageDataUrl(body.source);
      if (!image) return reply.code(400).send({ error: "白板媒体数据格式无效" });
      if (image.content.byteLength > MAX_WHITEBOARD_ASSET_BYTES) {
        return reply.code(413).send({ error: "白板媒体文件不能超过 200MB" });
      }
      const rawWidth = Number(firstHeader(request.headers["x-moki-asset-width"]));
      const rawHeight = Number(firstHeader(request.headers["x-moki-asset-height"]));
      const width = Number.isFinite(rawWidth) && rawWidth > 0
        ? Math.max(1, Math.round(rawWidth))
        : typeof body.width === "number" && Number.isFinite(body.width)
        ? Math.max(1, Math.round(body.width))
        : undefined;
      const height = Number.isFinite(rawHeight) && rawHeight > 0
        ? Math.max(1, Math.round(rawHeight))
        : typeof body.height === "number" && Number.isFinite(body.height)
        ? Math.max(1, Math.round(body.height))
        : undefined;
      const rawFileName = decodeAssetFileName(
        firstHeader(request.headers["x-moki-asset-name"]),
      );
      const saved = repository(request).saveAsset(image.content, {
        mimeType: image.mimeType,
        ...(rawFileName
          ? { fileName: rawFileName }
          : typeof body.name === "string"
          ? { fileName: body.name.slice(0, 240) }
          : {}),
        ...(width ? { width } : {}),
        ...(height ? { height } : {}),
        createdAt: now().toISOString(),
      });
      return reply.code(201).send({
        src: saved.src,
        mimeType: saved.mimeType,
        fileSize: saved.byteSize,
        width: saved.width,
        height: saved.height,
        deduplicated: saved.deduplicated,
      });
    },
  );
  app.post("/api/whiteboard/assets/remote", async (request, reply) => {
    let url = safeRemoteUrl(isRecord(request.body) ? request.body.url : undefined);
    if (!url) return reply.code(400).send({ error: "网络图片地址无效或不允许访问本地网络" });
    try {
      let response: Response | undefined;
      for (let redirect = 0; redirect < 4; redirect += 1) {
        response = await fetcher(url, {
          redirect: "manual",
          signal: AbortSignal.timeout(20_000),
          headers: { accept: "image/*" },
        });
        if (![301, 302, 303, 307, 308].includes(response.status)) break;
        const location = response.headers.get("location");
        url = safeRemoteUrl(location ? new URL(location, url).toString() : undefined);
        if (!url) return reply.code(400).send({ error: "网络图片重定向到了不允许的位置" });
      }
      if (!response?.ok) return reply.code(502).send({ error: `网络图片下载失败：HTTP ${response?.status ?? 0}` });
      const mimeType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
      if (!mimeType?.startsWith("image/")) return reply.code(400).send({ error: "该地址返回的内容不是图片" });
      const declaredSize = Number(response.headers.get("content-length"));
      if (Number.isFinite(declaredSize) && declaredSize > MAX_WHITEBOARD_ASSET_BYTES) {
        return reply.code(413).send({ error: "网络图片不能超过 200MB" });
      }
      const content = Buffer.from(await response.arrayBuffer());
      if (!content.byteLength || content.byteLength > MAX_WHITEBOARD_ASSET_BYTES) {
        return reply.code(content.byteLength ? 413 : 400).send({ error: content.byteLength ? "网络图片不能超过 200MB" : "网络图片内容为空" });
      }
      const saved = repository(request).saveAsset(content, {
        mimeType,
        fileName: decodeURIComponent(basename(url.pathname)).slice(0, 240) || "网络图片",
        createdAt: now().toISOString(),
      });
      return reply.code(201).send({
        src: saved.src,
        mimeType: saved.mimeType,
        fileSize: saved.byteSize,
        width: saved.width,
        height: saved.height,
        deduplicated: saved.deduplicated,
      });
    } catch (error) {
      return reply.code(502).send({ error: error instanceof Error ? `网络图片缓存失败：${error.message}` : "网络图片缓存失败" });
    }
  });
  app.post("/api/whiteboard/links/metadata", async (request, reply) => {
    let url = safeRemoteUrl(isRecord(request.body) ? request.body.url : undefined);
    if (!url) return reply.code(400).send({ error: "网页链接无效或不允许访问本地网络" });
    try {
      let response: Response | undefined;
      for (let redirect = 0; redirect < 4; redirect += 1) {
        response = await fetcher(url, {
          redirect: "manual",
          signal: AbortSignal.timeout(10_000),
          headers: {
            accept: "text/html,application/xhtml+xml;q=0.9",
            "user-agent": "MOKI-Workbench-Link-Preview/1.0",
          },
        });
        if (![301, 302, 303, 307, 308].includes(response.status)) break;
        const location = response.headers.get("location");
        url = safeRemoteUrl(location ? new URL(location, url).toString() : undefined);
        if (!url) return reply.code(400).send({ error: "网页链接重定向到了不允许的位置" });
      }
      if (!response?.ok) return reply.code(502).send({ error: `网页标题读取失败：HTTP ${response?.status ?? 0}` });
      const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
      if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
        return reply.code(400).send({ error: "该地址返回的内容不是网页" });
      }
      const declaredSize = Number(response.headers.get("content-length"));
      if (Number.isFinite(declaredSize) && declaredSize > MAX_WHITEBOARD_LINK_METADATA_BYTES) {
        return reply.code(413).send({ error: "网页内容超过标题读取限制" });
      }
      const html = await readLimitedResponseText(response, MAX_WHITEBOARD_LINK_METADATA_BYTES);
      return {
        url: url.toString(),
        title: remotePageTitle(html) || url.hostname || "网页链接",
      };
    } catch (error) {
      return reply.code(502).send({
        error: error instanceof Error ? `网页标题读取失败：${error.message}` : "网页标题读取失败",
      });
    }
  });
  app.put(
    "/api/whiteboard/pages",
    {
      bodyLimit: maxBytes + 2 * 1024 * 1024,
    },
    async (request, reply) => {
      const body = isRecord(request.body) ? request.body : {};
      const raw = body.snapshot;
      let serialized: string;
      try {
        serialized = JSON.stringify(raw);
      } catch {
        return reply.code(400).send({ error: "白板快照格式无效" });
      }
      if (Buffer.byteLength(serialized, "utf8") > maxBytes) {
        return reply.code(413).send({
          error: `白板快照超过 ${formatMegabytes(maxBytes)} MB 限制`,
        });
      }
      const parsed = WhiteboardSnapshotSchema.safeParse(raw);
      if (!parsed.success) {
        return reply.code(400).send({ error: "白板快照格式无效" });
      }
      try {
        return repository(request).syncPages(
          parsed.data,
          now().toISOString(),
        );
      } catch (error) {
        return reply.code(400).send({
          error: error instanceof Error ? error.message : "白板页面同步失败",
        });
      }
    },
  );
  app.post(
    "/api/whiteboard/snapshots",
    {
      bodyLimit: maxBytes + 2 * 1024 * 1024,
    },
    async (request, reply) => {
      const body = isRecord(request.body) ? request.body : {};
      const raw = body.snapshot;
      const pageId =
        typeof body.pageId === "string" && body.pageId.trim()
          ? body.pageId.trim()
          : undefined;
      const pageName =
        typeof body.pageName === "string" && body.pageName.trim()
          ? body.pageName.trim()
          : undefined;
      let serialized: string;
      try {
        serialized = JSON.stringify(raw);
      } catch {
        return reply
          .code(400)
          .send({ error: "白板快照格式无效" });
      }
      if (Buffer.byteLength(serialized, "utf8") > maxBytes) {
        return reply
          .code(413)
          .send({
            error: `白板快照超过 ${formatMegabytes(maxBytes)} MB 限制`,
          });
      }
      const parsed = WhiteboardSnapshotSchema.safeParse(raw);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "白板快照格式无效" });
      }
      return reply
        .code(201)
        .send(
          repository(request).save(
            parsed.data,
            now().toISOString(),
            pageId
              ? { pageId, ...(pageName ? { pageName } : {}) }
              : undefined,
          ),
        );
    },
  );
}
