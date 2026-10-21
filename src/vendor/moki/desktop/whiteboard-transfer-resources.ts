import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import type {
  DesktopWhiteboardReadResourceResult,
  DesktopWhiteboardRestoredResource,
  DesktopWhiteboardTransferFile,
  DesktopWhiteboardTransferResource,
} from "../shared/desktop-whiteboard-transfer-contract.js";

export const MAX_PORTABLE_WHITEBOARD_RESOURCE_BYTES = 256 * 1024 * 1024;
export const MAX_PORTABLE_WHITEBOARD_RESOURCE_FILES = 20_000;

function safeSegment(value: string, fallback: string): string {
  const sanitized = value
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/gu, "-")
    .replace(/[. ]+$/gu, "")
    .trim();
  return sanitized && sanitized !== "." && sanitized !== ".." ? sanitized.slice(0, 240) : fallback;
}

function safeRelativePath(value: string): string {
  const segments = value.replace(/\\/gu, "/").split("/")
    .filter((segment) => segment && segment !== ".")
    .map((segment) => {
      if (segment === "..") throw new Error("白板便携文件包含不安全路径");
      return safeSegment(segment, "未命名文件");
    });
  if (!segments.length || isAbsolute(value)) throw new Error("白板便携文件路径无效");
  return segments.join("/");
}

async function readRemoteFile(source: URL, preferredName?: string): Promise<DesktopWhiteboardReadResourceResult> {
  if (source.username || source.password) throw new Error("在线资料地址不能包含登录凭据");
  const response = await fetch(source, {
    redirect: "follow",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`在线资料读取失败：HTTP ${response.status}`);
  const declaredSize = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredSize) && declaredSize > MAX_PORTABLE_WHITEBOARD_RESOURCE_BYTES) {
    throw new Error("单个白板映射文件不能超过 256MB");
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_PORTABLE_WHITEBOARD_RESOURCE_BYTES) {
    throw new Error("单个白板映射文件不能超过 256MB");
  }
  const name = safeSegment(preferredName || decodeURIComponent(basename(source.pathname)) || "在线资料", "在线资料");
  return { name, kind: "file", files: [{ relativePath: name, bytes }] };
}

async function readLocalResource(source: string, preferredName?: string): Promise<DesktopWhiteboardReadResourceResult> {
  const root = resolve(source);
  const rootMetadata = await lstat(root);
  if (rootMetadata.isSymbolicLink()) throw new Error("不支持打包符号链接或目录联接");
  const rootName = safeSegment(preferredName || basename(root), rootMetadata.isDirectory() ? "白板资料夹" : "白板资料");
  if (rootMetadata.isFile()) {
    if (rootMetadata.size > MAX_PORTABLE_WHITEBOARD_RESOURCE_BYTES) throw new Error("单个白板映射文件不能超过 256MB");
    return {
      name: rootName,
      kind: "file",
      files: [{ relativePath: rootName, bytes: new Uint8Array(await readFile(root)) }],
    };
  }
  if (!rootMetadata.isDirectory()) throw new Error("白板映射目标不是文件或文件夹");
  const files: DesktopWhiteboardTransferFile[] = [];
  let totalBytes = 0;
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
        continue;
      }
      if (!entry.isFile()) continue;
      if (files.length >= MAX_PORTABLE_WHITEBOARD_RESOURCE_FILES) throw new Error("白板映射文件数量超过 20000 个");
      const metadata = await lstat(path);
      totalBytes += metadata.size;
      if (totalBytes > MAX_PORTABLE_WHITEBOARD_RESOURCE_BYTES) throw new Error("单个白板映射资料夹不能超过 256MB");
      const relativePath = relative(root, path).split(sep).map((segment) => safeSegment(segment, "未命名文件")).join("/");
      files.push({ relativePath, bytes: new Uint8Array(await readFile(path)) });
    }
  };
  await visit(root);
  return { name: rootName, kind: "folder", files };
}

export async function readWhiteboardTransferResource(
  input: { source: string; name?: string },
): Promise<DesktopWhiteboardReadResourceResult> {
  const source = input.source.trim();
  if (!source) throw new Error("白板映射来源为空");
  if(source.startsWith('data:')){const match=/^data:([^;,]+);base64,([\s\S]+)$/.exec(source);if(!match)throw new Error('内联文件格式无效');const bytes=Buffer.from(match[2]!, 'base64');if(bytes.length>MAX_PORTABLE_WHITEBOARD_RESOURCE_BYTES)throw new Error('内联文件超过256MB');const name=safeSegment(input.name??'白板附件','白板附件');return {name,kind:'file',files:[{relativePath:name,bytes}]};}
  if (/^https?:\/\//iu.test(source)) {
    return readRemoteFile(new URL(source), input.name);
  }
  return readLocalResource(source, input.name);
}

function uniqueDestination(parent: string, name: string, occupied: Set<string>): string {
  const extensionIndex = name.lastIndexOf(".");
  const stem = extensionIndex > 0 ? name.slice(0, extensionIndex) : name;
  const extension = extensionIndex > 0 ? name.slice(extensionIndex) : "";
  let candidate = name;
  let suffix = 2;
  while (occupied.has(candidate.toLocaleLowerCase("en-US"))) {
    candidate = `${stem}-${suffix}${extension}`;
    suffix += 1;
  }
  occupied.add(candidate.toLocaleLowerCase("en-US"));
  return join(parent, candidate);
}

export async function restoreWhiteboardTransferResources(
  baseDirectory: string,
  resources: DesktopWhiteboardTransferResource[],
  importId: string = randomUUID(),
): Promise<DesktopWhiteboardRestoredResource[]> {
  if (resources.length > 2_000) throw new Error("白板映射资料数量超过 2000 个");
  const importRoot = join(resolve(baseDirectory), safeSegment(importId, "import"));
  const occupied = new Set<string>();
  let totalBytes = 0;
  let totalFiles = 0;
  await mkdir(resolve(baseDirectory), { recursive: true });
  await mkdir(importRoot, { recursive: false });
  try {
    const restored: DesktopWhiteboardRestoredResource[] = [];
    for (const resource of resources) {
      const safeName = safeSegment(resource.name, resource.kind === "folder" ? "白板资料夹" : "白板资料");
      const destination = uniqueDestination(importRoot, safeName, occupied);
      if (resource.kind === "folder") await mkdir(destination, { recursive: true });
      let firstFilePath: string | undefined;
      for (const file of resource.files) {
        totalFiles += 1;
        totalBytes += file.bytes.byteLength;
        if (totalFiles > MAX_PORTABLE_WHITEBOARD_RESOURCE_FILES) throw new Error("白板便携文件数量超过 20000 个");
        if (totalBytes > MAX_PORTABLE_WHITEBOARD_RESOURCE_BYTES) throw new Error("白板便携文件内容超过 256MB");
        const relativePath = safeRelativePath(file.relativePath);
        const target = resource.kind === "folder"
          ? join(destination, ...relativePath.split("/"))
          : destination;
        const resolvedTarget = resolve(target);
        const relativeTarget = relative(importRoot, resolvedTarget);
        if (relativeTarget.startsWith("..") || isAbsolute(relativeTarget)) throw new Error("白板便携文件路径越界");
        await mkdir(dirname(resolvedTarget), { recursive: true });
        await writeFile(resolvedTarget, file.bytes);
        firstFilePath ??= resolvedTarget;
      }
      if (resource.kind === "file" && !firstFilePath) throw new Error(`白板映射文件缺少内容：${safeName}`);
      restored.push({
        shapeId: resource.shapeId,
        name: safeName,
        kind: resource.kind,
        localPath: resource.kind === "folder" ? destination : firstFilePath!,
      });
    }
    return restored;
  } catch (error) {
    await rm(importRoot, { recursive: true, force: true });
    throw error;
  }
}
