import { EditorDraftStore } from "./editor-draft-store.js";
import { assertOfficeExport, inspectOfficeQuality } from './office-quality.js';
import { withFileEdit } from "./file-edit-guard.js";
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { Context } from "@deepseek-ai/cordis";
import { GatewayUniverService, resolveConfig } from "dsh-univer-office";
import { UNIVER_LIBRARY_IMAGE_FORMATS_LABEL, isUniverLibraryImageName } from "../shared/univer-image-contract.js";
import {
  preserveUniverDocumentParagraphBorders,
  readWordDocumentParagraphBorders,
  replaceFileAtomically,
  type UniverDocumentParagraphBorder,
} from "./workbench-office-editor.js";

type JsonRecord = Record<string, unknown>;
type OfficeUnitType = 1 | 2 | 3;
export type UniverUnitKind = "doc" | "sheet" | "slide" | "base" | "board";

export type UniverUnitSummary = {
  unitId: string;
  kind?: UniverUnitKind;
  name?: string;
};

export type UniverOfficeSession = {
  sessionId: string;
  itemId: string;
  sourcePath: string;
  viewerUrl: string;
  worktreeId: string;
  unitId: string;
  kind: "document" | "spreadsheet" | "presentation" | "workspace";
  units?: UniverUnitSummary[];
  recoveredDraft?: boolean;
};

export type UniverLibraryImageInsert = {
  slideId?: string;
  sheetId?: string;
  unitId?: string;
  startOffset?: number;
  endOffset?: number;
  segmentId?: string;
  row?: number;
  column?: number;
  left?: number;
  top?: number;
  width?: number;
  height?: number;
};

const UNIVER_IMAGE_MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".jpe": "image/jpeg",
  ".jfif": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

const UNIVER_IMAGE_SOURCE_MAX_BYTES = 96 * 1024 * 1024;
const UNIVER_IMAGE_INLINE_MAX_BYTES = 16 * 1024 * 1024;
const UNIVER_IMAGE_MAX_INPUT_PIXELS = 64_000_000;
const UNIVER_IMAGE_MAX_EDGE = 6_000;
const UNIVER_IMAGE_REDUCTION_EDGES = [6_000, 4_096, 3_072, 2_048, 1_600] as const;

type PreparedUniverImage = {
  contents: Buffer;
  mime: string;
  dimensions: { width: number; height: number };
  sourceFormat: string;
  embeddedFormat: string;
  sourceBytes: number;
  embeddedBytes: number;
  optimized: boolean;
};

type DecodedBitmap = {
  data: Buffer;
  width: number;
  height: number;
  hasAlpha: boolean;
};

type SharpFactory = typeof import("sharp").default;
let sharpFactoryPromise: Promise<SharpFactory> | undefined;

async function loadSharp(): Promise<SharpFactory> {
  if (!sharpFactoryPromise) {
    sharpFactoryPromise = import("sharp").then((module) =>
      (module as unknown as { default?: SharpFactory }).default
      ?? (module as unknown as SharpFactory));
  }
  return sharpFactoryPromise;
}

function decodeBitmap(contents: Buffer): DecodedBitmap {
  if (contents.length < 54 || contents.subarray(0, 2).toString("ascii") !== "BM") {
    throw new Error("BMP 文件头无效");
  }
  const pixelOffset = contents.readUInt32LE(10);
  const dibSize = contents.readUInt32LE(14);
  const width = contents.readInt32LE(18);
  const signedHeight = contents.readInt32LE(22);
  const planes = contents.readUInt16LE(26);
  const bitsPerPixel = contents.readUInt16LE(28);
  const compression = contents.readUInt32LE(30);
  const height = Math.abs(signedHeight);
  if (dibSize < 40 || planes !== 1 || width <= 0 || height <= 0 || ![24, 32].includes(bitsPerPixel) || compression !== 0) {
    throw new Error("仅支持未压缩的 24 位或 32 位 BMP 图片");
  }
  if (width * height > UNIVER_IMAGE_MAX_INPUT_PIXELS) throw new Error("BMP 图片像素数量过大");
  const rowStride = Math.ceil((width * bitsPerPixel) / 32) * 4;
  if (pixelOffset + rowStride * height > contents.length) throw new Error("BMP 像素数据不完整");
  const data = Buffer.allocUnsafe(width * height * 4);
  let nonZeroAlpha = false;
  for (let y = 0; y < height; y += 1) {
    const sourceY = signedHeight > 0 ? height - y - 1 : y;
    const row = pixelOffset + sourceY * rowStride;
    for (let x = 0; x < width; x += 1) {
      const source = row + x * (bitsPerPixel / 8);
      const target = (y * width + x) * 4;
      data[target] = contents[source + 2]!;
      data[target + 1] = contents[source + 1]!;
      data[target + 2] = contents[source]!;
      const alpha = bitsPerPixel === 32 ? contents[source + 3]! : 255;
      data[target + 3] = alpha;
      if (alpha !== 0) nonZeroAlpha = true;
    }
  }
  if (bitsPerPixel === 32 && !nonZeroAlpha) {
    for (let offset = 3; offset < data.length; offset += 4) data[offset] = 255;
  }
  return { data, width, height, hasAlpha: bitsPerPixel === 32 && nonZeroAlpha };
}

export function officeImageDimensions(contents: Buffer, extension: string): { width: number; height: number } | undefined {
  const normalized = extension.toLowerCase();
  if (
    normalized === ".png"
    && contents.length >= 24
    && contents.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return { width: contents.readUInt32BE(16), height: contents.readUInt32BE(20) };
  }
  if (normalized === ".gif" && contents.length >= 10 && contents.subarray(0, 3).toString("ascii") === "GIF") {
    return { width: contents.readUInt16LE(6), height: contents.readUInt16LE(8) };
  }
  if ([".jpg", ".jpeg", ".jpe", ".jfif"].includes(normalized) && contents.length >= 4 && contents[0] === 0xff && contents[1] === 0xd8) {
    let offset = 2;
    while (offset + 8 < contents.length) {
      if (contents[offset] !== 0xff) { offset += 1; continue; }
      const marker = contents[offset + 1]!;
      if (marker === 0xd8 || marker === 0xd9) { offset += 2; continue; }
      const length = contents.readUInt16BE(offset + 2);
      if (length < 2 || offset + length + 2 > contents.length) break;
      if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
        return { width: contents.readUInt16BE(offset + 7), height: contents.readUInt16BE(offset + 5) };
      }
      offset += length + 2;
    }
  }
  if (normalized === ".webp" && contents.length >= 30 && contents.subarray(0, 4).toString("ascii") === "RIFF" && contents.subarray(8, 12).toString("ascii") === "WEBP") {
    const kind = contents.subarray(12, 16).toString("ascii");
    if (kind === "VP8X") return { width: 1 + contents.readUIntLE(24, 3), height: 1 + contents.readUIntLE(27, 3) };
    if (kind === "VP8 ") return { width: contents.readUInt16LE(26) & 0x3fff, height: contents.readUInt16LE(28) & 0x3fff };
    if (kind === "VP8L" && contents.length >= 25) {
      const bits = contents.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
  }
  if (normalized === ".svg") {
    const source = contents.subarray(0, Math.min(contents.length, 256_000)).toString("utf8");
    const svg = source.match(/<svg\b[^>]*>/iu)?.[0] ?? "";
    const number = (name: string) => Number(svg.match(new RegExp(`\\b${name}=["']\\s*([0-9]+(?:\\.[0-9]+)?)`, "iu"))?.[1]);
    const width = number("width");
    const height = number("height");
    if (width > 0 && height > 0) return { width, height };
    const viewBox = svg.match(/\bviewBox=["']\s*[-+0-9.e]+[ ,]+[-+0-9.e]+[ ,]+([-+0-9.e]+)[ ,]+([-+0-9.e]+)/iu);
    const viewWidth = Number(viewBox?.[1]);
    const viewHeight = Number(viewBox?.[2]);
    if (viewWidth > 0 && viewHeight > 0) return { width: viewWidth, height: viewHeight };
  }
  return undefined;
}

async function prepareUniverImage(contents: Buffer, extension: string): Promise<PreparedUniverImage> {
  const sourceMime = UNIVER_IMAGE_MIME_TYPES[extension];
  const detectedDimensions = officeImageDimensions(contents, extension);
  const needsNormalization = !sourceMime
    || contents.length > UNIVER_IMAGE_INLINE_MAX_BYTES
    || !detectedDimensions
    || detectedDimensions.width > UNIVER_IMAGE_MAX_EDGE
    || detectedDimensions.height > UNIVER_IMAGE_MAX_EDGE
    || detectedDimensions.width * detectedDimensions.height > UNIVER_IMAGE_MAX_INPUT_PIXELS;
  if (sourceMime && detectedDimensions && !needsNormalization) {
    return {
      contents,
      mime: sourceMime,
      dimensions: detectedDimensions,
      sourceFormat: extension.slice(1),
      embeddedFormat: extension.slice(1),
      sourceBytes: contents.length,
      embeddedBytes: contents.length,
      optimized: false,
    };
  }

  const sharp = await loadSharp();
  let bitmap: DecodedBitmap | undefined;
  if (extension === ".bmp") bitmap = decodeBitmap(contents);
  const createPipeline = () => bitmap
    ? sharp(bitmap.data, { raw: { width: bitmap.width, height: bitmap.height, channels: 4 } })
    : sharp(contents, {
      failOn: "error",
      limitInputPixels: UNIVER_IMAGE_MAX_INPUT_PIXELS,
      pages: 1,
    });
  let metadata: { width?: number; height?: number; hasAlpha?: boolean };
  try {
    metadata = bitmap
      ? { width: bitmap.width, height: bitmap.height, hasAlpha: bitmap.hasAlpha }
      : await createPipeline().metadata();
  } catch {
    throw new Error(`无法解码该图片，请使用${UNIVER_LIBRARY_IMAGE_FORMATS_LABEL}格式的有效文件`);
  }
  if (!metadata.width || !metadata.height) throw new Error("无法读取资料库图片尺寸");
  const transparent = metadata.hasAlpha === true;
  let lastBytes = Number.POSITIVE_INFINITY;
  try {
    for (const edge of UNIVER_IMAGE_REDUCTION_EDGES) {
      const pipeline = createPipeline()
        .rotate()
        .resize({ width: edge, height: edge, fit: "inside", withoutEnlargement: true });
      const encoded = transparent
        ? await pipeline.png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer({ resolveWithObject: true })
        : await pipeline.jpeg({ quality: 90, progressive: true, mozjpeg: true }).toBuffer({ resolveWithObject: true });
      lastBytes = encoded.data.length;
      if (lastBytes <= UNIVER_IMAGE_INLINE_MAX_BYTES) {
        return {
          contents: encoded.data,
          mime: transparent ? "image/png" : "image/jpeg",
          dimensions: { width: encoded.info.width, height: encoded.info.height },
          sourceFormat: extension.slice(1),
          embeddedFormat: transparent ? "png" : "jpeg",
          sourceBytes: contents.length,
          embeddedBytes: encoded.data.length,
          optimized: true,
        };
      }
    }
  } catch (error) {
    throw new Error(`图片转换失败：${error instanceof Error ? error.message : "无法解码图片"}`);
  }
  throw new Error(`图片优化后仍超过 16MB（当前约 ${Math.ceil(lastBytes / 1024 / 1024)}MB），请降低分辨率后重试`);
}

type RuntimeSession = UniverOfficeSession & {
  workspace: string;
  univerPath: string;
  unitType: OfficeUnitType;
  unitKind: UniverUnitKind;
  sourceFormat: "office" | "univer";
  sourceSize: number;
  sourceModifiedMs: number;
  merged: boolean;
  hasChanges: boolean;
};

export function univerOfficeFileType(path: string): {
  unitType: OfficeUnitType;
  unitKind: UniverUnitKind;
  kind: UniverOfficeSession["kind"];
} {
  const extension = extname(path).toLowerCase();
  if (extension === ".docx") return { unitType: 1, unitKind: "doc", kind: "document" };
  if ([".xlsx", ".csv", ".tsv"].includes(extension)) return { unitType: 2, unitKind: "sheet", kind: "spreadsheet" };
  if (extension === ".pptx") return { unitType: 3, unitKind: "slide", kind: "presentation" };
  throw new Error("Univer 编辑器仅支持 DOCX、XLSX、CSV、TSV 和 PPTX 文件");
}

export function serializeUniverDelimitedRows(rows: readonly (readonly string[])[], delimiter: "," | "\t"): string {
  return rows.map((row) => row.map((value) => {
    const text = String(value ?? "");
    return text.includes(delimiter) || /["\r\n]/u.test(text)
      ? `"${text.replaceAll('"', '""')}"`
      : text;
  }).join(delimiter)).join("\r\n");
}

function unitSummaries(value: unknown): UniverUnitSummary[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const item = entry as JsonRecord;
    if (typeof item.unitId !== "string" || !item.unitId) return [];
    const kind = typeof item.kind === "string" && ["doc", "sheet", "slide", "base", "board"].includes(item.kind)
      ? item.kind as UniverUnitKind
      : undefined;
    return [{
      unitId: item.unitId,
      ...(kind ? { kind } : {}),
      ...(typeof item.name === "string" && item.name ? { name: item.name } : {}),
    }];
  });
}

function selectedWorktreeUnits(status: JsonRecord): UniverUnitSummary[] {
  const selected = status.selectedWorktree && typeof status.selectedWorktree === "object" && !Array.isArray(status.selectedWorktree)
    ? status.selectedWorktree as JsonRecord
    : undefined;
  const trunk = status.trunk && typeof status.trunk === "object" && !Array.isArray(status.trunk)
    ? status.trunk as JsonRecord
    : undefined;
  return unitSummaries(selected?.units ?? trunk?.units);
}

function asRecord(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} 返回了无效数据`);
  }
  return value as JsonRecord;
}

function operationResult(value: unknown, label: string): JsonRecord {
  const envelope = asRecord(value, label);
  if (envelope.ok !== true) throw operationError(envelope, label);
  return asRecord(envelope.result, `${label} 结果`);
}

function operationValue(value: unknown, label: string): unknown {
  const envelope = asRecord(value, label);
  if (envelope.ok !== true) throw operationError(envelope, label);
  return envelope.result;
}

function operationError(envelope: JsonRecord, label: string): Error {
  const detail = typeof envelope.error === 'string' ? envelope.error
    : envelope.error && typeof envelope.error === 'object' ? (envelope.error as JsonRecord).message
    : envelope.message;
  return new Error(`${label} 执行失败${typeof detail === 'string' && detail.trim() ? `：${detail.slice(0, 1500)}` : ''}。请先检查当前草稿状态后修正，不要盲目重复写入。`);
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) throw new Error(`${label} 缺少有效标识`);
  return value;
}

export function editableWorktreeViewerUrl(
  fileState: JsonRecord,
  worktreeId: string,
  unitId: string,
): string {
  const worktrees = Array.isArray(fileState.worktrees) ? fileState.worktrees : [];
  const worktree = worktrees
    .filter((value): value is JsonRecord => Boolean(value) && typeof value === "object" && !Array.isArray(value))
    .find((value) => value.worktreeId === worktreeId);
  if (!worktree) throw new Error("Univer 编辑草稿缺少可用的 Worktree Viewer");
  const units = Array.isArray(worktree.units) ? worktree.units : [];
  const unit = units
    .filter((value): value is JsonRecord => Boolean(value) && typeof value === "object" && !Array.isArray(value))
    .find((value) => value.unitId === unitId);
  const viewer = new URL(requiredString(unit?.worktreeUrl ?? worktree.worktreeUrl, "Univer 编辑草稿"));
  // Keep every manual Office surface on the same editable worktree that MOKI
  // inspects and mutates; the original file remains behind the explicit Save.
  viewer.searchParams.set("unit", unitId);
  viewer.searchParams.set("mode", "embedded");
  viewer.searchParams.set("scope", "worktree");
  viewer.searchParams.set("editable", "true");
  viewer.searchParams.set("lang", "zh-CN");
  return viewer.href;
}

/**
 * Adapts the official dsh-univer-office service to MOKI's resource-library
 * confirmation model. Every open resource owns an isolated .univer file and
 * draft worktree; the original Office file changes only in save().
 */
const checkpointTimers = new WeakMap<object, Map<string, ReturnType<typeof setTimeout>>>();
const sessionQueues = new WeakMap<object, Map<string, Promise<void>>>();

export class UniverOfficeRuntime {
  private readonly service: GatewayUniverService;
  private readonly sessions = new Map<string, RuntimeSession>();
  private readonly stateDirectory: string;

  constructor(stateDirectory: string, options: { gatewayPort?: number } = {}) {
    this.stateDirectory = resolve(stateDirectory);
    this.service = new GatewayUniverService(new Context(), resolveConfig({
      gatewayPort: options.gatewayPort ?? 9080,
      autoStartGateway: true,
      tools: false,
      skills: false,
      resourceCacheRoot: join(this.stateDirectory, "univer-resource-cache"),
    }));
  }

  /** Serialize the complete read/modify/commit cycle, including reads and saves.
   * Different drafts remain independent; a failed operation does not poison the queue.
   */
  private inSession<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
    let queues = sessionQueues.get(this);
    if (!queues) { queues = new Map(); sessionQueues.set(this, queues); }
    const previous = queues.get(sessionId) ?? Promise.resolve();
    const result = previous.then(operation);
    const settled = result.then(() => undefined, () => undefined);
    queues.set(sessionId, settled);
    void settled.then(() => { if (queues.get(sessionId) === settled) queues.delete(sessionId); });
    return result;
  }

  async open(itemId: string, sourcePath: string, displayName: string): Promise<UniverOfficeSession> {
    const canonicalSource = await realpath(sourcePath);
    const source = await stat(canonicalSource);
    if (!source.isFile()) throw new Error("Univer 映射目标不是文件");
    const existing = [...this.sessions.values()].find((session) => (
      !session.merged
      && session.itemId === itemId
      && session.sourcePath === canonicalSource
    ));
    if (existing) {
      return {
        sessionId: existing.sessionId,
        itemId: existing.itemId,
        sourcePath: existing.sourcePath,
        viewerUrl: existing.viewerUrl,
        worktreeId: existing.worktreeId,
        unitId: existing.unitId,
        kind: existing.kind,
        ...(existing.units ? { units: existing.units } : {}),
        ...(existing.hasChanges ? { recoveredDraft: true } : {}),
      };
    }
    const stored = await this.draftStore().get('office:'+itemId);
    const recovery = stored?.sourcePath === canonicalSource ? stored : undefined;
    let importSource = canonicalSource;
    if (recovery) {
      const restoreDirectory = join(this.stateDirectory, 'office-recovery', randomUUID());
      await mkdir(restoreDirectory, {recursive:true});
      importSource = join(restoreDirectory, basename(canonicalSource));
      await writeFile(importSource, recovery.content);
    }
    if (extname(canonicalSource).toLowerCase() === ".univer") {
      const opened = await this.openNative(itemId, importSource, recovery?.sourceSize ?? source.size, recovery?.sourceModifiedMs ?? source.mtimeMs, displayName, recovery?.nativeWorktreeId);
      this.requireSession(opened.sessionId).sourcePath = canonicalSource;
      return {...opened,sourcePath:canonicalSource};
    }
    const { unitType, unitKind, kind } = univerOfficeFileType(canonicalSource);
    const sessionId = randomUUID();
    const sessionDirectory = join(this.stateDirectory, "univer-office-sessions", sessionId);
    await mkdir(sessionDirectory, { recursive: true });
    const workspace = await realpath(sessionDirectory);
    const univerPath = join(workspace, "document.univer");
    try {
      await this.service.newFile({ workspace, file: univerPath });
      const bootstrap = operationResult(await this.service.worktree({
        workspace,
        file: univerPath,
        action: "create",
        name: "MOKI Office import",
      }), "Univer 导入草稿");
      const bootstrapId = requiredString(bootstrap.worktreeId, "Univer 导入草稿");
      const imported = operationResult(await this.service.importUnitContent({
        workspace,
        file: univerPath,
        sourceWorkspace: dirname(importSource),
        source: importSource,
        worktreeId: bootstrapId,
        name: displayName || basename(canonicalSource),
      }), "Univer Office 导入");
      const unitId = requiredString(imported.unitId, "Univer Unit");
      await this.service.worktree({ workspace, file: univerPath, action: "ready", worktreeId: bootstrapId });
      await this.service.worktree({ workspace, file: univerPath, action: "merge", worktreeId: bootstrapId });

      const editing = operationResult(await this.service.worktree({
        workspace,
        file: univerPath,
        action: "create",
        name: `编辑 ${displayName || basename(canonicalSource)}`,
      }), "Univer 编辑草稿");
      const worktreeId = requiredString(editing.worktreeId, "Univer 编辑草稿");
      if (unitKind === "doc") {
        const paragraphBorders = readWordDocumentParagraphBorders(await readFile(importSource));
        if (paragraphBorders.length) {
          const restored = operationResult(await this.service.executeUnitContent({
            workspace,
            file: univerPath,
            worktreeId,
            unitId,
            code: `const document = univerAPI.getActiveDocument();
const paragraphs = document.getParagraphs();
const borders = ${JSON.stringify(paragraphBorders)};
let applied = 0;
for (const border of borders) {
  const paragraph = paragraphs[border.paragraphIndex];
  if (!paragraph) continue;
  if (paragraph.setStyle({
    borderBottom: {
      color: { rgb: border.color ?? "#CDD0D8" },
      width: border.width ?? 1,
      padding: border.padding ?? 5,
      dashStyle: border.dashStyle ?? 1,
    },
    spaceBelow: { v: 10 },
  })) applied += 1;
}
return { applied };`,
          }), "Univer 分割线恢复");
          const restoredValue = restored.value && typeof restored.value === "object" && !Array.isArray(restored.value)
            ? restored.value as JsonRecord
            : {};
          if (restoredValue.applied !== paragraphBorders.length) {
            throw new Error("Word 分割线恢复不完整，请重新打开文档后再试");
          }
        }
      }
      const fileState = asRecord(await this.service.fileState({ workspace, file: univerPath }), "Univer 文件状态");
      // MOKI and the manual editor must share the same isolated worktree. The
      // bundled viewer patch enables editing on this draft surface, so confirmed
      // assistant writes arrive through Univer's worktree event stream immediately.
      // The original Office file still changes only when save() merges and exports.
      const viewerUrl = editableWorktreeViewerUrl(fileState, worktreeId, unitId);

      const session: RuntimeSession = {
        sessionId,
        itemId,
        sourcePath: canonicalSource,
        viewerUrl,
        worktreeId,
        unitId,
        unitType,
        unitKind,
        kind,
        sourceFormat: "office",
        workspace,
        univerPath,
        sourceSize: recovery?.sourceSize ?? source.size,
        sourceModifiedMs: recovery?.sourceModifiedMs ?? source.mtimeMs,
        merged: false,
        hasChanges: Boolean(recovery),
      };
      this.sessions.set(sessionId, session);
      return {
        sessionId: session.sessionId,
        itemId: session.itemId,
        sourcePath: session.sourcePath,
        viewerUrl: session.viewerUrl,
        worktreeId: session.worktreeId,
        unitId: session.unitId,
        kind: session.kind,
        ...(session.hasChanges ? { recoveredDraft: true } : {}),
      };
    } catch (error) {
      await rm(sessionDirectory, { recursive: true, force: true });
      throw error;
    }
  }

  async createNativeFile(
    filePath: string,
    kind: UniverUnitKind = "sheet",
    name = "MOKI Univer",
  ): Promise<{ unitId: string; kind: UniverUnitKind }> {
    const destinationDirectory = await realpath(dirname(filePath));
    const destination = join(destinationDirectory, basename(filePath));
    const sessionDirectory = join(this.stateDirectory, "univer-create-sessions", randomUUID());
    await mkdir(sessionDirectory, { recursive: true });
    const workspace = await realpath(sessionDirectory);
    const targetPath = join(workspace, "document.univer");
    let wroteDestination = false;
    try {
      await this.service.newFile({ workspace, file: targetPath });
      const draft = operationResult(await this.service.worktree({
        workspace,
        file: targetPath,
        action: "create",
        name: `创建 ${name}`,
      }), "Univer 新建草稿");
      const worktreeId = requiredString(draft.worktreeId, "Univer 新建草稿");
      const created = operationResult(await this.service.unit({
        workspace,
        file: targetPath,
        worktreeId,
        action: "create",
        kind,
        name,
      }), "Univer Unit 创建");
      const unitId = requiredString(created.unitId, "Univer Unit");
      await this.service.worktree({ workspace, file: targetPath, action: "ready", worktreeId });
      await this.service.worktree({ workspace, file: targetPath, action: "merge", worktreeId });
      const contents = await readFile(targetPath);
      if (!contents.length) throw new Error("Univer 工作区文件为空");
      await writeFile(destination, contents, { flag: "wx" });
      wroteDestination = true;
      return { unitId, kind };
    } catch (error) {
      if (wroteDestination) await rm(destination, { force: true, maxRetries: 5, retryDelay: 100 }).catch(() => undefined);
      throw error;
    } finally {
      await rm(sessionDirectory, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 }).catch(() => undefined);
    }
  }

  private async openNative(
    itemId: string,
    canonicalSource: string,
    sourceSize: number,
    sourceModifiedMs: number,
    displayName: string,
    recoveryWorktreeId?: string,
  ): Promise<UniverOfficeSession> {
    const sessionId = randomUUID();
    const sessionDirectory = join(this.stateDirectory, "univer-office-sessions", sessionId);
    await mkdir(sessionDirectory, { recursive: true });
    const workspace = await realpath(sessionDirectory);
    const univerPath = join(workspace, "document.univer");
    try {
      await copyFile(canonicalSource, univerPath);
      const trunk = operationResult(await this.service.status({ workspace, file: univerPath }), "Univer 文件状态");
      const trunkRecord = trunk.trunk && typeof trunk.trunk === "object" && !Array.isArray(trunk.trunk)
        ? trunk.trunk as JsonRecord
        : {};
      let units = recoveryWorktreeId ? selectedWorktreeUnits(operationResult(await this.service.status({workspace,file:univerPath,worktreeId:recoveryWorktreeId}), "恢复工作区")) : unitSummaries(trunkRecord.units);
      const editing = recoveryWorktreeId ? {worktreeId:recoveryWorktreeId} : operationResult(await this.service.worktree({
        workspace,
        file: univerPath,
        action: "create",
        name: `编辑 ${displayName || basename(canonicalSource)}`,
      }), "Univer 编辑草稿");
      const worktreeId = requiredString(editing.worktreeId, "Univer 编辑草稿");
      if (!units.length) {
        const created = operationResult(await this.service.unit({
          workspace,
          file: univerPath,
          worktreeId,
          action: "create",
          kind: "sheet",
          name: "Sheet1",
        }), "Univer 默认 Unit");
        units = [{ unitId: requiredString(created.unitId, "Univer 默认 Unit"), kind: "sheet", name: "Sheet1" }];
      }
      const primary = units[0]!;
      const fileState = asRecord(await this.service.fileState({ workspace, file: univerPath }), "Univer 文件状态");
      // Keep native workspaces on the same editable draft surface used by MOKI.
      // The copied session file preserves the save/cancel boundary for the source.
      const viewerUrl = editableWorktreeViewerUrl(fileState, worktreeId, primary.unitId);
      const unitKind = primary.kind ?? "sheet";
      const unitType = unitKind === "doc" ? 1 : unitKind === "slide" ? 3 : 2;
      const session: RuntimeSession = {
        sessionId,
        itemId,
        sourcePath: canonicalSource,
        viewerUrl,
        worktreeId,
        unitId: primary.unitId,
        units,
        unitType,
        unitKind,
        kind: "workspace",
        sourceFormat: "univer",
        workspace,
        univerPath,
        sourceSize,
        sourceModifiedMs,
        merged: false,
        hasChanges: Boolean(recoveryWorktreeId),
      };
      this.sessions.set(sessionId, session);
      return {
        sessionId,
        itemId,
        sourcePath: canonicalSource,
        viewerUrl,
        worktreeId,
        unitId: primary.unitId,
        units,
        kind: "workspace",
        ...(session.hasChanges ? { recoveredDraft: true } : {}),
      };
    } catch (error) {
      await rm(sessionDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => undefined);
      throw error;
    }
  }

  private draftStore() { return new EditorDraftStore(join(this.stateDirectory, 'editor-drafts')); }
  private scheduleCheckpoint(sessionId: string) {
    if (!this.stateDirectory) return;
    const session = this.sessions.get(sessionId);
    if (session) session.hasChanges = true;
    let timers=checkpointTimers.get(this);if(!timers){timers=new Map();checkpointTimers.set(this,timers);}
    clearTimeout(timers.get(sessionId));
    timers.set(sessionId,setTimeout(()=>{timers.delete(sessionId);void this.checkpoint(sessionId).catch(()=>undefined);},1500));
  }
  async checkpoint(sessionId: string, itemId?: string): Promise<{savedAt:string}> {
    return this.inSession(sessionId,async()=>{
      const session=this.requireSession(sessionId,itemId);
      session.hasChanges = true;
      const exported=await this.exportDraftInSession(sessionId,session.itemId);
      try {return await this.draftStore().put('office:'+session.itemId,await readFile(exported.path),{
        sourcePath:session.sourcePath,sourceSize:session.sourceSize,sourceModifiedMs:session.sourceModifiedMs,
        ...(session.sourceFormat==='univer'?{nativeWorktreeId:session.worktreeId}:{}),
      });} finally {await rm(exported.path,{force:true});}
    });
  }
  private async clearCheckpoint(session: RuntimeSession) {
    clearTimeout(checkpointTimers.get(this)?.get(session.sessionId));
    checkpointTimers.get(this)?.delete(session.sessionId);
    if(this.stateDirectory) await this.draftStore().remove('office:'+session.itemId);
  }

  async save(sessionId: string, itemId?: string): Promise<{ size: number; updatedAt: string }> {
    return this.inSession(sessionId, async () => {
      const session = this.requireSession(sessionId, itemId);
      return withFileEdit(session.sourcePath, undefined, async () => {
        await this.assertSourceUnchanged(session);
        if (session.sourceFormat === "univer") {
          await this.mergeSessionWorktree(session);
          const contents = await readFile(session.univerPath);
          if (!contents.length) throw new Error("Univer 工作区文件为空");
          await replaceFileAtomically(session.sourcePath, contents);
          await this.clearCheckpoint(session);
        this.sessions.delete(sessionId);
          const saved = await stat(session.sourcePath);
          return { size: saved.size, updatedAt: saved.mtime.toISOString() };
        }
        const extension = extname(session.sourcePath);
        const documentBorders = extension.toLowerCase() === ".docx"
          ? await this.documentParagraphBorders(session)
          : [];
        const exportedPath = join(dirname(session.sourcePath), `.${randomUUID()}.moki-univer-export${extension}`);
        try {
          let exported = [".csv", ".tsv"].includes(extension.toLowerCase())
            ? await this.delimitedFileContents(session, extension.toLowerCase() === ".tsv" ? "\t" : ",")
            : await this.exportOfficeFile(session, exportedPath, dirname(session.sourcePath));
          if (!exported.length) throw new Error("Univer 导出的 Office 文件为空");
          if (documentBorders.length) {
            exported = preserveUniverDocumentParagraphBorders(exported, documentBorders);
          }
          assertOfficeExport(exported, extension);
          await replaceFileAtomically(session.sourcePath, exported);
        } finally {
          await rm(exportedPath, { force: true });
        }
        await this.clearCheckpoint(session);
        this.sessions.delete(sessionId);
        const saved = await stat(session.sourcePath);
        return { size: saved.size, updatedAt: saved.mtime.toISOString() };
      });
    });
  }

  async saveAs(
    sessionId: string,
    destination: string,
    itemId?: string,
  ): Promise<{ path: string; size: number; updatedAt: string }> {
    return this.inSession(sessionId, async () => {
      const session = this.requireSession(sessionId, itemId);
      const resolvedDestination = resolve(destination);
      if (resolvedDestination.toLowerCase() === resolve(session.sourcePath).toLowerCase()) {
        throw new Error('另存为不能覆盖原文件，请使用保存操作或选择其他路径');
      }
      if (extname(resolvedDestination).toLowerCase() !== extname(session.sourcePath).toLowerCase()) {
        throw new Error(`另存为文件必须保留 ${extname(session.sourcePath).toLowerCase()} 格式`);
      }
      await mkdir(dirname(resolvedDestination), { recursive: true });
      let contents: Buffer;
      if (session.sourceFormat === "univer") {
        await this.mergeSessionWorktree(session);
        contents = await readFile(session.univerPath);
      } else {
        const documentBorders = extname(session.sourcePath).toLowerCase() === ".docx"
          ? await this.documentParagraphBorders(session)
          : [];
        const exportedPath = join(session.workspace, `save-as-${randomUUID()}${extname(session.sourcePath)}`);
        try {
          const sourceExtension = extname(session.sourcePath).toLowerCase();
          contents = [".csv", ".tsv"].includes(sourceExtension)
            ? await this.delimitedFileContents(session, sourceExtension === ".tsv" ? "\t" : ",")
            : await this.exportOfficeFile(session, exportedPath, session.workspace);
          if (documentBorders.length) {
            contents = preserveUniverDocumentParagraphBorders(contents, documentBorders);
          }
        } finally {
          await rm(exportedPath, { force: true });
        }
      }
      if (!contents.length) throw new Error("Univer 导出的另存为文件为空");
      assertOfficeExport(contents, extname(session.sourcePath));
      if (await stat(resolvedDestination).then((value) => value.isFile()).catch(() => false)) {
        await replaceFileAtomically(resolvedDestination, contents);
      } else {
        const temporary = join(dirname(resolvedDestination), `.${randomUUID()}.moki-save-as.tmp`);
        try {
          await writeFile(temporary, contents, { flag: "wx" });
          await rename(temporary, resolvedDestination);
        } finally {
          await rm(temporary, { force: true });
        }
      }
      await this.clearCheckpoint(session);
        this.sessions.delete(sessionId);
      const saved = await stat(resolvedDestination);
      return { path: resolvedDestination, size: saved.size, updatedAt: saved.mtime.toISOString() };
    });
  }

  private async assertSourceUnchanged(session: RuntimeSession): Promise<void> {
    const current = await stat(session.sourcePath);
    if (current.size !== session.sourceSize || current.mtimeMs !== session.sourceModifiedMs) {
      throw new Error("原 Office 文件在编辑期间已被其他程序修改，草稿仍保留；可另存当前草稿，或读取最新原文件后合并修改");
    }
  }

  private async exportOfficeFile(session: RuntimeSession, output: string, outputWorkspace: string): Promise<Buffer> {
    await this.service.exportUnitContent({
      workspace: session.workspace,
      file: session.univerPath,
      outputWorkspace,
      output,
      unitId: session.unitId,
      // Export the live draft before merging it. Besides preserving manual
      // editor changes, the worktree keeps uploaded image assets in scope so
      // the patched export worker can inline their UUID sources as Base64.
      // Exporting the merged trunk loses that asset scope and rejects PPTX
      // images with "media source must be an inline base64 data URI".
      ...(session.merged ? {} : { worktreeId: session.worktreeId }),
    });
    const contents = await readFile(output);
    assertOfficeExport(contents, extname(output));
    return contents;
  }

  private async delimitedFileContents(session: RuntimeSession, delimiter: "," | "\t"): Promise<Buffer> {
    const result = operationResult(await this.service.executeUnitContent({
      workspace: session.workspace,
      file: session.univerPath,
      worktreeId: session.worktreeId,
      unitId: session.unitId,
      code: `const sheets = workbook.getSheets();
if (sheets.length !== 1) throw new Error("CSV/TSV 文件只能保存一个工作表");
return { rows: sheets[0].getDataRange().getDisplayValues() };`,
    }), "Univer CSV/TSV 导出");
    const value = asRecord(result.value, "Univer CSV/TSV 导出结果");
    if (!Array.isArray(value.rows) || value.rows.some((row) => !Array.isArray(row) || row.some((cell) => typeof cell !== "string"))) {
      throw new Error("Univer CSV/TSV 导出返回了无效表格数据");
    }
    const original = await readFile(session.sourcePath);
    const prefix = original.length >= 3 && original[0] === 0xef && original[1] === 0xbb && original[2] === 0xbf ? "\uFEFF" : "";
    return Buffer.from(prefix + serializeUniverDelimitedRows(value.rows as string[][], delimiter), "utf8");
  }

  private async documentParagraphBorders(session: RuntimeSession): Promise<UniverDocumentParagraphBorder[]> {
    const result = operationResult(await this.service.executeUnitContent({
      workspace: session.workspace,
      file: session.univerPath,
      worktreeId: session.worktreeId,
      unitId: session.unitId,
      code: `const body = univerAPI.getActiveDocument().getBody();
return (body.paragraphs ?? []).flatMap((paragraph, paragraphIndex) => {
  const border = paragraph.paragraphStyle?.borderBottom;
  if (!border) return [];
  return [{
    paragraphIndex,
    color: border.color?.rgb,
    width: border.width,
    padding: border.padding,
    dashStyle: border.dashStyle,
  }];
});`,
    }), "Univer 分割线检查");
    if (!Array.isArray(result.value)) return [];
    return result.value.flatMap((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
      const value = entry as JsonRecord;
      if (typeof value.paragraphIndex !== "number" || !Number.isSafeInteger(value.paragraphIndex) || value.paragraphIndex < 0) {
        return [];
      }
      return [{
        paragraphIndex: value.paragraphIndex,
        ...(typeof value.color === "string" ? { color: value.color } : {}),
        ...(typeof value.width === "number" ? { width: value.width } : {}),
        ...(typeof value.padding === "number" ? { padding: value.padding } : {}),
        ...(typeof value.dashStyle === "number" ? { dashStyle: value.dashStyle } : {}),
      }];
    });
  }

  private async mergeSessionWorktree(session: RuntimeSession): Promise<void> {
    if (session.merged) return;
    await this.service.worktree({
      workspace: session.workspace,
      file: session.univerPath,
      action: "ready",
      worktreeId: session.worktreeId,
    });
    await this.service.worktree({
      workspace: session.workspace,
      file: session.univerPath,
      action: "merge",
      worktreeId: session.worktreeId,
    });
    session.merged = true;
  }

  async execute(
    sessionId: string,
    itemId: string,
    code: string,
    unitId?: string,
  ): Promise<{ committed: boolean; revision?: number; value?: unknown }> {
    return this.inSession(sessionId, async () => {
      const session = this.requireEditableSession(sessionId, itemId);
      const unit = await this.resolveUnit(session, unitId);
      const result = operationResult(await this.service.executeUnitContent({
        workspace: session.workspace,
        file: session.univerPath,
        worktreeId: session.worktreeId,
        unitId: unit.unitId,
        code,
      }), "Univer 代码执行");
      this.scheduleCheckpoint(sessionId);
      return {
        committed: result.committed === true,
        ...(typeof result.revision === "number" ? { revision: result.revision } : {}),
        ...(result.value === undefined ? {} : { value: result.value }),
      };
    });
  }

  async insertLibraryImage(
    sessionId: string,
    itemId: string,
    imagePath: string,
    options: UniverLibraryImageInsert = {},
  ): Promise<{
    committed: boolean;
    revision?: number;
    value?: unknown;
    optimization: Omit<PreparedUniverImage, "contents" | "mime" | "dimensions"> & { width: number; height: number };
  }> {
    const canonicalImage = await realpath(imagePath);
    const extension = extname(canonicalImage).toLowerCase();
    if (!isUniverLibraryImageName(canonicalImage)) throw new Error(`资料库图片仅支持 ${UNIVER_LIBRARY_IMAGE_FORMATS_LABEL}`);
    const metadata = await stat(canonicalImage);
    if (!metadata.isFile()) throw new Error("资料库图片不是有效文件");
    if (metadata.size > UNIVER_IMAGE_SOURCE_MAX_BYTES) throw new Error("资料库图片超过 96MB，无法安全处理");
    const contents = await readFile(canonicalImage);
    if (!contents.length) throw new Error("资料库图片为空");
    const prepared = await prepareUniverImage(contents, extension);
    const source = `data:${prepared.mime};base64,${prepared.contents.toString("base64")}`;
    const session = this.requireEditableSession(sessionId, itemId);
    const targetUnitId = options.unitId ?? session.unitId;
    const unitKind = session.units?.find((unit) => unit.unitId === targetUnitId)?.kind
      ?? (targetUnitId === session.unitId ? session.unitKind : undefined);
    if (!unitKind || !["doc", "sheet", "slide", "board"].includes(unitKind)) {
      throw new Error("当前 Univer 编辑器不支持插入图片");
    }
    const code = unitKind === "slide" ? `const slide = ${options.slideId ? `presentation.getSlideById(${JSON.stringify(options.slideId)})` : "presentation.getActiveSlide() || presentation.getSlideByIndex(0)"};
if (!slide) throw new Error("没有可插入图片的活动幻灯片");
const pageSize = slide.getPageSize?.() || presentation.getPageSize?.() || {};
const pageWidth = Number(pageSize.width || 960);
const pageHeight = Number(pageSize.height || 540);
const sourceRatio = ${JSON.stringify(prepared.dimensions.width / prepared.dimensions.height)};
const requestedWidth = ${options.width === undefined ? "null" : JSON.stringify(options.width)};
const requestedHeight = ${options.height === undefined ? "null" : JSON.stringify(options.height)};
let width = requestedWidth;
let height = requestedHeight;
if (width == null && height == null) {
  width = Math.min(pageWidth * 0.62, (pageHeight * 0.62) * sourceRatio);
  height = width / sourceRatio;
} else if (width == null) width = height * sourceRatio;
else if (height == null) height = width / sourceRatio;
const left = ${options.left === undefined ? "null" : JSON.stringify(options.left)} ?? Math.max(0, (pageWidth - width) / 2);
const top = ${options.top === undefined ? "null" : JSON.stringify(options.top)} ?? Math.max(0, (pageHeight - height) / 2);
const imageInfo = slide.newImage()
  .setSource(${JSON.stringify(source)}, api.Enum.ImageSourceType.BASE64)
  .setAbsolutePosition(left, top)
  .setSize(width, height)
  .build();
const inserted = slide.insertImage(imageInfo);
if (!inserted) throw new Error("Univer 未能插入图片");
return { imageId: inserted.getId(), slideId: slide.getId(), left, top, width, height };`
      : unitKind === "doc" ? `const paragraphs = doc.getParagraphs();
const anchor = paragraphs[0];
if (!anchor) throw new Error("当前文档没有可用的图片插入位置");
const anchorRange = anchor.getRange();
const width = ${options.width === undefined ? "320" : JSON.stringify(options.width)};
const height = ${options.height === undefined ? `width / ${JSON.stringify(prepared.dimensions.width / prepared.dimensions.height)}` : JSON.stringify(options.height)};
const startOffset = ${options.startOffset === undefined ? "anchorRange.startOffset" : JSON.stringify(options.startOffset)};
const endOffset = ${options.endOffset === undefined ? "startOffset" : JSON.stringify(options.endOffset)};
const segmentId = ${options.segmentId ? JSON.stringify(options.segmentId) : "anchor.getSegmentId()"};
const inserted = await doc.insertImage({
  source: ${JSON.stringify(source)},
  imageSourceType: api.Enum.ImageSourceType.BASE64,
  width,
  height,
  wrappingStyle: api.Enum.DocsImageWrappingStyle.INLINE,
  textRange: { startOffset, endOffset, collapsed: startOffset === endOffset, segmentId },
});
if (!inserted) throw new Error("Univer 未能插入图片");
return { imageId: inserted.getId(), startOffset, endOffset, segmentId, width, height };`
      : unitKind === "sheet" ? `const sheet = ${options.sheetId ? `workbook.getSheetBySheetId(${JSON.stringify(options.sheetId)})` : "workbook.getActiveSheet()"};
if (!sheet) throw new Error("没有可插入图片的活动工作表");
const width = ${options.width === undefined ? "320" : JSON.stringify(options.width)};
const height = ${options.height === undefined ? `width / ${JSON.stringify(prepared.dimensions.width / prepared.dimensions.height)}` : JSON.stringify(options.height)};
const imageInfo = await sheet.newOverGridImage()
  .setSource(${JSON.stringify(source)}, api.Enum.ImageSourceType.BASE64)
  .setColumn(${options.column ?? 0})
  .setRow(${options.row ?? 0})
  .setWidth(width)
  .setHeight(height)
  .buildAsync();
sheet.insertImages([imageInfo]);
return { imageId: imageInfo.drawingId || imageInfo.id || "", sheetId: sheet.getSheetId(), row: ${options.row ?? 0}, column: ${options.column ?? 0}, width, height };`
      : `const width = ${options.width === undefined ? "320" : JSON.stringify(options.width)};
const height = ${options.height === undefined ? `width / ${JSON.stringify(prepared.dimensions.width / prepared.dimensions.height)}` : JSON.stringify(options.height)};
const inserted = board.insertImage({
  source: ${JSON.stringify(source)},
  imageSourceType: api.Enum.ImageSourceType.BASE64,
  left: ${options.left ?? 80},
  top: ${options.top ?? 80},
  width,
  height,
});
if (!inserted) throw new Error("Univer 未能插入图片");
return { imageId: inserted.getId(), pageId: board.getActivePageId?.() || "", left: ${options.left ?? 80}, top: ${options.top ?? 80}, width, height };`;
    const result = await this.execute(sessionId, itemId, code, options.unitId);
    return {
      ...result,
      optimization: {
        sourceFormat: prepared.sourceFormat,
        embeddedFormat: prepared.embeddedFormat,
        sourceBytes: prepared.sourceBytes,
        embeddedBytes: prepared.embeddedBytes,
        width: prepared.dimensions.width,
        height: prepared.dimensions.height,
        optimized: prepared.optimized,
      },
    };
  }

  async inspect(sessionId: string, itemId: string, range?: string, unitId?: string): Promise<JsonRecord> {
    return this.inSession(sessionId, async () => {
      const session = this.requireSession(sessionId, itemId);
      const unit = await this.resolveUnit(session, unitId);
      return operationResult(await this.service.inspectUnitContent({
        workspace: session.workspace,
        file: session.univerPath,
        unitId: unit.unitId,
        worktreeId: session.worktreeId,
        ...(range ? { range } : {}),
      }), "Univer 内容检查");
    });
  }

  async status(sessionId: string, itemId: string): Promise<JsonRecord> {
    return this.inSession(sessionId, async () => {
      const session = this.requireSession(sessionId, itemId);
      const status = operationResult(await this.service.status({
        workspace: session.workspace,
        file: session.univerPath,
        worktreeId: session.worktreeId,
      }), "Univer 状态查询");
      const units = selectedWorktreeUnits(status);
      if (units.length) session.units = units;
      return status;
    });
  }

  async lint(sessionId: string, itemId: string, pages?: readonly (number | string)[], unitId?: string): Promise<JsonRecord> {
    return this.inSession(sessionId, async () => {
      const session = this.requireSession(sessionId, itemId);
      const unit = await this.resolveUnit(session, unitId);
      if (unit.kind !== "slide") throw new Error("只有演示文稿支持版面检查");
      return operationResult(await this.service.lintUnitLayout({
        workspace: session.workspace,
        file: session.univerPath,
        unitId: unit.unitId,
        worktreeId: session.worktreeId,
        ...(pages ? { pages } : {}),
      }), "Univer 版面检查");
    });
  }

  async screenshot(sessionId: string, itemId: string, target?: JsonRecord, unitId?: string): Promise<JsonRecord> {
    return this.inSession(sessionId, async () => {
      const session = this.requireSession(sessionId, itemId);
      const unit = await this.resolveUnit(session, unitId);
      const output = join(session.workspace, "screenshots", randomUUID());
      return operationResult(await this.service.screenshotUnit({
        workspace: session.workspace,
        file: session.univerPath,
        unitId: unit.unitId,
        worktreeId: session.worktreeId,
        outputWorkspace: session.workspace,
        output,
        ...(target ? { target } : {}),
      }), "Univer 截图");
    });
  }

  apiReference(
    action: "find" | "show",
    queries: readonly string[],
    options?: { unit?: string; limit?: number },
  ): Promise<unknown> {
    return this.service.apiReference({ action, queries, ...options })
      .then((value) => operationValue(value, "Univer API 查询"));
  }

  resources(request: JsonRecord): Promise<JsonRecord> {
    return this.service.resources(request).then((value) => operationResult(value, "Univer 资源查询"));
  }

  async exportResources(
    sessionId: string,
    itemId: string,
    handles: readonly string[],
  ): Promise<JsonRecord> {
    const session = this.requireSession(sessionId, itemId);
    if (!handles.length || handles.some((handle) => !handle.trim())) {
      throw new Error("Univer 资源导出需要至少一个有效资源句柄");
    }
    const output = join(session.workspace, "resources", randomUUID());
    return operationResult(await this.service.resources({
      action: "export",
      handles: [...handles],
      outputWorkspace: session.workspace,
      output,
    }), "Univer 资源导出");
  }

  async exportDraft(
    sessionId: string,
    itemId: string,
    unitId?: string,
  ): Promise<{ path: string; size: number; extension: string }> {
    return this.inSession(sessionId, () => this.exportDraftInSession(sessionId, itemId, unitId));
  }

  async quality(sessionId: string, itemId: string) {
    return this.inSession(sessionId, async () => {
      const session = this.requireSession(sessionId, itemId);
      if (!['.docx', '.xlsx', '.pptx'].includes(extname(session.sourcePath).toLowerCase())) {
        throw new Error('导出质量检查支持 DOCX、XLSX、PPTX；CSV/TSV 和原生工作区请使用 inspect 检查对应表格或 Unit');
      }
      const exported = await this.exportDraftInSession(sessionId, itemId);
      try { return inspectOfficeQuality(await readFile(exported.path), exported.extension); }
      finally { await rm(exported.path, { force: true }); }
    });
  }

  private async exportDraftInSession(
    sessionId: string,
    itemId: string,
    unitId?: string,
  ): Promise<{ path: string; size: number; extension: string }> {

      const session = this.requireSession(sessionId, itemId);
      const extension = extname(session.sourcePath).toLowerCase();
      const outputDirectory = join(session.workspace, "exports");
      await mkdir(outputDirectory, { recursive: true });
      const output = join(outputDirectory, `${randomUUID()}${extension}`);
      if (session.sourceFormat === "univer") {
        await copyFile(session.univerPath, output);
        const metadata = await stat(output);
        return { path: output, size: metadata.size, extension };
      }
      const unit = await this.resolveUnit(session, unitId);
      if (extension === ".csv" || extension === ".tsv") {
        const contents = await this.delimitedFileContents(session, extension === ".tsv" ? "\t" : ",");
        await writeFile(output, contents);
        const metadata = await stat(output);
        return { path: output, size: metadata.size, extension };
      }
      const documentBorders = extension === ".docx"
        ? await this.documentParagraphBorders(session)
        : [];
      await this.exportOfficeFile(session, output, session.workspace);
      const metadata = await stat(output);
      if (!metadata.isFile() || metadata.size === 0) {
        await rm(output, { force: true });
        throw new Error("Univer 导出的草稿文件为空");
      }
      if (documentBorders.length) {
        const contents = preserveUniverDocumentParagraphBorders(await readFile(output), documentBorders);
        await writeFile(output, contents);
        const updated = await stat(output);
        return { path: output, size: updated.size, extension };
      }
      return { path: output, size: metadata.size, extension };

  }

  async compileSvg(sessionId: string, itemId: string, sourcePath: string, page: number, mode?: "replace" | "add", unitId?: string): Promise<JsonRecord> {
    return this.inSession(sessionId, () => this.compileSvgInSession(sessionId, itemId, sourcePath, page, mode, unitId));
  }

  private async compileSvgInSession(
    sessionId: string,
    itemId: string,
    sourcePath: string,
    page: number,
    mode?: "replace" | "add",
    unitId?: string,
  ): Promise<JsonRecord> {
    const session = this.requireEditableSession(sessionId, itemId);
    const unit = await this.resolveUnit(session, unitId);
    if (unit.kind !== "slide") throw new Error("SVG 页面编译仅支持演示文稿");
    const source = await realpath(sourcePath);
    const result = operationResult(await this.service.compileSvg({
      workspace: session.workspace,
      file: session.univerPath,
      worktreeId: session.worktreeId,
      unitId: unit.unitId,
      sourceWorkspace: dirname(source),
      source,
      page,
      ...(mode ? { mode } : {}),
    }), "Univer SVG 编译");
    this.scheduleCheckpoint(sessionId);
    return result;
  }

  async compileSvgText(
    sessionId: string,
    itemId: string,
    svg: string,
    page: number,
    mode?: "replace" | "add",
    unitId?: string,
  ): Promise<JsonRecord> {
    return this.inSession(sessionId, async () => {
      const session = this.requireEditableSession(sessionId, itemId);
      const unit = await this.resolveUnit(session, unitId);
      if (unit.kind !== "slide") throw new Error("SVG 页面编译仅支持演示文稿");
      if (!svg.trim() || Buffer.byteLength(svg, "utf8") > 2_000_000) {
        throw new Error("SVG 源码不能为空且不能超过 2MB");
      }
      const sourceDirectory = join(session.workspace, "svg-sources");
      await mkdir(sourceDirectory, { recursive: true });
      const source = join(sourceDirectory, `${randomUUID()}.svg`);
      await writeFile(source, svg, "utf8");
      try {
        return await this.compileSvgInSession(sessionId, itemId, source, page, mode, unit.unitId);
      } catch (error) {
        await rm(source, { force: true });
        throw error;
      }
    });
  }

  async createUnit(
    sessionId: string,
    itemId: string,
    kind: UniverUnitKind,
    name: string,
  ): Promise<{ unit: UniverUnitSummary; units: UniverUnitSummary[] }> {
    return this.inSession(sessionId, async () => {
      const session = this.requireEditableSession(sessionId, itemId);
      if (session.sourceFormat !== "univer") throw new Error("只有原生 .univer 工作区支持增加 Unit");
      const created = operationResult(await this.service.unit({
        workspace: session.workspace,
        file: session.univerPath,
        worktreeId: session.worktreeId,
        action: "create",
        kind,
        name,
      }), "Univer Unit 创建");
      const unit = { unitId: requiredString(created.unitId, "Univer Unit"), kind, name };
      const units = await this.refreshUnits(session);
      this.scheduleCheckpoint(sessionId);
      return { unit, units };
    });
  }

  async removeUnit(sessionId: string, itemId: string, unitId: string): Promise<{ units: UniverUnitSummary[] }> {
    return this.inSession(sessionId, async () => {
      const session = this.requireEditableSession(sessionId, itemId);
      if (session.sourceFormat !== "univer") throw new Error("只有原生 .univer 工作区支持删除 Unit");
      const units = await this.refreshUnits(session);
      if (units.length <= 1) throw new Error("Univer 工作区至少需要保留一个 Unit");
      if (!units.some((unit) => unit.unitId === unitId)) throw new Error("要删除的 Univer Unit 不存在");
      await this.service.unit({
        workspace: session.workspace,
        file: session.univerPath,
        worktreeId: session.worktreeId,
        action: "remove",
        unitId,
      });
      const remaining = await this.refreshUnits(session);
      if (session.unitId === unitId && remaining[0]) {
        session.unitId = remaining[0].unitId;
        session.unitKind = remaining[0].kind ?? "sheet";
      }
      this.scheduleCheckpoint(sessionId);
      return { units: remaining };
    });
  }

  async discard(sessionId: string, itemId?: string): Promise<void> {
    return this.inSession(sessionId, async () => {
      const session = this.sessions.get(sessionId);
      if (!session) return;
      if (itemId !== undefined && session.itemId !== itemId) throw new Error("Office 编辑会话与资料不匹配");
      if (!session.merged) {
        await this.service.worktree({
          workspace: session.workspace,
          file: session.univerPath,
          action: "discard",
          worktreeId: session.worktreeId,
        });
      }
      await this.clearCheckpoint(session);
        this.sessions.delete(sessionId);
    });
  }

  async close(): Promise<void> {
    const sessionIds = [...this.sessions.values()].filter((session) => session.hasChanges).map((session) => session.sessionId);
    for (const timer of checkpointTimers.get(this)?.values() ?? []) clearTimeout(timer);
    await Promise.allSettled(sessionIds.map((sessionId) => this.checkpoint(sessionId)));
    await this.service.dispose();
  }

  private requireSession(sessionId: string, itemId?: string): RuntimeSession {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error("Office 编辑会话已结束，请重新打开编辑器");
    if (itemId !== undefined && session.itemId !== itemId) throw new Error("Office 编辑会话与资料不匹配");
    return session;
  }

  private requireEditableSession(sessionId: string, itemId: string): RuntimeSession {
    const session = this.requireSession(sessionId, itemId);
    if (session.merged) throw new Error("Office 草稿已经合并，不能继续编辑");
    return session;
  }

  private async refreshUnits(session: RuntimeSession): Promise<UniverUnitSummary[]> {
    const status = operationResult(await this.service.status({
      workspace: session.workspace,
      file: session.univerPath,
      worktreeId: session.worktreeId,
    }), "Univer 状态查询");
    const units = selectedWorktreeUnits(status);
    session.units = units;
    return units;
  }

  private async resolveUnit(session: RuntimeSession, requestedUnitId?: string): Promise<UniverUnitSummary> {
    const units = session.units?.length ? session.units : await this.refreshUnits(session);
    const unitId = requestedUnitId ?? session.unitId;
    const unit = units.find((candidate) => candidate.unitId === unitId);
    if (!unit) throw new Error("指定的 Univer Unit 不存在于当前草稿");
    return unit;
  }
}
