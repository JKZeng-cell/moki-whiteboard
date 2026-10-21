import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { normalizeImportedSnapshot } from "./board.js";
import type { ShapeRecord, WhiteboardSnapshot } from "./types.js";

export const WHITEBOARD_TRANSFER_MIME = "application/vnd.moki.whiteboard+zip";
const MAX_BYTES = 256 * 1024 * 1024;

function safeName(value: string): string { return value.replace(/[\\/:*?"<>|]+/gu, "-").trim() || "MOKI-白板"; }

function dataUrlBytes(value: string): { mimeType: string; bytes: Uint8Array } | undefined {
  const match = /^data:([^;,]+);base64,(.+)$/isu.exec(value);
  if (!match) return undefined;
  const binary = atob(match[2]!);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return { mimeType: match[1]!, bytes };
}

function bytesDataUrl(bytes: Uint8Array, mimeType: string): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return `data:${mimeType};base64,${btoa(binary)}`;
}

export function createPortableWhiteboard(snapshot: WhiteboardSnapshot, options: { title: string; pageId?: string; pageName?: string }): { bytes: Uint8Array; fileName: string } {
  const portable = structuredClone(snapshot);
  const archive: Record<string, Uint8Array> = {};
  const assets: Array<{ assetId: string; archivePath: string; mimeType: string; name?: string; width?: number; height?: number }> = [];
  const resources: Array<{ shapeId: string; name: string; kind: "file" | "folder"; files: Array<{ archivePath: string; relativePath: string }> }> = [];
  let serial = 0;
  for (const record of Object.values(portable.document.store)) {
    if (record.typeName === 'asset') {
      const asset=record as unknown as {id:string;props:Record<string,unknown>};
      const content=dataUrlBytes(String(asset.props.src??''));
      if(content){const archivePath='assets/'+String(++serial).padStart(5,'0')+'.bin';archive[archivePath]=content.bytes;assets.push({assetId:asset.id,archivePath,mimeType:content.mimeType,name:String(asset.props.name??'图片'),width:Number(asset.props.width??360),height:Number(asset.props.height??240)});}
    }
    if (record.typeName !== "shape") continue;
    const shape = record as ShapeRecord;
    if (shape.type === "image") {
      const content = dataUrlBytes(String(shape.props.source ?? ""));
      if (!content) continue;
      const assetId = `asset:${shape.id.slice("shape:".length)}`;
      const archivePath = `assets/${String(++serial).padStart(5,"0")}.bin`;
      archive[archivePath] = content.bytes;
      portable.document.store[assetId] = { id: assetId, typeName: "asset", type: "image", props: { src: String(shape.props.source), name: String(shape.props.name ?? "图片"), mimeType: content.mimeType, width: Number(shape.props.w ?? 360), height: Number(shape.props.h ?? 240) }, meta: {} };
      shape.props = { w: shape.props.w, h: shape.props.h, assetId, altText: String(shape.props.name ?? "图片") };
      assets.push({ assetId, archivePath, mimeType: content.mimeType, name: String(shape.props.altText), width: Number(shape.props.w), height: Number(shape.props.h) });
    }
    if (shape.type === "file" || shape.type === "resource") {
      const content = dataUrlBytes(String(shape.props.source ?? ""));
      if (!content) continue;
      const archivePath = `resources/${String(resources.length + 1).padStart(5,"0")}/00001.bin`;
      archive[archivePath] = content.bytes;
      const name = String(shape.props.name ?? "附件");
      shape.type = "resource";
      shape.props = { ...shape.props, kind: "local_file", name, localPath: "" };
      resources.push({ shapeId: shape.id, name, kind: "file", files: [{ archivePath, relativePath: name }] });
    }
  }
  const manifest = { format: "moki-whiteboard", version: 2, exportedAt: new Date().toISOString(), ...(options.pageId ? { pageId: options.pageId } : {}), ...(options.pageName ? { pageName: options.pageName } : {}), snapshot: portable, assets, resources };
  archive["manifest.json"] = strToU8(JSON.stringify(manifest));
  const bytes = zipSync(archive, { level: 6 });
  if (bytes.byteLength > MAX_BYTES) throw new Error("白板文件超过 256 MB，无法导出");
  return { bytes, fileName: `${safeName(options.title)}.moki` };
}

export function importPortableWhiteboard(bytes: Uint8Array): { snapshot: WhiteboardSnapshot; pageName?: string; format: "moki-v2" | "moki-legacy" | "snapshot" } {
  if (bytes.byteLength > MAX_BYTES) throw new Error("白板文件超过 256 MB，无法导入");
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const archive = unzipSync(bytes);
    const manifestBytes = archive["manifest.json"];
    if (!manifestBytes) throw new Error("MOKI 白板文件缺少 manifest.json");
    const manifest = JSON.parse(strFromU8(manifestBytes)) as { format?: string; version?: number; pageName?: string; snapshot?: unknown; assets?: Array<{assetId:string;archivePath:string;mimeType:string}>; resources?: Array<{shapeId:string;name:string;kind:string;files:Array<{archivePath:string;relativePath:string}>}> };
    if (manifest.format !== "moki-whiteboard" || manifest.version !== 2 || !manifest.snapshot) throw new Error("不支持的 MOKI 白板文件版本");
    const snapshot = normalizeImportedSnapshot(manifest.snapshot);
    for (const asset of manifest.assets ?? []) {
      const content = archive[asset.archivePath];
      if (!content) throw new Error(`白板缺少图片资源：${asset.assetId}`);
      const assetRecord = snapshot.document.store[asset.assetId] as { props?: Record<string,unknown> } | undefined;
      const source = bytesDataUrl(content, asset.mimeType);
      if(!assetRecord?.props) throw new Error('白板缺少媒体记录：'+asset.assetId);
      assetRecord.props.src=source;
    }
    for(const resource of manifest.resources??[]){
      const shape=snapshot.document.store[resource.shapeId] as ShapeRecord|undefined;
      if(!shape)throw new Error('白板缺少文件记录：'+resource.shapeId);
      if(resource.kind!=='file'||resource.files.length!==1)throw new Error('文件夹资源请使用白板页面原生导入入口');
      const file=resource.files[0]!,content=archive[file.archivePath];if(!content)throw new Error('白板缺少附件内容');
      const source=bytesDataUrl(content,String(shape.props.mimeType??'application/octet-stream'));
      shape.type='resource';shape.props={...shape.props,kind:'local_file',name:resource.name,source,localPath:source};
    }
    return { snapshot, ...(manifest.pageName ? { pageName: manifest.pageName } : {}), format: "moki-v2" };
  }
  const raw = JSON.parse(new TextDecoder().decode(bytes)) as { format?: string; snapshot?: unknown; pageName?: string } | WhiteboardSnapshot;
  if (raw && typeof raw === "object" && "snapshot" in raw && raw.snapshot) return { snapshot: normalizeImportedSnapshot(raw.snapshot), ...(raw.pageName ? { pageName: raw.pageName } : {}), format: "moki-legacy" };
  return { snapshot: normalizeImportedSnapshot(raw), format: "snapshot" };
}

export function downloadPortableWhiteboard(result: { bytes: Uint8Array; fileName: string }): void {
  const blob = new Blob([result.bytes.slice().buffer as ArrayBuffer], { type: WHITEBOARD_TRANSFER_MIME });
  const url = URL.createObjectURL(blob), anchor = document.createElement("a");
  anchor.href = url; anchor.download = result.fileName; anchor.click(); URL.revokeObjectURL(url);
}
