import type { SpreadsheetPreviewSheet } from "../../shared/spreadsheet-preview.js";
import type {
  AssistantMediaSave,
  ResourceLibraryCreate,
  ResourceLibraryFileCreate,
  ResourceLibraryItem,
  ResourceLibraryMove,
  ResourceLibraryOfficeContentUpdate,
  ResourceLibraryUpdate,
} from "../../shared/resource-library-contract.js";
import type { AssistantImageAttachment } from "../../shared/assistant-contract.js";
import { apiFetch } from "./api-fetch.js";

export async function saveAsResourceLibraryText(id: string, content: string, fileName: string, destination?: string): Promise<{saved:true;path?:string}> {
  const response = await apiFetch(`/api/library/items/${encodeURIComponent(id)}/content/save-as`, {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({content,destination})});
  if (!response.ok) throw new Error(await errorMessage(response,'文本另存失败'));
  if (destination) return response.json();
  const url=URL.createObjectURL(await response.blob());
  const link=document.createElement('a');link.href=url;link.download=fileName;document.body.append(link);link.click();link.remove();URL.revokeObjectURL(url);
  return {saved:true};
}
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

export type ResourceLibraryIndexStatus = {
  itemId: string;
  status: "queued" | "indexing" | "completed" | "error";
  phase: "scanning" | "mapping" | "completed";
  total: number;
  processed: number;
  added: number;
  updated: number;
  removed: number;
  startedAt: string;
  finishedAt?: string;
  error?: string;
};

async function errorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = await response.json() as { error?: string };
    return body.error || fallback;
  } catch {
    return fallback;
  }
}

export async function getResourceLibraryItems(): Promise<ResourceLibraryItem[]> {
  const response = await apiFetch("/api/library/items");
  if (!response.ok) throw new Error(await errorMessage(response, "资料库加载失败"));
  return response.json() as Promise<ResourceLibraryItem[]>;
}

export async function getResourceLibraryIndexStatus(id: string): Promise<ResourceLibraryIndexStatus> {
  const response = await apiFetch(`/api/library/items/${encodeURIComponent(id)}/index-status`);
  if (!response.ok) throw new Error(await errorMessage(response, "资料库索引状态读取失败"));
  return response.json() as Promise<ResourceLibraryIndexStatus>;
}

export async function reindexResourceLibraryFolder(id: string): Promise<ResourceLibraryIndexStatus> {
  const response = await apiFetch(`/api/library/items/${encodeURIComponent(id)}/index`, { method: "POST" });
  if (!response.ok) throw new Error(await errorMessage(response, "资料库索引启动失败"));
  return response.json() as Promise<ResourceLibraryIndexStatus>;
}

export async function createResourceLibraryItem(input: ResourceLibraryCreate): Promise<ResourceLibraryItem> {
  const response = await apiFetch("/api/library/items", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(await errorMessage(response, "资料创建失败"));
  return response.json() as Promise<ResourceLibraryItem>;
}

export async function createGeneratedResourceLibraryFile(input: ResourceLibraryFileCreate): Promise<{
  created: true;
  resourceType: "resource_library";
  path: string;
  item: ResourceLibraryItem;
}> {
  const response = await apiFetch("/api/library/files", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(await errorMessage(response, "资料库文件创建失败"));
  return response.json() as Promise<{ created: true; resourceType: "resource_library"; path: string; item: ResourceLibraryItem }>;
}

export async function updateResourceLibraryItem(id: string, patch: ResourceLibraryUpdate): Promise<ResourceLibraryItem> {
  const response = await apiFetch(`/api/library/items/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!response.ok) throw new Error(await errorMessage(response, "资料修改失败"));
  return response.json() as Promise<ResourceLibraryItem>;
}

export async function moveResourceLibraryItem(id: string, input: ResourceLibraryMove): Promise<ResourceLibraryItem> {
  const response = await apiFetch(`/api/library/items/${encodeURIComponent(id)}/move`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(await errorMessage(response, "资料移动失败"));
  return response.json() as Promise<ResourceLibraryItem>;
}

export async function deleteResourceLibraryItem(id: string): Promise<void> {
  const response = await apiFetch(`/api/library/items/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!response.ok) throw new Error(await errorMessage(response, "资料删除失败"));
}

export async function permanentlyDeleteResourceLibraryItem(id: string, expectedTarget: string): Promise<void> {
  const response = await apiFetch(`/api/library/items/${encodeURIComponent(id)}/permanent-delete`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ confirmed: true, expectedTarget }),
  });
  if (!response.ok) throw new Error(await errorMessage(response, "彻底删除失败"));
}

export async function openResourceLibraryItem(id: string): Promise<void> {
  const itemResponse=await apiFetch('/api/library/items/'+encodeURIComponent(id));
  if(!itemResponse.ok)throw new Error(await errorMessage(itemResponse,'资料打开失败'));
  const item=await itemResponse.json() as ResourceLibraryItem;
  if(item.kind==='url'&&item.target){window.open(item.target,'_blank','noopener');return;}
  if(item.target&&window.mokiDesktop?.openLocalPath){if(!await window.mokiDesktop.openLocalPath(item.target))throw new Error('无法打开本地文件');return;}
  if(item.kind==='local_file'){window.open(resourceLibraryPreviewUrl(item),'_blank','noopener');return;}
  throw new Error('请在白板资料选择器内展开文件夹');
}

export async function revealResourceLibraryFolder(id: string): Promise<void> {
  const response = await apiFetch(`/api/library/items/${encodeURIComponent(id)}/reveal`, { method: "POST" });
  if (!response.ok) throw new Error(await errorMessage(response, "文件夹路径打开失败"));
}

export async function openAssistantMedia(sourceUrl: string): Promise<void> {
  const response = await apiFetch("/api/library/assistant-media/open", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sourceUrl }),
  });
  if (!response.ok) throw new Error(await errorMessage(response, "附件打开失败"));
}

export async function revealAssistantMedia(sourceUrl: string): Promise<void> {
  const response = await apiFetch("/api/library/assistant-media/reveal", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sourceUrl }),
  });
  if (!response.ok) throw new Error(await errorMessage(response, "附件定位失败"));
}

export async function exportResourceLibraryItem(
  id: string,
  input: { destination: string; mode: "file" | "folder" },
): Promise<{ saved: true; path: string; files: number; folders: number }> {
  const response = await apiFetch(`/api/library/items/${encodeURIComponent(id)}/export`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(await errorMessage(response, "资料另存为失败"));
  return response.json() as Promise<{ saved: true; path: string; files: number; folders: number }>;
}

export async function saveAssistantMedia(
  input: AssistantMediaSave,
): Promise<{ saved: true; path: string; item?: ResourceLibraryItem }> {
  const response = await apiFetch("/api/library/assistant-media/save", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error(await errorMessage(response, "附件保存失败"));
  }
  return response.json() as Promise<{
    saved: true;
    path: string;
    item?: ResourceLibraryItem;
  }>;
}

export type WhiteboardFolderExportInput = {
  mode: "local" | "library";
  destination?: string;
  parentId?: string | null;
  name: string;
  description: string;
  payload: {
    version: 1;
    shapes: Array<Record<string, unknown>>;
    assets: Array<Record<string, unknown>>;
  };
};

export async function exportWhiteboardFolder(input: WhiteboardFolderExportInput): Promise<{
  saved: true;
  path: string;
  files: number;
  folders: number;
  item?: ResourceLibraryItem;
}> {
  const response = await apiFetch("/api/library/whiteboard-folders/export", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(await errorMessage(response, "白板资料夹保存失败"));
  return response.json() as Promise<{ saved: true; path: string; files: number; folders: number; item?: ResourceLibraryItem }>;
}

export type ResourceLibraryTextContent = {
  version?: string;
  content: string;
  extension: string;
  size: number;
  updatedAt: string;
};

export type ResourceLibraryStructuredPreview =
  | { kind: "document"; paragraphs: string[]; html?: string }
  | { kind: "spreadsheet"; sheets: SpreadsheetPreviewSheet[] }
  | { kind: "presentation"; slides: Array<{ number: number; paragraphs: string[] }> }
  | { kind: "pdf"; totalPages: number; pages: Array<{ number: number; text: string }>; text: string; source?: "text-layer" | "deepseek-ocr" };

export async function getResourceLibraryStructuredPreview(id: string): Promise<ResourceLibraryStructuredPreview> {
  const response = await apiFetch(`/api/library/items/${encodeURIComponent(id)}/structured-preview`);
  if (!response.ok) throw new Error(await errorMessage(response, "文件内容提取失败"));
  return response.json() as Promise<ResourceLibraryStructuredPreview>;
}

export async function saveResourceLibraryOfficeContent(
  id: string,
  content: ResourceLibraryOfficeContentUpdate,
): Promise<{ saved: true; preview: Exclude<ResourceLibraryStructuredPreview, { kind: "pdf" }>; size: number; updatedAt: string }> {
  const response = await apiFetch(`/api/library/items/${encodeURIComponent(id)}/office-content`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(content),
  });
  if (!response.ok) throw new Error(await errorMessage(response, "Office 文件保存失败"));
  return response.json() as Promise<{ saved: true; preview: Exclude<ResourceLibraryStructuredPreview, { kind: "pdf" }>; size: number; updatedAt: string }>;
}

export type ResourceLibraryUniverSession = {
  sessionId: string;
  itemId: string;
  sourcePath: string;
  viewerUrl: string;
  worktreeId: string;
  unitId: string;
  kind: "document" | "spreadsheet" | "presentation" | "workspace";
  recoveredDraft?: boolean;
  units?: Array<{
    unitId: string;
    kind?: "doc" | "sheet" | "slide" | "base" | "board";
    name?: string;
  }>;
};

export async function openResourceLibraryUniverSession(id: string): Promise<ResourceLibraryUniverSession> {
  const response = await apiFetch(`/api/library/items/${encodeURIComponent(id)}/univer-session`, {
    method: "POST",
  });
  if (!response.ok) throw new Error(await errorMessage(response, "Univer Office 打开失败"));
  const value = await response.json() as { session: ResourceLibraryUniverSession };
  return value.session;
}

export async function insertResourceLibraryUniverImage(
  id: string,
  sessionId: string,
  input: {
    imageId: string;
    unitId?: string;
    slideId?: string;
    sheetId?: string;
    startOffset?: number;
    endOffset?: number;
    segmentId?: string;
    row?: number;
    column?: number;
    left?: number;
    top?: number;
    width?: number;
    height?: number;
  },
): Promise<{
  inserted: true;
  committed: boolean;
  revision?: number;
  value?: unknown;
  image: { id: string; name: string };
  optimization?: {
    sourceFormat: string;
    embeddedFormat: string;
    sourceBytes: number;
    embeddedBytes: number;
    width: number;
    height: number;
    optimized: boolean;
  };
}> {
  const response = await apiFetch(`/api/library/items/${encodeURIComponent(id)}/univer-session/${encodeURIComponent(sessionId)}/images`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(await errorMessage(response, "资料库图片插入失败"));
  return response.json() as ReturnType<typeof insertResourceLibraryUniverImage>;
}

export async function saveResourceLibraryUniverSession(
  id: string,
  sessionId: string,
): Promise<{ saved: true; size: number; updatedAt: string }> {
  const response = await apiFetch(
    `/api/library/items/${encodeURIComponent(id)}/univer-session/${encodeURIComponent(sessionId)}/save`,
    { method: "POST" },
  );
  if (!response.ok) throw new Error(await errorMessage(response, "Univer Office 保存失败"));
  return response.json() as Promise<{ saved: true; size: number; updatedAt: string }>;
}

export async function saveAsResourceLibraryUniverSession(
  id: string,
  sessionId: string,
  fileName: string,
  destination?: string,
): Promise<{ saved: true; path?: string; size: number; updatedAt?: string }> {
  const response = await apiFetch(
    `/api/library/items/${encodeURIComponent(id)}/univer-session/${encodeURIComponent(sessionId)}/save-as`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(destination ? { destination } : {}),
    },
  );
  if (!response.ok) throw new Error(await errorMessage(response, "Univer Office 另存为失败"));
  if (destination) return response.json() as Promise<{ saved: true; path: string; size: number; updatedAt: string }>;
  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(url);
  return { saved: true, size: blob.size };
}

export async function discardResourceLibraryUniverSession(id: string, sessionId: string): Promise<void> {
  const response = await apiFetch(
    `/api/library/items/${encodeURIComponent(id)}/univer-session/${encodeURIComponent(sessionId)}/discard`,
    { method: "POST" },
  );
  if (!response.ok) throw new Error(await errorMessage(response, "Univer Office 草稿放弃失败"));
}

type DeepSeekOcrProgress = {
  currentPage: number;
  totalPages: number;
  phase: "rendering" | "recognizing";
};

export async function recognizeResourceLibraryPdf(
  id: string,
  totalPages: number,
  onProgress?: (progress: DeepSeekOcrProgress) => void,
): Promise<Extract<ResourceLibraryStructuredPreview, { kind: "pdf" }>> {
  const statusResponse = await apiFetch("/api/settings/deepseek-ocr/verify", { method: "POST" });
  if (!statusResponse.ok) throw new Error(await errorMessage(statusResponse, "DeepSeek OCR 服务验证失败"));
  const status = await statusResponse.json() as {
    state: "ready" | "disabled" | "unavailable";
    message: string;
    maxPages: number;
  };
  if (status.state !== "ready") throw new Error(status.message);
  if (totalPages > status.maxPages) {
    throw new Error(`此 PDF 共 ${totalPages} 页，当前 OCR 上限为 ${status.maxPages} 页；请在 AI 设置中调整`);
  }

  const pdfResponse = await apiFetch(`/api/library/items/${encodeURIComponent(id)}/attachment`);
  if (!pdfResponse.ok) throw new Error(await errorMessage(pdfResponse, "PDF 文件读取失败"));
  const contents = new Uint8Array(await pdfResponse.arrayBuffer());
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  const loadingTask = pdfjs.getDocument({ data: contents, useSystemFonts: true });
  const document = await loadingTask.promise;
  const pageCount = Math.min(totalPages, document.numPages);
  const pages: Array<{ number: number; text: string }> = [];
  try {
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      onProgress?.({ currentPage: pageNumber, totalPages: pageCount, phase: "rendering" });
      const page = await document.getPage(pageNumber);
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = Math.min(2, 1_800 / Math.max(1, baseViewport.width, baseViewport.height));
      const viewport = page.getViewport({ scale });
      const canvas = window.document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("当前客户端无法渲染 PDF 页面");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      const imageDataUrl = canvas.toDataURL("image/jpeg", 0.9);
      page.cleanup();

      onProgress?.({ currentPage: pageNumber, totalPages: pageCount, phase: "recognizing" });
      const response = await apiFetch(`/api/library/items/${encodeURIComponent(id)}/deepseek-ocr`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pageNumber, imageDataUrl }),
      });
      if (!response.ok) throw new Error(await errorMessage(response, `第 ${pageNumber} 页 OCR 失败`));
      const result = await response.json() as { pageNumber: number; text: string };
      pages.push({ number: result.pageNumber, text: result.text });
    }
  } finally {
    await loadingTask.destroy();
  }
  return {
    kind: "pdf",
    totalPages: pageCount,
    pages,
    text: pages.map((page) => page.text).filter(Boolean).join("\n\n"),
    source: "deepseek-ocr",
  };
}

export async function getResourceLibraryTextContent(id: string): Promise<ResourceLibraryTextContent> {
  const response = await apiFetch(`/api/library/items/${encodeURIComponent(id)}/content`);
  if (!response.ok) throw new Error(await errorMessage(response, "资料文本读取失败"));
  return response.json() as Promise<ResourceLibraryTextContent>;
}

export async function saveResourceLibraryTextContent(id: string, content: string, expectedVersion?: string): Promise<{ saved: true; version?: string; size: number; updatedAt: string }> {
  const response = await apiFetch(`/api/library/items/${encodeURIComponent(id)}/content`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content, expectedVersion }),
  });
  if (!response.ok) throw new Error(await errorMessage(response, "资料文本保存失败"));
  return response.json() as Promise<{ saved: true; version?: string; size: number; updatedAt: string }>;
}

export function resourceLibraryPreviewUrl(item: ResourceLibraryItem): string | undefined {
  if (item.kind === "url") return item.target ?? undefined;
  if (item.kind === "local_file") return `/api/library/items/${encodeURIComponent(item.id)}/preview`;
  return undefined;
}

export function isResourceLibraryImage(item: Pick<ResourceLibraryItem, "kind" | "name" | "target">): boolean {
  if (item.kind === "folder" || item.kind === "local_folder") return false;
  const source = (item.target ?? item.name).split(/[?#]/u)[0] ?? "";
  const extension = source.match(/\.([^.\\/]+)$/u)?.[1]?.toLowerCase() ?? "";
  return ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif", "ico", "tif", "tiff", "heic"].includes(extension);
}

export async function getResourceLibraryImageFile(item: ResourceLibraryItem): Promise<File> {
  if (!isResourceLibraryImage(item)) throw new Error("当前资料不是图片文件");
  const url = item.kind === "local_file"
    ? resourceLibraryPreviewUrl(item)
    : `/api/library/items/${encodeURIComponent(item.id)}/attachment`;
  if (!url) throw new Error("图片资料没有可读取的来源");
  const response = await apiFetch(url);
  if (!response.ok) throw new Error(await errorMessage(response, "资料图片读取失败"));
  const blob = await response.blob();
  return new File([blob], resourceLibraryAttachmentName(item), {
    type: blob.type || "application/octet-stream",
  });
}

export function resourceLibraryAttachmentName(item: ResourceLibraryItem): string {
  const target = item.target ?? "";
  let targetName = "";
  if (item.kind === "url") {
    try { targetName = decodeURIComponent(new URL(target).pathname.split("/").filter(Boolean).at(-1) ?? ""); }
    catch { targetName = ""; }
  } else {
    targetName = target.replace(/[\\/]+$/u, "").split(/[\\/]/u).at(-1) ?? "";
  }
  if (!targetName) return item.name;
  const extension = targetName.match(/(\.[^.\\/]+)$/u)?.[1] ?? "";
  return extension && !item.name.toLowerCase().endsWith(extension.toLowerCase())
    ? `${item.name}${extension}`
    : item.name;
}

export async function getResourceLibraryAttachment(item: ResourceLibraryItem): Promise<File> {
  const response = await apiFetch(`/api/library/items/${encodeURIComponent(item.id)}/attachment`);
  if (!response.ok) throw new Error(await errorMessage(response, "资料附件读取失败"));
  const blob = await response.blob();
  return new File([blob], resourceLibraryAttachmentName(item), {
    type: blob.type || "application/octet-stream",
  });
}

export async function stageResourceLibraryAssistantAttachment(
  item: ResourceLibraryItem,
): Promise<AssistantImageAttachment> {
  const response = await apiFetch(
    `/api/library/items/${encodeURIComponent(item.id)}/assistant-attachment`,
    { method: "POST", headers: { "x-moki-attachment-upload": "1" } },
  );
  if (!response.ok) throw new Error(await errorMessage(response, "资料附件暂存失败"));
  return response.json() as Promise<AssistantImageAttachment>;
}
