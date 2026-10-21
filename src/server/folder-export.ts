import {constants} from 'node:fs';
import {copyFile,mkdir,readFile,readdir,stat,writeFile} from 'node:fs/promises';
import {basename,extname,join} from 'node:path';
import {z} from 'zod';
import {WhiteboardFolderExportSchema,type ResourceLibraryItem} from '../vendor/moki/shared/resource-library-contract.js';
const MIME_TYPES: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".jpe": "image/jpeg", ".jfif": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml", ".bmp": "image/bmp", ".avif": "image/avif", ".tif": "image/tiff", ".tiff": "image/tiff", ".ico": "image/x-icon",
  ".pdf": "application/pdf", ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8", ".markdown": "text/markdown; charset=utf-8", ".log": "text/plain; charset=utf-8", ".json": "application/json",
  ".mp4": "video/mp4", ".webm": "video/webm", ".m4v": "video/x-m4v", ".ogv": "video/ogg", ".mp3": "audio/mpeg",
  ".wav": "audio/wav", ".flac": "audio/flac", ".aac": "audio/aac", ".m4a": "audio/mp4", ".ogg": "audio/ogg",
  ".csv": "text/csv; charset=utf-8", ".tsv": "text/tab-separated-values; charset=utf-8", ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8", ".xml": "application/xml", ".yaml": "text/yaml; charset=utf-8", ".yml": "text/yaml; charset=utf-8",
  ".doc": "application/msword", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint", ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".zip": "application/zip",
};
const WHITEBOARD_ASSET_EXTENSION_BY_MIME: Record<string, string> = {
  "image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp",
  "image/svg+xml": ".svg", "image/bmp": ".bmp", "image/avif": ".avif", "image/tiff": ".tiff",
  "video/mp4": ".mp4", "video/quicktime": ".mov", "video/webm": ".webm", "video/ogg": ".ogv", "video/x-matroska": ".mkv",
  "audio/mpeg": ".mp3", "audio/wav": ".wav", "audio/mp4": ".m4a", "audio/aac": ".aac",
  "audio/ogg": ".ogg", "audio/opus": ".opus", "audio/flac": ".flac",
};


function safeExportName(value: string, fallback = "资料"): string {
  const sanitized = value.replace(/[<>:"/\\|?*\u0000-\u001f]/gu, "_").replace(/[. ]+$/gu, "").trim();
  return sanitized || fallback;
}

function whiteboardAssetExportName(fileName: string, mimeType?: string): string {
  const safeName = safeExportName(fileName, "画布素材");
  const normalizedMime = mimeType?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  const expectedExtension = WHITEBOARD_ASSET_EXTENSION_BY_MIME[normalizedMime];
  if (!expectedExtension) return safeName;
  const currentExtension = extname(safeName).toLowerCase();
  if (!currentExtension) return `${safeName}${expectedExtension}`;
  const currentMime = MIME_TYPES[currentExtension]?.split(";", 1)[0]?.trim().toLowerCase();
  return currentMime && currentMime !== normalizedMime
    ? `${safeName.slice(0, -currentExtension.length)}${expectedExtension}`
    : safeName;
}

function exportFileName(item: ResourceLibraryItem): string {
  const sourceName = attachmentName(item);
  const sourceExtension = extname(sourceName);
  const displayName = safeExportName(item.name);
  return sourceExtension && !displayName.toLocaleLowerCase().endsWith(sourceExtension.toLocaleLowerCase())
    ? `${displayName}${sourceExtension}`
    : displayName;
}

function attachmentName(item: ResourceLibraryItem): string {
  if (!item.target) return item.name;
  if (item.kind === "url") {
    try {
      const segment = new URL(item.target).pathname.split("/").filter(Boolean).at(-1);
      return segment ? decodeURIComponent(segment) : item.name;
    } catch {
      return item.name;
    }
  }
  return basename(item.target) || item.name;
}

export function createWhiteboardFolderWriter(options:{repository:{find:(id:string)=>ResourceLibraryItem|undefined;list:()=>ResourceLibraryItem[]};fetchResource?:typeof fetch;findWhiteboardAsset?:(id:string)=>{fileName:string;mimeType:string;content:Buffer}|undefined}){
  const downloadUrl = async (url: string, destination: string): Promise<void> => {
    const response = await (options.fetchResource ?? fetch)(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`在线文件读取失败（HTTP ${response.status}）`);
    await writeFile(destination, Buffer.from(await response.arrayBuffer()));
  };

  const copyDirectory = async (source: string, destination: string): Promise<{ files: number; folders: number }> => {
    const sourceMetadata = await stat(source);
    if (!sourceMetadata.isDirectory()) throw new Error("映射目标不是文件夹");
    await mkdir(destination, { recursive: false });
    let files = 0;
    let folders = 1;
    for (const entry of await readdir(source, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const sourcePath = join(source, entry.name);
      const destinationPath = join(destination, safeExportName(entry.name, "未命名资料"));
      if (entry.isDirectory()) {
        const result = await copyDirectory(sourcePath, destinationPath);
        files += result.files;
        folders += result.folders;
      } else if (entry.isFile()) {
        await copyFile(sourcePath, destinationPath, constants.COPYFILE_EXCL);
        files += 1;
      }
    }
    return { files, folders };
  };

  const exportItemIntoFolder = async (item: ResourceLibraryItem, destinationParent: string): Promise<{ files: number; folders: number }> => {
    if (item.kind === "local_folder" && item.target) {
      return copyDirectory(item.target, join(destinationParent, safeExportName(item.name, "资料夹")));
    }
    if (item.kind === "folder") {
      const destination = join(destinationParent, safeExportName(item.name, "资料夹"));
      await mkdir(destination, { recursive: false });
      let files = 0;
      let folders = 1;
      const children = options.repository.list().filter((candidate) => candidate.parentId === item.id);
      for (const child of children) {
        const result = await exportItemIntoFolder(child, destination);
        files += result.files;
        folders += result.folders;
      }
      return { files, folders };
    }
    if (!item.target) throw new Error(`资料“${item.name}”没有可读取的来源`);
    const destination = join(destinationParent, exportFileName(item));
    if (item.kind === "local_file") await copyFile(item.target, destination, constants.COPYFILE_EXCL);
    else await downloadUrl(item.target, destination);
    return { files: 1, folders: 0 };
  };

  const richTextValue = (value: unknown): string => {
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return value.map(richTextValue).filter(Boolean).join("\n");
    if (!value || typeof value !== "object") return "";
    const record = value as Record<string, unknown>;
    if (typeof record.text === "string") return record.text;
    return richTextValue(record.content);
  };

  const whiteboardAssetLookupIds = (assetRecord: Record<string, unknown>): string[] => {
    const candidates: string[] = [];
    const props = assetRecord.props && typeof assetRecord.props === "object"
      ? assetRecord.props as Record<string, unknown>
      : {};
    if (typeof props.src === "string") {
      try {
        const pathname = new URL(props.src, "http://moki.local").pathname;
        const storedAsset = /^\/api\/whiteboard\/assets\/([a-f0-9]{64})$/iu.exec(pathname);
        if (storedAsset?.[1]) candidates.push(storedAsset[1]);
      } catch {
        // Fall back to the document asset id for historical records.
      }
    }
    if (typeof assetRecord.id === "string" && assetRecord.id) candidates.push(assetRecord.id);
    return [...new Set(candidates)];
  };

  const writeWhiteboardFolder = async (
    destination: string,
    input: z.infer<typeof WhiteboardFolderExportSchema>,
  ): Promise<{ files: number; folders: number }> => {
    await mkdir(destination, { recursive: false });
    let files = 0;
    let folders = 1;
    await writeFile(join(destination, "资料夹说明.md"), `# ${input.name}\n\n${input.description || "暂无描述"}\n`, "utf8");
    await writeFile(join(destination, "白板内容.moki.json"), JSON.stringify({ name: input.name, description: input.description, ...input.payload }, null, 2), "utf8");
    files += 2;
    const materialDirectory = join(destination, "素材");
    let materialDirectoryCreated = false;
    const ensureMaterialDirectory = async () => {
      if (materialDirectoryCreated) return;
      await mkdir(materialDirectory, { recursive: false });
      materialDirectoryCreated = true;
      folders += 1;
    };
    const writtenAssets = new Set<string>();
    for (const [index, assetRecord] of input.payload.assets.entries()) {
      const resolvedAsset = whiteboardAssetLookupIds(assetRecord)
        .map((id) => ({ id, asset: options.findWhiteboardAsset?.(id) }))
        .find((entry) => Boolean(entry.asset));
      if (!resolvedAsset?.asset || writtenAssets.has(resolvedAsset.id)) continue;
      writtenAssets.add(resolvedAsset.id);
      await ensureMaterialDirectory();
      const name = `${String(index + 1).padStart(3, "0")}-${whiteboardAssetExportName(
        resolvedAsset.asset.fileName,
        resolvedAsset.asset.mimeType,
      )}`;
      await writeFile(join(materialDirectory, name), resolvedAsset.asset.content, { flag: "wx" });
      files += 1;
    }
    const textBlocks: string[] = [];
    const resourceIds = new Set<string>();
    let linkIndex = 0;
    for (const shape of input.payload.shapes) {
      const props = shape.props && typeof shape.props === "object" ? shape.props as Record<string, unknown> : {};
      const text = [props.text, props.richText, props.title].map(richTextValue).filter(Boolean).join("\n").trim();
      if (text) textBlocks.push(text);
      const libraryItemId = typeof props.libraryItemId === "string" ? props.libraryItemId : "";
      if (libraryItemId) resourceIds.add(libraryItemId);
      const url = typeof props.url === "string" && /^https?:\/\//iu.test(props.url) ? props.url : "";
      if (url) {
        await ensureMaterialDirectory();
        linkIndex += 1;
        const title = safeExportName(typeof props.title === "string" ? props.title : `链接-${linkIndex}`, `链接-${linkIndex}`);
        await writeFile(join(materialDirectory, `${String(linkIndex).padStart(3, "0")}-${title}.url`), `[InternetShortcut]\r\nURL=${url}\r\n`, { encoding: "utf8", flag: "wx" });
        files += 1;
      }
    }
    if (textBlocks.length) {
      await writeFile(join(destination, "文字内容.md"), textBlocks.map((text, index) => `## 内容 ${index + 1}\n\n${text}`).join("\n\n"), "utf8");
      files += 1;
    }
    let resourceIndex = 0;
    for (const libraryItemId of resourceIds) {
      const item = options.repository.find(libraryItemId);
      if (!item) continue;
      await ensureMaterialDirectory();
      resourceIndex += 1;
      const wrapper = join(materialDirectory, `资料-${String(resourceIndex).padStart(3, "0")}`);
      await mkdir(wrapper, { recursive: false });
      folders += 1;
      const result = await exportItemIntoFolder(item, wrapper);
      files += result.files;
      folders += result.folders;
    }
    return { files, folders };
  };

  return writeWhiteboardFolder;
}
