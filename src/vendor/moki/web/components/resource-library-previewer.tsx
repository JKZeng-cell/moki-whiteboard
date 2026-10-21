import { SpreadsheetPreview } from "./spreadsheet-preview.js";
import { apiFetch } from "../lib/api-fetch.js";
import "@extend-ai/react-pptx/styles.css";
import powerpointWasmUrl from "@extend-ai/react-pptx/pptx_wasm_bg.wasm?url";
import { applyTextDraftPatches } from '../../shared/text-draft-patch.js';
import {
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  FileText,
  LoaderCircle,
  Minus,
  Move,
  Pause,
  Pencil,
  Play,
  RotateCcw,
  ScanText,
  Save,
  Plus,
  Trash2,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type FocusEvent as ReactFocusEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type WheelEvent } from "react";
import type { ResourceLibraryItem } from "../../shared/resource-library-contract.js";
import { isUniverLibraryImageName } from "../../shared/univer-image-contract.js";
import {
  getResourceLibraryTextContent,
  getResourceLibraryStructuredPreview,
  getResourceLibraryItems,
  insertResourceLibraryUniverImage,
  discardResourceLibraryUniverSession,
  openResourceLibraryUniverSession,
  recognizeResourceLibraryPdf,
  resourceLibraryPreviewUrl,
  saveResourceLibraryUniverSession,
  saveAsResourceLibraryUniverSession,
  saveResourceLibraryTextContent,
  type ResourceLibraryUniverSession,
  type ResourceLibraryStructuredPreview,
} from "../lib/resource-library-api.js";
import { MarkdownRenderer } from "./markdown-renderer.js";
import { ResourceLibraryPickerDialog } from "./resource-library-picker-dialog.js";
import { clearWorkbenchSelectionContext, closeMokiEditorAssistance, publishWorkbenchSelectionContext, readWorkbenchSelectionContext, requestMokiAssistance } from "../lib/workbench-selection-context.js";
import { WORKBENCH_DATA_UPDATED_EVENT, type WorkbenchDataUpdatedDetail } from "../lib/workbench-events.js";
import { useWorkspaceEditor } from '../lib/use-workspace-editor.js';
import { exportResourceLibraryItem, saveAsResourceLibraryText } from '../lib/resource-library-api.js';
import type { WorkspaceEditorCommand, WorkspaceEditorResult, WorkspaceEditorState } from '../../shared/workspace-editor-contract.js';

type PreviewKind = "image" | "video" | "audio" | "text" | "embedded" | "web" | "document" | "spreadsheet" | "presentation" | "workspace" | "unsupported";
type OfficeEditorFocus =
  | { kind: "document"; paragraph: number }
  | { kind: "spreadsheet"; row: number; column: number }
  | { kind: "presentation"; slide: number; paragraph: number };
type UniverEditorSelection = {
  kind: "document";
  unitId: string;
  startOffset: number;
  endOffset: number;
  collapsed: boolean;
  segmentId: string;
  page: number | null;
  line: number | null;
};

function moveListItem<T>(values: T[], from: number, to: number): void {
  if (from < 0 || from >= values.length || to < 0 || to >= values.length || from === to) return;
  const [value] = values.splice(from, 1);
  if (value !== undefined) values.splice(to, 0, value);
}
const POWERPOINT_WASM_LIMIT_PATCHES = [
  {
    // @extend-ai/react-pptx 0.1.2: 100 MiB input -> 512 MiB input.
    from: [0x80, 0x80, 0x80, 0xb2, 0x80, 0xc4, 0x13],
    to: [0x80, 0x80, 0x80, 0x80, 0x82, 0xc4, 0x13],
  },
  {
    // @extend-ai/react-pptx 0.1.2: 64 MiB ZIP entry -> 256 MiB ZIP entry.
    from: [0x80, 0x80, 0x80, 0xa0, 0x80, 0x80, 0x80, 0x80, 0x20],
    to: [0x80, 0x80, 0x80, 0x80, 0x81, 0x80, 0x80, 0x80, 0x20],
  },
] as const;

export function patchPowerPointWasmPreviewLimits(source: ArrayBuffer): ArrayBuffer {
  const bytes = new Uint8Array(source.slice(0));
  for (const patch of POWERPOINT_WASM_LIMIT_PATCHES) {
    let matchAt = -1;
    let matchCount = 0;
    for (let offset = 0; offset <= bytes.length - patch.from.length; offset += 1) {
      if (patch.from.every((value, index) => bytes[offset + index] === value)) {
        matchAt = offset;
        matchCount += 1;
      }
    }
    // The signatures are version-specific. If a future package changes them,
    // leave that limit untouched and let the package's own defaults take over.
    if (matchCount === 1) bytes.set(patch.to, matchAt);
  }
  return bytes.buffer;
}

let powerPointRuntimePromise: Promise<void> | undefined;

async function configurePowerPointRuntime(module: typeof import("@extend-ai/react-pptx")): Promise<void> {
  powerPointRuntimePromise ??= (async () => {
    const response = await fetch(powerpointWasmUrl);
    if (!response.ok) throw new Error(`PowerPoint parser runtime could not be loaded (${response.status}).`);
    module.setWasmSource(patchPowerPointWasmPreviewLimits(await response.arrayBuffer()));
  })();
  await powerPointRuntimePromise;
}

const PowerPointViewer = lazy(async () => {
  const module = await import("@extend-ai/react-pptx");
  if (typeof module.setWasmSource === "function") {
    try {
      await configurePowerPointRuntime(module);
    } catch {
      // Keep the package's default runtime available when the optimized asset
      // cannot be loaded; ordinary presentations can still be previewed.
    }
  }
  return { default: module.ReactPptxViewer };
});
const VIDEO_PREVIEW_FPS = 30;
const VIDEO_VOLUME_STORAGE_KEY = "moki.resource-library.video-volume";
const POWERPOINT_MAX_PREVIEW_BYTES = 512 * 1024 * 1024;

type VideoVolumePreference = {
  volume: number;
  muted: boolean;
};

function readVideoVolumePreference(): VideoVolumePreference {
  if (typeof window === "undefined") return { volume: 1, muted: false };
  try {
    const stored = JSON.parse(window.localStorage.getItem(VIDEO_VOLUME_STORAGE_KEY) ?? "null") as Partial<VideoVolumePreference> | null;
    const volume = Number(stored?.volume);
    if (!Number.isFinite(volume)) return { volume: 1, muted: false };
    return {
      volume: Math.max(0, Math.min(1, volume)),
      muted: Boolean(stored?.muted),
    };
  } catch {
    return { volume: 1, muted: false };
  }
}

function saveVideoVolumePreference(preference: VideoVolumePreference): void {
  try {
    window.localStorage.setItem(VIDEO_VOLUME_STORAGE_KEY, JSON.stringify(preference));
  } catch {
    // Playback still works when storage is unavailable.
  }
}

export function formatVideoPreviewTime(value: number): string {
  const seconds = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

export function videoPreviewFramePosition(currentTime: number, duration: number): {
  current: number;
  total: number;
} {
  const total = Math.max(1, Math.round(Math.max(0, Number.isFinite(duration) ? duration : 0) * VIDEO_PREVIEW_FPS));
  const current = Math.min(total, Math.max(1, Math.floor(Math.max(0, Number.isFinite(currentTime) ? currentTime : 0) * VIDEO_PREVIEW_FPS) + 1));
  return { current, total };
}

const TEXT_EXTENSIONS = new Set([
  "txt", "md", "markdown", "log", "json", "html", "htm", "xml", "yaml", "yml",
  "js", "jsx", "ts", "tsx", "css", "scss", "less", "py", "java", "c", "cpp", "h", "hpp", "cs", "go", "rs", "sql", "sh", "ps1",
]);

export function resourcePreviewExtension(item: Pick<ResourceLibraryItem, "name" | "target">): string {
  const source = (item.target ?? item.name).split(/[?#]/u)[0] ?? "";
  return source.match(/\.([^.\\/]+)$/u)?.[1]?.toLowerCase() ?? "";
}

export function enhancedResourcePreviewKind(item: Pick<ResourceLibraryItem, "kind" | "name" | "target">): PreviewKind {
  if (item.kind === "folder" || item.kind === "local_folder") return "unsupported";
  const extension = resourcePreviewExtension(item);
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif", "ico"].includes(extension)) return "image";
  if (["mp4", "webm", "m4v", "mov", "ogv"].includes(extension)) return "video";
  if (["mp3", "wav", "flac", "aac", "m4a", "ogg"].includes(extension)) return "audio";
  if (["doc", "docx"].includes(extension)) return "document";
  if (["xlsx", "csv", "tsv"].includes(extension)) return "spreadsheet";
  if (["ppt", "pptx"].includes(extension)) return "presentation";
  if (extension === "univer") return "workspace";
  if (TEXT_EXTENSIONS.has(extension) && item.kind === "local_file") return "text";
  if (["pdf"].includes(extension)) return "embedded";
  if (item.kind === "url") return "web";
  return "unsupported";
}

/**
 * Univer can import/edit the OOXML PowerPoint format (.pptx), but the legacy
 * binary .ppt and .doc formats are preview-only. Keep this capability check in one place
 * so the toolbar and assistant commands cannot open an editor that the server
 * will reject with 415.
 */
export function isOfficeEditorSupportedExtension(extension: string): boolean {
  return ["docx", "xlsx", "csv", "tsv", "pptx", "univer"].includes(extension.toLowerCase());
}

export function onlinePreviewSandbox(
  target: string,
  currentOrigin = typeof window === "undefined" ? "" : window.location.origin,
): string {
  const base = "allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-scripts allow-top-navigation-by-user-activation";
  try {
    return new URL(target, currentOrigin || undefined).origin === currentOrigin
      ? base
      : `${base} allow-same-origin`;
  } catch {
    return base;
  }
}

export function parseDelimitedText(content: string, delimiter: "," | "\t"): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index] ?? "";
    if (character === '"') {
      if (quoted && content[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === delimiter && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && content[index + 1] === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }
  if (cell || row.length || !rows.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

export function serializeDelimitedRows(rows: string[][], delimiter: "," | "\t"): string {
  return rows.map((row) => row.map((cell) => {
    if (!cell.includes(delimiter) && !/["\r\n]/u.test(cell)) return cell;
    return `"${cell.replace(/"/gu, '""')}"`;
  }).join(delimiter)).join("\n");
}

async function copyCanvas(canvas: HTMLCanvasElement): Promise<void> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob || !navigator.clipboard?.write || typeof ClipboardItem === "undefined") throw new Error("当前环境不支持复制图像");
  await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
}

function presentationSourceUrl(item: ResourceLibraryItem, revision = ""): string {
  const path = item.kind === "local_file"
    ? resourceLibraryPreviewUrl(item)
    : `/api/library/items/${encodeURIComponent(item.id)}/attachment`;
  if (!path) return "";
  if (typeof window === "undefined") return path;
  const url = new URL(path, window.location.origin);
  if (revision) url.searchParams.set("revision", revision);
  return url.toString();
}

const POWERPOINT_THUMBNAIL_ROW_ESTIMATE = 123;

export function synchronizePowerPointThumbnailRail(root: ParentNode | null, slideIndex: number): boolean {
  const filmstrip = root?.querySelector<HTMLElement>(".rpv-filmstrip");
  if (!filmstrip) return false;

  const index = Math.max(0, Math.floor(slideIndex));
  const rowStart = index * POWERPOINT_THUMBNAIL_ROW_ESTIMATE;
  const rowEnd = rowStart + POWERPOINT_THUMBNAIL_ROW_ESTIMATE;
  const viewportHeight = filmstrip.clientHeight;
  let nextScrollTop = filmstrip.scrollTop;

  if (index === 0 || rowStart < nextScrollTop) {
    nextScrollTop = rowStart;
  } else if (viewportHeight > 0 && rowEnd > nextScrollTop + viewportHeight) {
    nextScrollTop = Math.max(0, rowEnd - viewportHeight);
  }

  if (Math.abs(filmstrip.scrollTop - nextScrollTop) > 0.5) {
    filmstrip.scrollTop = nextScrollTop;
  }

  // The thumbnail rail is virtualized. A newly mounted rail can keep the
  // virtualizer's old offset even though the DOM scroll position is zero.
  const EventConstructor = filmstrip.ownerDocument.defaultView?.Event ?? Event;
  filmstrip.dispatchEvent(new EventConstructor("scroll"));
  return true;
}

function StructuredPresentationSlides({
  preview,
}: {
  preview: Extract<ResourceLibraryStructuredPreview, { kind: "presentation" }>;
}) {
  return <div className="grid size-full gap-4 overflow-auto bg-[#e8eaf0] p-5 md:grid-cols-2">
    {preview.slides.map((slide) => <article key={slide.number} className="relative aspect-video overflow-auto rounded-lg bg-white p-8 shadow-sm">
      <span className="absolute bottom-2 right-3 text-[0.625rem] font-bold text-[#a0a5b5]">{slide.number}</span>
      {slide.paragraphs.map((paragraph, index) => <p key={index} className={`${index === 0 ? "mb-5 text-xl font-black" : "mb-3 text-sm leading-6"} text-[#30364b]`}>{paragraph}</p>)}
    </article>)}
  </div>;
}

type Props = {
  item: ResourceLibraryItem;
  onClose: () => void;
  onOpen: (item: ResourceLibraryItem) => void | Promise<void>;
  onThumbnail?: (item: ResourceLibraryItem, media: HTMLImageElement | HTMLVideoElement) => void | boolean | Promise<void | boolean>;
  layerClassName?: string;
  displayMode?: "modal" | "embedded";
  contained?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  active?: boolean;
  onCheckpointReady?: (checkpoint: (() => Promise<void>) | undefined) => void;
  onCloseRequestReady?: (requestClose: (() => void) | undefined) => void;
};
type UniverImageSelection =
  | { kind: "slide"; unitId: string; slideId: string }
  | { kind: "document"; unitId: string; startOffset: number; endOffset: number; segmentId: string }
  | { kind: "sheet"; unitId: string; sheetId: string; row: number; column: number }
  | { kind: "board"; unitId: string; pageId: string };

export function normalizeUniverImageSelection(value: unknown): UniverImageSelection | undefined {
  if (!value || typeof value !== "object") return undefined;
  const selection = value as Record<string, unknown>;
  if (typeof selection.unitId !== "string" || !selection.unitId) return undefined;
  if (selection.kind === "slide" && typeof selection.slideId === "string" && selection.slideId) {
    return { kind: "slide", unitId: selection.unitId, slideId: selection.slideId };
  }
  if (selection.kind === "document"
    && Number.isInteger(selection.startOffset)
    && Number.isInteger(selection.endOffset)
    && Number(selection.startOffset) >= 0
    && Number(selection.endOffset) >= 0
    && typeof selection.segmentId === "string") {
    return {
      kind: "document",
      unitId: selection.unitId,
      startOffset: Number(selection.startOffset),
      endOffset: Number(selection.endOffset),
      segmentId: selection.segmentId,
    };
  }
  if (selection.kind === "sheet"
    && typeof selection.sheetId === "string"
    && selection.sheetId
    && Number.isInteger(selection.row)
    && Number.isInteger(selection.column)
    && Number(selection.row) >= 0
    && Number(selection.column) >= 0) {
    return {
      kind: "sheet",
      unitId: selection.unitId,
      sheetId: selection.sheetId,
      row: Number(selection.row),
      column: Number(selection.column),
    };
  }
  if (selection.kind === "board") {
    return {
      kind: "board",
      unitId: selection.unitId,
      pageId: typeof selection.pageId === "string" ? selection.pageId : "",
    };
  }
  return undefined;
}

export function isUniverInsertableLibraryImage(item: ResourceLibraryItem): boolean {
  if (item.kind !== "local_file") return false;
  return isUniverLibraryImageName(item.target || item.name);
}

type EditorExitIntent = "close" | "cancel";

function editableCaretPosition(element: HTMLInputElement | HTMLTextAreaElement): { x: number; y: number } {
  const bounds = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  const mirror = document.createElement("div");
  const marker = document.createElement("span");
  const properties = [
    "fontFamily", "fontSize", "fontWeight", "fontStyle", "letterSpacing", "lineHeight",
    "textTransform", "textIndent", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
    "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth", "boxSizing",
  ] as const;
  Object.assign(mirror.style, {
    position: "fixed",
    visibility: "hidden",
    pointerEvents: "none",
    left: `${bounds.left}px`,
    top: `${bounds.top}px`,
    width: `${bounds.width}px`,
    minHeight: `${bounds.height}px`,
    whiteSpace: element instanceof HTMLInputElement ? "pre" : "pre-wrap",
    overflowWrap: "break-word",
  });
  for (const property of properties) mirror.style[property] = style[property];
  mirror.textContent = element.value.slice(0, element.selectionStart ?? element.value.length);
  marker.textContent = "\u200b";
  mirror.append(marker);
  document.body.append(mirror);
  const markerBounds = marker.getBoundingClientRect();
  mirror.remove();
  const lineHeight = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.4 || 20;
  const measuredX = markerBounds.left || bounds.left + Number.parseFloat(style.paddingLeft || "0");
  const measuredY = markerBounds.bottom || bounds.top + Number.parseFloat(style.paddingTop || "0") + lineHeight;
  return {
    x: Math.max(12, Math.min(window.innerWidth - 340, measuredX - element.scrollLeft)),
    y: Math.max(12, Math.min(window.innerHeight - 96, measuredY - element.scrollTop + 8)),
  };
}

function contentEditableCaretPosition(element: HTMLElement): { x: number; y: number } {
  const selection = window.getSelection();
  const range = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : undefined;
  const caret = range && typeof range.getBoundingClientRect === "function" ? range.getBoundingClientRect() : undefined;
  const bounds = element.getBoundingClientRect();
  const x = caret && (caret.width || caret.height) ? caret.right : bounds.left + Math.min(80, bounds.width / 2);
  const y = caret && (caret.width || caret.height) ? caret.bottom : bounds.top + Math.min(80, bounds.height / 2);
  return { x: Math.round(x), y: Math.round(y) };
}

export function ResourceLibraryPreviewer({ item, onClose, onOpen, onThumbnail, layerClassName = "z-[80]", displayMode = "modal", contained = false, onDirtyChange, active = true, onCheckpointReady, onCloseRequestReady }: Props) {
  const previewUrl = resourceLibraryPreviewUrl(item);
  const kind = enhancedResourcePreviewKind(item);
  const extension = resourcePreviewExtension(item);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [textContent, setTextContent] = useState("");
  const [textSourceVersion, setTextSourceVersion] = useState<string>();
  const [savedTextContent, setSavedTextContent] = useState("");
  const [editingText, setEditingText] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [exitIntent, setExitIntent] = useState<EditorExitIntent>();
  const textDraftActiveRef = useRef(false);
  textDraftActiveRef.current = editingText || dirty;
  const [textHistory, setTextHistory] = useState<{undo:string[];redo:string[]}>({undo:[],redo:[]});
  const embedded = displayMode === "embedded";
  const onDirtyChangeRef = useRef(onDirtyChange);
  onDirtyChangeRef.current = onDirtyChange;
  const [renderedTextPreview, setRenderedTextPreview] = useState(["md", "markdown", "html", "htm", "json"].includes(extension));
  const [structuredPreview, setStructuredPreview] = useState<ResourceLibraryStructuredPreview>();
  const [savedStructuredPreview, setSavedStructuredPreview] = useState<ResourceLibraryStructuredPreview>();
  const [editingOffice, setEditingOffice] = useState(false);
  const [univerSession, setUniverSession] = useState<ResourceLibraryUniverSession>();
  const [libraryImagePickerOpen, setLibraryImagePickerOpen] = useState(false);
  const [libraryImageItems, setLibraryImageItems] = useState<ResourceLibraryItem[]>([]);
  const [libraryImageLoading, setLibraryImageLoading] = useState(false);
  const [libraryImageError, setLibraryImageError] = useState("");
  const [insertingLibraryImage, setInsertingLibraryImage] = useState(false);
  const libraryImageSelectionRef = useRef<UniverImageSelection | undefined>(undefined);
  const [officeRevision, setOfficeRevision] = useState("");
  const [pdfTextOpen, setPdfTextOpen] = useState(false);
  const [ocrProgress, setOcrProgress] = useState<{ currentPage: number; totalPages: number; phase: "rendering" | "recognizing" }>();
  const [activeSheetIndex, setActiveSheetIndex] = useState(0);
  const [tableMode, setTableMode] = useState(extension === "csv" || extension === "tsv");
  const [imageScale, setImageScale] = useState(1);
  const [imageOffset, setImageOffset] = useState({ x: 0, y: 0 });
  const [videoPlaying, setVideoPlaying] = useState(false);
  const [videoCurrentTime, setVideoCurrentTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const initialVideoVolumePreference = useMemo(readVideoVolumePreference, []);
  const [videoVolume, setVideoVolume] = useState(initialVideoVolumePreference.volume);
  const [videoMuted, setVideoMuted] = useState(initialVideoVolumePreference.muted);
  const [volumeControlOpen, setVolumeControlOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const imageDragRef = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | undefined>(undefined);
  const presentationPreviewRef = useRef<HTMLDivElement>(null);
  const [presentationPosition, setPresentationPosition] = useState({ itemId: item.id, slideIndex: 0 });
  const presentationSlideIndex = presentationPosition.itemId === item.id ? presentationPosition.slideIndex : 0;
  const presentationFallbackRequestedRef = useRef(false);
  const mokiAssistancePendingRef = useRef(false);
  const mokiEditorAssistantOpenedRef = useRef(false);
  const univerSessionRef = useRef<ResourceLibraryUniverSession | undefined>(undefined);
  const editorRevision = useRef({ signature: '', value: 0 });
  const editorSignature = JSON.stringify([textContent, editingText, editingOffice, univerSession?.sessionId,textHistory.undo.length,textHistory.redo.length]);
  if (editorRevision.current.signature !== editorSignature) editorRevision.current = { signature: editorSignature, value: editorRevision.current.value + 1 };
  const officeEditable = isOfficeEditorSupportedExtension(extension);
  const editorOperations: WorkspaceEditorState['operations'] = loading || saving ? [] : [
    ...(kind === 'text' || officeEditable ? ['edit' as const] : []),
    ...(editingText || editingOffice ? ['save' as const] : []),
    ...(editingText ? ['read_text' as const, 'replace_text' as const, 'patch_text' as const] : []),
    ...(editingText && textHistory.undo.length ? ['undo' as const] : []),
    ...(editingText && textHistory.redo.length ? ['redo' as const] : []),
    ...(editingText || editingOffice ? ['discard' as const] : []),
    'save_as',
  ];
  useWorkspaceEditor(embedded && item.kind === 'local_file', {
    id: item.id, name: item.name, active, mode: editingOffice ? 'office' : editingText ? 'text' : 'preview',
    sessionId: univerSession?.sessionId, dirty, revision: editorRevision.current.value, operations: editorOperations,
  }, executeWorkspaceCommand);
  const [autosaveStatus, setAutosaveStatus] = useState('');
  const autosavePending = useRef<Promise<void>>(Promise.resolve());
  const lastTextCheckpoint = useRef('');
  const checkpointState = useRef({textContent,textSourceVersion,editingText,dirty,saving,session:univerSession});
  checkpointState.current = {textContent,textSourceVersion,editingText,dirty,saving,session:univerSession};
  async function draftRequest<T extends Record<string,unknown> = Record<string,unknown>>(path:string, method='GET', body?:unknown):Promise<T> {
    const response=await apiFetch(`/api/library/items/${encodeURIComponent(item.id)}/${path}`,{
      method,
      ...(body===undefined ? {} : {headers:{'content-type':'application/json'},body:JSON.stringify(body)}),
      ...(method === 'DELETE' ? {headers:{'x-moki-retryable-write':'true'}} : {}),
    });
    const responseText=await response.text();
    let result:Record<string,unknown>={};
    if(responseText) {
      try { result=JSON.parse(responseText) as Record<string,unknown>; }
      catch { result={error:responseText}; }
    }
    if(!response.ok)throw new Error(typeof result.error === 'string' ? result.error : response.statusText || '自动保存草稿失败');
    return result as T;
  }
  function persistDraft(syncFrame=true): Promise<void> {
    const pending=autosavePending.current.catch(()=>undefined).then(async()=>{
      const current=checkpointState.current;
      if(current.saving) return;
      if(current.session) {
        if(!current.dirty) return;
        if(syncFrame) await prepareOfficeEditorSave(current.session);
        const saved=await draftRequest<{savedAt:string}>(`univer-session/${current.session.sessionId}/checkpoint`,'POST',{});
        setAutosaveStatus(`草稿已自动保存 · ${new Date(saved.savedAt).toLocaleTimeString()}`);
      } else if(current.editingText || current.dirty) {
        const signature=JSON.stringify([current.textContent,current.textSourceVersion]);
        if(signature===lastTextCheckpoint.current)return;
        const saved=await draftRequest<{savedAt:string}>('draft','PUT',{content:current.textContent,version:current.textSourceVersion});
        lastTextCheckpoint.current=signature;
        setAutosaveStatus(`草稿已自动保存 · ${new Date(saved.savedAt).toLocaleTimeString()}`);
      }
    });
    autosavePending.current=pending;
    return pending.catch(error=>{setAutosaveStatus(`草稿自动保存失败：${error.message}`);throw error;});
  }
  const persistDraftRef=useRef(persistDraft);persistDraftRef.current=persistDraft;
  useEffect(()=>{
    onCheckpointReady?.(()=>persistDraftRef.current());
    const timer=window.setInterval(()=>{void persistDraftRef.current().catch(()=>undefined);},15000);
    return ()=>{window.clearInterval(timer);onCheckpointReady?.(undefined);void persistDraftRef.current(false).catch(()=>undefined);};
  },[item.id]);
  useEffect(()=>{
    if(!editingText && !dirty)return;
    const timer=window.setTimeout(()=>{void persistDraftRef.current().catch(()=>undefined);},1200);
    return ()=>window.clearTimeout(timer);
  },[textContent,editingText,dirty]);

  const discardingSessions = useRef(new Map<string, Promise<unknown>>());
  function discardOfficeSession(session: ResourceLibraryUniverSession): Promise<unknown> {
    const existing = discardingSessions.current.get(session.sessionId);
    if (existing) return existing;
    const pending = discardResourceLibraryUniverSession(session.itemId, session.sessionId).catch((error: unknown) => {
      discardingSessions.current.delete(session.sessionId);
      throw error;
    });
    discardingSessions.current.set(session.sessionId, pending);
    return pending;
  }
  const previewWindowRef = useRef<HTMLElement>(null);
  const officeEditorFrameRef = useRef<HTMLIFrameElement>(null);
  const previewResizeRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    width: number;
    height: number;
  } | undefined>(undefined);
  const [previewSize, setPreviewSize] = useState<{ width: number; height: number }>();
  const [officeEditorFocus, setOfficeEditorFocus] = useState<OfficeEditorFocus>();

  useEffect(() => {
    if (!active || kind !== "presentation" || editingOffice) return;
    const root = presentationPreviewRef.current;
    if (!root) return;
    const synchronize = () => synchronizePowerPointThumbnailRail(root, presentationSlideIndex);
    synchronize();
    const animationFrame = window.requestAnimationFrame(synchronize);
    const delayed = window.setTimeout(synchronize, 120);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.clearTimeout(delayed);
    };
  }, [active, editingOffice, item.id, item.updatedAt, kind, officeRevision, presentationSlideIndex]);

  useEffect(() => {
    if (!embedded || !active || (!univerSession && !editingText)) return;
    publishWorkbenchSelectionContext({
      source: 'library', label: `资料库编辑：${item.name}`, itemCount: 1,
      content: JSON.stringify({
        file: { id: item.id, name: item.name, type: univerSession ? 'Office' : 'text' },
        unsavedDraft: univerSession ? JSON.stringify({ editor: 'univer', sessionId: univerSession.sessionId,
          worktreeId: univerSession.worktreeId, unitId: univerSession.unitId, kind: univerSession.kind, units: univerSession.units ?? [] }) : textContent.slice(0, 16000),
        draftTruncated: !univerSession && textContent.length > 16000,
        assistantContext: univerSession
          ? '当前侧边工作区有活动 Univer 隔离草稿。使用精确文件 id 和 sessionId，先调用 workbench_univer_office_status / workbench_univer_office_inspect；不熟悉的功能先查 workbench_univer_office_api。通过 workbench_univer_office_execute_preview 调用完整 Univer Facade，新增或删除 Unit 使用 workbench_univer_unit_preview；插入用户图片时先检索资料库，再调用 workbench_univer_office_insert_library_image。工具直接修改隔离草稿，修改可在编辑器中回退或放弃，由用户点击保存后才写回文件。'
          : '当前侧边工作区有未保存文本草稿。编辑前结合草稿与原文生成确认预览，保留用户已有修改。',
      }),
    });
    return () => {
      const selection = readWorkbenchSelectionContext();
      if (selection?.source !== 'library') return;
      try {
        if (JSON.parse(selection.content).file?.id === item.id) clearWorkbenchSelectionContext('library');
      } catch { /* Leave unrelated selections intact. */ }
    };
  }, [embedded, active, item.id, item.name, univerSession, editingText, textContent]);

  useEffect(() => () => {
    if (mokiEditorAssistantOpenedRef.current) {
      mokiEditorAssistantOpenedRef.current = false;
      closeMokiEditorAssistance();
    }
    const session = univerSessionRef.current;
    if (!session) return;
    univerSessionRef.current = undefined;
    // The checkpoint cleanup preserves this session for recovery; explicit Cancel discards it.
  }, []);

  async function copyText(text: string, successNotice: string) {
    try {
      const desktopCopy = window.mokiDesktop?.copyText;
      if (desktopCopy) {
        if (!await desktopCopy(text)) throw new Error("Desktop clipboard rejected the text");
      } else {
        if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
        await navigator.clipboard.writeText(text);
      }
      setNotice(successNotice);
    } catch {
      setNotice("当前环境无法访问剪贴板");
    }
  }

  useEffect(() => {
    setNotice("");
    setTextContent("");
    setTextHistory({undo:[],redo:[]});
    setSavedTextContent("");
    setTextSourceVersion(undefined);
    setEditingText(false);
    setDirty(false);
    setRenderedTextPreview(["md", "markdown", "html", "htm", "json"].includes(extension));
    setStructuredPreview(undefined);
    setSavedStructuredPreview(undefined);
    setEditingOffice(false);
    const previousUniverSession = univerSessionRef.current;
    univerSessionRef.current = undefined;
    setUniverSession(undefined);
    if (previousUniverSession) {
      void discardOfficeSession(previousUniverSession).catch(() => undefined);
    }
    setOfficeRevision("");
    setPdfTextOpen(false);
    setOcrProgress(undefined);
    setActiveSheetIndex(0);
    setTableMode(extension === "csv" || extension === "tsv");
    setImageScale(1);
    setImageOffset({ x: 0, y: 0 });
    setVideoPlaying(false);
    setVideoCurrentTime(0);
    setVideoDuration(0);
    const savedVolume = readVideoVolumePreference();
    setVideoVolume(savedVolume.volume);
    setVideoMuted(savedVolume.muted);
    setVolumeControlOpen(false);
    setPreviewSize(undefined);
    presentationFallbackRequestedRef.current = false;
    if (["document", "spreadsheet"].includes(kind)) {
      let cancelled = false;
      setLoading(true);
      void getResourceLibraryStructuredPreview(item.id)
        .then((result) => {
          if (!cancelled) {
            setStructuredPreview(result);
            setSavedStructuredPreview(result);
            if (extension === "doc") setNotice("DOC 文本预览：不保留原始分页、图片和复杂排版，原文件不会被修改。");
            if (result.kind === "spreadsheet") setActiveSheetIndex(Math.max(0, result.sheets.findIndex(sheet => !sheet.layout?.hidden)));
          }
        })
        .catch((error) => { if (!cancelled) setNotice(error instanceof Error ? error.message : "Office 文件预览失败"); })
        .finally(() => { if (!cancelled) setLoading(false); });
      return () => { cancelled = true; };
    }
    if (kind !== "text") return undefined;
    let cancelled = false;
    setLoading(true);
    void getResourceLibraryTextContent(item.id)
      .then((result) => {
        if (cancelled) return;
        setTextContent(result.content);
        setSavedTextContent(result.content);
        setTextSourceVersion(result.version);
        void draftRequest<{draft?:{content:string;version?:string;savedAt?:string}}>('draft').then(({draft})=>{
          if(cancelled || !draft)return;
          setTextContent(draft.content);setTextSourceVersion(draft.version ?? result.version);
          setEditingText(true);setDirty(draft.content!==result.content);
          setNotice('已恢复上次自动保存的草稿；原文件未被覆盖');
        }).catch(error=>{if(!cancelled)setNotice(String(error));});
      })
      .catch((error) => { if (!cancelled) setNotice(error instanceof Error ? error.message : "文本读取失败"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [extension, item.id, kind]);

  useEffect(() => { onDirtyChangeRef.current?.(dirty); }, [dirty]);
  useEffect(() => () => onDirtyChangeRef.current?.(false), []);

  useEffect(() => {
    let cancelled = false;
    const handleUpdate = (event: Event) => {
      const detail = (event as CustomEvent<WorkbenchDataUpdatedDetail>).detail;
      if ((!mokiAssistancePendingRef.current && !embedded) || detail?.resource !== "resource_library" || detail.itemId !== item.id) return;
      mokiAssistancePendingRef.current = false;
      const activeSession = univerSessionRef.current;
      if (activeSession) {
        setDirty(true);
        setAutosaveStatus("");
        setNotice("MOKI 已完成写入；编辑结果已在当前编辑器中显示，请检查后选择保存或取消");
        return;
      }
      if (kind === "text" && textDraftActiveRef.current) {
        setNotice("原文件已更新，当前编辑草稿已保留。保存前请核对最新文件，或将草稿另存为。");
        return;
      }
      setLoading(true);
      if (kind === "text") {
        void getResourceLibraryTextContent(item.id)
          .then((result) => {
            if (cancelled || textDraftActiveRef.current) return;
            setTextContent(result.content);
            setSavedTextContent(result.content);
            setTextSourceVersion(result.version);
            setDirty(false);
            setNotice("已同步 MOKI 确认后的编辑结果");
          })
          .catch((error) => setNotice(error instanceof Error ? error.message : "MOKI 编辑结果同步失败"))
          .finally(() => setLoading(false));
        return;
      }
      void getResourceLibraryStructuredPreview(item.id)
        .then((result) => {
          setStructuredPreview(result);
          setSavedStructuredPreview(structuredClone(result));
          setDirty(false);
          setOfficeRevision(new Date().toISOString());
          setNotice("已同步 MOKI 确认后的编辑结果");
        })
        .catch((error) => setNotice(error instanceof Error ? error.message : "MOKI 编辑结果同步失败"))
        .finally(() => setLoading(false));
    };
    window.addEventListener(WORKBENCH_DATA_UPDATED_EVENT, handleUpdate);
    return () => { cancelled = true; window.removeEventListener(WORKBENCH_DATA_UPDATED_EVENT, handleUpdate); };
  }, [embedded, item.id, kind]);

  function loadPresentationFallback(): void {
    if (extension !== "pptx" || presentationFallbackRequestedRef.current) return;
    presentationFallbackRequestedRef.current = true;
    setLoading(true);
    void getResourceLibraryStructuredPreview(item.id)
      .then((result) => {
        setStructuredPreview(result);
        setSavedStructuredPreview(result);
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    const video = videoRef.current;
    if (kind !== "video" || !video) return;
    if (video.volume !== videoVolume) video.volume = videoVolume;
    if (video.muted !== videoMuted) video.muted = videoMuted;
  }, [item.id, kind, videoMuted, videoVolume]);

  const delimiter = extension === "tsv" ? "\t" as const : "," as const;
  const tableRows = useMemo(() => tableMode ? parseDelimitedText(textContent, delimiter) : [], [delimiter, tableMode, textContent]);
  const tableCellCount = tableRows.reduce((total, row) => total + row.length, 0);
  const renderEditableTable = editingText && tableMode && tableCellCount <= 12_000;
  const renderReadOnlyTable = !editingText && tableMode && tableCellCount <= 12_000;

  async function copySource() {
    await copyText(item.target || previewUrl || item.name, "已复制文件位置");
  }

  async function copyImageOrFrame(media: HTMLImageElement | HTMLVideoElement | null) {
    if (!media) return void copySource();
    const width = media instanceof HTMLVideoElement ? media.videoWidth : media.naturalWidth;
    const height = media instanceof HTMLVideoElement ? media.videoHeight : media.naturalHeight;
    if (!width || !height) return void copySource();
    try {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d")?.drawImage(media, 0, 0, width, height);
      await copyCanvas(canvas);
      setNotice(media instanceof HTMLVideoElement ? "已复制当前帧" : "已复制图片");
    } catch {
      await copySource();
    }
  }

  async function openVideoContextMenu(
    event: ReactMouseEvent<HTMLVideoElement>,
  ) {
    event.preventDefault();
    const video = event.currentTarget;
    const showNativeMenu = window.mokiDesktop?.showMediaContextMenu;
    if (!showNativeMenu) {
      await copyImageOrFrame(video);
      return;
    }
    const action = await showNativeMenu({
      canCopyFrame: video.videoWidth > 0 && video.videoHeight > 0,
      hasPath: Boolean(item.target || previewUrl || item.name),
      canOpen: true,
    });
    if (action === "copy-frame") await copyImageOrFrame(video);
    else if (action === "copy-path") await copySource();
    else if (action === "open") await onOpen(item);
  }

  function stepVideo(direction: -1 | 1) {
    const video = videoRef.current;
    if (!video) return;
    video.pause();
    const duration = Number.isFinite(video.duration) ? video.duration : Number.POSITIVE_INFINITY;
    video.currentTime = Math.max(0, Math.min(duration, video.currentTime + direction / VIDEO_PREVIEW_FPS));
    setVideoCurrentTime(video.currentTime);
    setVideoPlaying(false);
  }

  function toggleVideoPlayback() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play();
    else video.pause();
  }

  function seekVideo(value: number) {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.max(0, Math.min(videoDuration || 0, value));
    setVideoCurrentTime(video.currentTime);
  }

  function changeVideoVolume(value: number) {
    const video = videoRef.current;
    if (!video) return;
    const volume = Math.max(0, Math.min(1, value));
    video.volume = volume;
    video.muted = volume === 0;
    setVideoVolume(volume);
    setVideoMuted(video.muted);
    saveVideoVolumePreference({ volume, muted: video.muted });
  }

  function toggleVideoMuted() {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setVideoMuted(video.muted);
    saveVideoVolumePreference({ volume: video.volume, muted: video.muted });
  }

  useEffect(() => {
    if (kind !== "video") return undefined;
    const handleVideoShortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      const contentEditableRoot = target?.closest("[contenteditable]");
      const isEditableTarget = target?.isContentEditable
        || Boolean(contentEditableRoot && contentEditableRoot.getAttribute("contenteditable") !== "false")
        || target instanceof HTMLTextAreaElement
        || target instanceof HTMLSelectElement
        || (target instanceof HTMLInputElement && target.type !== "range");
      if (isEditableTarget) return;

      if (event.key === " " || event.code === "Space") {
        if (event.repeat) return;
        event.preventDefault();
        toggleVideoPlayback();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        stepVideo(-1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        stepVideo(1);
      }
    };
    window.addEventListener("keydown", handleVideoShortcut);
    return () => window.removeEventListener("keydown", handleVideoShortcut);
  }, [item.id, kind]);

  async function saveText(propagate = false) {
    setSaving(true);
    setNotice("");
    try {
      await autosavePending.current.catch(()=>undefined);
      const saved = await saveResourceLibraryTextContent(item.id, textContent, textSourceVersion);
      await draftRequest('draft','DELETE');
      lastTextCheckpoint.current='';
      setAutosaveStatus('');
      checkpointState.current={...checkpointState.current,textContent,editingText:false,dirty:false,saving:false};
      setTextSourceVersion(saved.version);
      setSavedTextContent(textContent);
      setTextHistory({undo:[],redo:[]});
      setDirty(false);
      setEditingText(false);
      finishMokiEditorAssistance();
      setNotice("已保存到原文件");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "文本保存失败");
      if (propagate) throw error;
    } finally {
      setSaving(false);
    }
  }

  async function startOfficeEditing(propagate = false) {
    if (univerSessionRef.current) return univerSessionRef.current;
    if (!officeEditable) {
      setNotice(extension === "ppt"
        ? "旧版 .ppt 仅支持预览，请另存为 .pptx 后编辑"
        : "当前格式不支持 Office 编辑");
      if (propagate) throw new Error("当前格式不支持 Office 编辑");
      return;
    }
    setNotice("");
    setLoading(true);
    try {
      const session = await openResourceLibraryUniverSession(item.id);
      univerSessionRef.current = session;
      setUniverSession(session);
      setEditingOffice(true);
      setDirty(session.recoveredDraft === true);
      setNotice(session.recoveredDraft ? "正在恢复上次自动保存的草稿…" : "正在打开编辑器…");
      return session;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "编辑器打开失败");
      if (propagate) throw error;
    } finally {
      setLoading(false);
    }
  }

  async function cancelOfficeEditing(propagate = false) {
    const session = univerSessionRef.current;
    if (!session) return;
    setSaving(true);
    try {
      await discardOfficeSession(session);
      univerSessionRef.current = undefined;
      setUniverSession(undefined);
      setStructuredPreview(savedStructuredPreview ? structuredClone(savedStructuredPreview) : undefined);
      setEditingOffice(false);
      finishMokiEditorAssistance();
      setDirty(false);
      setNotice("已放弃草稿，原文件没有被修改");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "草稿放弃失败");
      if (propagate) throw error;
    } finally {
      setSaving(false);
    }
  }

  function changeOfficePreview(updater: (current: Exclude<ResourceLibraryStructuredPreview, { kind: "pdf" }>) => Exclude<ResourceLibraryStructuredPreview, { kind: "pdf" }>) {
    setStructuredPreview((current) => {
      if (!current || current.kind === "pdf") return current;
      return updater(structuredClone(current));
    });
    setDirty(true);
  }

  async function prepareOfficeEditorSave(session: ResourceLibraryUniverSession): Promise<void> {
    const frame = officeEditorFrameRef.current;
    const target = frame?.contentWindow;
    if (!frame || !target) throw new Error('Office 编辑器尚未就绪，无法同步保存');
    const expectedOrigin = new URL(session.viewerUrl, window.location.href).origin;
    const requestId = `save-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const synced = await new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (value: boolean) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        window.removeEventListener("message", handleMessage);
        resolve(value);
      };
      const handleMessage = (event: MessageEvent) => {
        if (event.source !== target || event.origin !== expectedOrigin) return;
        const payload = event.data as Record<string, unknown> | null;
        if (payload?.type !== "moki:univer-save-ready" || payload.requestId !== requestId) return;
        finish(payload.synced === true);
      };
      const timeout = window.setTimeout(() => finish(false), 10_000);
      window.addEventListener("message", handleMessage);
      target.postMessage({ type: "moki:univer-prepare-save", requestId }, expectedOrigin);
    });
    if (!synced) throw new Error("编辑内容仍在同步，请稍后再次保存");
  }

  async function readUniverEditorSelection(session: ResourceLibraryUniverSession): Promise<UniverImageSelection | undefined> {
    const frame = officeEditorFrameRef.current;
    const target = frame?.contentWindow;
    if (!target) throw new Error("Office 编辑器尚未就绪");
    const expectedOrigin = new URL(session.viewerUrl, window.location.href).origin;
    const requestId = `selection-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value?: UniverImageSelection) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        window.removeEventListener("message", handleMessage);
        resolve(value);
      };
      const handleMessage = (event: MessageEvent) => {
        if (event.source !== target || event.origin !== expectedOrigin) return;
        const payload = event.data as Record<string, unknown> | null;
        if (payload?.type !== "moki:univer-selection-response" || payload.requestId !== requestId) return;
        finish(normalizeUniverImageSelection(payload.selection));
      };
      const timeout = window.setTimeout(() => finish(), 2_000);
      window.addEventListener("message", handleMessage);
      target.postMessage({ type: "moki:univer-selection-request", requestId }, expectedOrigin);
    });
  }

  async function openLibraryImagePicker(selection?: UniverImageSelection) {
    libraryImageSelectionRef.current = selection;
    setLibraryImagePickerOpen(true);
    setLibraryImageLoading(true);
    setLibraryImageError("");
    try {
      setLibraryImageItems(await getResourceLibraryItems());
    } catch (error) {
      setLibraryImageError(error instanceof Error ? error.message : "资料库加载失败");
    } finally {
      setLibraryImageLoading(false);
    }
  }

  async function insertLibraryImage(items: ResourceLibraryItem[]) {
    const image = items[0];
    const session = univerSessionRef.current;
    if (!image || !session) return;
    setLibraryImagePickerOpen(false);
    setInsertingLibraryImage(true);
    setNotice("");
    try {
      const selection = libraryImageSelectionRef.current ?? await readUniverEditorSelection(session);
      if (!selection?.unitId) throw new Error("无法确认当前编辑位置，请先在编辑器中点选插入位置后重试");
      const selectionKind = selection.kind;
      const target = selection.kind === "slide"
        ? { unitId: selection.unitId, slideId: selection.slideId }
        : selection.kind === "document"
          ? { unitId: selection.unitId, startOffset: selection.startOffset, endOffset: selection.endOffset, segmentId: selection.segmentId }
          : selection.kind === "sheet"
            ? { unitId: selection.unitId, sheetId: selection.sheetId, row: selection.row, column: selection.column }
            : { unitId: selection.unitId };
      const result = await insertResourceLibraryUniverImage(item.id, session.sessionId, {
        imageId: image.id,
        ...target,
      });
      setDirty(true);
      setAutosaveStatus("");
      setNotice(result.optimization?.optimized
        ? `已将“${result.image.name}”优化为 ${result.optimization.embeddedFormat.toUpperCase()} 并插入当前${selectionKind === "slide" ? "幻灯片" : selectionKind === "sheet" ? "工作表" : selectionKind === "document" ? "文档" : "白板"}`
        : `已将“${result.image.name}”插入当前${selectionKind === "slide" ? "幻灯片" : selectionKind === "sheet" ? "工作表" : selectionKind === "document" ? "文档" : "白板"}，可继续调整位置和大小`);
      void persistDraftRef.current(false).catch(() => undefined);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "资料库图片插入失败");
    } finally {
      setInsertingLibraryImage(false);
      libraryImageSelectionRef.current = undefined;
    }
  }

  async function saveOffice(propagate = false) {
    const session = univerSessionRef.current;
    if (!session) return;
    setSaving(true);
    setNotice("");
    try {
      await prepareOfficeEditorSave(session);
      const result = await saveResourceLibraryUniverSession(item.id, session.sessionId);
      univerSessionRef.current = undefined;
      setUniverSession(undefined);
      setEditingOffice(false);
      finishMokiEditorAssistance();
      setDirty(false);
      setOfficeRevision(result.updatedAt);
      setNotice(kind === "workspace" ? "已确认合并 Univer 草稿，并原子保存到原生工作区文件" : "已确认合并 Univer 草稿，并原子保存到原 Office 文件");
      // The save response is authoritative. Rebuilding the read-only preview
      // can take much longer for rich Word files, so it must not keep the Save
      // button spinning after the source file has already been written.
      if (kind !== "workspace") {
        void getResourceLibraryStructuredPreview(item.id).then((preview) => {
          setStructuredPreview(preview);
          setSavedStructuredPreview(structuredClone(preview));
        }).catch(() => undefined);
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "文件保存失败");
      if (propagate) throw error;
    } finally {
      setSaving(false);
    }
  }

  async function saveOfficeAs(destinationOverride?: string, propagate = false) {
    const session = univerSessionRef.current;
    if (!session) return;
    const selectSavePath = window.mokiDesktop?.selectSavePath;
    const destination = destinationOverride ?? (selectSavePath ? await selectSavePath(item.name) : undefined);
    if (selectSavePath && !destination) return { cancelled: true as const };
    if (destination && sameSourcePath(destination)) {
      setNotice('另存为不能覆盖原文件，请选择其他路径');
      if (propagate) throw new Error('另存为不能覆盖原文件');
      return;
    }
    setSaving(true);
    setNotice("");
    try {
      await prepareOfficeEditorSave(session);
      const result = await saveAsResourceLibraryUniverSession(item.id, session.sessionId, item.name, destination ?? undefined);
      univerSessionRef.current = undefined;
      setUniverSession(undefined);
      setStructuredPreview(savedStructuredPreview ? structuredClone(savedStructuredPreview) : undefined);
      setEditingOffice(false);
      finishMokiEditorAssistance();
      setDirty(false);
      setNotice(result.path ? `已另存为“${result.path}”，原文件未修改` : "已下载当前编辑内容，原文件未修改");
      return result;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "文件另存为失败");
      if (propagate) throw error;
    } finally {
      setSaving(false);
    }
  }

  function sameSourcePath(destination: string) {
    return destination.replace(/\\/gu,'/').toLowerCase() === (item.target ?? '').replace(/\\/gu,'/').toLowerCase();
  }

  function textHistoryStep(operation: 'undo' | 'redo') {
    const source = textHistory[operation];
    const previous = source.at(-1);
    if (previous === undefined) throw new Error('没有可回退的助手编辑');
    setTextHistory(operation === 'undo'
      ? {undo:source.slice(0,-1),redo:[...textHistory.redo,textContent]}
      : {undo:[...textHistory.undo,textContent],redo:source.slice(0,-1)});
    setTextContent(previous);setDirty(previous !== savedTextContent);
    setNotice(operation === 'undo' ? '已撤销助手编辑，原文件未修改' : '已重做助手编辑，尚未保存');
  }

  async function discardTextDraft(propagate = false) {
    setSaving(true);
    try {
      await autosavePending.current.catch(()=>undefined);
      await draftRequest('draft','DELETE');
      lastTextCheckpoint.current='';setAutosaveStatus('');
      checkpointState.current={...checkpointState.current,textContent:savedTextContent,editingText:false,dirty:false,saving:false};
      setTextContent(savedTextContent);setTextHistory({undo:[],redo:[]});
      setDirty(false);setEditingText(false);finishMokiEditorAssistance();
      setRenderedTextPreview(['md','markdown','html','htm','json'].includes(extension));
      setNotice("已放弃草稿，原文件没有被修改");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "草稿放弃失败");
      if (propagate) throw error;
    } finally {
      setSaving(false);
    }
  }

  async function completeEditorExit(action: "save" | "discard") {
    const intent = exitIntent;
    if (!intent || saving) return;
    try {
      if (action === "save") {
        if (editingOffice && univerSessionRef.current) await saveOffice(true);
        else if (editingText) await saveText(true);
      } else if (editingOffice) {
        await cancelOfficeEditing(true);
      } else if (editingText) {
        await discardTextDraft(true);
      }
      setExitIntent(undefined);
      if (intent === "close") onClose();
    } catch {
      // The save/discard routine keeps the error visible and the prompt open.
    }
  }

  async function requestEditorExit(intent: EditorExitIntent) {
    if (saving) return;
    if (dirty) {
      setExitIntent(intent);
      return;
    }
    try {
      if (editingOffice) await cancelOfficeEditing(true);
      else if (editingText) await discardTextDraft(true);
      if (intent === "close") onClose();
    } catch {
      // Keep the editor open when its recoverable draft cannot be cleaned up.
    }
  }
  const requestEditorExitRef = useRef(requestEditorExit);
  requestEditorExitRef.current = requestEditorExit;
  useEffect(() => {
    onCloseRequestReady?.(() => { void requestEditorExitRef.current("close"); });
    return () => onCloseRequestReady?.(undefined);
  }, [item.id, onCloseRequestReady]);

  async function executeWorkspaceCommand(command: WorkspaceEditorCommand): Promise<WorkspaceEditorResult> {
    if (loading || saving) throw new Error('编辑器正在加载或保存，请稍后重试');
    if (!editorOperations.includes(command.operation)) throw new Error('当前格式或状态不支持此操作');
    if (command.operation === 'edit') {
      if (kind === 'text') { setEditingText(true); setRenderedTextPreview(false); setNotice('已进入文本编辑'); }
      else { const session = await startOfficeEditing(true); return {status:'completed', message:'已打开或复用 Office 草稿', sessionId:session!.sessionId}; }
      return {status:'completed',message:'已进入文本编辑，尚未写入原文件'};
    }
    if (command.operation === 'read_text') return {status:'completed',message:'当前文本草稿（含未保存修改）',content:textContent};
    if (command.operation === 'replace_text' || command.operation === 'patch_text') {
      const nextContent = command.operation === 'patch_text' ? applyTextDraftPatches(textContent, command.patches ?? []) : command.content!;
      if (nextContent === textContent) return {status:'completed',message:'草稿内容未变化'};
      const undo=[...textHistory.undo,textContent].slice(-20);
      while(undo.length>1 && undo.reduce((size,text)=>size+text.length,0)>5_000_000) undo.shift();
      setTextHistory({undo,redo:[]});
      setTextContent(nextContent); setDirty(true);
      return {status:'completed',message:'当前文本草稿已直接更新，可撤销；尚未保存到原文件'};
    }
    if (command.operation === 'undo' || command.operation === 'redo') {
      textHistoryStep(command.operation);
      return {status:'completed',message:command.operation === 'undo' ? '已撤销助手编辑，原文件未修改' : '已重做助手编辑，尚未保存'};
    }
    if (command.operation === 'discard') {
      if (editingOffice) await cancelOfficeEditing(true);else await discardTextDraft(true);
      return {status:'completed',message:'已放弃当前未保存草稿，恢复原文件预览'};
    }
    if (command.operation === 'save') {
      if (editingOffice && univerSessionRef.current) await saveOffice(true);
      else if (editingText) await saveText(true);
      else throw new Error('没有活动编辑草稿');
      return {status:'completed',message:'编辑内容已保存到原文件',path:item.target ?? undefined};
    }
    if (editingOffice && univerSessionRef.current) {
      const result = await saveOfficeAs(command.destination, true);
      if (result && 'cancelled' in result) return {status:'cancelled',message:'用户取消了另存，草稿和原文件保留'};
      if (!result) throw new Error('未能确认另存结果');
      return {status:'completed',message:result.path ? '当前草稿已另存，原文件未修改' : '已发起当前草稿下载，原文件未修改',path:result.path};
    }
    const selectSavePath=window.mokiDesktop?.selectSavePath;
    const destination=command.destination ?? (selectSavePath ? await selectSavePath(item.name) : undefined);
    if (selectSavePath && !destination) return {status:'cancelled',message:'用户取消了另存'};
    if (destination && sameSourcePath(destination)) throw new Error('另存为不能覆盖原文件');
    setSaving(true);
    try {
      if (kind === 'text') {
        const result=await saveAsResourceLibraryText(item.id,textContent,item.name,destination ?? undefined);
        return {status:'completed',message:result.path ? '当前文本已另存，原文件和活动草稿保留' : '已发起当前文本下载，原文件未修改',path:result.path};
      }
      if (!destination) throw new Error('此格式另存需要选择本地目标路径');
      const result=await exportResourceLibraryItem(item.id,{destination,mode:'file'});
      return {status:'completed',message:'预览文件已另存，原文件未修改',path:result.path};
    } finally {setSaving(false);}
  }

  function openMokiAtCaret(event: ReactKeyboardEvent<HTMLElement>) {
    if (!(event.altKey && event.key.toLocaleLowerCase() === "m")) return;
    const active = event.target;
    if (!(active instanceof HTMLElement)) return;
    const contentEditable = active.closest<HTMLElement>("[contenteditable='true']");
    if (!(active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement) && !contentEditable) return;
    event.preventDefault();
    event.stopPropagation();
    if (active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement) {
      const selectedText = active.value.slice(active.selectionStart ?? 0, active.selectionEnd ?? 0);
      askMokiToEdit("", selectedText, editableCaretPosition(active));
      return;
    }
    askMokiToEdit("", window.getSelection()?.toString() ?? "", contentEditableCaretPosition(contentEditable!));
  }

  function askMokiToEdit(
    instruction = "",
    selectedText = "",
    anchor?: { x: number; y: number },
    editorSelection?: UniverEditorSelection,
  ) {
    const active = document.activeElement;
    if (!selectedText && (active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement)) {
      selectedText = active.value.slice(active.selectionStart ?? 0, active.selectionEnd ?? 0);
    }
    const draft = kind === "text"
      ? textContent
      : univerSession
        ? JSON.stringify({
            editor: "univer",
            sessionId: univerSession.sessionId,
            worktreeId: univerSession.worktreeId,
            unitId: univerSession.unitId,
            kind: univerSession.kind,
            units: univerSession.units ?? [],
            editorSelection: editorSelection ?? null,
          }, null, 2)
      : structuredPreview && structuredPreview.kind !== "pdf"
        ? JSON.stringify(structuredPreview, null, 2)
        : "";
    const fileType = kind === "text" ? "Markdown" : kind === "workspace" ? "Univer 多 Unit" : "Office";
    mokiAssistancePendingRef.current = true;
    mokiEditorAssistantOpenedRef.current = true;
    requestMokiAssistance({
      source: "library",
      label: `资料库编辑：${item.name}`,
      itemCount: 1,
      content: JSON.stringify({
        file: { id: item.id, name: item.name, type: fileType },
        selectedText: selectedText || null,
        editorSelection: editorSelection ?? null,
        unsavedDraft: draft.slice(0, 16_000),
        draftTruncated: draft.length > 16_000,
        assistantContext: univerSession
          ? "当前为正在运行的 Univer 隔离草稿。先用精确 sessionId 调用 workbench_univer_office_status 获取全部 Unit，再用 workbench_univer_office_inspect 检查目标 Unit；不确定 Facade 能力时先调用 workbench_univer_office_api。若 editorSelection.kind 为 document，普通续写必须在其 startOffset 插入；存在选区时仅替换 startOffset 到 endOffset。不得默认追加到文末或重写整段。插入文本先去除首尾空白和空行，除用户明确要求排版、分段、列表或换页外，不得添加多余换行或空白段落。所有文档、表格、演示文稿的内容、格式、公式、表格、图表、图片、形状、页面布局与多 Unit 操作均通过 workbench_univer_office_execute_preview 调用完整 Univer Facade 直接写入隔离草稿；新增或删除 Unit 使用 workbench_univer_unit_preview；插入用户图片时先用 workbench_resource_library 找到唯一图片，再用 workbench_univer_office_insert_library_image。草稿可回退或放弃，只有用户保存后才写回原文件。"
          : "根据用户接下来输入的指令协助编辑当前资料；涉及写入时先生成确认预览。",
      }, null, 2),
    }, `请协助编辑资料库中的${fileType}文件“${item.name}”。当前文件 ID 是 ${item.id}，编辑器草稿、光标位置与选中文字已作为工作台选区提供。我的编辑要求是：${instruction.trim() || "请在当前光标或选区位置协助续写、改写或排版"}。${univerSession ? "这是正在运行的 Univer 隔离草稿；普通文本只在 editorSelection 指定的光标位置插入或替换选区，先清理生成内容首尾空白，除版式确有需要外不增加换行或空白段落。先读取会话与目标 Unit，再使用工作台选区中的精确 sessionId 调用完整 Univer 编辑工具直接修改草稿；插入资料库图片时使用专用图片插入工具。草稿可回退或放弃，我会在完整编辑器里复核并决定保存。" : "需要写入文件时，先读取精确文件并生成确认预览，只有我确认后才能保存。"}`, {
      ...(anchor ? { anchor } : {}),
      preferInline: true,
      prefillPrompt: false,
      editorAssist: true,
    });
    setNotice("已唤醒 MOKI，并带入当前文件、草稿和选中文字");
  }

  function finishMokiEditorAssistance() {
    if (!mokiEditorAssistantOpenedRef.current) return;
    mokiEditorAssistantOpenedRef.current = false;
    mokiAssistancePendingRef.current = false;
    closeMokiEditorAssistance();
  }

  useEffect(() => {
    if (!editingText && (!editingOffice || !univerSession)) return undefined;
    const subscribe = window.mokiDesktop?.assistantWindow?.onComposeShortcut;
    if (!subscribe) return undefined;
    return subscribe((anchor) => {
      if (editingOffice && !univerSessionRef.current) return;
      askMokiToEdit("", "", anchor);
    });
  }, [editingOffice, editingText, univerSession?.sessionId]);

  useEffect(() => {
    if (!editingOffice || !univerSession) return undefined;
    const expectedOrigin = new URL(univerSession.viewerUrl, window.location.href).origin;
    const handleEditorMessage = (event: MessageEvent) => {
      const frame = officeEditorFrameRef.current;
      if (!frame || event.source !== frame.contentWindow || event.origin !== expectedOrigin) return;
      const payload = event.data;
      if (!payload || typeof payload !== "object") return;
      const detail = payload as Record<string, unknown>;
      if (detail.type === "moki:univer-dirty") {
        setDirty(true);
        setAutosaveStatus("");
        return;
      }
      if (detail.type === "moki:univer-open-library-media" && detail.mediaKind === "image") {
        void openLibraryImagePicker(normalizeUniverImageSelection(detail.selection));
        return;
      }
      if (detail.type !== "moki:univer-compose-shortcut") return;
      const bounds = frame.getBoundingClientRect();
      const localX = typeof detail.x === "number" && Number.isFinite(detail.x) ? detail.x : bounds.width / 2;
      const localY = typeof detail.y === "number" && Number.isFinite(detail.y) ? detail.y : Math.min(120, bounds.height / 2);
      const selectedText = typeof detail.selectedText === "string" ? detail.selectedText.slice(0, 8_000) : "";
      const editorSelection = detail.editorSelection && typeof detail.editorSelection === "object"
        ? detail.editorSelection as UniverEditorSelection
        : undefined;
      askMokiToEdit("", selectedText, {
        x: Math.round(bounds.left + Math.max(0, Math.min(bounds.width, localX))),
        y: Math.round(bounds.top + Math.max(0, Math.min(bounds.height, localY))),
      }, editorSelection);
    };
    window.addEventListener("message", handleEditorMessage);
    return () => window.removeEventListener("message", handleEditorMessage);
  }, [editingOffice, univerSession?.sessionId, univerSession?.viewerUrl]);

  function updateDocumentParagraph(index: number, value: string) {
    changeOfficePreview((current) => {
      if (current.kind !== "document") return current;
      current.paragraphs[index] = value;
      return current;
    });
  }

  function updateSpreadsheetCell(sheetIndex: number, rowIndex: number, columnIndex: number, value: string) {
    changeOfficePreview((current) => {
      if (current.kind !== "spreadsheet") return current;
      const sheet = current.sheets[sheetIndex];
      if (!sheet) return current;
      while (sheet.rows.length <= rowIndex) sheet.rows.push([]);
      const row = sheet.rows[rowIndex] ?? [];
      while (row.length <= columnIndex) row.push("");
      row[columnIndex] = value;
      sheet.rows[rowIndex] = row;
      return current;
    });
  }

  function updatePresentationParagraph(slideIndex: number, paragraphIndex: number, value: string) {
    changeOfficePreview((current) => {
      if (current.kind !== "presentation") return current;
      const slide = current.slides[slideIndex];
      if (slide) slide.paragraphs[paragraphIndex] = value;
      return current;
    });
  }

  function rememberOfficeEditorFocus(event: ReactFocusEvent<HTMLElement>) {
    const label = (event.target as HTMLElement).getAttribute("aria-label") ?? "";
    let match = label.match(/^Word 第 (\d+) 段$/u);
    if (match) {
      setOfficeEditorFocus({ kind: "document", paragraph: Number(match[1]) - 1 });
      return;
    }
    match = label.match(/ 第 (\d+) 行第 (\d+) 列$/u);
    if (match) {
      setOfficeEditorFocus({ kind: "spreadsheet", row: Number(match[1]) - 1, column: Number(match[2]) - 1 });
      return;
    }
    match = label.match(/^第 (\d+) 页第 (\d+) 个文本块$/u);
    if (match) setOfficeEditorFocus({ kind: "presentation", slide: Number(match[1]) - 1, paragraph: Number(match[2]) - 1 });
  }

  async function togglePdfText() {
    if (pdfTextOpen) {
      setPdfTextOpen(false);
      setNotice("");
      return;
    }
    setPdfTextOpen(true);
    if (structuredPreview?.kind === "pdf") return;
    setLoading(true);
    setNotice("");
    try {
      const result = await getResourceLibraryStructuredPreview(item.id);
      if (result.kind !== "pdf") throw new Error("PDF 提取结果无效");
      setStructuredPreview(result);
      if (!result.text) setNotice("未提取到文字；扫描版 PDF 需要 OCR 后才能读取文本");
    } catch (error) {
      setPdfTextOpen(false);
      setNotice(error instanceof Error ? error.message : "PDF 文本提取失败");
    } finally {
      setLoading(false);
    }
  }

  async function recognizePdf() {
    if (structuredPreview?.kind !== "pdf") return;
    setLoading(true);
    setNotice("");
    setOcrProgress({ currentPage: 1, totalPages: structuredPreview.totalPages, phase: "rendering" });
    try {
      const result = await recognizeResourceLibraryPdf(
        item.id,
        structuredPreview.totalPages,
        setOcrProgress,
      );
      setStructuredPreview(result);
      setNotice(`DeepSeek OCR 已完成，共识别 ${result.totalPages} 页`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "DeepSeek OCR 识别失败");
    } finally {
      setLoading(false);
      setOcrProgress(undefined);
    }
  }

  function updateTableCell(rowIndex: number, columnIndex: number, value: string) {
    const rows = parseDelimitedText(textContent, delimiter);
    while (rows.length <= rowIndex) rows.push([]);
    const row = rows[rowIndex] ?? [];
    while (row.length <= columnIndex) row.push("");
    row[columnIndex] = value;
    rows[rowIndex] = row;
    setTextContent(serializeDelimitedRows(rows, delimiter));
    setDirty(true);
  }

  function changeImageScale(nextScale: number) {
    const scale = Math.max(0.25, Math.min(8, nextScale));
    setImageScale(scale);
    if (scale === 1) setImageOffset({ x: 0, y: 0 });
  }

  function startImagePan(event: ReactPointerEvent<HTMLDivElement>) {
    if (imageScale <= 1 || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    imageDragRef.current = { x: event.clientX, y: event.clientY, offsetX: imageOffset.x, offsetY: imageOffset.y };
  }

  function moveImage(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = imageDragRef.current;
    if (!drag) return;
    setImageOffset({ x: drag.offsetX + event.clientX - drag.x, y: drag.offsetY + event.clientY - drag.y });
  }

  function startPreviewResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    const bounds = previewWindowRef.current?.getBoundingClientRect();
    if (!bounds) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    previewResizeRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      width: bounds.width,
      height: bounds.height,
    };
  }

  function movePreviewResize(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = previewResizeRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const containingBounds = contained
      ? previewWindowRef.current?.parentElement?.getBoundingClientRect()
      : undefined;
    const maxWidth = Math.max(1, (containingBounds?.width ?? window.innerWidth) - 32);
    const maxHeight = Math.max(1, (containingBounds?.height ?? window.innerHeight) - 32);
    const minWidth = Math.min(320, maxWidth);
    const minHeight = Math.min(320, maxHeight);
    setPreviewSize({
      width: Math.max(minWidth, Math.min(maxWidth, drag.width + event.clientX - drag.startX)),
      height: Math.max(minHeight, Math.min(maxHeight, drag.height + event.clientY - drag.startY)),
    });
  }

  function endPreviewResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (previewResizeRef.current?.pointerId !== event.pointerId) return;
    previewResizeRef.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  const visualLocationContext = JSON.stringify({
    mode: editingOffice ? "office_editor" : editingText ? "text_editor" : "preview",
    contentKind: kind,
    extension,
    ...(kind === "presentation" && !editingOffice ? { pageNumber: presentationSlideIndex + 1 } : {}),
    ...(kind === "spreadsheet" && !editingOffice ? {
      sheetIndex: activeSheetIndex,
      sheetName: structuredPreview?.kind === "spreadsheet"
        ? structuredPreview.sheets[activeSheetIndex]?.name
        : undefined,
    } : {}),
    ...(univerSession ? {
      sessionId: univerSession.sessionId,
      worktreeId: univerSession.worktreeId,
      unitId: univerSession.unitId,
      unitKind: univerSession.kind,
    } : {}),
    ...(officeEditorFocus ? { focus: officeEditorFocus } : {}),
  });

  const toolButton = "grid size-9 shrink-0 place-items-center rounded-xl border border-[#dedfea] bg-white text-[#5f6579] transition hover:border-[#bcb8ec] hover:bg-[#f1f0ff] hover:text-[#5f58bd] disabled:opacity-40";

  return <div data-moki-preview-location={visualLocationContext} className={embedded ? "flex size-full min-h-0 flex-col" : `${contained ? "absolute" : "fixed"} inset-0 grid min-h-0 place-items-center overflow-hidden bg-[#111827]/40 p-4 backdrop-blur-sm ${layerClassName}`} role={embedded ? "region" : "dialog"} aria-modal={embedded ? undefined : true} aria-label={`预览 ${item.name}`}>
    <section
      ref={previewWindowRef}
      aria-label="文件预览窗口"
      onKeyDownCapture={openMokiAtCaret}
      onFocusCapture={rememberOfficeEditorFocus}
      className={embedded
        ? "relative flex size-full min-h-0 min-w-0 flex-col overflow-hidden bg-white p-3"
        : contained
          ? "relative flex min-h-0 min-w-0 resize flex-col overflow-hidden rounded-[24px] bg-white p-4 shadow-2xl"
          : "relative flex h-[82vh] min-h-80 min-w-80 max-h-[calc(100vh-2rem)] max-w-[calc(100vw-2rem)] resize flex-col overflow-hidden rounded-[24px] bg-white p-4 shadow-2xl"}
      style={{
        width: embedded
          ? undefined
          : previewSize
            ? `${previewSize.width}px`
            : contained
              ? "68rem"
              : "min(72rem, calc(100vw - 2rem))",
        height: embedded
          ? undefined
          : previewSize
            ? `${previewSize.height}px`
            : contained
              ? "44rem"
              : undefined,
        maxWidth: embedded ? undefined : contained ? "calc(100% - 2rem)" : undefined,
        maxHeight: embedded ? undefined : contained ? "calc(100% - 2rem)" : undefined,
      }}
    >
      <header className="moki-dialog-header mb-3 flex shrink-0 flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 flex-1">{editingOffice ? <div className="flex min-w-0 items-center gap-2"><b className="shrink-0 truncate text-[0.875rem]">{item.name}</b><span className={embedded ? "min-w-0 truncate text-[0.625rem] text-[#9096a8]" : "max-w-[42vw] truncate text-[0.625rem] text-[#9096a8]"} title={item.target ?? undefined}>{item.target}</span></div> : <><b className="block truncate text-[0.875rem]">{item.name}</b><span className={embedded ? "block truncate text-[0.625rem] text-[#9096a8]" : "block max-w-[54vw] truncate text-[0.625rem] text-[#9096a8]"} title={item.target ?? undefined}>{item.target}</span></>}</div>
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
          {(kind === "audio" || kind === "embedded" || kind === "web" || kind === "unsupported") ? <button type="button" aria-label="复制文件位置" onClick={() => void copySource()} className={toolButton}><Copy size={14}/></button> : null}
          {item.kind === "local_file" && (officeEditable || kind === "workspace") ? editingOffice ? <>
            <span className="hidden rounded-full bg-[#f0efff] px-2.5 py-1 text-[0.625rem] font-extrabold text-[#625bc5] sm:inline">草稿</span>
            <button type="button" disabled={saving} onClick={() => void requestEditorExit("cancel")} className="h-9 rounded-xl border border-[#dedfea] bg-white px-3 text-[0.6875rem] font-bold text-[#5f6579] disabled:opacity-40">取消</button>
            <button type="button" disabled={!dirty || saving} onClick={() => void saveOfficeAs()} className="flex h-9 items-center gap-1.5 rounded-xl border border-[#cfd2df] bg-white px-3 text-[0.6875rem] font-bold text-[#4f566b] hover:bg-[#f5f4ff] disabled:opacity-40"><Save size={13}/>另存为</button>
            <button type="button" disabled={!dirty || saving} onClick={() => void saveOffice()} className="flex h-9 items-center gap-1.5 rounded-xl bg-[#292f47] px-3 text-[0.6875rem] font-bold text-white disabled:opacity-40">{saving ? <LoaderCircle size={13} className="animate-spin"/> : <Save size={13}/>}保存</button>
          </> : <>
            <button type="button" aria-label={kind === "workspace" ? "编辑 Univer" : "编辑 Office"} title={kind === "workspace" ? "编辑 Univer" : "编辑 Office"} disabled={loading} onClick={() => void startOfficeEditing()} className={toolButton}><Pencil size={14}/></button>
            <button type="button" aria-label="复制文件位置" onClick={() => void copySource()} className={toolButton}><Copy size={14}/></button>
          </> : null}
          {kind === "embedded" && extension === "pdf" ? <>
            {pdfTextOpen && structuredPreview?.kind === "pdf" && structuredPreview.text ? <button type="button" aria-label="复制 PDF 文本" onClick={() => void copyText(structuredPreview.text, "已复制 PDF 文本")} className={toolButton}><Copy size={14}/></button> : null}
            {pdfTextOpen && structuredPreview?.kind === "pdf" ? <button type="button" disabled={loading} onClick={() => void recognizePdf()} className="flex h-9 items-center gap-1.5 rounded-xl bg-[#625bc5] px-3 text-[0.6875rem] font-bold text-white hover:bg-[#554fb4] disabled:opacity-40">{ocrProgress ? <LoaderCircle size={13} className="animate-spin"/> : <ScanText size={13}/>} {ocrProgress ? `${ocrProgress.phase === "rendering" ? "渲染" : "识别"} ${ocrProgress.currentPage}/${ocrProgress.totalPages}` : structuredPreview.source === "deepseek-ocr" ? "重新 OCR" : "DeepSeek OCR"}</button> : null}
            <button type="button" disabled={loading} onClick={() => void togglePdfText()} className="flex h-9 items-center gap-1.5 rounded-xl border border-[#dedfea] bg-white px-3 text-[0.6875rem] font-bold text-[#5f6579] hover:bg-[#f1f0ff] disabled:opacity-40">{loading ? <LoaderCircle size={13} className="animate-spin"/> : <FileText size={13}/>} {pdfTextOpen ? "查看原 PDF" : "提取文本"}</button>
          </> : null}
          {kind === "text" ? <>
            {!editingText && ["md", "markdown", "html", "htm", "json"].includes(extension) ? <button type="button" onClick={() => setRenderedTextPreview((value) => !value)} className="h-9 rounded-xl border border-[#dedfea] bg-white px-3 text-[0.6875rem] font-bold text-[#5f6579] hover:bg-[#f1f0ff]">{renderedTextPreview ? "查看源码" : "渲染预览"}</button> : null}
            {(extension === "csv" || extension === "tsv") ? <button type="button" onClick={() => setTableMode((value) => !value)} className="h-9 rounded-xl border border-[#dedfea] bg-white px-3 text-[0.6875rem] font-bold text-[#5f6579] hover:bg-[#f1f0ff]">{tableMode ? "文本模式" : "表格模式"}</button> : null}
            {!editingText ? <>
              <button type="button" aria-label="编辑" title="编辑" onClick={() => { setEditingText(true); setRenderedTextPreview(false); setNotice(""); }} className={toolButton}><Pencil size={14}/></button>
              <button type="button" aria-label="复制文本" onClick={() => void copyText(textContent, "已复制文本")} className={toolButton}><Copy size={14}/></button>
            </> : <>
              <button type="button" aria-label="撤销助手编辑" title="撤销助手编辑" disabled={saving || !textHistory.undo.length} onClick={() => textHistoryStep('undo')} className={toolButton}>↶</button>
              <button type="button" aria-label="重做助手编辑" title="重做助手编辑" disabled={saving || !textHistory.redo.length} onClick={() => textHistoryStep('redo')} className={toolButton}>↷</button>
              <button type="button" disabled={saving} onClick={() => void requestEditorExit("cancel")} className="h-9 rounded-xl border border-[#dedfea] bg-white px-3 text-[0.6875rem] font-bold text-[#5f6579] disabled:opacity-40">取消</button>
              <button type="button" disabled={!dirty || saving} onClick={() => void saveText()} className="flex h-9 items-center gap-1.5 rounded-xl bg-[#292f47] px-3 text-[0.6875rem] font-bold text-white disabled:opacity-40">{saving ? <LoaderCircle size={13} className="animate-spin"/> : <Save size={13}/>}保存</button>
            </>}
          </> : null}
          {!editingOffice && !editingText ? <button type="button" onClick={() => void onOpen(item)} className="flex h-9 items-center gap-1.5 rounded-xl bg-[#242a40] px-3 text-[0.6875rem] font-bold text-white"><ExternalLink size={13}/>系统打开</button> : null}
          <button type="button" aria-label="关闭预览" onClick={() => void requestEditorExit("close")} className="grid size-9 place-items-center rounded-xl bg-[#f4f5f8] transition hover:bg-[#ecebfa] hover:text-[#5f58bd]"><X size={15}/></button>
        </div>
      </header>
      {exitIntent ? <div className="absolute inset-0 z-[70] grid place-items-center bg-[#242a40]/35 p-4 backdrop-blur-[2px]">
        <div role="dialog" aria-modal="true" aria-label="保存编辑提醒" className="w-full max-w-sm rounded-2xl border border-white/80 bg-white p-5 shadow-[0_24px_70px_rgba(35,40,61,.28)]">
          <header className="moki-dialog-header moki-dialog-header-inset-5"><h3 className="text-sm font-black text-[#30364b]">保存对“{item.name}”的修改？</h3></header>
          <p className="mt-2 text-[0.6875rem] leading-5 text-[#777d91]">当前编辑尚未写入原文件。保存后再退出，或放弃本次修改。</p>
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <button type="button" autoFocus disabled={saving} onClick={() => setExitIntent(undefined)} className="h-9 rounded-xl border border-[#dedfea] bg-white px-3 text-[0.6875rem] font-bold text-[#5f6579] disabled:opacity-40">继续编辑</button>
            <button type="button" disabled={saving} onClick={() => void completeEditorExit("discard")} className="h-9 rounded-xl border border-[#f0ccd7] bg-white px-3 text-[0.6875rem] font-bold text-[#b64a68] disabled:opacity-40">放弃修改</button>
            <button type="button" disabled={saving} onClick={() => void completeEditorExit("save")} className="flex h-9 items-center gap-1.5 rounded-xl bg-[#292f47] px-3 text-[0.6875rem] font-bold text-white disabled:opacity-40">{saving ? <LoaderCircle size={13} className="animate-spin"/> : <Save size={13}/>}保存并退出</button>
          </div>
        </div>
      </div> : null}
      {editingText ? <p className="mb-2 text-[0.625rem] font-semibold text-[#7c8294]">在编辑光标处按 <kbd className="rounded-md border border-[#d9daea] bg-[#f7f7fb] px-1.5 py-0.5 font-mono text-[#625bc5]">Alt+M</kbd> 唤醒 MOKI</p> : null}
      {autosaveStatus ? <p role="status" className="px-4 py-1 text-[0.625rem] text-[#7b8197]">{autosaveStatus}</p> : null}
        {notice ? <p role="status" className="mb-2 rounded-xl bg-[#eef9f5] px-3 py-2 text-[0.6875rem] font-semibold text-[#357d65]">{notice}</p> : null}
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-2xl border border-[#e4e6ef] bg-[#f5f6fa]">
        {editingOffice && univerSession ? <div className="absolute inset-0 z-20 bg-white">
          <iframe
            ref={officeEditorFrameRef}
            src={univerSession.viewerUrl}
            title={`${item.name} Univer Office 编辑器`}
            allow="clipboard-read; clipboard-write"
            className="size-full border-0 bg-white"
            onLoad={() => setNotice("编辑中 · 按 Alt+M 唤醒 MOKI，完成后可选择保存或取消")}
          />
        </div> : null}
        {previewUrl && kind === "image" ? <div className={`size-full overflow-hidden ${imageScale > 1 ? "cursor-grab active:cursor-grabbing" : ""}`} onPointerDown={startImagePan} onPointerMove={moveImage} onPointerUp={() => { imageDragRef.current = undefined; }} onPointerCancel={() => { imageDragRef.current = undefined; }} onWheel={(event: WheelEvent<HTMLDivElement>) => { event.preventDefault(); changeImageScale(imageScale + (event.deltaY < 0 ? 0.2 : -0.2)); }}><img ref={imageRef} src={previewUrl} alt={item.name} draggable={false} loading="lazy" decoding="async" crossOrigin={item.kind === "url" ? "anonymous" : undefined} onLoad={(event) => void onThumbnail?.(item, event.currentTarget)} className="size-full select-none object-contain transition-transform duration-100" style={{ transform: `translate(${imageOffset.x}px, ${imageOffset.y}px) scale(${imageScale})` }}/><span className="pointer-events-none absolute bottom-3 left-3 flex items-center gap-1 rounded-lg bg-[#242a40]/75 px-2 py-1 text-[0.5625rem] font-bold text-white"><Move size={11}/>滚轮缩放，放大后拖动</span><div role="toolbar" aria-label="图片预览操作" onPointerDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()} className="absolute bottom-3 right-3 z-10 flex items-center gap-1.5 rounded-2xl border border-white/75 bg-white/92 p-2 shadow-[0_14px_38px_rgba(34,39,61,.2)] backdrop-blur-md"><button type="button" aria-label="缩小图片" onClick={() => changeImageScale(imageScale - 0.25)} className={toolButton}><Minus size={14}/></button><span className="min-w-12 text-center text-[0.625rem] font-bold text-[#73798c]">{Math.round(imageScale * 100)}%</span><button type="button" aria-label="放大图片" onClick={() => changeImageScale(imageScale + 0.25)} className={toolButton}><span className="text-lg leading-none">+</span></button><button type="button" aria-label="重置图片视图" onClick={() => { setImageScale(1); setImageOffset({ x: 0, y: 0 }); }} className={toolButton}><RotateCcw size={14}/></button><button type="button" aria-label="复制图片" onClick={() => void copyImageOrFrame(imageRef.current)} className={toolButton}><Copy size={14}/></button></div></div> : null}
        {previewUrl && kind === "video" ? <div className="relative size-full overflow-hidden bg-[#10131d]">
          <video
            ref={videoRef}
            src={previewUrl}
            preload="auto"
            crossOrigin={item.kind === "url" ? "anonymous" : undefined}
            onClick={toggleVideoPlayback}
            onContextMenu={(event) => void openVideoContextMenu(event)}
            title="右键打开视频菜单"
            onPlay={() => setVideoPlaying(true)}
            onPause={() => setVideoPlaying(false)}
            onEnded={() => setVideoPlaying(false)}
            onTimeUpdate={(event) => setVideoCurrentTime(event.currentTarget.currentTime)}
            onDurationChange={(event) => setVideoDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
            onVolumeChange={(event) => { setVideoVolume(event.currentTarget.volume); setVideoMuted(event.currentTarget.muted); }}
            onLoadedMetadata={(event) => {
              const video = event.currentTarget;
              video.volume = videoVolume;
              video.muted = videoMuted;
              setVideoDuration(Number.isFinite(video.duration) ? video.duration : 0);
              setVideoCurrentTime(video.currentTime);
            }}
            onLoadedData={(event) => void onThumbnail?.(item, event.currentTarget)}
            className="size-full object-contain"
          />
      <div
            role="group"
            aria-label="视频播放控制"
            className="absolute bottom-3 left-1/2 flex w-fit max-w-[calc(100%-1.5rem)] -translate-x-1/2 flex-nowrap items-center justify-center gap-1.5 rounded-2xl border border-white/15 bg-[#171b2c]/90 p-2 text-white shadow-xl backdrop-blur-md"
          >
            <button type="button" aria-label="视频上一帧" aria-keyshortcuts="ArrowLeft" title="上一帧（←）" onClick={() => stepVideo(-1)} className="grid size-8 shrink-0 place-items-center rounded-xl hover:bg-white/15"><SkipBack size={14}/></button>
            <button type="button" aria-label={videoPlaying ? "暂停视频" : "播放视频"} aria-keyshortcuts="Space" title={`${videoPlaying ? "暂停" : "播放"}（空格）`} onClick={toggleVideoPlayback} className="grid size-8 shrink-0 place-items-center rounded-xl bg-white text-[#242a40] hover:bg-[#eeedff]">{videoPlaying ? <Pause size={14}/> : <Play size={14}/>}</button>
            <button type="button" aria-label="视频下一帧" aria-keyshortcuts="ArrowRight" title="下一帧（→）" onClick={() => stepVideo(1)} className="grid size-8 shrink-0 place-items-center rounded-xl hover:bg-white/15"><SkipForward size={14}/></button>
            <span className="grid min-w-[6.5rem] gap-0.5 text-center font-bold tabular-nums">
              <span className="text-[0.625rem]">{formatVideoPreviewTime(videoCurrentTime)} / {formatVideoPreviewTime(videoDuration)}</span>
              <span className="text-[0.5625rem] text-white/65" title="按 30 fps 估算帧数">帧 {videoPreviewFramePosition(videoCurrentTime, videoDuration).current} / {videoPreviewFramePosition(videoCurrentTime, videoDuration).total}</span>
            </span>
            <input
              aria-label="视频时间轴"
              type="range"
              min="0"
              max={Math.max(0, videoDuration)}
              step="0.001"
              value={Math.min(videoCurrentTime, Math.max(0, videoDuration))}
              onChange={(event) => seekVideo(Number(event.target.value))}
              className="h-1 w-[clamp(7rem,24vw,20rem)] shrink accent-[#8c84e8]"
            />
            <div className="relative shrink-0">
              <button
                type="button"
                aria-label={volumeControlOpen ? "关闭视频音量调节" : "打开视频音量调节"}
                aria-expanded={volumeControlOpen}
                aria-controls="resource-video-volume-control"
                onClick={() => setVolumeControlOpen((open) => !open)}
                className="grid size-8 place-items-center rounded-xl hover:bg-white/15"
              >
                {videoMuted || videoVolume === 0 ? <VolumeX size={14}/> : <Volume2 size={14}/>}
              </button>
              {volumeControlOpen ? (
                <div
                  id="resource-video-volume-control"
                  role="group"
                  aria-label="视频音量调节"
                  className="absolute bottom-full right-0 mb-2 flex items-center gap-2 rounded-xl border border-white/15 bg-[#171b2c]/95 p-2 shadow-xl backdrop-blur-md"
                >
                  <button type="button" aria-label={videoMuted ? "取消视频静音" : "视频静音"} onClick={toggleVideoMuted} className="grid size-7 shrink-0 place-items-center rounded-lg hover:bg-white/15">{videoMuted || videoVolume === 0 ? <VolumeX size={13}/> : <Volume2 size={13}/>}</button>
                  <input aria-label="视频音量" type="range" min="0" max="1" step="0.01" value={videoMuted ? 0 : videoVolume} onChange={(event) => changeVideoVolume(Number(event.target.value))} className="h-1 w-24 accent-[#8c84e8]"/>
                  <span className="w-8 text-right text-[0.5625rem] font-bold tabular-nums text-white/75">{Math.round((videoMuted ? 0 : videoVolume) * 100)}%</span>
                </div>
              ) : null}
            </div>
          </div>
        </div> : null}
        {previewUrl && kind === "audio" ? <div className="grid size-full place-items-center"><audio src={previewUrl} controls preload="metadata" className="w-[min(38rem,80%)]"/></div> : null}
        {previewUrl && kind === "embedded" && !pdfTextOpen ? <iframe src={previewUrl} title={item.name} loading="lazy" className="size-full border-0"/> : null}
        {kind === "embedded" && extension === "pdf" && pdfTextOpen ? loading ? <div role="status" className="grid size-full place-items-center"><span className="flex items-center gap-2 text-[0.75rem] font-bold text-[#6860c2]"><LoaderCircle size={16} className="animate-spin"/>{ocrProgress ? `正在${ocrProgress.phase === "rendering" ? "渲染" : "识别"}第 ${ocrProgress.currentPage}/${ocrProgress.totalPages} 页` : "正在提取 PDF 文本"}</span></div> : structuredPreview?.kind === "pdf" ? <div className="size-full overflow-auto bg-[#eef0f5] p-5"><div className="mx-auto grid max-w-4xl gap-4"><div className="flex items-center justify-between rounded-xl border border-[#e2e4ed] bg-white px-4 py-3"><span className="text-xs font-bold text-[#697083]">文本来源</span><span className={`rounded-full px-2.5 py-1 text-[0.625rem] font-extrabold ${structuredPreview.source === "deepseek-ocr" ? "bg-[#e9e7ff] text-[#625bc5]" : "bg-[#edf9f4] text-[#357d65]"}`}>{structuredPreview.source === "deepseek-ocr" ? "DeepSeek OCR" : "PDF 文字层"}</span></div>{structuredPreview.pages.map((page) => <article key={page.number} data-moki-page-number={page.number} className="rounded-xl bg-white px-8 py-7 shadow-sm"><div className="mb-4 flex items-center justify-between border-b border-[#eceef3] pb-3"><b className="text-[0.75rem] text-[#464c61]">第 {page.number} 页</b><span className="text-[0.625rem] font-semibold text-[#999fb0]">{page.text.length} 字符</span></div>{page.text ? structuredPreview.source === "deepseek-ocr" ? <MarkdownRenderer content={page.text} className="text-sm leading-7"/> : <p className="whitespace-pre-wrap text-sm leading-7 text-[#30364b]">{page.text}</p> : <p className="text-sm font-semibold text-[#9a7a3b]">本页没有可提取的文本层，可点击 DeepSeek OCR 识别</p>}</article>)}</div></div> : <div className="grid size-full place-items-center text-sm font-bold text-[#7c8294]">无法提取此 PDF 的文本</div> : null}
        {previewUrl && kind === "web" ? <div className="flex size-full flex-col bg-white"><div className="flex shrink-0 items-center gap-2 border-b border-[#e3e5ed] bg-[#f7f8fb] px-3 py-2 text-[0.6875rem] font-semibold text-[#697083]"><span className="size-2 rounded-full bg-[#4aa681]"/><span className="min-w-0 flex-1 truncate">网页预览会复用当前 MOKI 客户端的网页会话；工作台平台授权不会暴露令牌，若飞书等站点尚无网页登录状态，可直接在预览中完成一次登录。</span></div><iframe src={previewUrl} title={`${item.name} 在线页面`} loading="lazy" referrerPolicy="strict-origin-when-cross-origin" sandbox={onlinePreviewSandbox(previewUrl)} className="min-h-0 flex-1 border-0"/></div> : null}
        {kind === "text" ? loading ? <div role="status" className="grid size-full place-items-center"><span className="flex items-center gap-2 text-[0.75rem] font-bold text-[#6860c2]"><LoaderCircle size={16} className="animate-spin"/>正在读取文本</span></div> : !editingText && renderedTextPreview && ["html", "htm"].includes(extension) ? <iframe title={`${item.name} HTML 预览`} srcDoc={textContent} sandbox="allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation" referrerPolicy="no-referrer" className="size-full border-0 bg-white"/> : !editingText && renderedTextPreview && ["md", "markdown"].includes(extension) ? <div className="size-full overflow-auto bg-white p-6"><MarkdownRenderer content={textContent} className="mx-auto max-w-4xl text-sm leading-7"/></div> : !editingText && renderedTextPreview && extension === "json" ? <pre className="size-full overflow-auto bg-[#171b2c] p-5 font-mono text-xs leading-6 text-[#d9dcf0]">{(() => { try { return JSON.stringify(JSON.parse(textContent), null, 2); } catch { return textContent; } })()}</pre> : renderReadOnlyTable ? <div className="size-full overflow-auto bg-white p-3"><table className="min-w-full border-collapse text-[0.6875rem]"><tbody>{tableRows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, columnIndex) => <td key={columnIndex} className="min-w-32 border border-[#e1e3ec] px-2 py-1.5 text-[#34394e]">{cell}</td>)}</tr>)}</tbody></table></div> : renderEditableTable ? <div className="size-full overflow-auto bg-white p-3"><table className="min-w-full border-collapse text-[0.6875rem]"><tbody>{tableRows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, columnIndex) => <td key={columnIndex} className="min-w-32 border border-[#e1e3ec] p-0"><input aria-label={`第 ${rowIndex + 1} 行第 ${columnIndex + 1} 列`} value={cell} onChange={(event) => updateTableCell(rowIndex, columnIndex, event.target.value)} className="h-8 w-full min-w-32 bg-white px-2 outline-none focus:bg-[#f1f0ff]"/></td>)}</tr>)}</tbody></table></div> : editingText ? <div className="flex size-full flex-col"><textarea aria-label="资料文本编辑器" autoFocus value={textContent} onChange={(event) => { setTextContent(event.target.value); setTextHistory(history=>({...history,redo:[]})); setDirty(true); }} spellCheck={false} className="min-h-0 flex-1 resize-none bg-white p-4 font-mono text-[0.75rem] leading-6 text-[#30364b] outline-none"/>{tableMode && tableCellCount > 12_000 ? <p className="shrink-0 border-t border-[#e2e4ed] bg-[#fff8e8] px-3 py-2 text-[0.625rem] font-semibold text-[#9a6d24]">表格数据量较大，已切换为高性能文本编辑模式，保存时不会截断内容。</p> : null}</div> : <pre className="size-full overflow-auto whitespace-pre-wrap bg-white p-5 font-mono text-[0.75rem] leading-6 text-[#30364b]">{textContent}</pre> : null}
        {["document", "spreadsheet"].includes(kind) && !editingOffice ? loading ? <div role="status" className="grid size-full place-items-center"><span className="flex items-center gap-2 text-[0.75rem] font-bold text-[#6860c2]"><LoaderCircle size={16} className="animate-spin"/>正在解析 Office 文件</span></div> : structuredPreview?.kind === "document" ? <article className="size-full overflow-auto bg-[#eef0f5] p-6"><div data-testid="office-document-preview" className="mx-auto min-h-full max-w-3xl rounded-sm bg-white px-12 py-10 text-sm leading-7 text-[#30364b] shadow-sm [&_p]:mb-3 [&_p]:whitespace-pre-wrap [&_table]:my-5 [&_table]:w-full [&_table]:border-collapse [&_td]:min-w-20 [&_td]:border [&_td]:border-[#d9dce6] [&_td]:px-3 [&_td]:py-2 [&_td]:align-top">{structuredPreview.html ? <div className="contents" dangerouslySetInnerHTML={{ __html: structuredPreview.html }}/> : structuredPreview.paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div></article> : structuredPreview?.kind === "spreadsheet" ? <SpreadsheetPreview sheets={structuredPreview.sheets} activeSheetIndex={activeSheetIndex} onActiveSheetIndex={setActiveSheetIndex}/> : <div className="grid size-full place-items-center text-sm font-bold text-[#7c8294]">无法解析此 Office 文件</div> : null}
        {active && kind === "presentation" && !editingOffice ? <div ref={presentationPreviewRef} data-moki-page-number={presentationSlideIndex + 1} className="size-full min-h-0 overflow-hidden"><Suspense fallback={<div role="status" className="grid size-full place-items-center"><span className="flex items-center gap-2 text-[0.75rem] font-bold text-[#6860c2]"><LoaderCircle size={16} className="animate-spin"/>正在加载 PowerPoint 预览器</span></div>}>
          <PowerPointViewer
            key={`${item.id}:${item.updatedAt}:${officeRevision}`}
            source={presentationSourceUrl(item, officeRevision)}
            parseOptions={{ maxInputBytes: POWERPOINT_MAX_PREVIEW_BYTES }}
            mode="slide"
            slideIndex={presentationSlideIndex}
            fitMode="contain"
            height="100%"
            showToolbar
            showThumbnails
            showSlideLabels
            className="moki-powerpoint-viewer size-full min-h-0 overflow-hidden bg-[#e8eaf0]"
            onSlideChange={(slideIndex) => setPresentationPosition({ itemId: item.id, slideIndex })}
            onThumbnailRendered={() => {
              const root = presentationPreviewRef.current;
              if (!root?.querySelector(`.rpv-filmstrip__item[data-index="${presentationSlideIndex}"]`)) {
                synchronizePowerPointThumbnailRail(root, presentationSlideIndex);
              }
            }}
            renderLoading={() => <div role="status" className="grid size-full place-items-center"><span className="flex items-center gap-2 text-[0.75rem] font-bold text-[#6860c2]"><LoaderCircle size={16} className="animate-spin"/>正在解析 PowerPoint 文件</span></div>}
            onError={loadPresentationFallback}
            renderError={(error) => structuredPreview?.kind === "presentation"
              ? <StructuredPresentationSlides preview={structuredPreview}/>
              : loading && presentationFallbackRequestedRef.current
                ? <div role="status" className="grid size-full place-items-center"><span className="flex items-center gap-2 text-[0.75rem] font-bold text-[#6860c2]"><LoaderCircle size={16} className="animate-spin"/>正在准备 PowerPoint 文字兜底预览</span></div>
              : <div className="grid size-full place-items-center px-6 text-center"><div><p className="text-sm font-black text-[#3e4356]">PowerPoint 预览失败</p><p className="mt-2 max-w-xl text-[0.6875rem] leading-5 text-[#858b9d]">{error.message}</p><button type="button" onClick={() => void onOpen(item)} className="mt-4 rounded-xl bg-[#242a40] px-4 py-2 text-[0.6875rem] font-bold text-white">调用系统应用打开</button></div></div>}
          />
        </Suspense></div> : null}
        {kind === "workspace" && !editingOffice ? <div className="grid size-full place-items-center text-center"><div><p className="text-sm font-black text-[#30364b]">原生 Univer 多 Unit 工作区</p><p className="mt-2 max-w-md text-[0.6875rem] leading-5 text-[#7c8294]">可在同一文件中管理文档、表格、幻灯片、Base 与白板；进入编辑后使用官方完整功能区和文件侧栏。</p><button type="button" disabled={loading} onClick={() => void startOfficeEditing()} className="mt-4 rounded-xl bg-[#625bc5] px-4 py-2 text-[0.6875rem] font-bold text-white disabled:opacity-40">打开完整编辑器</button></div></div> : null}
        {kind === "unsupported" ? <div className="grid size-full place-items-center text-center"><div><p className="text-[0.75rem] font-bold text-[#676d80]">当前格式暂不支持内嵌预览</p><button type="button" onClick={() => void onOpen(item)} className="mt-3 rounded-xl bg-[#242a40] px-4 py-2 text-[0.6875rem] font-bold text-white">调用系统默认应用打开</button></div></div> : null}
      </div>
      {!embedded ? <div
        role="separator"
        aria-label="调整文件预览窗口大小"
        aria-orientation="horizontal"
        title="拖动调整预览窗口大小"
        onPointerDown={startPreviewResize}
        onPointerMove={movePreviewResize}
        onPointerUp={endPreviewResize}
        onPointerCancel={endPreviewResize}
        onLostPointerCapture={() => { previewResizeRef.current = undefined; }}
        className="modal-resize-handle absolute bottom-1 right-1 z-20 size-6 cursor-nwse-resize touch-none"
      >
        <span aria-hidden="true" className="pointer-events-none absolute bottom-1 right-1 size-3 border-b-2 border-r-2 border-[#777d91] opacity-80" />
      </div> : null}
      {libraryImagePickerOpen ? <ResourceLibraryPickerDialog
        ariaLabel="选择要插入编辑器的资料库图片"
        title="从资料库插入图片"
        description="支持 PNG、JPEG/JFIF、GIF、WebP、SVG、BMP、AVIF 和 TIFF；插入前会自动转换为编辑器可保存的格式。"
        items={libraryImageItems}
        loading={libraryImageLoading}
        error={libraryImageError}
        selectableKinds={new Set<ResourceLibraryItem["kind"]>(["local_file"])}
        itemFilter={isUniverInsertableLibraryImage}
        maxSelected={1}
        confirmLabel="插入当前位置"
        onClose={() => { setLibraryImagePickerOpen(false); libraryImageSelectionRef.current = undefined; }}
        onConfirm={insertLibraryImage}
      /> : null}
    </section>
  </div>;
}
