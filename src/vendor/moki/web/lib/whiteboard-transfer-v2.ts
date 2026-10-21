import { strFromU8, unzipSync, zipSync } from "fflate";
import { z } from "zod";
import { WhiteboardSnapshotSchema, type WhiteboardSnapshot } from "../../domain/whiteboard.js";
import type {
  DesktopWhiteboardReadResourceResult,
  DesktopWhiteboardRestoredResource,
  DesktopWhiteboardTransferResource,
} from "../../shared/desktop-whiteboard-transfer-contract.js";
import { apiFetch } from "./api-fetch.js";

export const WHITEBOARD_TRANSFER_EXTENSION = ".moki";
const LEGACY_WHITEBOARD_TRANSFER_EXTENSION = ".moki-board";
export const WHITEBOARD_TRANSFER_MIME = "application/vnd.moki.whiteboard+zip";
const LEGACY_WHITEBOARD_TRANSFER_MIME = "application/vnd.moki.whiteboard+json";
const WHITEBOARD_TRANSFER_FORMAT = "moki-whiteboard";
const WHITEBOARD_TRANSFER_VERSION = 2;
const WHITEBOARD_TRANSFER_MANIFEST = "manifest.json";
const WHITEBOARD_ASSET_CONTENT_TYPE = "application/x-moki-whiteboard-asset";
const MAX_WHITEBOARD_TRANSFER_BYTES = 256 * 1024 * 1024;
const MAX_WHITEBOARD_TRANSFER_FILES = 20_000;

const LegacyEmbeddedAssetSchema = z.object({
  assetId: z.string().min(1),
  dataUrl: z.string().regex(/^data:image\/[a-z0-9.+-]+;base64,/iu),
  name: z.string().max(240).optional(),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
});

function normalizeImportedSnapshot(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const candidate = value as { document?: { store?: unknown; schema?: unknown }; store?: unknown };
  const sourceStore = candidate.document?.store ?? candidate.store;
  if (!sourceStore || typeof sourceStore !== "object" || Array.isArray(sourceStore)) return value;
  const store: Record<string, unknown> = {};
  for (const [key, record] of Object.entries(sourceStore)) {
    store[key] = record && typeof record === "object" && !Array.isArray(record)
      ? { id: key, ...(record as Record<string, unknown>) }
      : record;
  }
  const document = candidate.document && typeof candidate.document === "object"
    ? { ...candidate.document, store, schema: candidate.document.schema ?? {} }
    : { store, schema: {} };
  return { ...(value as Record<string, unknown>), document };
}

const LegacyWhiteboardTransferSchema = z.object({
  format: z.union([z.literal(WHITEBOARD_TRANSFER_FORMAT), z.literal("moki-whiteboard-page")]),
  version: z.coerce.number().int().min(1).max(3),
  exportedAt: z.iso.datetime({ offset: true }).optional(),
  pageId: z.string().min(1).optional(),
  pageName: z.string().max(240).optional(),
  boardTitle: z.string().max(120).optional(),
  snapshot: z.preprocess(normalizeImportedSnapshot, WhiteboardSnapshotSchema),
  assets: z.array(LegacyEmbeddedAssetSchema).max(10_000).default([]),
});

const ArchiveAssetSchema = z.object({
  assetId: z.string().min(1),
  archivePath: z.string().min(1).max(500),
  mimeType: z.string().min(1).max(200),
  name: z.string().max(240).optional(),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
});

const ArchiveResourceSchema = z.object({
  shapeId: z.string().min(1),
  name: z.string().min(1).max(240),
  kind: z.enum(["file", "folder"]),
  files: z.array(z.object({
    archivePath: z.string().min(1).max(500),
    relativePath: z.string().min(1).max(4_096),
  })).max(MAX_WHITEBOARD_TRANSFER_FILES),
});

const WhiteboardArchiveManifestSchema = z.object({
  format: z.literal(WHITEBOARD_TRANSFER_FORMAT),
  version: z.literal(WHITEBOARD_TRANSFER_VERSION),
  exportedAt: z.iso.datetime({ offset: true }).optional(),
  pageId: z.string().min(1).optional(),
  pageName: z.string().max(240).optional(),
  boardTitle: z.string().max(120).optional(),
  snapshot: z.preprocess(normalizeImportedSnapshot, WhiteboardSnapshotSchema),
  assets: z.array(ArchiveAssetSchema).max(10_000).default([]),
  resources: z.array(ArchiveResourceSchema).max(2_000).default([]),
});

type WhiteboardAssetRecord = {
  id: string;
  typeName: string;
  type?: string;
  props?: Record<string, unknown>;
};

function isPortableAsset(value: unknown): value is WhiteboardAssetRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as WhiteboardAssetRecord;
  return record.typeName === "asset" && ["image", "media"].includes(record.type ?? "") &&
    Boolean(record.props && typeof record.props.src === "string");
}

function safeFileStem(value: string): string {
  return value.replace(/[\\/:*?"<>|]+/gu, "-").trim() || "MOKI-白板";
}

function safeArchiveRelativePath(value: string): string {
  const segments = value.replace(/\\/gu, "/").split("/")
    .filter((segment) => segment && segment !== ".")
    .map((segment) => segment === ".." ? "上级目录" : segment.replace(/[\u0000-\u001f]/gu, "-").slice(0, 240));
  return segments.join("/") || "未命名文件";
}

function joinedArchiveRelativePath(prefix: string | undefined, value: string): string {
  return safeArchiveRelativePath([prefix, value].filter(Boolean).join("/"));
}

function dataUrlBytes(dataUrl: string): { mimeType: string; bytes: Uint8Array } {
  const match = /^data:([^;,]+);base64,(.+)$/isu.exec(dataUrl);
  if (!match) throw new Error("白板内嵌资源格式无效");
  const binary = atob(match[2]!);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return { mimeType: match[1]!.toLowerCase(), bytes };
}

function rendererBytes(value: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(value.byteLength);
  bytes.set(value);
  return bytes;
}

function byteFingerprint(bytes: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return `${bytes.byteLength}:${hash >>> 0}`;
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

async function sourceBytes(source: string, fetcher: typeof fetch): Promise<{ mimeType: string; bytes: Uint8Array }> {
  if (source.startsWith("data:")) return dataUrlBytes(source);
  const response = await fetcher(source, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const blob = await response.blob();
  return {
    mimeType: blob.type || response.headers.get("content-type")?.split(";", 1)[0] || "application/octet-stream",
    bytes: new Uint8Array(await blob.arrayBuffer()),
  };
}

function uniqueResourcePath(path: string, occupied: Set<string>): string {
  if (!occupied.has(path.toLocaleLowerCase("en-US"))) {
    occupied.add(path.toLocaleLowerCase("en-US"));
    return path;
  }
  const slash = path.lastIndexOf("/");
  const directory = slash >= 0 ? path.slice(0, slash + 1) : "";
  const name = slash >= 0 ? path.slice(slash + 1) : path;
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : "";
  let suffix = 2;
  while (occupied.has(`${directory}${stem}-${suffix}${extension}`.toLocaleLowerCase("en-US"))) suffix += 1;
  const result = `${directory}${stem}-${suffix}${extension}`;
  occupied.add(result.toLocaleLowerCase("en-US"));
  return result;
}

export type WhiteboardPortableResourceSource = {
  source: string;
  name?: string;
  pathPrefix?: string;
};

export type WhiteboardPortableResource = {
  shapeId: string;
  name: string;
  kind: "file" | "folder";
  sources: WhiteboardPortableResourceSource[];
};

export function isWhiteboardTransferFile(file: File): boolean {
  const name = file.name.toLocaleLowerCase();
  return name.endsWith(WHITEBOARD_TRANSFER_EXTENSION) || name.endsWith(LEGACY_WHITEBOARD_TRANSFER_EXTENSION) ||
    name.endsWith(`${LEGACY_WHITEBOARD_TRANSFER_EXTENSION}.json`) || name.endsWith(`${WHITEBOARD_TRANSFER_EXTENSION}.json`) ||
    file.type === WHITEBOARD_TRANSFER_MIME || file.type === LEGACY_WHITEBOARD_TRANSFER_MIME;
}

export async function createWhiteboardTransferFile(
  snapshot: WhiteboardSnapshot,
  options: {
    fetcher?: typeof fetch;
    exportedAt?: string;
    fileName?: string;
    pageId?: string;
    pageName?: string;
    boardTitle?: string;
    resources?: WhiteboardPortableResource[];
    readResource?: (input: { source: string; name?: string }) => Promise<DesktopWhiteboardReadResourceResult>;
  } = {},
): Promise<{ blob: Blob; fileName: string; assetCount: number; resourceCount: number; fileCount: number }> {
  const parsed = WhiteboardSnapshotSchema.safeParse(snapshot);
  if (!parsed.success) throw new Error("当前白板数据格式无效，无法导出。");
  const fetcher = options.fetcher ?? fetch;
  const archive: Record<string, Uint8Array> = {};
  const archivedContent = new Map<string, Array<{ archivePath: string; bytes: Uint8Array }>>();
  let expandedBytes = 0;
  let archiveFileCount = 0;
  const addArchiveContent = (archivePath: string, value: Uint8Array): string => {
    const bytes = rendererBytes(value);
    const fingerprint = byteFingerprint(bytes);
    const duplicate = archivedContent.get(fingerprint)?.find((entry) => equalBytes(entry.bytes, bytes));
    if (duplicate) return duplicate.archivePath;
    if (archiveFileCount + 1 >= MAX_WHITEBOARD_TRANSFER_FILES) {
      throw new Error("白板便携文件数量超过 20000 个，无法导出。");
    }
    expandedBytes += bytes.byteLength;
    if (expandedBytes > MAX_WHITEBOARD_TRANSFER_BYTES) {
      throw new Error("白板便携文件内容超过 256MB，无法导出。请移除过大的映射文件或资料夹后重试。");
    }
    archive[archivePath] = bytes;
    archiveFileCount += 1;
    const matches = archivedContent.get(fingerprint) ?? [];
    matches.push({ archivePath, bytes });
    archivedContent.set(fingerprint, matches);
    return archivePath;
  };
  const assets: Array<z.infer<typeof ArchiveAssetSchema>> = [];
  for (const record of Object.values(parsed.data.document.store)) {
    if (!isPortableAsset(record)) continue;
    const props = record.props ?? {};
    let content: { mimeType: string; bytes: Uint8Array };
    try {
      content = await sourceBytes(String(props.src ?? ""), fetcher);
    } catch {
      throw new Error(`白板资源打包失败：${String(props.name ?? record.id)}`);
    }
    const archivePath = addArchiveContent(
      `assets/${String(assets.length + 1).padStart(5, "0")}.bin`,
      content.bytes,
    );
    assets.push({
      assetId: record.id,
      archivePath,
      mimeType: content.mimeType,
      ...(typeof props.name === "string" ? { name: props.name } : {}),
      ...(typeof props.width === "number" && props.width > 0 ? { width: props.width } : {}),
      ...(typeof props.height === "number" && props.height > 0 ? { height: props.height } : {}),
    });
  }

  const resources: Array<z.infer<typeof ArchiveResourceSchema>> = [];
  let resourceFileCount = 0;
  for (const resource of options.resources ?? []) {
    if (!options.readResource) throw new Error("请在 MOKI 客户端中导出包含本地映射资料的白板页面。");
    const occupied = new Set<string>();
    const files: Array<{ archivePath: string; relativePath: string }> = [];
    for (const source of resource.sources) {
      let result: DesktopWhiteboardReadResourceResult;
      try {
        result = await options.readResource({ source: source.source, ...(source.name ? { name: source.name } : {}) });
      } catch (error) {
        throw new Error(`映射资料打包失败：${resource.name}（${error instanceof Error ? error.message : "无法读取"}）`);
      }
      for (const file of result.files) {
        if (resourceFileCount >= MAX_WHITEBOARD_TRANSFER_FILES) {
          throw new Error("白板映射文件数量超过 20000 个，无法导出。");
        }
        const relativePath = uniqueResourcePath(joinedArchiveRelativePath(source.pathPrefix, file.relativePath), occupied);
        const archivePath = addArchiveContent(
          `resources/${String(resources.length + 1).padStart(5, "0")}/${String(files.length + 1).padStart(5, "0")}.bin`,
          file.bytes,
        );
        files.push({ archivePath, relativePath });
        resourceFileCount += 1;
      }
    }
    resources.push({ shapeId: resource.shapeId, name: resource.name, kind: resource.kind, files });
  }

  const manifest = {
    format: WHITEBOARD_TRANSFER_FORMAT,
    version: WHITEBOARD_TRANSFER_VERSION,
    exportedAt: options.exportedAt ?? new Date().toISOString(),
    ...(options.pageId ? { pageId: options.pageId } : {}),
    ...(options.pageName ? { pageName: options.pageName } : {}),
    ...(options.boardTitle ? { boardTitle: options.boardTitle } : {}),
    snapshot: parsed.data,
    assets,
    resources,
  };
  // fflate distinguishes files from nested directories with instanceof, so
  // copy TextEncoder/IPC buffers into the renderer realm before archiving.
  const manifestBytes = rendererBytes(new TextEncoder().encode(JSON.stringify(manifest)));
  if (expandedBytes + manifestBytes.byteLength > MAX_WHITEBOARD_TRANSFER_BYTES) {
    throw new Error("白板便携文件内容超过 256MB，无法导出。请移除过大的映射文件或资料夹后重试。");
  }
  archive[WHITEBOARD_TRANSFER_MANIFEST] = manifestBytes;
  const bytes = zipSync(archive, { level: 6 });
  if (bytes.byteLength > MAX_WHITEBOARD_TRANSFER_BYTES) {
    throw new Error("白板便携文件超过 256MB，无法导出。请移除过大的映射文件或资料夹后重试。");
  }
  return {
    blob: new Blob([bytes.slice().buffer as ArrayBuffer], { type: WHITEBOARD_TRANSFER_MIME }),
    fileName: `${safeFileStem(options.fileName ?? "MOKI-白板")}${WHITEBOARD_TRANSFER_EXTENSION}`,
    assetCount: assets.length,
    resourceCount: resources.length,
    fileCount: assets.length + resourceFileCount,
  };
}

export function downloadWhiteboardTransferFile(result: { blob: Blob; fileName: string }): void {
  const url = URL.createObjectURL(result.blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = result.fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function uploadAsset(
  fetcher: typeof fetch,
  asset: { bytes: Uint8Array; mimeType: string; name?: string; width?: number; height?: number },
): Promise<Record<string, unknown>> {
  const response = await fetcher("/api/whiteboard/assets", {
    method: "POST",
    headers: {
      "content-type": WHITEBOARD_ASSET_CONTENT_TYPE,
      "x-moki-retryable-write": "true",
      "x-moki-asset-mime": asset.mimeType,
      ...(asset.name ? { "x-moki-asset-name": encodeURIComponent(asset.name) } : {}),
      ...(asset.width ? { "x-moki-asset-width": String(asset.width) } : {}),
      ...(asset.height ? { "x-moki-asset-height": String(asset.height) } : {}),
    },
    body: new Blob([asset.bytes.slice().buffer as ArrayBuffer], { type: asset.mimeType }),
  });
  const result = await response.json() as Record<string, unknown>;
  if (!response.ok || typeof result.src !== "string") {
    throw new Error(typeof result.error === "string" ? result.error : "白板内嵌资源导入失败。");
  }
  return result;
}

function rewriteAsset(snapshot: WhiteboardSnapshot, assetId: string, result: Record<string, unknown>): void {
  const record = snapshot.document.store[assetId];
  if (!record || !isPortableAsset(record)) return;
  record.props = {
    ...record.props,
    src: result.src,
    ...(typeof result.mimeType === "string" ? { mimeType: result.mimeType } : {}),
    ...(typeof result.fileSize === "number" ? { fileSize: result.fileSize } : {}),
    ...(typeof result.width === "number" ? { width: result.width } : {}),
    ...(typeof result.height === "number" ? { height: result.height } : {}),
  };
}

function rewriteRestoredResources(snapshot: WhiteboardSnapshot, restored: DesktopWhiteboardRestoredResource[]): void {
  for (const resource of restored) {
    const record = snapshot.document.store[resource.shapeId];
    if (!record || record.typeName !== "shape" || !record.props || typeof record.props !== "object") continue;
    const props = { ...(record.props as Record<string, unknown>) };
    delete props.libraryItemId;
    record.props = {
      ...props,
      name: resource.name,
      localPath: resource.localPath,
      ...(record.type === "resource" ? { kind: resource.kind === "folder" ? "local_folder" : "local_file" } : {}),
    };
  }
}

function unzipWhiteboard(bytes: Uint8Array): Record<string, Uint8Array> {
  let expandedBytes = 0;
  let files = 0;
  return unzipSync(bytes, {
    filter(entry) {
      files += 1;
      expandedBytes += entry.originalSize;
      if (files > MAX_WHITEBOARD_TRANSFER_FILES || expandedBytes > MAX_WHITEBOARD_TRANSFER_BYTES) {
        throw new Error("白板便携文件展开后超过安全限制。");
      }
      return true;
    },
  });
}

export async function importWhiteboardTransferFile(
  file: File,
  options: {
    fetcher?: typeof fetch;
    restoreResources?: (resources: DesktopWhiteboardTransferResource[]) => Promise<DesktopWhiteboardRestoredResource[]>;
  } = {},
): Promise<{
  snapshot: WhiteboardSnapshot;
  assetCount: number;
  resourceCount: number;
  fileCount: number;
  pageId?: string;
  pageName?: string;
  boardTitle?: string;
}> {
  if (!isWhiteboardTransferFile(file)) throw new Error(`请选择 ${WHITEBOARD_TRANSFER_EXTENSION} 白板文件。`);
  if (file.size > MAX_WHITEBOARD_TRANSFER_BYTES) throw new Error("白板文件超过 256MB，无法导入。");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const fetcher = options.fetcher ?? apiFetch;

  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    let archive: Record<string, Uint8Array>;
    try {
      archive = unzipWhiteboard(bytes);
    } catch (error) {
      throw new Error(error instanceof Error ? `白板便携文件无法展开：${error.message}` : "白板便携文件无法展开。");
    }
    const manifestBytes = archive[WHITEBOARD_TRANSFER_MANIFEST];
    if (!manifestBytes) throw new Error("白板便携文件缺少清单。");
    let raw: unknown;
    try {
      raw = JSON.parse(strFromU8(manifestBytes));
    } catch {
      throw new Error("白板便携文件清单无法解析，文件可能已损坏。");
    }
    const parsed = WhiteboardArchiveManifestSchema.safeParse(raw);
    if (!parsed.success) throw new Error("白板文件格式或版本不受支持。");
    const snapshot = structuredClone(parsed.data.snapshot);
    for (const asset of parsed.data.assets) {
      const content = archive[asset.archivePath];
      if (!content) throw new Error(`白板便携文件缺少内嵌资源：${asset.name ?? asset.assetId}`);
      const result = await uploadAsset(fetcher, {
        bytes: content,
        mimeType: asset.mimeType,
        ...(asset.name ? { name: asset.name } : {}),
        ...(asset.width ? { width: asset.width } : {}),
        ...(asset.height ? { height: asset.height } : {}),
      });
      rewriteAsset(snapshot, asset.assetId, result);
    }
    const portableResources: DesktopWhiteboardTransferResource[] = parsed.data.resources.map((resource) => ({
      shapeId: resource.shapeId,
      name: resource.name,
      kind: resource.kind,
      files: resource.files.map((entry) => {
        const content = archive[entry.archivePath];
        if (!content) throw new Error(`白板便携文件缺少映射资料：${resource.name}`);
        return { relativePath: entry.relativePath, bytes: content };
      }),
    }));
    if (portableResources.length) {
      if (!options.restoreResources) throw new Error("该白板包含映射资料，请使用 MOKI 客户端导入。");
      rewriteRestoredResources(snapshot, await options.restoreResources(portableResources));
    }
    return {
      snapshot,
      assetCount: parsed.data.assets.length,
      resourceCount: parsed.data.resources.length,
      fileCount: parsed.data.assets.length + parsed.data.resources.reduce((sum, resource) => sum + resource.files.length, 0),
      ...(parsed.data.pageId ? { pageId: parsed.data.pageId } : {}),
      ...(parsed.data.pageName ? { pageName: parsed.data.pageName } : {}),
      ...(parsed.data.boardTitle ? { boardTitle: parsed.data.boardTitle } : {}),
    };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error("白板文件无法解析，文件可能已损坏。");
  }
  const parsed = LegacyWhiteboardTransferSchema.safeParse(raw);
  if (!parsed.success) throw new Error("白板文件格式或版本不受支持。");
  const snapshot = structuredClone(parsed.data.snapshot);
  for (const asset of parsed.data.assets) {
    const content = dataUrlBytes(asset.dataUrl);
    const result = await uploadAsset(fetcher, {
      ...content,
      ...(asset.name ? { name: asset.name } : {}),
      ...(asset.width ? { width: asset.width } : {}),
      ...(asset.height ? { height: asset.height } : {}),
    });
    rewriteAsset(snapshot, asset.assetId, result);
  }
  return {
    snapshot,
    assetCount: parsed.data.assets.length,
    resourceCount: 0,
    fileCount: parsed.data.assets.length,
    ...(parsed.data.pageId ? { pageId: parsed.data.pageId } : {}),
    ...(parsed.data.pageName ? { pageName: parsed.data.pageName } : {}),
    ...(parsed.data.boardTitle ? { boardTitle: parsed.data.boardTitle } : {}),
  };
}
