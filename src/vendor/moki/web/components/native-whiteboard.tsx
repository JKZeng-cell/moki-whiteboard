import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  AlertTriangle,
  Bold,
  ClipboardPaste,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  Eye,
  EyeOff,
  FileText,
  Folder,
  FolderOpen,
  GitBranch,
  Group,
  GripVertical,
  ImageIcon,
  Italic,
  LibraryBig,
  Link2,
  Minus,
  Palette,
  Pause,
  Pencil,
  Play,
  Plus,
  Redo2,
  Search,
  StepBack,
  StepForward,
  Trash2,
  Underline,
  Ungroup,
  Undo2,
} from "lucide-react";
import type { WhiteboardSnapshot } from "../../domain/whiteboard.js";
import { apiFetch } from "../lib/api-fetch.js";
import {
  WHITEBOARD_MIN_ZOOM,
  WHITEBOARD_MAX_ZOOM,
  clampWhiteboardZoom,
  formatWhiteboardZoom,
  whiteboardWheelZoom,
  zoomWhiteboardAt,
} from "../lib/whiteboard-zoom.js";
import {
  createNativeId,
  createNativeWhiteboardSnapshot,
  isNativeRecord,
  isNativeShape,
  markNativeSnapshot,
  nativeArrowEndpoints,
  nativeBezierAnchors,
  nativeDrawPoints,
  nativePageId,
  nativeRichText,
  nativeRichTextValue,
  nativeShapeBounds,
  nativeShapeVisualBounds,
  nextNativeIndex,
  type NativeBounds,
  type NativeBezierAnchor,
  type NativePoint,
  type NativeWhiteboardRecord,
  type NativeWhiteboardShape,
} from "../../whiteboard/native-whiteboard-model.js";
import {
  addMindMapChild,
  isMindMapNode,
  isMindMapShapeHidden,
  mindMapChildren,
  mindMapDescendantIds,
  mindMapParentId,
  promoteMindMapNode,
  reparentMindMapNode,
  synchronizeMindMapSnapshot,
  toggleMindMapBranch,
} from "../../whiteboard/mind-map.js";
import type { DesktopUpdateStatus } from "../../shared/desktop-update-contract.js";
import type {
  DesktopMediaContextAction,
  DesktopMediaContextRequest,
} from "../../shared/desktop-media-context-contract.js";
import type {
  DesktopAttachmentContextAction,
  DesktopAttachmentContextRequest,
} from "../../shared/desktop-attachment-context-contract.js";
import type { DesktopAssistantWindowState, DesktopWorkbenchRoute } from "../../shared/desktop-assistant-window-contract.js";
import type { DesktopClipboardResource } from "../../shared/desktop-clipboard-contract.js";
import type { DesktopWhiteboardFilesBridge } from "../../shared/desktop-whiteboard-transfer-contract.js";
import {
  clearWorkbenchSelectionContext,
  NATIVE_WHITEBOARD_CLIPBOARD_TEXT_PREFIX,
  NATIVE_WHITEBOARD_CLIPBOARD_TYPE,
  publishWorkbenchSelectionContext,
  readWorkbenchSelectionContext,
  visualAnnotationsFromSelection,
} from "../lib/workbench-selection-context.js";
import { storeVisualSelectionImage } from "../lib/visual-selection.js";

export {
  NATIVE_WHITEBOARD_CLIPBOARD_TEXT_PREFIX,
  NATIVE_WHITEBOARD_CLIPBOARD_TYPE,
} from "../lib/workbench-selection-context.js";

declare global {
  interface Window {
    mokiDesktop?: {
      resourceCache?: import('../../../../shared/resource-cache-contract.js').ResourceCacheBridge;
      appearance?: {
        setColorSchemePreference(preference: "system" | "light" | "dark"): Promise<boolean>;
        onColorSchemePreferenceChange(
          listener: (preference: "system" | "light" | "dark") => void,
        ): () => void;
      };
      browser?: import('../../shared/desktop-browser-contract.js').DesktopBrowserBridge;
      getPathForFile?(file: File): string;
      openLocalPath?(path: string): Promise<boolean>;
      openExternalUrl?(url: string): Promise<boolean>;
      copyText?(text: string): Promise<boolean>;
      readClipboardResources?(): Promise<DesktopClipboardResource[]>;
      selectLocalFolder?(): Promise<string | null>;
      selectLocalFile?(): Promise<string | null>;
      selectSavePath?(defaultName: string): Promise<string | null>;
      captureWhiteboardLinkPreview(rect: {
        x: number;
        y: number;
        width: number;
        height: number;
      }): Promise<string | null>;
      whiteboardFiles?: DesktopWhiteboardFilesBridge;
      showMediaContextMenu?(
        request: DesktopMediaContextRequest,
      ): Promise<DesktopMediaContextAction | null>;
      showAttachmentContextMenu?(
        request: DesktopAttachmentContextRequest,
      ): Promise<DesktopAttachmentContextAction | null>;
      assistantWindow?: {
        open(): Promise<boolean>;
        isDetached(): Promise<boolean>;
        setAlwaysOnTop(value: boolean): Promise<boolean>;
        getState(): Promise<DesktopAssistantWindowState>;
        setFloatingBallEnabled(value: boolean): Promise<DesktopAssistantWindowState>;
        collapseToFloatingBall(): Promise<boolean>;
        openFromFloatingBall(): Promise<boolean>;
        openFullAssistant?(sessionId: string): Promise<boolean>;
        openWorkbenchRoute?(route: DesktopWorkbenchRoute): Promise<boolean>;
        closeFloatingBall(): Promise<boolean>;
        moveFloatingBall?(input: import("../../shared/desktop-assistant-window-contract.js").DesktopAssistantFloatingBallMove): Promise<boolean>;
        onState(listener: (state: DesktopAssistantWindowState) => void): () => void;
        onComposeShortcut(listener: (anchor: { x: number; y: number }) => void): () => void;
      };
      updates?: {
        getStatus(): Promise<DesktopUpdateStatus>;
        ignoreVersion?(version: string): Promise<DesktopUpdateStatus>;
        check(): Promise<DesktopUpdateStatus>;
        download(): Promise<DesktopUpdateStatus>;
        install(): Promise<void>;
        onStatus(listener: (status: DesktopUpdateStatus) => void): () => void;
      };
      windowControls?: {
        minimize(): Promise<void>;
        toggleMaximize(): Promise<boolean>;
        close(): Promise<void>;
        isMaximized(): Promise<boolean>;
        beginResize?(edge: string, screenX: number, screenY: number): Promise<void>;
        updateResize?(screenX: number, screenY: number): Promise<void>;
        endResize?(): Promise<void>;
        beginMove?(screenX: number, screenY: number): Promise<void>;
        updateMove?(screenX: number, screenY: number): Promise<void>;
        endMove?(): Promise<void>;
        onMaximizedChange(listener: (maximized: boolean) => void): () => void;
      };
    };
  }
}

export type NativeGeoShape =
  | "rectangle"
  | "ellipse"
  | "triangle"
  | "diamond"
  | "cloud"
  | "star";
export type NativeShapeId = string;
export type NativeEditorSnapshot = WhiteboardSnapshot;
export type NativeVecLike = { x: number; y: number };
export type NativeShape = NativeWhiteboardShape;
export type NativeWhiteboardFolderExportRequest = {
  folderId: string;
  name: string;
  description: string;
  payload: {
    version: 1;
    shapes: NativeWhiteboardShape[];
    assets: NativeWhiteboardRecord[];
  };
};
export type NativeDroppedLocalItem = {
  file: File;
  path?: string;
  isDirectory: boolean;
};
export type NativeNoteShapeUtil = { options: { resizeMode: string } };
export const NativeGeoShapeStyle = "geo";
export const NATIVE_COLOR_OPTIONS = [
  { value: "black", label: "黑色", hex: "#242838" },
  { value: "grey", label: "灰色", hex: "#9297a7" },
  { value: "violet", label: "紫色", hex: "#7c63d9" },
  { value: "light-violet", label: "浅紫", hex: "#b79cff" },
  { value: "blue", label: "蓝色", hex: "#4771e8" },
  { value: "light-blue", label: "浅蓝", hex: "#65a8ee" },
  { value: "yellow", label: "黄色", hex: "#f5bb4d" },
  { value: "orange", label: "橙色", hex: "#ed8d3b" },
  { value: "green", label: "绿色", hex: "#2c9c72" },
  { value: "light-green", label: "浅绿", hex: "#65bb78" },
  { value: "red", label: "红色", hex: "#df4e4e" },
  { value: "light-red", label: "浅红", hex: "#f47b7b" },
] as const;
export type NativeCanvasColor = (typeof NATIVE_COLOR_OPTIONS)[number]["value"];
export type NativeGeoPaintStyle = {
  strokeEnabled: boolean;
  strokeColor: NativeCanvasColor;
  strokeOpacity: number;
  fillEnabled: boolean;
  fillColor: NativeCanvasColor;
  fillOpacity: number;
};
export type NativeTextStyle = {
  size: "s" | "m" | "l" | "xl";
  bold: boolean;
  italic: boolean;
  underline: boolean;
  textAlign: "start" | "middle" | "end";
};
export type NativeStrokeSize = NativeTextStyle["size"];
export type NativeArrowStyle = "single" | "double" | "line" | "dashed";
export function clipboardImageFiles(
  directFiles: readonly File[],
  itemFiles: readonly File[],
): File[] {
  const directImages = directFiles.filter((file) => file.type.startsWith("image/"));
  if (directImages.length > 0) return directImages;
  return itemFiles.filter((file) => file.type.startsWith("image/"));
}

export type NativeWhiteboardLinkMode = "link" | "preview";

const DEFAULT_GEO_PAINT_STYLE: NativeGeoPaintStyle = {
  strokeEnabled: true,
  strokeColor: "black",
  strokeOpacity: 1,
  fillEnabled: true,
  fillColor: "light-violet",
  fillOpacity: 0.28,
};

function nativeArrowStyle(value: unknown): NativeArrowStyle {
  return value === "double" || value === "line" || value === "dashed"
    ? value
    : "single";
}

function drawNativeArrow(
  context: CanvasRenderingContext2D,
  start: NativePoint,
  end: NativePoint,
  style: NativeArrowStyle,
  headSize: number,
  curved = false,
): void {
  context.save();
  context.setLineDash(style === "dashed" ? [Math.max(4, headSize * 0.72), Math.max(3, headSize * 0.45)] : []);
  context.beginPath();
  context.moveTo(start.x, start.y);
  if (curved) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    if (Math.abs(dx) >= Math.abs(dy)) {
      const controlX = start.x + dx * 0.52;
      context.bezierCurveTo(controlX, start.y, controlX, end.y, end.x, end.y);
    } else {
      const controlY = start.y + dy * 0.52;
      context.bezierCurveTo(start.x, controlY, end.x, controlY, end.x, end.y);
    }
  } else {
    context.lineTo(end.x, end.y);
  }
  context.stroke();
  context.setLineDash([]);
  if (style === "line") {
    context.restore();
    return;
  }
  const drawHead = (tip: NativePoint, other: NativePoint) => {
    const angle = Math.atan2(tip.y - other.y, tip.x - other.x);
    context.beginPath();
    context.moveTo(tip.x, tip.y);
    context.lineTo(
      tip.x - headSize * Math.cos(angle - Math.PI / 6),
      tip.y - headSize * Math.sin(angle - Math.PI / 6),
    );
    context.moveTo(tip.x, tip.y);
    context.lineTo(
      tip.x - headSize * Math.cos(angle + Math.PI / 6),
      tip.y - headSize * Math.sin(angle + Math.PI / 6),
    );
    context.stroke();
  };
  drawHead(end, start);
  if (style === "double") drawHead(start, end);
  context.restore();
}

function nativeCanvasColor(value: unknown, fallback: NativeCanvasColor): NativeCanvasColor {
  return NATIVE_COLOR_OPTIONS.some((option) => option.value === value)
    ? value as NativeCanvasColor
    : fallback;
}

function nativeOpacity(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : fallback;
}

export function nativeGeoPaintStyle(shape: NativeWhiteboardShape): NativeGeoPaintStyle {
  const hasExplicitPaint =
    typeof shape.props.strokeEnabled === "boolean" ||
    typeof shape.props.fillEnabled === "boolean" ||
    typeof shape.props.strokeColor === "string" ||
    typeof shape.props.fillColor === "string";
  const legacyColor = nativeCanvasColor(shape.props.color, "black");
  if (!hasExplicitPaint) {
    return {
      strokeEnabled: true,
      strokeColor: legacyColor,
      strokeOpacity: 1,
      // Historical shapes used fill="none" while still drawing a translucent
      // white interior. Preserve that appearance until the user edits it.
      fillEnabled: true,
      fillColor: "grey",
      fillOpacity: 0.08,
    };
  }
  return {
    strokeEnabled: shape.props.strokeEnabled !== false,
    strokeColor: nativeCanvasColor(shape.props.strokeColor, legacyColor),
    strokeOpacity: nativeOpacity(shape.props.strokeOpacity, 1),
    fillEnabled: shape.props.fillEnabled !== false,
    fillColor: nativeCanvasColor(shape.props.fillColor, "light-violet"),
    fillOpacity: nativeOpacity(shape.props.fillOpacity, 0.28),
  };
}

export function normalizeWhiteboardLinkUrl(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const candidate = /^[a-z][a-z\d+.-]*:/iu.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  try {
    const url = new URL(candidate);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

function normalizePastedWhiteboardLinkUrl(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed || /\s/u.test(trimmed)) return undefined;
  const hasProtocol = /^https?:\/\//iu.test(trimmed);
  const looksLikeDomain = /^(?:www\.)?[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+(?:[/?#:].*)?$/iu.test(
    trimmed,
  );
  if (!hasProtocol && !looksLikeDomain) return undefined;
  return normalizeWhiteboardLinkUrl(trimmed);
}

export function normalizePastedWhiteboardImageUrl(
  plainText: string,
  html = "",
): string | undefined {
  const htmlMatch = /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/iu.exec(html)?.[1];
  const candidate = normalizeWhiteboardLinkUrl(htmlMatch ?? plainText.trim());
  if (!candidate) return undefined;
  try {
    const path = new URL(candidate).pathname;
    return /\.(?:avif|bmp|gif|jpe?g|png|svg|webp)$/iu.test(path) || htmlMatch
      ? candidate
      : undefined;
  } catch {
    return undefined;
  }
}

function whiteboardLinkTitle(url: string): string {
  try {
    return new URL(url).hostname || "网页链接";
  } catch {
    return "网页链接";
  }
}

export function wrapNativeCanvasText(
  context: Pick<CanvasRenderingContext2D, "measureText">,
  text: string,
  maxWidth: number,
  maxLines = Number.POSITIVE_INFINITY,
): string[] {
  if (!text || maxLines <= 0) return [];
  const width = Math.max(1, maxWidth);
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/u)) {
    if (!paragraph) {
      lines.push("");
      continue;
    }
    let current = "";
    for (const character of Array.from(paragraph)) {
      const candidate = current + character;
      if (current && context.measureText(candidate).width > width) {
        lines.push(current.trimEnd());
        current = /^\s$/u.test(character) ? "" : character;
      } else {
        current = candidate;
      }
    }
    if (current || paragraph) lines.push(current.trimEnd());
  }
  if (lines.length <= maxLines) return lines;
  const visible = lines.slice(0, maxLines);
  const ellipsis = "…";
  let last = visible.at(-1) ?? "";
  while (last && context.measureText(`${last}${ellipsis}`).width > width) {
    last = Array.from(last).slice(0, -1).join("");
  }
  visible[visible.length - 1] = `${last}${ellipsis}`;
  return visible;
}

function traceNativeBezierPath(
  context: CanvasRenderingContext2D,
  anchors: NativeBezierAnchor[],
  transform: (point: NativePoint) => NativePoint,
  closed = false,
): void {
  if (!anchors.length) return;
  const first = transform(anchors[0]!);
  context.beginPath();
  context.moveTo(first.x, first.y);
  const count = closed && anchors.length > 2 ? anchors.length : anchors.length - 1;
  for (let index = 0; index < count; index += 1) {
    const from = anchors[index]!;
    const to = anchors[(index + 1) % anchors.length]!;
    const out = transform(from.out);
    const incoming = transform(to.in);
    const end = transform(to);
    context.bezierCurveTo(out.x, out.y, incoming.x, incoming.y, end.x, end.y);
  }
  if (closed && anchors.length > 2) context.closePath();
}

export type WhiteboardLinkMetadata = {
  url: string;
  title: string;
};

export async function fetchWhiteboardLinkMetadata(
  value: string,
): Promise<WhiteboardLinkMetadata | undefined> {
  const url = normalizeWhiteboardLinkUrl(value);
  if (!url) return undefined;
  try {
    const response = await apiFetch("/api/whiteboard/links/metadata", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
    });
    if (!response.ok) return undefined;
    const body = await response.json() as Partial<WhiteboardLinkMetadata>;
    const title = typeof body.title === "string" ? body.title.trim().slice(0, 240) : "";
    const resolvedUrl = normalizeWhiteboardLinkUrl(typeof body.url === "string" ? body.url : url);
    return title && resolvedUrl ? { url: resolvedUrl, title } : undefined;
  } catch {
    return undefined;
  }
}

export async function openWhiteboardExternalUrl(value: string): Promise<boolean> {
  const url = normalizeWhiteboardLinkUrl(value);
  if (!url) return false;
  const desktopOpen = window.mokiDesktop?.openExternalUrl;
  if (desktopOpen) return desktopOpen(url);
  return window.open(url, "_blank", "noopener,noreferrer") !== null;
}

export function nativeAutoTextBoxSize(
  text: string,
  fontSize: number,
  measureText: (value: string) => number = (value) => Array.from(value).reduce(
    (width, character) => width + (/[^\u0000-\u00ff]/u.test(character) ? fontSize : fontSize * 0.58),
    0,
  ),
): { width: number; height: number } {
  const horizontalPadding = 32;
  const minimumWidth = 80;
  const maximumWidth = 640;
  const content = text || "输入文字…";
  const paragraphs = content.split(/\r?\n/u);
  const longestLine = Math.max(...paragraphs.map((line) => measureText(line || " ")), 1);
  const width = Math.max(minimumWidth, Math.min(maximumWidth, longestLine + horizontalPadding));
  const lines = wrapNativeCanvasText(
    { measureText: (value) => ({ width: measureText(value) }) as TextMetrics },
    content,
    width - horizontalPadding,
  );
  return {
    width,
    height: Math.max(40, Math.max(1, lines.length) * fontSize * 1.35 + 32),
  };
}

export function nativeCanvasTextStartY(
  bounds: NativeBounds,
  fontSize: number,
  lineHeight: number,
  lineCount: number,
  verticallyCentered = false,
): number {
  if (!verticallyCentered || lineCount <= 0) return bounds.y + 16;
  const blockHeight = fontSize + Math.max(0, lineCount - 1) * lineHeight;
  return bounds.center.y - blockHeight / 2;
}

type NativeWhiteboardClipboardPayload = {
  version: 1;
  shapes: NativeWhiteboardShape[];
  assets: NativeWhiteboardRecord[];
};

type StoreEvent = { scope: "document" | "session" };
type StoreListener = (event: StoreEvent) => void;
const MAX_UNDO_STEPS = 30;

export class NativeWhiteboardStore {
  private value: WhiteboardSnapshot = createNativeWhiteboardSnapshot();
  private readonly listeners = new Set<StoreListener>();
  private past: WhiteboardSnapshot[] = [];
  private future: WhiteboardSnapshot[] = [];
  private pendingCheckpoint: WhiteboardSnapshot | undefined;

  get snapshot(): WhiteboardSnapshot {
    return this.value;
  }

  replace(snapshot: WhiteboardSnapshot, scope: StoreEvent["scope"] = "document"): void {
    this.value = markNativeSnapshot(structuredClone(snapshot));
    synchronizeMindMapSnapshot(this.value);
    this.past = [];
    this.future = [];
    this.pendingCheckpoint = undefined;
    this.emit(scope);
  }

  mutate(
    change: (snapshot: WhiteboardSnapshot) => void,
    scope: StoreEvent["scope"] = "document",
    notify = true,
  ): void {
    if (scope === "document") {
      if (notify) {
        this.pushHistory(this.pendingCheckpoint ?? structuredClone(this.value));
        this.pendingCheckpoint = undefined;
      } else if (!this.pendingCheckpoint) {
        this.pendingCheckpoint = structuredClone(this.value);
      }
    }
    change(this.value);
    if (scope === "document") synchronizeMindMapSnapshot(this.value);
    if (notify) this.emit(scope);
  }

  mutateWithoutHistory(
    change: (snapshot: WhiteboardSnapshot) => void,
    scope: StoreEvent["scope"] = "document",
  ): void {
    change(this.value);
    if (scope === "document") synchronizeMindMapSnapshot(this.value);
    this.emit(scope);
  }

  touch(scope: StoreEvent["scope"] = "document"): void {
    if (scope === "document" && this.pendingCheckpoint) {
      this.pushHistory(this.pendingCheckpoint);
      this.pendingCheckpoint = undefined;
    }
    this.emit(scope);
  }

  undo(): boolean {
    const previous = this.past.pop();
    if (!previous) return false;
    this.future.push(structuredClone(this.value));
    this.value = markNativeSnapshot(previous);
    this.pendingCheckpoint = undefined;
    this.emit("document");
    return true;
  }

  redo(): boolean {
    const next = this.future.pop();
    if (!next) return false;
    this.past.push(structuredClone(this.value));
    this.value = markNativeSnapshot(next);
    this.pendingCheckpoint = undefined;
    this.emit("document");
    return true;
  }

  canUndo(): boolean {
    return this.past.length > 0;
  }

  canRedo(): boolean {
    return this.future.length > 0;
  }

  listen(listener: StoreListener, _options?: unknown): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(scope: StoreEvent["scope"]): void {
    for (const listener of this.listeners) listener({ scope });
  }

  private pushHistory(snapshot: WhiteboardSnapshot): void {
    this.past.push(snapshot);
    if (this.past.length > MAX_UNDO_STEPS) this.past.shift();
    this.future = [];
  }
}

export function createNativeWhiteboardStore(): NativeWhiteboardStore {
  return new NativeWhiteboardStore();
}

export function getNativeSnapshot(store: NativeWhiteboardStore): WhiteboardSnapshot {
  return structuredClone(store.snapshot);
}

export function loadNativeSnapshot(
  store: NativeWhiteboardStore,
  snapshot: WhiteboardSnapshot,
): void {
  store.replace(snapshot);
}

export const createNativeShapeId = () => createNativeId("shape");
export const toNativeRichText = nativeRichText;

function records(snapshot: WhiteboardSnapshot): NativeWhiteboardRecord[] {
  return Object.values(snapshot.document.store).filter(isNativeRecord);
}

function whiteboardPages(snapshot: WhiteboardSnapshot): NativeWhiteboardRecord[] {
  return records(snapshot)
    .filter((record) => record.typeName === "page")
    .sort((left, right) => String(left.index ?? "").localeCompare(
      String(right.index ?? ""),
      undefined,
      { numeric: true },
    ));
}

type NativeWhiteboardPageGroup = {
  id: string;
  name: string;
  pages: NativeWhiteboardRecord[];
};

const WHITEBOARD_PAGE_GROUP_ACCENTS = [
  { id: "violet", className: "bg-[#eeecff] text-[#625bc5]" },
  { id: "teal", className: "bg-[#e8f7f4] text-[#278876]" },
  { id: "amber", className: "bg-[#fff3dd] text-[#c17819]" },
  { id: "rose", className: "bg-[#ffedf2] text-[#c24d70]" },
  { id: "blue", className: "bg-[#eaf2ff] text-[#4776c8]" },
] as const;

function recordMeta(record: NativeWhiteboardRecord | undefined): Record<string, unknown> {
  return record?.meta && typeof record.meta === "object"
    ? record.meta as Record<string, unknown>
    : {};
}

function pageGroupId(page: NativeWhiteboardRecord | undefined): string | undefined {
  const value = recordMeta(page).mokiPageGroupId;
  return typeof value === "string" && value ? value : undefined;
}

function pageGroupName(page: NativeWhiteboardRecord | undefined): string {
  const value = recordMeta(page).mokiPageGroupName;
  return typeof value === "string" && value.trim() ? value.trim() : "未命名分组";
}

function isPageGroupRecord(record: NativeWhiteboardRecord): boolean {
  return record.typeName === "page_group" && record.id.startsWith("page-group:");
}

function pageGroupRecordName(record: NativeWhiteboardRecord): string {
  const value = record.name;
  return typeof value === "string" && value.trim() ? value.trim() : "未命名分组";
}

function whiteboardPageGroups(snapshot: WhiteboardSnapshot): NativeWhiteboardPageGroup[] {
  const groups = new Map<string, NativeWhiteboardPageGroup>();
  for (const record of records(snapshot)
    .filter(isPageGroupRecord)
    .sort((left, right) => String(left.index ?? "").localeCompare(String(right.index ?? ""), undefined, { numeric: true }))) {
    groups.set(record.id, { id: record.id, name: pageGroupRecordName(record), pages: [] });
  }
  for (const page of whiteboardPages(snapshot)) {
    const id = pageGroupId(page);
    if (!id) continue;
    const current = groups.get(id);
    if (current) current.pages.push(page);
    else groups.set(id, { id, name: pageGroupName(page), pages: [page] });
  }
  return [...groups.values()];
}

function shapes(snapshot: WhiteboardSnapshot, pageId = nativePageId(snapshot)): NativeWhiteboardShape[] {
  return records(snapshot)
    .filter(isNativeShape)
    .filter((shape) => shape.parentId === pageId)
    .sort((left, right) => left.index.localeCompare(right.index));
}

function nativeGroupId(shape: NativeWhiteboardShape | undefined): string | undefined {
  const value = shape?.props.mokiGroupId;
  return typeof value === "string" && value ? value : undefined;
}

function isCollapsedGroupMember(shape: NativeWhiteboardShape): boolean {
  return shape.type !== "group-folder" && shape.props.mokiGroupCollapsed === true;
}

function visibleShapes(snapshot: WhiteboardSnapshot, pageId = nativePageId(snapshot)): NativeWhiteboardShape[] {
  return shapes(snapshot, pageId).filter((shape) => (
    !isCollapsedGroupMember(shape) && !isMindMapShapeHidden(shape)
  ));
}

function parseNativeWhiteboardClipboard(
  serialized: string,
): NativeWhiteboardClipboardPayload | undefined {
  if (serialized.length > 16 * 1024 * 1024) return undefined;
  try {
    const value = JSON.parse(serialized) as Partial<NativeWhiteboardClipboardPayload>;
    if (value.version !== 1 || !Array.isArray(value.shapes) || value.shapes.length > 2_000) return undefined;
    const copiedShapes = value.shapes.filter(shape => isNativeShape(shape)
      && Number.isFinite(shape.x) && Number.isFinite(shape.y)
      && shape.type.length > 0 && !Array.isArray(shape.props));
    if (copiedShapes.length !== value.shapes.length) return undefined;
    if (copiedShapes.length === 0) return undefined;
    if (value.assets !== undefined && (!Array.isArray(value.assets) || value.assets.length > 2_000)) return undefined;
    const copiedAssets = Array.isArray(value.assets) ? value.assets.filter(
      (record): record is NativeWhiteboardRecord => isNativeRecord(record) && record.typeName === "asset",
    ) : [];
    if (Array.isArray(value.assets) && copiedAssets.length !== value.assets.length) return undefined;
    return {
      version: 1,
      shapes: copiedShapes,
      assets: copiedAssets,
    };
  } catch {
    return undefined;
  }
}

function imageAsset(snapshot: WhiteboardSnapshot, shape: NativeWhiteboardShape) {
  const id = typeof shape.props.assetId === "string" ? shape.props.assetId : "";
  const asset = snapshot.document.store[id];
  return asset && asset.typeName === "asset" ? asset : undefined;
}

export function createNativeGroupFolderExportRequest(
  snapshot: WhiteboardSnapshot,
  folderId: string,
): NativeWhiteboardFolderExportRequest | undefined {
  const folder = snapshot.document.store[folderId];
  if (!isNativeShape(folder) || folder.type !== "group-folder") return undefined;
  const groupId = nativeGroupId(folder);
  if (!groupId) return undefined;
  const members = shapes(snapshot, folder.parentId)
    .filter((shape) => shape.type !== "group-folder" && nativeGroupId(shape) === groupId)
    .map((shape) => structuredClone(shape));
  const assetIds = new Set(members.map((shape) => shape.props.assetId).filter((id): id is string => typeof id === "string" && Boolean(id)));
  const assets = [...assetIds]
    .map((id) => snapshot.document.store[id])
    .filter((asset): asset is NativeWhiteboardRecord => isNativeRecord(asset) && asset.typeName === "asset")
    .map((asset) => structuredClone(asset));
  return {
    folderId,
    name: String(folder.props.groupLabel ?? "新空间"),
    description: String(folder.props.groupDescription ?? "把相关想法放在一起"),
    payload: { version: 1, shapes: members, assets },
  };
}

export function isAnimatedNativeImageAsset(
  asset: NativeWhiteboardRecord | undefined,
): boolean {
  if (!asset || asset.typeName !== "asset") return false;
  const props = asset.props && typeof asset.props === "object"
    ? asset.props as Record<string, unknown>
    : {};
  const mimeType = String(props.mimeType ?? "").toLowerCase();
  const source = String(props.src ?? "").toLowerCase();
  const name = String(props.name ?? "").toLowerCase();
  return props.isAnimated === true || mimeType === "image/gif" ||
    source.startsWith("data:image/gif") || name.endsWith(".gif");
}

function pageName(snapshot: WhiteboardSnapshot, id: string): string {
  const page = snapshot.document.store[id];
  return page && typeof page.name === "string" && page.name.trim() ? page.name : "未命名页面";
}

function touchPageEdited(snapshot: WhiteboardSnapshot, id: string): void {
  const page = snapshot.document.store[id];
  if (!page || page.typeName !== "page") return;
  snapshot.document.store[id] = { ...page, updatedAt: new Date().toISOString() };
}

function formatPageEditedAt(page: NativeWhiteboardRecord): string {
  const raw = typeof page.updatedAt === "string"
    ? page.updatedAt
    : typeof page.createdAt === "string"
      ? page.createdAt
      : "";
  if (!raw) return "较早编辑";
  const editedAt = new Date(raw);
  if (Number.isNaN(editedAt.getTime())) return "较早编辑";
  const elapsedMinutes = Math.max(0, Math.floor((Date.now() - editedAt.getTime()) / 60_000));
  if (elapsedMinutes < 1) return "刚刚编辑";
  if (elapsedMinutes < 60) return `${elapsedMinutes} 分钟前编辑`;
  const now = new Date();
  const sameDay = now.getFullYear() === editedAt.getFullYear() &&
    now.getMonth() === editedAt.getMonth() && now.getDate() === editedAt.getDate();
  const time = editedAt.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  if (sameDay) return `今天 ${time} 编辑`;
  return `${editedAt.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" })} ${time} 编辑`;
}

function preloadImage(source: string): Promise<HTMLImageElement | undefined> {
  return new Promise((resolve) => {
    const image = new Image();
    image.decoding = "async";
    let settled = false;
    const finish = (value?: HTMLImageElement) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    image.onload = () => finish(image.naturalWidth > 0 ? image : undefined);
    image.onerror = () => finish();
    image.src = source;
    if (image.complete) {
      queueMicrotask(() => finish(image.naturalWidth > 0 ? image : undefined));
    }
  });
}

class WhiteboardImageDecodeError extends Error {}

async function imageDimensions(file: Blob): Promise<{ width: number; height: number; bitmap?: ImageBitmap; image?: HTMLImageElement }> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      if (bitmap.width > 0 && bitmap.height > 0) {
        return { width: bitmap.width, height: bitmap.height, bitmap };
      }
      bitmap.close();
    } catch {
      // Chromium may reject a large clipboard image here even when an img
      // element can decode and downsample the same bytes.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new WhiteboardImageDecodeError("图片无法解码，请检查图片格式或重新复制"));
      image.src = url;
    });
    if (image.naturalWidth <= 0 || image.naturalHeight <= 0) {
      throw new WhiteboardImageDecodeError("图片无法解码，请检查图片格式或重新复制");
    }
    return { width: image.naturalWidth, height: image.naturalHeight, image };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function optimizeImage(file: File): Promise<{
  blob: Blob;
  width: number;
  height: number;
  optimized: boolean;
}> {
  const decoded = await imageDimensions(file);
  const maxEdge = 4096;
  const maxPixels = 12_000_000;
  const scale = Math.min(
    1,
    maxEdge / Math.max(decoded.width, decoded.height),
    Math.sqrt(maxPixels / Math.max(1, decoded.width * decoded.height)),
  );
  const shouldEncode = scale < 1 || file.size > 8 * 1024 * 1024;
  if (!shouldEncode || file.type === "image/gif" || file.type === "image/svg+xml") {
    decoded.bitmap?.close();
    return { blob: file, width: decoded.width, height: decoded.height, optimized: false };
  }
  const width = Math.max(1, Math.round(decoded.width * scale));
  const height = Math.max(1, Math.round(decoded.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) throw new Error("当前设备无法处理大图片");
  if (decoded.bitmap) {
    try { context.drawImage(decoded.bitmap, 0, 0, width, height); }
    finally { decoded.bitmap.close(); }
  } else if (decoded.image) {
    context.drawImage(decoded.image, 0, 0, width, height);
  }
  const mime = file.type === "image/png" ? "image/webp" : "image/jpeg";
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (value) => value ? resolve(value) : reject(new Error("图片压缩失败")),
      mime,
      mime === "image/webp" ? 0.88 : 0.86,
    ),
  );
  return { blob, width, height, optimized: true };
}

async function uploadImageAsset(file: File): Promise<{
  record: {
    src: string;
    mimeType: string;
    fileSize: number;
    width: number;
    height: number;
  };
  previewImage?: HTMLImageElement;
}> {
  const optimized = await optimizeImage(file);
  const mimeType = optimized.blob.type || file.type || "image/png";
  const response = await apiFetch("/api/whiteboard/assets", {
    method: "POST",
    headers: {
      "content-type": "application/x-moki-whiteboard-asset",
      "x-moki-retryable-write": "true",
      "x-moki-asset-mime": mimeType,
      "x-moki-asset-name": encodeURIComponent(file.name),
      "x-moki-asset-width": String(optimized.width),
      "x-moki-asset-height": String(optimized.height),
    },
    body: optimized.blob,
  });
  const result = await response.json() as Record<string, unknown>;
  if (!response.ok || typeof result.src !== "string") {
    throw new Error(typeof result.error === "string" ? result.error : "图片资源保存失败");
  }
  const previewImage = await preloadImage(result.src);
  return {
    record: {
      src: result.src,
      mimeType: typeof result.mimeType === "string" ? result.mimeType : optimized.blob.type,
      fileSize: typeof result.fileSize === "number" ? result.fileSize : optimized.blob.size,
      width: optimized.width,
      height: optimized.height,
    },
    ...(previewImage ? { previewImage } : {}),
  };
}

function nativeMediaKind(file: File): "audio" | "video" | undefined {
  const type = file.type.toLowerCase();
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("audio/")) return "audio";
  const extension = file.name.toLowerCase().match(/\.([a-z0-9]+)$/u)?.[1] ?? "";
  if (["mp4", "m4v", "mov", "webm", "ogv", "mkv", "avi"].includes(extension)) return "video";
  if (["mp3", "wav", "m4a", "aac", "ogg", "oga", "opus", "flac"].includes(extension)) return "audio";
  return undefined;
}

function nativeMediaMimeType(file: File, kind: "audio" | "video"): string {
  if (file.type.startsWith(`${kind}/`)) return file.type.toLowerCase();
  const extension = file.name.toLowerCase().match(/\.([a-z0-9]+)$/u)?.[1] ?? "";
  const known = new Map<string, string>([
    ["mp4", "video/mp4"], ["m4v", "video/mp4"], ["mov", "video/quicktime"],
    ["webm", "video/webm"], ["ogv", "video/ogg"], ["mkv", "video/x-matroska"], ["avi", "video/x-msvideo"],
    ["mp3", "audio/mpeg"], ["wav", "audio/wav"], ["m4a", "audio/mp4"],
    ["aac", "audio/aac"], ["ogg", "audio/ogg"], ["oga", "audio/ogg"],
    ["opus", "audio/opus"], ["flac", "audio/flac"],
  ]);
  return known.get(extension) ?? `${kind}/octet-stream`;
}

async function uploadMediaAsset(file: File): Promise<{
  src: string;
  mimeType: string;
  fileSize: number;
}> {
  const response = await apiFetch("/api/whiteboard/assets", {
    method: "POST",
    headers: {
      "content-type": "application/x-moki-whiteboard-asset",
      "x-moki-retryable-write": "true",
      "x-moki-asset-mime": nativeMediaMimeType(file, nativeMediaKind(file) ?? "video"),
      "x-moki-asset-name": encodeURIComponent(file.name),
    },
    body: file,
  });
  const result = await response.json() as Record<string, unknown>;
  if (!response.ok || typeof result.src !== "string") {
    throw new Error(typeof result.error === "string" ? result.error : "媒体资源保存失败");
  }
  return {
    src: result.src,
    mimeType: typeof result.mimeType === "string"
      ? result.mimeType
      : nativeMediaMimeType(file, nativeMediaKind(file) ?? "video"),
    fileSize: typeof result.fileSize === "number" ? result.fileSize : file.size,
  };
}

type NativeImageLoadStatus = "loading" | "loaded" | "error";

type NativeImageCacheEntry = {
  image: HTMLImageElement;
  status: NativeImageLoadStatus;
  promise: Promise<boolean>;
};

export function drawNativeImagePlaceholder(
  context: CanvasRenderingContext2D,
  bounds: NativeBounds,
  status: Exclude<NativeImageLoadStatus, "loaded">,
  now = performance.now(),
): void {
  const radius = Math.max(8, Math.min(22, Math.min(bounds.w, bounds.h) * 0.07));
  const centerX = bounds.center.x;
  const centerY = bounds.center.y;
  context.fillStyle = status === "error" ? "#fff2f2" : "#f4f5f9";
  context.fillRect(bounds.x, bounds.y, bounds.w, bounds.h);
  context.save();
  context.lineWidth = Math.max(2, radius * 0.16);
  context.lineCap = "round";
  if (status === "loading") {
    const angle = (now / 650) * Math.PI * 2;
    context.strokeStyle = "rgba(98,91,197,.2)";
    context.beginPath();
    context.arc(centerX, centerY, radius, 0, Math.PI * 2);
    context.stroke();
    context.strokeStyle = "#625bc5";
    context.beginPath();
    context.arc(centerX, centerY, radius, angle, angle + Math.PI * 1.25);
    context.stroke();
  } else {
    context.strokeStyle = "#d95d5d";
    context.beginPath();
    context.moveTo(centerX - radius * 0.55, centerY - radius * 0.55);
    context.lineTo(centerX + radius * 0.55, centerY + radius * 0.55);
    context.moveTo(centerX + radius * 0.55, centerY - radius * 0.55);
    context.lineTo(centerX - radius * 0.55, centerY + radius * 0.55);
    context.stroke();
  }
  if (bounds.w >= 140 && bounds.h >= 100) {
    context.fillStyle = status === "error" ? "#b84b4b" : "#73798b";
    context.font = `${Math.max(12, Math.min(16, radius * 0.7))}px system-ui, sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "top";
    context.fillText(
      status === "error" ? "图片加载失败" : "图片加载中…",
      centerX,
      centerY + radius + 10,
    );
  }
  context.restore();
}

function nativeLinkDetails(shape: NativeWhiteboardShape): {
  url: string;
  title: string;
  hostname: string;
  mode: NativeWhiteboardLinkMode;
  thumbnailUrl: string;
  thumbnailUpdatedAt: string;
} {
  const url = normalizeWhiteboardLinkUrl(String(shape.props.url ?? "")) ?? "";
  let hostname = url;
  try {
    hostname = new URL(url).hostname;
  } catch {
    // Keep the original text so legacy or partially edited cards remain legible.
  }
  return {
    url,
    hostname,
    title: String(shape.props.title ?? "").trim() || hostname || "网页链接",
    mode: shape.props.mode === "preview" ? "preview" : "link",
    thumbnailUrl:
      typeof shape.props.thumbnailUrl === "string"
        ? shape.props.thumbnailUrl
        : "",
    thumbnailUpdatedAt:
      typeof shape.props.thumbnailUpdatedAt === "string"
        ? shape.props.thumbnailUpdatedAt
        : "",
  };
}

function escapeSvgText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function createLinkPreviewThumbnailDataUrl(input: {
  title: string;
  hostname: string;
  url: string;
  capturedAt: string;
  pageTitle?: string;
}): string {
  const title = escapeSvgText(input.pageTitle?.trim() || input.title);
  const hostname = escapeSvgText(input.hostname || input.url);
  const url = escapeSvgText(input.url);
  const capturedAt = escapeSvgText(input.capturedAt);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="420" viewBox="0 0 720 420">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#f8f7ff"/>
      <stop offset="0.55" stop-color="#eef4ff"/>
      <stop offset="1" stop-color="#f5fbf8"/>
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="18" stdDeviation="18" flood-color="#232842" flood-opacity=".15"/>
    </filter>
  </defs>
  <rect width="720" height="420" rx="28" fill="url(#bg)"/>
  <rect x="46" y="44" width="628" height="332" rx="22" fill="#fff" filter="url(#shadow)"/>
  <rect x="46" y="44" width="628" height="46" rx="22" fill="#f1f3f8"/>
  <circle cx="76" cy="67" r="6" fill="#ff6b7b"/>
  <circle cx="98" cy="67" r="6" fill="#f2bd4b"/>
  <circle cx="120" cy="67" r="6" fill="#55c48b"/>
  <rect x="148" y="56" width="410" height="22" rx="11" fill="#fff"/>
  <text x="166" y="72" font-family="Inter,Segoe UI,Arial,sans-serif" font-size="12" font-weight="700" fill="#7c8498">${hostname}</text>
  <rect x="84" y="125" width="552" height="54" rx="16" fill="#f4f6fb"/>
  <rect x="84" y="205" width="380" height="18" rx="9" fill="#e2e6f0"/>
  <rect x="84" y="237" width="470" height="18" rx="9" fill="#e8ebf3"/>
  <rect x="84" y="269" width="308" height="18" rx="9" fill="#eef0f6"/>
  <rect x="484" y="210" width="104" height="104" rx="24" fill="#eeedff"/>
  <text x="536" y="272" text-anchor="middle" font-family="Inter,Segoe UI,Arial,sans-serif" font-size="44" font-weight="800" fill="#625bc5">↗</text>
  <text x="104" y="158" font-family="Inter,Segoe UI,Arial,sans-serif" font-size="24" font-weight="850" fill="#242a40">${title}</text>
  <text x="84" y="344" font-family="Inter,Segoe UI,Arial,sans-serif" font-size="13" font-weight="700" fill="#8a91a4">${url}</text>
  <text x="636" y="344" text-anchor="end" font-family="Inter,Segoe UI,Arial,sans-serif" font-size="12" font-weight="700" fill="#a2a8b8">${capturedAt}</text>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function drawNativeLinkCard(
  context: CanvasRenderingContext2D,
  bounds: NativeBounds,
  shape: NativeWhiteboardShape,
  thumbnailImage?: HTMLImageElement,
  hidePreview = false,
): void {
  const details = nativeLinkDetails(shape);
  const radius = Math.min(16, bounds.w / 8, bounds.h / 8);
  context.save();
  context.shadowColor = "rgba(35,39,61,.12)";
  context.shadowBlur = 14;
  context.shadowOffsetY = 5;
  context.fillStyle = "#ffffff";
  context.beginPath();
  context.roundRect(bounds.x, bounds.y, bounds.w, bounds.h, radius);
  context.fill();
  context.shadowColor = "transparent";
  context.strokeStyle = "#dfe2ec";
  context.lineWidth = 1.5;
  context.stroke();

  context.fillStyle = "#625bc5";
  context.beginPath();
  context.roundRect(bounds.x + 14, bounds.y + 14, 30, 30, 9);
  context.fill();
  context.fillStyle = "#ffffff";
  context.font = "700 17px system-ui, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText("↗", bounds.x + 29, bounds.y + 29);

  context.textAlign = "left";
  context.textBaseline = "top";
  context.fillStyle = "#242838";
  context.font = "700 15px system-ui, sans-serif";
  context.fillText(details.title, bounds.x + 54, bounds.y + 13, Math.max(30, bounds.w - 108));
  context.fillStyle = "#858b9c";
  context.font = "12px system-ui, sans-serif";
  context.fillText(details.hostname || details.url, bounds.x + 54, bounds.y + 34, Math.max(30, bounds.w - 68));

  if (details.mode === "preview" && bounds.h > 110 && !hidePreview) {
    const previewY = bounds.y + 58;
    const previewHeight = Math.max(30, bounds.h - 70);
    context.fillStyle = "#f5f6fa";
    context.beginPath();
    context.roundRect(bounds.x + 12, previewY, bounds.w - 24, previewHeight, 10);
    context.fill();
    if (thumbnailImage) {
      context.save();
      context.beginPath();
      context.roundRect(bounds.x + 12, previewY, bounds.w - 24, previewHeight, 10);
      context.clip();
      context.drawImage(
        thumbnailImage,
        bounds.x + 12,
        previewY,
        bounds.w - 24,
        previewHeight,
      );
      context.restore();
    } else {
      context.fillStyle = "#a0a5b4";
      context.font = "600 12px system-ui, sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText("网页交互式预览", bounds.center.x, previewY + previewHeight / 2);
    }
    if (details.thumbnailUpdatedAt) {
      context.fillStyle = "rgba(36,42,64,.72)";
      context.font = "700 10px system-ui, sans-serif";
      context.textAlign = "right";
      context.textBaseline = "bottom";
      context.fillText("已缓存预览", bounds.x + bounds.w - 18, bounds.y + bounds.h - 16);
    }
  }
  context.restore();
}

function drawNativeResourceCard(
  context: CanvasRenderingContext2D,
  bounds: NativeBounds,
  shape: NativeWhiteboardShape,
): void {
  const name = String(shape.props.name ?? "资料");
  const kind = String(shape.props.kind ?? "local_file");
  const folder = kind === "folder" || kind === "local_folder";
  const radius = Math.min(16, bounds.w / 8, bounds.h / 8);
  context.save();
  context.shadowColor = "rgba(35,39,61,.12)";
  context.shadowBlur = 12;
  context.shadowOffsetY = 4;
  context.fillStyle = "#ffffff";
  context.beginPath();
  context.roundRect(bounds.x, bounds.y, bounds.w, bounds.h, radius);
  context.fill();
  context.shadowColor = "transparent";
  context.strokeStyle = "#dfe2ec";
  context.lineWidth = 1.5;
  context.stroke();
  context.fillStyle = folder ? "#f0b94a" : "#625bc5";
  context.beginPath();
  if (folder) {
    context.roundRect(bounds.x + 18, bounds.y + 21, 48, 34, 7);
    context.fill();
    context.fillRect(bounds.x + 22, bounds.y + 16, 22, 12);
  } else {
    context.roundRect(bounds.x + 21, bounds.y + 14, 40, 50, 7);
    context.fill();
    context.strokeStyle = "rgba(255,255,255,.8)";
    context.lineWidth = 2;
    for (let row = 0; row < 3; row += 1) {
      context.beginPath();
      context.moveTo(bounds.x + 29, bounds.y + 28 + row * 10);
      context.lineTo(bounds.x + 53, bounds.y + 28 + row * 10);
      context.stroke();
    }
  }
  context.fillStyle = "#242838";
  context.font = "700 15px system-ui, sans-serif";
  context.textAlign = "left";
  context.textBaseline = "top";
  context.fillText(name, bounds.x + 78, bounds.y + 18, Math.max(30, bounds.w - 94));
  context.fillStyle = "#8a90a2";
  context.font = "12px system-ui, sans-serif";
  context.fillText(folder ? "资料文件夹 · 双击打开" : "资料文件 · 双击打开", bounds.x + 78, bounds.y + 43, Math.max(30, bounds.w - 94));
  context.restore();
}

function drawNativeMediaCard(
  context: CanvasRenderingContext2D,
  bounds: NativeBounds,
  shape: NativeWhiteboardShape,
): void {
  const video = shape.props.mediaKind === "video";
  const name = String(shape.props.name ?? (video ? "视频" : "音频"));
  context.save();
  context.fillStyle = video ? "#171b2a" : "#ffffff";
  context.strokeStyle = video ? "#30364d" : "#dfe2ec";
  context.lineWidth = 1.5;
  context.beginPath();
  context.roundRect(bounds.x, bounds.y, bounds.w, bounds.h, 16);
  context.fill();
  context.stroke();
  context.fillStyle = video ? "rgba(255,255,255,.92)" : "#242838";
  context.font = "700 15px system-ui, sans-serif";
  context.textAlign = "left";
  context.textBaseline = "bottom";
  context.fillText(name, bounds.x + 18, bounds.y + bounds.h - 16, Math.max(40, bounds.w - 36));
  if (video) {
    context.fillStyle = "rgba(255,255,255,.92)";
    context.beginPath();
    context.moveTo(bounds.center.x - 14, bounds.center.y - 20);
    context.lineTo(bounds.center.x + 20, bounds.center.y);
    context.lineTo(bounds.center.x - 14, bounds.center.y + 20);
    context.closePath();
    context.fill();
  } else {
    context.fillStyle = "#625bc5";
    for (let index = 0; index < 7; index += 1) {
      const height = 12 + (index % 3) * 8;
      context.fillRect(bounds.x + 20 + index * 10, bounds.center.y - height / 2, 5, height);
    }
  }
  context.restore();
}

type NativeGroupFolderPreview = {
  label: string;
  image?: HTMLImageElement;
  color: string;
};

function nativeGroupFolderPreviewLabel(shape: NativeWhiteboardShape): string {
  const text = nativeRichTextValue(shape.props.richText).trim();
  if (text) return text;
  for (const key of ["name", "title", "label", "fileName"] as const) {
    const value = shape.props[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return ({
    arrow: "箭头",
    bezier: "钢笔路径",
    draw: "绘图",
    geo: "图形",
    image: "图片",
    link: "网页链接",
    media: "媒体",
    note: "便签",
    resource: "资料",
    text: "文本",
  } as Record<string, string>)[shape.type] ?? "白板内容";
}

export function nativeGroupFolderVisualScale(bounds: NativeBounds): number {
  return Math.max(.01, Math.min(bounds.w / 240, bounds.h / 180));
}

export function nativeGroupFolderToggleButtonBounds(bounds: NativeBounds): NativeBounds {
  const visualScale = nativeGroupFolderVisualScale(bounds);
  const size = 28.8 * visualScale;
  const inset = 14.4 * visualScale;
  const x = bounds.x + bounds.w - inset - size;
  const y = bounds.y + bounds.h - inset - size;
  return {
    x,
    y,
    w: size,
    h: size,
    width: size,
    height: size,
    center: { x: x + size / 2, y: y + size / 2 },
  };
}

function pointInNativeBounds(point: NativePoint, bounds: NativeBounds): boolean {
  return point.x >= bounds.x && point.x <= bounds.x + bounds.w &&
    point.y >= bounds.y && point.y <= bounds.y + bounds.h;
}

function drawNativeGroupToggleButton(
  context: CanvasRenderingContext2D,
  bounds: NativeBounds,
  mode: "expand" | "collapse",
): void {
  const scale = bounds.w / 28;
  context.save();
  context.translate(bounds.x, bounds.y);
  context.scale(scale, scale);
  context.fillStyle = "#f2f0ff";
  context.strokeStyle = "#d9d5f5";
  context.lineWidth = 1;
  context.beginPath();
  context.roundRect(.5, .5, 27, 27, 8);
  context.fill();
  context.stroke();
  context.strokeStyle = "#625bc5";
  context.fillStyle = "rgba(98,91,197,.1)";
  context.lineWidth = 1.9;
  context.lineCap = "round";
  context.lineJoin = "round";
  if (mode === "expand") {
    // Open folder: the folder flap directly communicates that the contents will unfold.
    context.beginPath();
    context.moveTo(5, 13);
    context.lineTo(5, 8.5);
    context.quadraticCurveTo(5, 7, 6.5, 7);
    context.lineTo(10.5, 7);
    context.lineTo(12.5, 9.5);
    context.lineTo(21.5, 9.5);
    context.quadraticCurveTo(23, 9.5, 23, 11);
    context.stroke();
    context.beginPath();
    context.moveTo(6.5, 12);
    context.lineTo(23, 12);
    context.lineTo(20.5, 20.5);
    context.quadraticCurveTo(20.2, 21.5, 19, 21.5);
    context.lineTo(6.5, 21.5);
    context.quadraticCurveTo(5.2, 21.5, 5.5, 20.2);
    context.lineTo(7, 13.2);
    context.quadraticCurveTo(7.2, 12, 8.5, 12);
    context.closePath();
    context.fill();
    context.stroke();
  } else {
    // Folder input: the downward arrow makes the reverse action read as gathering into a folder.
    context.beginPath();
    context.moveTo(5, 11);
    context.lineTo(5, 8.5);
    context.quadraticCurveTo(5, 7, 6.5, 7);
    context.lineTo(10.5, 7);
    context.lineTo(12.5, 9.5);
    context.lineTo(21.5, 9.5);
    context.quadraticCurveTo(23, 9.5, 23, 11);
    context.lineTo(23, 20);
    context.quadraticCurveTo(23, 21.5, 21.5, 21.5);
    context.lineTo(6.5, 21.5);
    context.quadraticCurveTo(5, 21.5, 5, 20);
    context.closePath();
    context.fill();
    context.stroke();
    context.beginPath();
    context.moveTo(14, 11.5);
    context.lineTo(14, 17);
    context.moveTo(11.5, 14.5);
    context.lineTo(14, 17);
    context.lineTo(16.5, 14.5);
    context.stroke();
  }
  context.restore();
}

function drawNativeGroupFolder(
  context: CanvasRenderingContext2D,
  bounds: NativeBounds,
  shape: NativeWhiteboardShape,
  previews: NativeGroupFolderPreview[],
  memberCount: number,
): void {
  const visualScale = nativeGroupFolderVisualScale(bounds);
  const radius = Math.min(24 * visualScale, bounds.w / 7, bounds.h / 7);
  const frontY = bounds.y + Math.max(30 * visualScale, bounds.h * .2);
  const frontHeight = bounds.y + bounds.h - frontY;
  const inset = Math.max(12 * visualScale, bounds.w * .06);
  const previewGap = Math.max(6 * visualScale, bounds.w * .025);
  const previewWidth = Math.max(54 * visualScale, (bounds.w - inset * 2 - previewGap) / 2);
  const previewHeight = Math.max(36 * visualScale, Math.min(62 * visualScale, bounds.h * .32));
  const title = String(shape.props.groupLabel ?? "新空间");
  const description = String(shape.props.groupDescription ?? "把相关想法放在一起");
  const folderColor = typeof shape.props.groupColor === "string" && /^#[0-9a-f]{6}$/iu.test(shape.props.groupColor)
    ? shape.props.groupColor : "#776bd8";

  context.save();
  context.shadowColor = "rgba(87,83,151,.16)";
  context.shadowBlur = 22 * visualScale;
  context.shadowOffsetY = 9 * visualScale;
  context.fillStyle = "rgba(255,255,255,.72)";
  context.beginPath();
  context.roundRect(
    bounds.x + 5 * visualScale,
    bounds.y + 8 * visualScale,
    bounds.w - 10 * visualScale,
    bounds.h - 10 * visualScale,
    radius,
  );
  context.fill();
  context.shadowColor = "transparent";
  context.strokeStyle = "rgba(255,255,255,.92)";
  context.lineWidth = 1.5 * visualScale;
  context.stroke();

  for (let index = 0; index < 2; index += 1) {
    const preview = previews[index];
    const x = bounds.x + inset + index * (previewWidth + previewGap);
    const y = bounds.y + (index === 0 ? 6 : 12) * visualScale;
    context.save();
    context.beginPath();
    context.roundRect(x, y, previewWidth, previewHeight, Math.min(13 * visualScale, radius * .58));
    context.clip();
    context.fillStyle = preview?.color ?? "#f5f6fa";
    context.fillRect(x, y, previewWidth, previewHeight);
    if (preview?.image) {
      const sourceRatio = preview.image.naturalWidth / Math.max(1, preview.image.naturalHeight);
      const targetRatio = previewWidth / previewHeight;
      const drawWidth = sourceRatio > targetRatio ? previewHeight * sourceRatio : previewWidth;
      const drawHeight = sourceRatio > targetRatio ? previewHeight : previewWidth / sourceRatio;
      context.drawImage(
        preview.image,
        x + (previewWidth - drawWidth) / 2,
        y + (previewHeight - drawHeight) / 2,
        drawWidth,
        drawHeight,
      );
    } else if (preview) {
      context.fillStyle = "#505667";
      context.font = `700 ${10 * visualScale}px system-ui, sans-serif`;
      context.textAlign = "left";
      context.textBaseline = "top";
      context.fillText(
        preview.label,
        x + 10 * visualScale,
        y + 10 * visualScale,
        previewWidth - 20 * visualScale,
      );
      context.strokeStyle = "rgba(111,117,137,.28)";
      context.lineWidth = 2 * visualScale;
      for (let row = 0; row < 2; row += 1) {
        context.beginPath();
        context.moveTo(x + 10 * visualScale, y + (29 + row * 10) * visualScale);
        context.lineTo(
          x + previewWidth - (12 + row * 12) * visualScale,
          y + (29 + row * 10) * visualScale,
        );
        context.stroke();
      }
    }
    context.restore();
  }

  context.fillStyle = "#fffefe";
  context.beginPath();
  context.roundRect(bounds.x, frontY, bounds.w, frontHeight, radius);
  context.fill();
  context.fillStyle = folderColor;
  context.globalAlpha = .16;
  context.beginPath();
  context.roundRect(bounds.x + 1, frontY + 1, bounds.w - 2, frontHeight - 2, radius);
  context.fill();
  context.globalAlpha = 1;
  context.fillStyle = folderColor;
  context.fillRect(bounds.x + inset, frontY + 7 * visualScale, 32 * visualScale, 4 * visualScale);
  context.strokeStyle = "rgba(224,225,235,.86)";
  context.lineWidth = visualScale;
  context.stroke();

  context.textAlign = "left";
  context.textBaseline = "top";
  context.fillStyle = "#747988";
  context.font = `500 ${13 * visualScale}px system-ui, sans-serif`;
  context.fillText(`${memberCount} 项内容`, bounds.x + inset, frontY + 18 * visualScale);

  const titleY = bounds.y + bounds.h - 58 * visualScale;
  context.fillStyle = "#20232d";
  context.font = `800 ${18 * visualScale}px system-ui, sans-serif`;
  context.fillText(title, bounds.x + inset, titleY, Math.max(40 * visualScale, bounds.w - inset * 2 - 38 * visualScale));
  context.fillStyle = "#989ca8";
  context.font = `${12 * visualScale}px system-ui, sans-serif`;
  context.fillText(
    description,
    bounds.x + inset,
    titleY + 27 * visualScale,
    Math.max(40 * visualScale, bounds.w - inset * 2 - 42 * visualScale),
  );
  drawNativeGroupToggleButton(context, nativeGroupFolderToggleButtonBounds(bounds), "expand");
  context.restore();
}

export class NativeWhiteboardEditor {
  readonly store: NativeWhiteboardStore;
  private selected = new Set<string>();
  private currentTool = "select";
  private nextGeo: NativeGeoShape = "rectangle";
  private viewport = { x: 0, y: 0, width: 1000, height: 700, zoom: 1 };
  private refresh?: () => void;
  private cameraChange?: (camera: { x: number; y: number; zoom: number }) => void;
  private preloadImagesHandler?: (sources: string[]) => Promise<void>;
  private cachePreviewImageHandler?: (source: string, image: HTMLImageElement) => void;

  constructor(store: NativeWhiteboardStore) {
    this.store = store;
  }

  attachRefresh(refresh: () => void): void {
    this.refresh = refresh;
  }

  attachCameraChange(change: (camera: { x: number; y: number; zoom: number }) => void): void {
    this.cameraChange = change;
  }

  attachImageHandlers(
    preload: (sources: string[]) => Promise<void>,
    cachePreview: (source: string, image: HTMLImageElement) => void,
  ): void {
    this.preloadImagesHandler = preload;
    this.cachePreviewImageHandler = cachePreview;
  }

  async preloadImages(sources: string[], timeoutMs = 0): Promise<void> {
    const uniqueSources = [...new Set(sources.filter(Boolean))];
    if (!uniqueSources.length || !this.preloadImagesHandler) return;
    const loading = this.preloadImagesHandler(uniqueSources);
    if (timeoutMs <= 0) {
      await loading;
      return;
    }
    await Promise.race([
      loading,
      new Promise<void>((resolve) => globalThis.setTimeout(resolve, timeoutMs)),
    ]);
  }

  setViewport(value: Partial<typeof this.viewport>): void {
    this.viewport = { ...this.viewport, ...value };
  }

  getViewportPageBounds(): NativeBounds {
    const value = {
      x: this.viewport.x,
      y: this.viewport.y,
      w: this.viewport.width / this.viewport.zoom,
      h: this.viewport.height / this.viewport.zoom,
    };
    return { ...value, width: value.w, height: value.h, center: { x: value.x + value.w / 2, y: value.y + value.h / 2 } };
  }

  getCurrentPageId(): string {
    return nativePageId(this.store.snapshot);
  }

  getCurrentPage(): { id: string; name: string } {
    const id = this.getCurrentPageId();
    return { id, name: pageName(this.store.snapshot, id) };
  }

  getPages(): Array<{ id: string; name: string }> {
    return whiteboardPages(this.store.snapshot).map((page) => ({
      id: page.id,
      name: pageName(this.store.snapshot, page.id),
    }));
  }

  getPageGroups(): Array<{ id: string; name: string; pageIds: string[] }> {
    return whiteboardPageGroups(this.store.snapshot).map((group) => ({
      id: group.id,
      name: group.name,
      pageIds: group.pages.map((page) => page.id),
    }));
  }

  getCurrentPageShapeIds(): Set<string> {
    return new Set(visibleShapes(this.store.snapshot).map((shape) => shape.id));
  }

  getShape(id: string): NativeWhiteboardShape | undefined {
    const value = this.store.snapshot.document.store[id];
    return isNativeShape(value) ? value : undefined;
  }

  getShapePageBounds(id: string): NativeBounds | undefined {
    const shape = this.getShape(id);
    return shape ? nativeShapeVisualBounds(shape) : undefined;
  }

  getSelectedShapeIds(): string[] {
    return [...this.selected];
  }

  copySelectedShapes(): string | undefined {
    const selectedShapes = this.getSelectedShapeIds()
      .map((id) => this.getShape(id))
      .filter((shape): shape is NativeWhiteboardShape => Boolean(shape));
    if (selectedShapes.length === 0) return undefined;
    const assetIds = new Set(
      selectedShapes
        .map((shape) => shape.props.assetId)
        .filter((id): id is string => typeof id === "string"),
    );
    const assets = [...assetIds]
      .map((id) => this.store.snapshot.document.store[id])
      .filter(
        (record): record is NativeWhiteboardRecord =>
          isNativeRecord(record) && record.typeName === "asset",
      );
    return JSON.stringify({
      version: 1,
      shapes: selectedShapes,
      assets,
    } satisfies NativeWhiteboardClipboardPayload);
  }

  pasteCopiedShapes(serialized: string, offset = 32): string[] {
    const payload = parseNativeWhiteboardClipboard(serialized);
    if (!payload || !Number.isFinite(offset)) return [];
    const pageId = this.getCurrentPageId();
    if (this.store.snapshot.document.store[pageId]?.typeName !== "page") return [];
    const assetsById = new Map(payload.assets.map(asset => [asset.id, asset]));
    const assetIds = new Map<string, string>();
    const assetsToAdd: NativeWhiteboardRecord[] = [];
    for (const asset of payload.assets) {
      const existing = this.store.snapshot.document.store[asset.id];
      if (!existing) {
        assetsToAdd.push(structuredClone(asset));
      } else if (JSON.stringify(existing) !== JSON.stringify(asset)) {
        const nextId = createNativeId("asset");
        assetIds.set(asset.id, nextId);
        assetsToAdd.push({ ...structuredClone(asset), id: nextId });
      }
    }
    if (payload.shapes.some(shape => {
      const assetId = shape.props.assetId;
      return typeof assetId === "string" && !assetsById.has(assetId) &&
        this.store.snapshot.document.store[assetId]?.typeName !== "asset";
    })) return [];
    const copiedGroupIds = new Map<string, string>();
    const copies = payload.shapes.map((shape) => {
      const {
        id: _id,
        parentId: _parentId,
        index: _index,
        ...copy
      } = structuredClone(shape);
      const groupId = nativeGroupId(shape);
      const nextGroupId = groupId
        ? copiedGroupIds.get(groupId) ?? `group:${createNativeId("shape").slice(6)}`
        : undefined;
      if (groupId && nextGroupId) copiedGroupIds.set(groupId, nextGroupId);
      return {
        ...copy,
        id: createNativeShapeId(),
        parentId: pageId,
        x: shape.x + offset,
        y: shape.y + offset,
        props: {
          ...copy.props,
          ...(typeof copy.props.assetId === "string" && assetIds.has(copy.props.assetId)
            ? { assetId: assetIds.get(copy.props.assetId) } : {}),
          ...(nextGroupId ? { mokiGroupId: nextGroupId } : {}),
        },
      };
    });
    if (copies.some(shape => !Number.isFinite(shape.x) || !Number.isFinite(shape.y))) return [];
    this.store.mutate(snapshot => {
      for (const asset of assetsToAdd) snapshot.document.store[asset.id] = asset;
      const current = records(snapshot);
      for (const copy of copies) {
        const shape: NativeWhiteboardShape = {
          ...copy,
          typeName: "shape",
          index: nextNativeIndex(current, pageId),
          isLocked: false,
          props: { ...copy.props },
          meta: {},
        };
        snapshot.document.store[shape.id] = shape;
        current.push(shape);
      }
      touchPageEdited(snapshot, pageId);
    });
    const ids = copies.map((shape) => shape.id);
    this.select(...ids);
    return ids;
  }

  pasteLink(url: string, point?: NativePoint): string | undefined {
    const normalizedUrl = normalizeWhiteboardLinkUrl(url);
    if (!normalizedUrl) return undefined;
    const center = point ?? this.getViewportPageBounds().center;
    const id = createNativeShapeId();
    this.createShapes([{
      id,
      type: "link",
      x: center.x - 180,
      y: center.y - 41,
      props: {
        url: normalizedUrl,
        title: whiteboardLinkTitle(normalizedUrl),
        titleAuto: true,
        mode: "link",
        w: 360,
        h: 82,
        scale: 1,
      },
    }]);
    this.select(id);
    return id;
  }

  select(...ids: string[]): void {
    const currentShapes = shapes(this.store.snapshot);
    const selectedIds = [...new Set(ids.flatMap((id) => {
      const shape = this.getShape(id);
      if (!shape) return [];
      const groupId = nativeGroupId(shape);
      if (!groupId || shape.type === "group-folder") return [id];
      return currentShapes
        .filter((candidate) => nativeGroupId(candidate) === groupId && !isCollapsedGroupMember(candidate) && candidate.type !== "group-folder")
        .map((candidate) => candidate.id);
    }))];
    this.selected = new Set(selectedIds);
    if (selectedIds.length > 0) {
      const currentTopIds = currentShapes
        .slice(-selectedIds.length)
        .map((shape) => shape.id);
      const alreadyOnTop = currentTopIds.every((id, index) => id === selectedIds[index]);
      if (!alreadyOnTop) {
        this.store.mutateWithoutHistory((snapshot) => {
          const current = records(snapshot);
          for (const id of selectedIds) {
            const shape = snapshot.document.store[id];
            if (!isNativeShape(shape)) continue;
            shape.index = nextNativeIndex(current, shape.parentId);
          }
        });
      }
    }
    this.refresh?.();
  }

  selectGroupMemberForEditing(id: string): boolean {
    const shape = this.getShape(id);
    if (
      !shape ||
      shape.type === "group-folder" ||
      isCollapsedGroupMember(shape) ||
      !nativeGroupId(shape)
    ) {
      return false;
    }
    this.selected = new Set([id]);
    this.refresh?.();
    return true;
  }

  setSelection(ids: string[]): void {
    this.select(...ids);
  }

  groupSelectedShapes(): string | undefined {
    const members = this.getSelectedShapeIds()
      .map((id) => this.getShape(id))
      .filter((shape): shape is NativeWhiteboardShape => Boolean(shape && shape.type !== "group-folder"));
    if (members.length < 2) return undefined;
    const groupId = `group:${createNativeId("shape").slice(6)}`;
    this.updateShapes(members.map((shape) => ({
      id: shape.id,
      props: { mokiGroupId: groupId, mokiGroupCollapsed: false },
    })));
    this.select(...members.map((shape) => shape.id));
    return groupId;
  }

  ungroupSelectedShapes(): boolean {
    const selected = this.getSelectedShapeIds().map((id) => this.getShape(id));
    const groupIds = new Set(selected.map(nativeGroupId).filter((id): id is string => Boolean(id)));
    if (groupIds.size === 0) return false;
    const members = shapes(this.store.snapshot).filter((shape) => {
      const groupId = nativeGroupId(shape);
      return Boolean(groupId && groupIds.has(groupId));
    });
    this.store.mutate((snapshot) => {
      const editedPages = new Set<string>();
      for (const member of members) {
        const shape = snapshot.document.store[member.id];
        if (!isNativeShape(shape)) continue;
        editedPages.add(shape.parentId);
        if (shape.type === "group-folder") {
          delete snapshot.document.store[shape.id];
          continue;
        }
        const {
          mokiGroupId: _groupId,
          mokiGroupCollapsed: _collapsed,
          mokiGroupLabel: _label,
          mokiGroupDescription: _description,
          mokiGroupColor: _color,
          ...props
        } = shape.props;
        shape.props = props;
      }
      for (const pageId of editedPages) touchPageEdited(snapshot, pageId);
    });
    this.selected = new Set(members.filter((shape) => shape.type !== "group-folder").map((shape) => shape.id));
    this.refresh?.();
    return true;
  }

  collapseSelectedGroup(): string | undefined {
    const selected = this.getSelectedShapeIds().map((id) => this.getShape(id)).filter((shape): shape is NativeWhiteboardShape => Boolean(shape));
    const groupId = selected.length > 0 ? nativeGroupId(selected[0]) : undefined;
    if (!groupId || !selected.every((shape) => nativeGroupId(shape) === groupId)) return undefined;
    const members = shapes(this.store.snapshot).filter((shape) => nativeGroupId(shape) === groupId && shape.type !== "group-folder");
    if (members.length < 2) return undefined;
    const bounds = selectionBounds(members);
    if (!bounds) return undefined;
    const storedLabel = members.find((shape) => (
      typeof shape.props.mokiGroupLabel === "string" && shape.props.mokiGroupLabel.trim()
    ))?.props.mokiGroupLabel;
    const storedDescription = members.find((shape) => (
      typeof shape.props.mokiGroupDescription === "string"
    ))?.props.mokiGroupDescription;
    const storedColor = members.find((shape) => typeof shape.props.mokiGroupColor === "string")?.props.mokiGroupColor;
    const folderId = createNativeShapeId();
    this.store.mutate((snapshot) => {
      for (const member of members) {
        const shape = snapshot.document.store[member.id];
        if (isNativeShape(shape)) shape.props = { ...shape.props, mokiGroupCollapsed: true };
      }
      snapshot.document.store[folderId] = {
        id: folderId,
        typeName: "shape",
        type: "group-folder",
        x: bounds.center.x - 120,
        y: bounds.center.y - 90,
        parentId: members[0]!.parentId,
        index: nextNativeIndex(records(snapshot), members[0]!.parentId),
        rotation: 0,
        opacity: 1,
        props: {
          w: 240,
          h: 180,
          mokiGroupId: groupId,
          groupLabel: typeof storedLabel === "string" ? storedLabel : "新空间",
          groupDescription: typeof storedDescription === "string"
            ? storedDescription
            : "把相关想法放在一起",
          groupColor: typeof storedColor === "string" ? storedColor : "#776bd8",
          groupOriginX: bounds.center.x - 120,
          groupOriginY: bounds.center.y - 90,
        },
      } satisfies NativeWhiteboardShape;
      touchPageEdited(snapshot, members[0]!.parentId);
    });
    this.selected = new Set([folderId]);
    this.refresh?.();
    return folderId;
  }

  expandGroupFolder(folderId: string): string[] {
    const folder = this.getShape(folderId);
    const groupId = nativeGroupId(folder);
    if (!folder || folder.type !== "group-folder" || !groupId) return [];
    const memberIds = shapes(this.store.snapshot)
      .filter((shape) => nativeGroupId(shape) === groupId && shape.type !== "group-folder")
      .map((shape) => shape.id);
    const originX = Number(folder.props.groupOriginX);
    const originY = Number(folder.props.groupOriginY);
    const dx = Number.isFinite(originX) ? folder.x - originX : 0;
    const dy = Number.isFinite(originY) ? folder.y - originY : 0;
    const groupLabel = String(folder.props.groupLabel ?? "新空间");
    const groupDescription = String(folder.props.groupDescription ?? "把相关想法放在一起");
    const groupColor = String(folder.props.groupColor ?? "#776bd8");
    this.store.mutate((snapshot) => {
      delete snapshot.document.store[folderId];
      for (const id of memberIds) {
        const shape = snapshot.document.store[id];
        if (!isNativeShape(shape)) continue;
        shape.x += dx;
        shape.y += dy;
        shape.props = {
          ...shape.props,
          mokiGroupCollapsed: false,
          mokiGroupLabel: groupLabel,
          mokiGroupDescription: groupDescription,
          mokiGroupColor: groupColor,
        };
      }
      touchPageEdited(snapshot, folder.parentId);
    });
    this.selected = new Set(memberIds);
    this.refresh?.();
    return memberIds;
  }

  renameGroupFolder(folderId: string, name: string): boolean {
    const nextName = name.trim();
    const folder = this.getShape(folderId);
    if (!nextName || folder?.type !== "group-folder") return false;
    if (folder.props.groupLabel === nextName) return true;
    this.store.mutate((snapshot) => {
      const current = snapshot.document.store[folderId];
      if (!isNativeShape(current) || current.type !== "group-folder") return;
      current.props = { ...current.props, groupLabel: nextName };
      touchPageEdited(snapshot, current.parentId);
    });
    this.refresh?.();
    return true;
  }

  updateGroupFolderDescription(folderId: string, description: string): boolean {
    const nextDescription = description.trim();
    const folder = this.getShape(folderId);
    if (folder?.type !== "group-folder") return false;
    if (folder.props.groupDescription === nextDescription) return true;
    this.store.mutate((snapshot) => {
      const current = snapshot.document.store[folderId];
      if (!isNativeShape(current) || current.type !== "group-folder") return;
      current.props = { ...current.props, groupDescription: nextDescription };
      touchPageEdited(snapshot, current.parentId);
    });
    this.refresh?.();
    return true;
  }

  setGroupFolderColor(folderId: string, color: string): boolean {
    const folder = this.getShape(folderId);
    if (folder?.type !== "group-folder" || !/^#[0-9a-f]{6}$/iu.test(color)) return false;
    this.store.mutate((snapshot) => {
      const current = snapshot.document.store[folderId];
      if (!isNativeShape(current) || current.type !== "group-folder") return;
      current.props = { ...current.props, groupColor: color };
      touchPageEdited(snapshot, current.parentId);
    });
    this.refresh?.();
    return true;
  }

  addMindMapChild(parentId: string, center?: NativePoint): string | undefined {
    const result: { created?: NonNullable<ReturnType<typeof addMindMapChild>> } = {};
    this.store.mutate((snapshot) => {
      const created = addMindMapChild(snapshot, parentId, center ? { center } : {});
      if (created) {
        result.created = created;
        touchPageEdited(snapshot, this.getCurrentPageId());
      }
    });
    const created = result.created;
    if (!created) return undefined;
    this.selected = new Set([created.nodeId]);
    this.revealShape(created.nodeId);
    this.refresh?.();
    return created.nodeId;
  }

  revealShape(id: string): void {
    const bounds = this.getShapePageBounds(id);
    if (!bounds) return;
    const viewport = this.getViewportPageBounds();
    const inset = 48 / this.viewport.zoom;
    if (
      bounds.x >= viewport.x + inset
      && bounds.y >= viewport.y + inset
      && bounds.x + bounds.w <= viewport.x + viewport.w - inset
      && bounds.y + bounds.h <= viewport.y + viewport.h - inset
    ) return;
    let x = viewport.x;
    let y = viewport.y;
    if (bounds.x < viewport.x + inset) x = bounds.x - inset;
    else if (bounds.x + bounds.w > viewport.x + viewport.w - inset) {
      x = bounds.x + bounds.w - viewport.w + inset;
    }
    if (bounds.y < viewport.y + inset) y = bounds.y - inset;
    else if (bounds.y + bounds.h > viewport.y + viewport.h - inset) {
      y = bounds.y + bounds.h - viewport.h + inset;
    }
    const camera = {
      x,
      y,
      zoom: this.viewport.zoom,
    };
    this.setViewport(camera);
    this.cameraChange?.(camera);
    this.refresh?.();
  }

  addMindMapSibling(nodeId: string): string | undefined {
    const node = this.getShape(nodeId);
    const parentId = mindMapParentId(node);
    return parentId ? this.addMindMapChild(parentId) : undefined;
  }

  promoteMindMapNode(nodeId: string): boolean {
    let promoted = false;
    this.store.mutate((snapshot) => {
      promoted = promoteMindMapNode(snapshot, nodeId);
      if (promoted) touchPageEdited(snapshot, this.getCurrentPageId());
    });
    if (promoted) {
      this.selected = new Set([nodeId]);
      this.refresh?.();
    }
    return promoted;
  }

  canPromoteMindMapNode(nodeId: string): boolean {
    const node = this.getShape(nodeId);
    const parentId = mindMapParentId(node);
    const parent = parentId ? this.getShape(parentId) : undefined;
    return Boolean(mindMapParentId(parent));
  }

  toggleMindMapBranch(nodeId: string): boolean {
    let toggled = false;
    this.store.mutate((snapshot) => {
      toggled = toggleMindMapBranch(snapshot, nodeId);
      if (toggled) touchPageEdited(snapshot, this.getCurrentPageId());
    });
    if (toggled) {
      this.selected = new Set([nodeId]);
      this.refresh?.();
    }
    return toggled;
  }

  reparentMindMapNode(
    nodeId: string,
    parentId: string,
    options: { finalize?: boolean } = {},
  ): boolean {
    let moved = false;
    const change = (snapshot: WhiteboardSnapshot) => {
      moved = reparentMindMapNode(snapshot, nodeId, parentId);
      if (moved) touchPageEdited(snapshot, this.getCurrentPageId());
    };
    if (options.finalize === false) this.store.mutate(change, "document", false);
    else this.store.mutate(change);
    if (moved) {
      this.selected = new Set([nodeId]);
      this.refresh?.();
    }
    return moved;
  }

  mindMapHasChildren(nodeId: string): boolean {
    return mindMapChildren(this.store.snapshot, nodeId).length > 0;
  }

  createShapes(input: Array<Partial<NativeWhiteboardShape> & { type: string }>): void {
    const pageId = this.getCurrentPageId();
    this.store.mutate((snapshot) => {
      const current = records(snapshot);
      const editedPages = new Set<string>();
      for (const item of input) {
        const id = typeof item.id === "string" ? item.id : createNativeShapeId();
        const shape: NativeWhiteboardShape = {
          id,
          typeName: "shape",
          type: item.type,
          x: typeof item.x === "number" ? item.x : 0,
          y: typeof item.y === "number" ? item.y : 0,
          parentId: typeof item.parentId === "string" ? item.parentId : pageId,
          index: typeof item.index === "string" ? item.index : nextNativeIndex(current, pageId),
          rotation: typeof item.rotation === "number" ? item.rotation : 0,
          opacity: typeof item.opacity === "number" ? item.opacity : 1,
          isLocked: false,
          props: { ...(item.props ?? {}) },
          meta: {},
        };
        snapshot.document.store[id] = shape;
        current.push(shape);
        editedPages.add(shape.parentId);
      }
      for (const editedPageId of editedPages) touchPageEdited(snapshot, editedPageId);
    });
  }

  updateShapes(
    input: Array<Partial<NativeWhiteboardShape> & { id: string }>,
    options: { history?: boolean } = {},
  ): void {
    const mutate = options.history === false
      ? this.store.mutateWithoutHistory.bind(this.store)
      : this.store.mutate.bind(this.store);
    mutate((snapshot) => {
      const editedPages = new Set<string>();
      for (const update of input) {
        const current = snapshot.document.store[update.id];
        if (!isNativeShape(current)) continue;
        editedPages.add(current.parentId);
        snapshot.document.store[update.id] = {
          ...current,
          ...update,
          props: update.props ? { ...current.props, ...update.props } : current.props,
        } as NativeWhiteboardShape;
      }
      for (const editedPageId of editedPages) touchPageEdited(snapshot, editedPageId);
    });
  }

  renameMaterial(shapeId: string, name: string): boolean {
    const nextName = name.trim();
    const shape = this.getShape(shapeId);
    if (
      !nextName
      || !shape
      || !["image", "link", "resource", "media"].includes(shape.type)
    ) return false;
    this.store.mutate((snapshot) => {
      const current = snapshot.document.store[shapeId];
      if (!isNativeShape(current)) return;
      const property = current.type === "image"
        ? "altText"
        : current.type === "link"
          ? "title"
          : "name";
      current.props = { ...current.props, [property]: nextName };
      if (
        (current.type === "image" || current.type === "media")
        && typeof current.props.assetId === "string"
      ) {
        const asset = snapshot.document.store[current.props.assetId];
        if (asset?.typeName === "asset") {
          asset.props = { ...(asset.props ?? {}), name: nextName };
        }
      }
      touchPageEdited(snapshot, current.parentId);
    });
    this.refresh?.();
    return true;
  }

  deleteShapes(ids: Iterable<string>): void {
    const removing = new Set(ids);
    for (const id of [...removing]) {
      const shape = this.getShape(id);
      if (!isMindMapNode(shape)) continue;
      for (const descendantId of mindMapDescendantIds(this.store.snapshot, id)) {
        removing.add(descendantId);
      }
    }
    for (const shape of shapes(this.store.snapshot)) {
      if (
        shape.props.mokiMindMapEdge === true
        && (
          removing.has(String(shape.props.mokiMindMapFromId ?? ""))
          || removing.has(String(shape.props.mokiMindMapToId ?? ""))
        )
      ) removing.add(shape.id);
    }
    this.store.mutate((snapshot) => {
      const editedPages = new Set([...removing].flatMap((id) => {
        const shape = snapshot.document.store[id];
        return isNativeShape(shape) ? [shape.parentId] : [];
      }));
      for (const id of removing) delete snapshot.document.store[id];
      for (const record of Object.values(snapshot.document.store)) {
        if (record.typeName !== "binding") continue;
        if (removing.has(String(record.fromId)) || removing.has(String(record.toId))) {
          delete snapshot.document.store[record.id];
        }
      }
      for (const editedPageId of editedPages) touchPageEdited(snapshot, editedPageId);
    });
    for (const id of removing) this.selected.delete(id);
  }

  setCurrentTool(tool: string): void {
    this.currentTool = tool;
  }

  getCurrentTool(): string {
    return this.currentTool;
  }

  setStyleForNextShapes(_style: unknown, geo: NativeGeoShape): void {
    this.nextGeo = geo;
  }

  getNextGeo(): NativeGeoShape {
    return this.nextGeo;
  }

  updateInstanceState(_value: unknown): void {}
  markHistoryStoppingPoint(_label?: string): void {}
  undo(): boolean { return this.store.undo(); }
  redo(): boolean { return this.store.redo(); }
  canUndo(): boolean { return this.store.canUndo(); }
  canRedo(): boolean { return this.store.canRedo(); }
  getShapeUtil(_type: string): NativeNoteShapeUtil {
    return { options: { resizeMode: "scale" } };
  }

  async putExternalContent(content: {
    type?: string;
    files: File[];
    point?: NativePoint;
    localPaths?: Array<string | undefined>;
  }, _options?: unknown): Promise<void> {
    const point = content.point ?? this.getViewportPageBounds().center;
    let offset = 0;
    for (const [fileIndex, file] of content.files.entries()) {
      const mediaKind = nativeMediaKind(file);
      if (mediaKind) {
        const record = await uploadMediaAsset(file);
        const assetId = createNativeId("asset");
        const width = mediaKind === "video" ? 640 : 440;
        const height = mediaKind === "video" ? 360 : 116;
        const pageId = this.getCurrentPageId();
        const id = createNativeShapeId();
        this.store.mutate((snapshot) => {
          snapshot.document.store[assetId] = {
            id: assetId,
            typeName: "asset",
            type: "media",
            props: { ...record, name: file.name, mediaKind },
            meta: {},
          };
          snapshot.document.store[id] = {
            id,
            typeName: "shape",
            type: "media",
            x: point.x - width / 2 + offset,
            y: point.y - height / 2 + offset,
            parentId: pageId,
            index: nextNativeIndex(records(snapshot), pageId),
            rotation: 0,
            opacity: 1,
            props: {
              w: width,
              h: height,
              assetId,
              mediaKind,
              name: file.name,
              ...(content.localPaths?.[fileIndex]
                ? { localPath: content.localPaths[fileIndex] }
                : {}),
            },
            meta: {},
          };
          touchPageEdited(snapshot, pageId);
        });
        this.select(id);
        offset += 28;
        continue;
      }
      const asset = await uploadImageAsset(file);
      if (asset.previewImage) {
        this.cachePreviewImageHandler?.(asset.record.src, asset.previewImage);
      }
      const assetId = createNativeId("asset");
      const maxDisplay = 720;
      const displayScale = Math.min(1, maxDisplay / Math.max(asset.record.width, asset.record.height));
      const width = Math.max(80, Math.round(asset.record.width * displayScale));
      const height = Math.max(80, Math.round(asset.record.height * displayScale));
      const pageId = this.getCurrentPageId();
      const id = createNativeShapeId();
      this.store.mutate((snapshot) => {
        snapshot.document.store[assetId] = {
          id: assetId,
          typeName: "asset",
          type: "image",
          props: {
            ...asset.record,
            name: file.name,
            isAnimated: file.type === "image/gif" || file.name.toLowerCase().endsWith(".gif"),
          },
          meta: {},
        };
        snapshot.document.store[id] = {
          id,
          typeName: "shape",
          type: "image",
          x: point.x - width / 2 + offset,
          y: point.y - height / 2 + offset,
          parentId: pageId,
          index: nextNativeIndex(records(snapshot), pageId),
          rotation: 0,
          opacity: 1,
          props: {
            w: width,
            h: height,
            assetId,
            altText: file.name,
            ...(content.localPaths?.[fileIndex]
              ? { localPath: content.localPaths[fileIndex] }
              : {}),
          },
          meta: {},
        };
        touchPageEdited(snapshot, pageId);
      });
      this.select(id);
      offset += 28;
    }
  }

  setCurrentPage(id: string): void {
    if (this.store.snapshot.document.store[id]?.typeName !== "page") return;
    this.store.mutate((snapshot) => {
      snapshot.session = { ...(snapshot.session && typeof snapshot.session === "object" ? snapshot.session : {}), currentPageId: id };
    }, "session");
    this.selected.clear();
    this.fitCurrentPage();
  }

  createPage(): string {
    const id = createNativeId("page");
    const pageCount = whiteboardPages(this.store.snapshot).length;
    this.store.mutate((snapshot) => {
      snapshot.document.store[id] = {
        id,
        typeName: "page",
        name: `页面 ${pageCount + 1}`,
        index: `a${String(pageCount + 1).padStart(8, "0")}`,
        updatedAt: new Date().toISOString(),
        meta: {},
      };
      snapshot.session = { ...(snapshot.session && typeof snapshot.session === "object" ? snapshot.session : {}), currentPageId: id };
    });
    return id;
  }

  renamePage(id: string, name: string): boolean {
    const nextName = name.trim();
    const page = this.store.snapshot.document.store[id];
    if (!nextName || page?.typeName !== "page") return false;
    if (page.name === nextName) return true;
    this.store.mutate((snapshot) => {
      snapshot.document.store[id] = {
        ...snapshot.document.store[id]!,
        name: nextName,
        updatedAt: new Date().toISOString(),
      };
    });
    return true;
  }

  createPageGroup(pageId = this.getCurrentPageId(), name = "新分组"): string | undefined {
    const page = this.store.snapshot.document.store[pageId];
    if (page?.typeName !== "page") return undefined;
    const random = globalThis.crypto?.randomUUID?.() ??
      `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    const id = `page-group:${random}`;
    this.store.mutate((snapshot) => {
      const current = snapshot.document.store[pageId];
      if (!current) return;
      const groupName = name.trim() || "新分组";
      const groupCount = records(snapshot).filter(isPageGroupRecord).length;
      snapshot.document.store[id] = {
        id,
        typeName: "page_group",
        name: groupName,
        index: `a${String(groupCount + 1).padStart(8, "0")}`,
        meta: {},
      };
      // Preserve the existing group when the active page is already grouped.
      // A standalone record lets the newly created group remain empty until a
      // page is dragged into it, matching the assistant's grouping behavior.
      if (!pageGroupId(current)) {
        snapshot.document.store[pageId] = {
          ...current,
          meta: {
            ...recordMeta(current),
            mokiPageGroupId: id,
            mokiPageGroupName: groupName,
          },
        };
      }
    });
    return id;
  }

  movePageGroup(id: string, targetId: string, position: "before" | "after" = "before"): boolean {
    if (id === targetId) return false;
    const ordered = whiteboardPageGroups(this.store.snapshot);
    const source = ordered.find((group) => group.id === id);
    if (!source || !ordered.some((group) => group.id === targetId)) return false;
    const next = ordered.filter((group) => group.id !== id);
    const targetIndex = next.findIndex((group) => group.id === targetId);
    next.splice(targetIndex + (position === "after" ? 1 : 0), 0, source);
    if (next.every((group, index) => group.id === ordered[index]?.id)) return false;
    this.store.mutate((snapshot) => {
      next.forEach((group, index) => {
        snapshot.document.store[group.id] = {
          ...(snapshot.document.store[group.id] ?? { id: group.id, typeName: "page_group", name: group.name, meta: {} }),
          index: `a${String(index + 1).padStart(8, "0")}`,
        };
      });
    });
    return true;
  }

  movePageToGroup(pageId: string, groupId?: string): boolean {
    const page = this.store.snapshot.document.store[pageId];
    if (page?.typeName !== "page") return false;
    const group = groupId
      ? whiteboardPageGroups(this.store.snapshot).find((item) => item.id === groupId)
      : undefined;
    if (groupId && !group) return false;
    if (pageGroupId(page) === groupId) return false;
    this.store.mutate((snapshot) => {
      const current = snapshot.document.store[pageId];
      if (!current) return;
      const meta = { ...recordMeta(current) };
      delete meta.mokiPageGroupId;
      delete meta.mokiPageGroupName;
      if (group) {
        meta.mokiPageGroupId = group.id;
        meta.mokiPageGroupName = group.name;
      }
      snapshot.document.store[pageId] = { ...current, meta };
    });
    return true;
  }

  renamePageGroup(groupId: string, name: string): boolean {
    const nextName = name.trim();
    const group = whiteboardPageGroups(this.store.snapshot).find((item) => item.id === groupId);
    if (!group || !nextName) return false;
    this.store.mutate((snapshot) => {
      const groupRecord = snapshot.document.store[groupId];
      snapshot.document.store[groupId] = groupRecord && isPageGroupRecord(groupRecord)
        ? { ...groupRecord, name: nextName }
        : {
            id: groupId,
            typeName: "page_group",
            name: nextName,
            index: `a${String(records(snapshot).filter(isPageGroupRecord).length + 1).padStart(8, "0")}`,
            meta: {},
          };
      for (const page of group.pages) {
        const current = snapshot.document.store[page.id];
        if (!current) continue;
        snapshot.document.store[page.id] = {
          ...current,
          meta: { ...recordMeta(current), mokiPageGroupName: nextName },
        };
      }
    });
    return true;
  }

  deletePageGroup(groupId: string): boolean {
    const group = whiteboardPageGroups(this.store.snapshot).find((item) => item.id === groupId);
    if (!group) return false;
    this.store.mutate((snapshot) => {
      delete snapshot.document.store[groupId];
      for (const page of group.pages) {
        const current = snapshot.document.store[page.id];
        if (!current) continue;
        const meta = { ...recordMeta(current) };
        delete meta.mokiPageGroupId;
        delete meta.mokiPageGroupName;
        snapshot.document.store[page.id] = { ...current, meta };
      }
    });
    return true;
  }

  movePage(id: string, targetId: string, position: "before" | "after" = "before"): boolean {
    if (id === targetId) return false;
    const ordered = whiteboardPages(this.store.snapshot);
    const source = ordered.find((page) => page.id === id);
    const target = ordered.find((page) => page.id === targetId);
    if (!source || !target) return false;
    const withoutSource = ordered.filter((page) => page.id !== id);
    const targetIndex = withoutSource.findIndex((page) => page.id === targetId);
    withoutSource.splice(targetIndex + (position === "after" ? 1 : 0), 0, source);
    if (withoutSource.every((page, index) => page.id === ordered[index]?.id)) return false;
    this.store.mutate((snapshot) => {
      withoutSource.forEach((page, index) => {
        snapshot.document.store[page.id] = {
          ...snapshot.document.store[page.id]!,
          index: `a${String(index + 1).padStart(8, "0")}`,
        };
      });
    });
    return true;
  }

  deletePage(page: string | { id?: string }): void {
    const id = typeof page === "string" ? page : page.id;
    if (!id) return;
    const pages = whiteboardPages(this.store.snapshot);
    if (pages.length <= 1) return;
    const currentPageId = this.getCurrentPageId();
    const pageIndex = pages.findIndex((item) => item.id === id);
    if (pageIndex < 0) return;
    const next = currentPageId === id
      ? pages[pageIndex + 1]?.id ?? pages[pageIndex - 1]?.id
      : currentPageId;
    this.store.mutate((snapshot) => {
      const remove = new Set([id]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const record of Object.values(snapshot.document.store)) {
          if (typeof record.parentId === "string" && remove.has(record.parentId) && !remove.has(record.id)) {
            remove.add(record.id);
            changed = true;
          }
        }
      }
      for (const recordId of remove) delete snapshot.document.store[recordId];
      snapshot.session = { ...(snapshot.session && typeof snapshot.session === "object" ? snapshot.session : {}), currentPageId: next };
    });
  }

  zoomToSelection(_options?: unknown): void {
    const selected = this.getSelectedShapeIds().map((id) => this.getShapePageBounds(id)).filter(Boolean) as NativeBounds[];
    this.zoomToBounds(selected, 2.5);
  }

  fitCurrentPage(): void {
    const bounds = visibleShapes(this.store.snapshot).map((shape) => nativeShapeVisualBounds(shape));
    this.zoomToBounds(bounds, 1);
  }

  private zoomToBounds(selected: NativeBounds[], maximumZoom: number): void {
    if (!selected.length) {
      const camera = { x: 0, y: 0, zoom: 1 };
      this.setViewport(camera);
      this.cameraChange?.(camera);
      return;
    }
    const left = Math.min(...selected.map((box) => box.x));
    const top = Math.min(...selected.map((box) => box.y));
    const right = Math.max(...selected.map((box) => box.x + box.w));
    const bottom = Math.max(...selected.map((box) => box.y + box.h));
    const width = Math.max(80, right - left);
    const height = Math.max(80, bottom - top);
    const zoom = clampWhiteboardZoom(Math.min(maximumZoom, this.viewport.width / (width + 160), this.viewport.height / (height + 160)));
    const camera = { x: (left + right) / 2 - this.viewport.width / zoom / 2, y: (top + bottom) / 2 - this.viewport.height / zoom / 2, zoom };
    this.setViewport(camera);
    this.cameraChange?.(camera);
    this.refresh?.();
  }
}

const COLORS = Object.fromEntries(
  NATIVE_COLOR_OPTIONS.map((option) => [option.value, option.hex]),
) as Record<NativeCanvasColor, string>;
export function nativeCanvasThemePalette(dark: boolean) {
  return dark
    ? {
        background: "#151a28",
        grid: "rgba(151,160,194,.2)",
        ink: "#e8eaf4",
        minimapBackground: "rgba(28,33,49,.97)",
      }
    : {
        background: "#fafbfe",
        grid: "rgba(126,132,158,.18)",
        ink: COLORS.black,
        minimapBackground: "rgba(255,255,255,.97)",
      };
}

export function drawNativeCanvasTextLine(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  fontSize: number,
  italic: boolean,
): void {
  if (!italic) {
    context.fillText(text, x, y, maxWidth);
    return;
  }

  // Canvas font synthesis is inconsistent for CJK system fonts. Apply a
  // deterministic shear around the baseline so italic remains visible while
  // keeping the text anchor and wrapping measurements stable.
  context.save();
  context.translate(x, y + fontSize);
  context.transform(1, 0, -0.2, 1, 0, 0);
  context.fillText(text, 0, -fontSize, maxWidth);
  context.restore();
}

export function nativeCanvasSelectionPalette(dark: boolean) {
  return dark
    ? {
        stroke: "#aaa4ff",
        handleFill: "#242a3c",
        marqueeFill: "rgba(170,164,255,.16)",
      }
    : {
        stroke: "#625bc5",
        handleFill: "#ffffff",
        marqueeFill: "rgba(98,91,197,.09)",
      };
}

function nativeCanvasDisplayColor(color: NativeCanvasColor, dark: boolean): string {
  return dark && color === "black" ? nativeCanvasThemePalette(true).ink : COLORS[color];
}
const NOTE_COLORS: Record<string, string> = {
  yellow: "#fff1a8", orange: "#ffd2a1", green: "#c9f0d7", blue: "#cfe4ff",
  "light-blue": "#dceeff", "light-red": "#ffdce7",
  violet: "#e4d8ff", red: "#ffd1d8", grey: "#e8e9ee",
};

export function NativeTextFormattingControls({
  labelPrefix,
  sizeLabelPrefix = labelPrefix,
  style,
  color,
  colorMenuOpen,
  colorMenuSide = "bottom",
  onStyleChange,
  onColorChange,
  onColorMenuToggle,
}: {
  labelPrefix: string;
  sizeLabelPrefix?: string;
  style: NativeTextStyle;
  color: NativeCanvasColor;
  colorMenuOpen: boolean;
  colorMenuSide?: "top" | "bottom";
  onStyleChange: (patch: Partial<NativeTextStyle>) => void;
  onColorChange: (color: NativeCanvasColor) => void;
  onColorMenuToggle: () => void;
}) {
  return (
    <div className="native-whiteboard-text-toolbar flex items-center gap-1">
      <div className="native-whiteboard-text-sizes flex items-center gap-1 rounded-xl bg-[#f4f5f8] p-1">
        {(["s", "m", "l", "xl"] as const).map((size) => (
          <button
            type="button"
            key={size}
            aria-label={`${sizeLabelPrefix}字号 ${size.toUpperCase()}`}
            aria-pressed={style.size === size}
            onClick={() => onStyleChange({ size })}
            className={`native-whiteboard-text-control h-7 min-w-8 rounded-lg px-2 text-[0.6875rem] font-black transition ${style.size === size ? "bg-white text-[#625bc5] shadow-sm" : "text-[#73798b] hover:text-[#30364d]"}`}
          >
            {size.toUpperCase()}
          </button>
        ))}
      </div>
      <div className="native-whiteboard-text-toolbar-group flex items-center gap-0.5 border-l border-[#e2e4ed] pl-1">
        <button type="button" aria-label={`${labelPrefix}加粗`} aria-pressed={style.bold} onClick={() => onStyleChange({ bold: !style.bold })} className={`native-whiteboard-text-control grid size-8 place-items-center rounded-lg ${style.bold ? "bg-[#ebeafd] text-[#625bc5]" : "hover:bg-[#f4f5f8]"}`}><Bold size={14} /></button>
        <button type="button" aria-label={`${labelPrefix}倾斜`} aria-pressed={style.italic} onClick={() => onStyleChange({ italic: !style.italic })} className={`native-whiteboard-text-control grid size-8 place-items-center rounded-lg ${style.italic ? "bg-[#ebeafd] text-[#625bc5]" : "hover:bg-[#f4f5f8]"}`}><Italic size={14} /></button>
        <button type="button" aria-label={`${labelPrefix}下划线`} aria-pressed={style.underline} onClick={() => onStyleChange({ underline: !style.underline })} className={`native-whiteboard-text-control grid size-8 place-items-center rounded-lg ${style.underline ? "bg-[#ebeafd] text-[#625bc5]" : "hover:bg-[#f4f5f8]"}`}><Underline size={14} /></button>
        {([
          { value: "start", label: `${labelPrefix}左对齐`, icon: AlignLeft },
          { value: "middle", label: `${labelPrefix}居中`, icon: AlignCenter },
          { value: "end", label: `${labelPrefix}右对齐`, icon: AlignRight },
        ] as const).map(({ value, label, icon: Icon }) => (
          <button
            type="button"
            key={value}
            aria-label={label}
            aria-pressed={style.textAlign === value}
            onClick={() => onStyleChange({ textAlign: value })}
            className={`native-whiteboard-text-control grid size-8 place-items-center rounded-lg ${style.textAlign === value ? "bg-[#ebeafd] text-[#625bc5]" : "hover:bg-[#f4f5f8]"}`}
          >
            <Icon size={14} />
          </button>
        ))}
      </div>
      <div className="native-whiteboard-text-toolbar-group relative border-l border-[#e2e4ed] pl-1">
        <button
          type="button"
          aria-label={`${labelPrefix}颜色`}
          aria-expanded={colorMenuOpen}
          onClick={onColorMenuToggle}
          className="native-whiteboard-text-color-trigger relative grid size-8 place-items-center rounded-lg text-[#5f6679] hover:bg-[#f4f5f8]"
        >
          <Palette size={15} aria-hidden="true" />
          <span
            aria-hidden="true"
            className="native-whiteboard-current-color absolute bottom-1 right-1 block size-2 rounded-full border border-white shadow-[0_0_0_1px_rgba(35,39,61,.32)]"
            style={{ backgroundColor: COLORS[color] }}
          />
        </button>
        {colorMenuOpen && (
          <div data-whiteboard-color-menu className={`moki-menu-surface absolute left-1/2 z-50 grid w-40 -translate-x-1/2 grid-cols-6 gap-1 p-2 ${colorMenuSide === "top" ? "bottom-full mb-2" : "top-full mt-2"}`}>
            {NATIVE_COLOR_OPTIONS.map((option) => (
              <button
                type="button"
                key={option.value}
                aria-label={`${labelPrefix}颜色 ${option.label}`}
                aria-pressed={color === option.value}
                onClick={() => onColorChange(option.value)}
                className={`native-whiteboard-color-swatch h-5 w-5 min-w-5 shrink-0 rounded-full border border-black/5 p-0 ${color === option.value ? "ring-2 ring-[#625bc5] ring-offset-1" : ""}`}
                style={{ backgroundColor: option.hex, borderRadius: "50%", width: 20, minWidth: 20, height: 20, minHeight: 20, padding: 0 }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function nativeNoteBackgroundColor(color: unknown): string {
  return NOTE_COLORS[String(color)] ?? NOTE_COLORS.yellow!;
}

export type NativeWhiteboardImageExportOptions = {
  pageId?: string;
  scope: "selection" | "canvas";
  shapeIds?: string[];
  padding?: number;
  fileName?: string;
  background?: "canvas" | "transparent";
  requireImages?: boolean;
  maxDimension?: number;
  maxPixels?: number;
};

export type NativeWhiteboardImageExportResult = {
  blob: Blob;
  fileName: string;
  width: number;
  height: number;
  shapeCount: number;
};

const NATIVE_STAR_VERTEX_RATIOS = Array.from({ length: 10 }, (_, index) => {
  const radius = index % 2 ? 11 / 24 : 1;
  const angle = -Math.PI / 2 + index * Math.PI / 5;
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
});
const NATIVE_STAR_RATIO_BOUNDS = {
  left: Math.min(...NATIVE_STAR_VERTEX_RATIOS.map((point) => point.x)),
  top: Math.min(...NATIVE_STAR_VERTEX_RATIOS.map((point) => point.y)),
  right: Math.max(...NATIVE_STAR_VERTEX_RATIOS.map((point) => point.x)),
  bottom: Math.max(...NATIVE_STAR_VERTEX_RATIOS.map((point) => point.y)),
};

export function nativeStarPoints(bounds: NativeBounds): NativePoint[] {
  const ratioWidth = NATIVE_STAR_RATIO_BOUNDS.right - NATIVE_STAR_RATIO_BOUNDS.left;
  const ratioHeight = NATIVE_STAR_RATIO_BOUNDS.bottom - NATIVE_STAR_RATIO_BOUNDS.top;
  return NATIVE_STAR_VERTEX_RATIOS.map((point) => ({
    x: bounds.x + (point.x - NATIVE_STAR_RATIO_BOUNDS.left) / ratioWidth * bounds.w,
    y: bounds.y + (point.y - NATIVE_STAR_RATIO_BOUNDS.top) / ratioHeight * bounds.h,
  }));
}

function traceGeoPath(
  context: CanvasRenderingContext2D,
  geo: string,
  bounds: NativeBounds,
): void {
  context.beginPath();
  if (geo === "ellipse") {
    context.ellipse(bounds.center.x, bounds.center.y, bounds.w / 2, bounds.h / 2, 0, 0, Math.PI * 2);
  } else if (geo === "triangle") {
    context.moveTo(bounds.center.x, bounds.y);
    context.lineTo(bounds.x + bounds.w, bounds.y + bounds.h);
    context.lineTo(bounds.x, bounds.y + bounds.h);
    context.closePath();
  } else if (geo === "diamond") {
    context.moveTo(bounds.center.x, bounds.y);
    context.lineTo(bounds.x + bounds.w, bounds.center.y);
    context.lineTo(bounds.center.x, bounds.y + bounds.h);
    context.lineTo(bounds.x, bounds.center.y);
    context.closePath();
  } else if (geo === "star") {
    nativeStarPoints(bounds).forEach((point, index) => {
      if (index) context.lineTo(point.x, point.y);
      else context.moveTo(point.x, point.y);
    });
    context.closePath();
  } else if (geo === "cloud") {
    const radius = Math.min(bounds.w, bounds.h) / 4;
    context.arc(bounds.x + radius, bounds.center.y, radius, Math.PI / 2, Math.PI * 1.5);
    context.arc(bounds.center.x, bounds.y + radius, radius * 1.15, Math.PI, 0);
    context.arc(bounds.x + bounds.w - radius, bounds.center.y, radius, -Math.PI / 2, Math.PI / 2);
    context.closePath();
  } else {
    context.roundRect(
      bounds.x,
      bounds.y,
      bounds.w,
      bounds.h,
      Math.min(18, bounds.w / 8, bounds.h / 8),
    );
  }
}

function loadExportImage(source: string): Promise<HTMLImageElement | undefined> {
  return new Promise((resolve) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => resolve(undefined);
    image.src = source;
  });
}

export async function exportNativeWhiteboardImage(
  snapshot: WhiteboardSnapshot,
  options: NativeWhiteboardImageExportOptions,
): Promise<NativeWhiteboardImageExportResult> {
  const pageId = options.pageId ?? nativePageId(snapshot);
  const available = visibleShapes(snapshot, pageId);
  const requestedIds = new Set(options.shapeIds ?? []);
  const exported = options.scope === "selection"
    ? available.filter((shape) => requestedIds.has(shape.id))
    : available;
  if (!exported.length) {
    throw new Error(options.scope === "selection" ? "请先选择要导出的白板内容。" : "当前页面没有可导出的内容。");
  }
  const boxes = exported.map(nativeShapeVisualBounds);
  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.w));
  const bottom = Math.max(...boxes.map((box) => box.y + box.h));
  const contentWidth = Math.max(1, right - left);
  const contentHeight = Math.max(1, bottom - top);
  const padding = Math.min(1_000, Math.max(0, Math.round(options.padding ?? 48)));
  const maxDimension = Math.min(16_384, Math.max(320, Math.round(options.maxDimension ?? 16_384)));
  const maxPixels = Math.min(64_000_000, Math.max(100_000, Math.round(options.maxPixels ?? 64_000_000)));
  const availableWidth = Math.max(1, maxDimension - padding * 2);
  const availableHeight = Math.max(1, maxDimension - padding * 2);
  const scale = Math.min(
    1,
    availableWidth / contentWidth,
    availableHeight / contentHeight,
    Math.sqrt(Math.max(1, maxPixels - padding * padding * 4) / (contentWidth * contentHeight)),
  );
  const width = Math.max(1, Math.ceil(contentWidth * scale + padding * 2));
  const height = Math.max(1, Math.ceil(contentHeight * scale + padding * 2));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const transparent = options.background === "transparent";
  const context = canvas.getContext("2d", { alpha: transparent });
  if (!context) throw new Error("当前设备无法生成白板图片。");
  if (!transparent) {
    context.fillStyle = "#fafbfe";
    context.fillRect(0, 0, width, height);
  }

  const loadedImages = new Map<string, HTMLImageElement>();
  await Promise.all(exported.filter((shape) => shape.type === "image").map(async (shape) => {
    const asset = imageAsset(snapshot, shape);
    const props = asset?.props && typeof asset.props === "object"
      ? asset.props as Record<string, unknown>
      : undefined;
    const source = typeof props?.src === "string" ? props.src : "";
    if (!source || loadedImages.has(source)) return;
    const image = await loadExportImage(source);
    if (image) loadedImages.set(source, image);
  }));
  if (options.requireImages) {
    const missingImage = exported.some((shape) => {
      if (shape.type !== "image") return false;
      const asset = imageAsset(snapshot, shape);
      const props = asset?.props && typeof asset.props === "object"
        ? asset.props as Record<string, unknown>
        : undefined;
      const source = typeof props?.src === "string" ? props.src : "";
      return !source || !loadedImages.has(source);
    });
    if (missingImage) throw new Error("选中的图片尚未加载完成，请稍后重试复制。");
  }

  context.save();
  context.translate(padding - left * scale, padding - top * scale);
  context.scale(scale, scale);
  for (const shape of exported) {
    const bounds = nativeShapeBounds(shape);
    const color = COLORS[String(shape.props.color) as NativeCanvasColor] ?? "#30364d";
    const shapeScale = Math.max(0.01, Math.abs(Number(shape.props.scale) || 1));
    const shapeScaleX = shapeScale * Math.max(0.01, Math.abs(Number(shape.props.scaleX) || 1));
    const shapeScaleY = shapeScale * Math.max(0.01, Math.abs(Number(shape.props.scaleY) || 1));
    const lineWidth = Math.max(1.5, (STROKE_WIDTHS[String(shape.props.size) as NativeStrokeSize] ?? 2.5) * shapeScale);
    context.save();
    context.globalAlpha = typeof shape.opacity === "number" ? shape.opacity : 1;
    context.strokeStyle = color;
    context.fillStyle = color;
    context.lineWidth = lineWidth;
    context.lineCap = "round";
    context.lineJoin = "round";
    const rotation = Number(shape.rotation) || 0;
    if (rotation) {
      context.translate(bounds.center.x, bounds.center.y);
      context.rotate(rotation * Math.PI / 180);
      context.translate(-bounds.center.x, -bounds.center.y);
    }
    if (shape.type === "bezier") {
      const anchors = nativeBezierAnchors(shape);
      if (anchors.length > 1) {
        traceNativeBezierPath(context, anchors, (point) => ({
          x: shape.x + point.x * shapeScaleX,
          y: shape.y + point.y * shapeScaleY,
        }), shape.props.isClosed === true);
        context.stroke();
      }
    } else if (shape.type === "draw") {
      const points = nativeDrawPoints(shape);
      if (points.length) {
        context.beginPath();
        context.moveTo(shape.x + points[0]!.x * shapeScaleX, shape.y + points[0]!.y * shapeScaleY);
        for (const point of points.slice(1)) context.lineTo(shape.x + point.x * shapeScaleX, shape.y + point.y * shapeScaleY);
        if (shape.props.isClosed) context.closePath();
        context.stroke();
      }
    } else if (shape.type === "arrow") {
      const start = (shape.props.start as NativePoint | undefined) ?? { x: 0, y: 0 };
      const end = (shape.props.end as NativePoint | undefined) ?? { x: Number(shape.props.w) || 160, y: Number(shape.props.h) || 100 };
      drawNativeArrow(
        context,
        { x: shape.x + start.x * shapeScaleX, y: shape.y + start.y * shapeScaleY },
        { x: shape.x + end.x * shapeScaleX, y: shape.y + end.y * shapeScaleY },
        nativeArrowStyle(shape.props.arrowStyle),
        14 * shapeScale,
        shape.props.mokiMindMapEdge === true,
      );
    } else if (shape.type === "image") {
      const asset = imageAsset(snapshot, shape);
      const props = asset?.props && typeof asset.props === "object" ? asset.props as Record<string, unknown> : undefined;
      const source = typeof props?.src === "string" ? props.src : "";
      const image = loadedImages.get(source);
      if (image) context.drawImage(image, bounds.x, bounds.y, bounds.w, bounds.h);
      else {
        context.fillStyle = "#eceef4";
        context.fillRect(bounds.x, bounds.y, bounds.w, bounds.h);
      }
    } else if (shape.type === "link") {
      drawNativeLinkCard(context, bounds, shape);
    } else if (shape.type === "resource") {
      drawNativeResourceCard(context, bounds, shape);
    } else if (shape.type === "media") {
      drawNativeMediaCard(context, bounds, shape);
    } else if (shape.type === "note") {
      context.fillStyle = nativeNoteBackgroundColor(shape.props.color);
      context.shadowColor = "rgba(40,44,66,.12)";
      context.shadowBlur = 12;
      context.shadowOffsetY = 4;
      context.fillRect(bounds.x, bounds.y, bounds.w, bounds.h);
      context.shadowColor = "transparent";
    } else if (shape.type === "geo") {
      const paint = nativeGeoPaintStyle(shape);
      traceGeoPath(context, String(shape.props.geo ?? "rectangle"), bounds);
      if (paint.fillEnabled) {
        context.globalAlpha = (typeof shape.opacity === "number" ? shape.opacity : 1) * paint.fillOpacity;
        context.fillStyle = COLORS[paint.fillColor];
        context.fill();
      }
      if (paint.strokeEnabled) {
        context.globalAlpha = (typeof shape.opacity === "number" ? shape.opacity : 1) * paint.strokeOpacity;
        context.strokeStyle = COLORS[paint.strokeColor];
        context.stroke();
      }
      context.globalAlpha = typeof shape.opacity === "number" ? shape.opacity : 1;
    }
    const text = nativeRichTextValue(shape.props.richText);
    if (text && ["note", "text", "geo"].includes(shape.type)) {
      const size = ({ s: 14, m: 18, l: 24, xl: 32 } as Record<string, number>)[String(shape.props.size)] ?? 18;
      const fontSize = Math.max(12, size * Number(shape.props.scale || 1));
      const align = String(shape.props.textAlign ?? shape.props.align ?? "start");
      const textColor = shape.type === "note"
        ? COLORS[String(shape.props.labelColor ?? "black") as NativeCanvasColor] ?? COLORS.black
        : color;
      context.fillStyle = textColor;
      context.strokeStyle = textColor;
      context.font = `${shape.props.bold === true ? "700 " : "400 "}${fontSize}px system-ui, sans-serif`;
      context.textBaseline = "top";
      context.textAlign = align === "middle" ? "center" : align === "end" ? "right" : "left";
      const textX = align === "middle" ? bounds.center.x : align === "end" ? bounds.x + bounds.w - 16 : bounds.x + 16;
      const maxWidth = Math.max(20, bounds.w - 32);
      const lineHeight = fontSize * 1.35;
      const maxLines = shape.type === "note"
        ? Math.max(1, Math.floor((bounds.h - 32) / lineHeight))
        : 20;
      const lines = wrapNativeCanvasText(context, text, maxWidth, maxLines);
      let y = nativeCanvasTextStartY(
        bounds,
        fontSize,
        lineHeight,
        lines.length,
        shape.type === "geo" && isMindMapNode(shape),
      );
      if (shape.type === "note") {
        context.save();
        context.beginPath();
        context.rect(bounds.x, bounds.y, bounds.w, bounds.h);
        context.clip();
      }
      for (const line of lines) {
        drawNativeCanvasTextLine(context, line, textX, y, maxWidth, fontSize, shape.props.italic === true);
        if (shape.props.underline === true && line) {
          const measured = Math.min(maxWidth, context.measureText(line).width);
          const lineStart = align === "middle" ? textX - measured / 2 : align === "end" ? textX - measured : textX;
          context.beginPath();
          context.moveTo(lineStart, y + fontSize + 2);
          context.lineTo(lineStart + measured, y + fontSize + 2);
          context.stroke();
        }
        y += lineHeight;
      }
      if (shape.type === "note") context.restore();
    }
    context.restore();
  }
  context.restore();
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (value) => value ? resolve(value) : reject(new Error("白板图片生成失败。")),
      "image/png",
    );
  });
  const rawName = options.fileName?.trim() || `${pageName(snapshot, pageId)}-${options.scope === "selection" ? "选中内容" : "整个画布"}`;
  const safeName = rawName.replace(/[\\/:*?"<>|]+/gu, "-").replace(/\.png$/iu, "").trim() || "白板导出";
  return { blob, fileName: `${safeName}.png`, width, height, shapeCount: exported.length };
}

export function downloadNativeWhiteboardImage(
  result: NativeWhiteboardImageExportResult,
): void {
  const url = URL.createObjectURL(result.blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = result.fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export async function writeNativeWhiteboardSelectionToClipboard(
  snapshot: WhiteboardSnapshot,
  shapeIds: string[],
  serializedElements: string,
): Promise<boolean> {
  if (
    typeof navigator === "undefined" ||
    typeof navigator.clipboard?.write !== "function" ||
    typeof ClipboardItem === "undefined"
  ) {
    return false;
  }
  const pngBlob = exportNativeWhiteboardImage(snapshot, {
    scope: "selection",
    shapeIds,
    padding: 0,
    background: "transparent",
    requireImages: true,
    fileName: "MOKI-白板选中图片",
  }).then((result) => result.blob);
  const marker = `${NATIVE_WHITEBOARD_CLIPBOARD_TEXT_PREFIX}${serializedElements}`;
  const writing = navigator.clipboard.write([
    new ClipboardItem({
      "image/png": pngBlob,
      "text/plain": new Blob([marker], { type: "text/plain" }),
    }),
  ]);
  await writing;
  return true;
}

type Camera = { x: number; y: number; zoom: number };

export function nativeOverlayBounds(bounds: NativeBounds, camera: Camera, overlayScale = 1) {
  const scale = Number.isFinite(overlayScale) && overlayScale > 0 ? overlayScale : 1;
  return {
    left: ((bounds.x - camera.x) * camera.zoom) / scale,
    top: ((bounds.y - camera.y) * camera.zoom) / scale,
    width: (bounds.w * camera.zoom) / scale,
    height: (bounds.h * camera.zoom) / scale,
  };
}

export function nativeFloatingPalettePlacement({
  selectionTop,
  selectionBottom,
  viewportHeight,
  paletteHeight,
  toolbarHeight = 40,
  gap = 10,
  viewportPadding = 8,
}: {
  selectionTop: number;
  selectionBottom: number;
  viewportHeight: number;
  paletteHeight: number;
  toolbarHeight?: number;
  gap?: number;
  viewportPadding?: number;
}) {
  const safeViewportHeight = Math.max(1, viewportHeight);
  const top = Math.min(selectionTop, selectionBottom);
  const bottom = Math.max(selectionTop, selectionBottom);
  const aboveSpace = Math.max(0, top - viewportPadding);
  const belowSpace = Math.max(0, safeViewportHeight - bottom - viewportPadding);
  const requiredSpace = toolbarHeight + gap + Math.max(0, paletteHeight) + 8;
  const toolbarBelow = belowSpace >= requiredSpace || (
    aboveSpace < requiredSpace && belowSpace > aboveSpace
  );
  const anchorTop = toolbarBelow
    ? Math.min(
        Math.max(viewportPadding, bottom + gap),
        Math.max(viewportPadding, safeViewportHeight - viewportPadding - toolbarHeight),
      )
    : Math.max(
        Math.min(safeViewportHeight - viewportPadding, top - gap),
        viewportPadding + toolbarHeight,
      );
  return {
    anchorTop,
    toolbarBelow,
    menuSide: toolbarBelow ? "bottom" as const : "top" as const,
  };
}

export function nativeSelectionPalettePosition({
  selectionLeft,
  selectionTop,
  selectionRight,
  selectionBottom,
  viewportWidth,
  viewportHeight,
  paletteWidth,
  paletteHeight,
  gap = 12,
  viewportPadding = 8,
}: {
  selectionLeft: number;
  selectionTop: number;
  selectionRight: number;
  selectionBottom: number;
  viewportWidth: number;
  viewportHeight: number;
  paletteWidth: number;
  paletteHeight: number;
  gap?: number;
  viewportPadding?: number;
}) {
  const spaces = {
    top: Math.max(0, selectionTop - viewportPadding),
    bottom: Math.max(0, viewportHeight - selectionBottom - viewportPadding),
    right: Math.max(0, viewportWidth - selectionRight - viewportPadding),
    left: Math.max(0, selectionLeft - viewportPadding),
  };
  const requirements = {
    top: paletteHeight + gap,
    bottom: paletteHeight + gap,
    right: paletteWidth + gap,
    left: paletteWidth + gap,
  };
  const preferred = (["top", "bottom", "right", "left"] as const).find(
    (side) => spaces[side] >= requirements[side],
  );
  const side = preferred ?? (["top", "bottom", "right", "left"] as const).reduce(
    (best, candidate) => spaces[candidate] / requirements[candidate] > spaces[best] / requirements[best]
      ? candidate
      : best,
    "top",
  );
  const clamp = (value: number, size: number, viewportSize: number) => Math.min(
    Math.max(viewportPadding, value),
    Math.max(viewportPadding, viewportSize - viewportPadding - size),
  );
  const centeredLeft = clamp(
    (selectionLeft + selectionRight - paletteWidth) / 2,
    paletteWidth,
    viewportWidth,
  );
  const centeredTop = clamp(
    (selectionTop + selectionBottom - paletteHeight) / 2,
    paletteHeight,
    viewportHeight,
  );
  if (side === "top") return { side, left: centeredLeft, top: selectionTop - gap - paletteHeight };
  if (side === "bottom") return { side, left: centeredLeft, top: selectionBottom + gap };
  if (side === "right") return { side, left: selectionRight + gap, top: centeredTop };
  return { side, left: selectionLeft - gap - paletteWidth, top: centeredTop };
}
type ResizeCorner = "nw" | "ne" | "sw" | "se";
type ResizeEdge = "n" | "e" | "s" | "w";
type ResizeOrigin = { x: number; y: number; scale: number };
type StretchOrigin = {
  x: number;
  y: number;
  center: NativePoint;
  scaleX: number;
  scaleY: number;
};
type RotateOrigin = {
  x: number;
  y: number;
  rotation: number;
  center: NativePoint;
};
type PointerAction =
  | { kind: "pan"; start: NativePoint; camera: Camera }
  | { kind: "move"; start: NativePoint; origins: Map<string, NativePoint>; changed: boolean; axis?: "x" | "y" }
  | {
      kind: "resize";
      anchor: NativePoint;
      start: NativePoint;
      corner: ResizeCorner;
      origins: Map<string, ResizeOrigin>;
      changed: boolean;
    }
  | {
      kind: "stretch";
      anchor: NativePoint;
      start: NativePoint;
      edge: ResizeEdge;
      axis: NativePoint;
      origins: Map<string, StretchOrigin>;
      changed: boolean;
    }
  | {
      kind: "rotate";
      center: NativePoint;
      startAngle: number;
      origins: Map<string, RotateOrigin>;
      changed: boolean;
    }
  | {
      kind: "arrow-endpoint";
      id: string;
      endpoint: "start" | "end";
      start: NativePoint;
      end: NativePoint;
      changed: boolean;
    }
  | { kind: "marquee"; start: NativePoint; current: NativePoint; initial: string[]; additive: boolean }
  | { kind: "pen-handle"; index: number }
  | { kind: "bezier-handle"; id: string; shape: NativeWhiteboardShape; index: number; handle: "anchor" | "in" | "out"; start: NativePoint; anchors: NativeBezierAnchor[]; changed: boolean }
  | { kind: "draw" | "create"; start: NativePoint; points: NativePoint[] };
type TextDraft = {
  point: NativePoint;
  value: string;
  shapeId?: string;
  width?: number;
  height?: number;
  shapeScale?: number;
  color?: NativeCanvasColor;
  style?: NativeTextStyle;
  rotation?: number;
  autoSize?: boolean;
  shapeScaleX?: number;
  shapeScaleY?: number;
};
type MindMapConnectionDraft = {
  sourceId: string;
  mode: "set-parent" | "set-child";
  start: NativePoint;
  current: NativePoint;
  targetId?: string;
};

const STROKE_WIDTHS: Record<NativeStrokeSize, number> = {
  s: 2,
  m: 3,
  l: 5,
  xl: 8,
};

export type SelectionFrame = {
  center: NativePoint;
  w: number;
  h: number;
  rotation: number;
};

function selectedExpandedGroupId(input: NativeWhiteboardShape[]): string | undefined {
  if (input.length < 2 || input.some((shape) => shape.type === "group-folder" || isCollapsedGroupMember(shape))) {
    return undefined;
  }
  const groupId = nativeGroupId(input[0]);
  return groupId && input.every((shape) => nativeGroupId(shape) === groupId)
    ? groupId
    : undefined;
}

export function nativeExpandedGroupCollapseButtonBounds(
  frame: SelectionFrame,
  zoom: number,
): NativeBounds {
  const size = 28 / zoom;
  const inset = 24 / zoom;
  const localCenter = {
    x: frame.center.x + frame.w / 2 - inset,
    y: frame.center.y + frame.h / 2 - inset,
  };
  const center = rotatePoint(localCenter, frame.center, frame.rotation * Math.PI / 180);
  return {
    x: center.x - size / 2,
    y: center.y - size / 2,
    w: size,
    h: size,
    width: size,
    height: size,
    center,
  };
}

function selectionBounds(input: NativeWhiteboardShape[]): NativeBounds | undefined {
  if (!input.length) return undefined;
  const boxes = input.map(nativeShapeVisualBounds);
  const x = Math.min(...boxes.map((box) => box.x));
  const y = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.w));
  const bottom = Math.max(...boxes.map((box) => box.y + box.h));
  const w = Math.max(1, right - x);
  const h = Math.max(1, bottom - y);
  return { x, y, w, h, width: w, height: h, center: { x: x + w / 2, y: y + h / 2 } };
}

function normalizeRotation(rotation: number): number {
  return ((rotation % 360) + 360) % 360;
}

function rotationDifference(left: number, right: number): number {
  const difference = Math.abs(normalizeRotation(left) - normalizeRotation(right));
  return Math.min(difference, 360 - difference);
}

function selectionSupportsEdgeResize(input: NativeWhiteboardShape[]): boolean {
  if (!input.length) return false;
  const rotation = Number(input[0]?.rotation) || 0;
  return input.every((shape) => (
    rotationDifference(Number(shape.rotation) || 0, rotation) < 0.001
  ));
}

function selectionFrame(input: NativeWhiteboardShape[]): SelectionFrame | undefined {
  if (!input.length) return undefined;
  const rotation = Number(input[0]?.rotation) || 0;
  const sharesRotation = input.every((shape) => (
    rotationDifference(Number(shape.rotation) || 0, rotation) < 0.001
  ));
  if (!sharesRotation) {
    const bounds = selectionBounds(input);
    return bounds
      ? { center: bounds.center, w: bounds.w, h: bounds.h, rotation: 0 }
      : undefined;
  }
  const radians = rotation * Math.PI / 180;
  const origin = { x: 0, y: 0 };
  const localCorners = input.flatMap((shape) => {
    const bounds = nativeShapeBounds(shape);
    return [
      { x: bounds.x, y: bounds.y },
      { x: bounds.x + bounds.w, y: bounds.y },
      { x: bounds.x, y: bounds.y + bounds.h },
      { x: bounds.x + bounds.w, y: bounds.y + bounds.h },
    ].map((point) => rotatePoint(
      rotatePoint(point, bounds.center, radians),
      origin,
      -radians,
    ));
  });
  const left = Math.min(...localCorners.map((point) => point.x));
  const top = Math.min(...localCorners.map((point) => point.y));
  const right = Math.max(...localCorners.map((point) => point.x));
  const bottom = Math.max(...localCorners.map((point) => point.y));
  return {
    center: rotatePoint({ x: (left + right) / 2, y: (top + bottom) / 2 }, origin, radians),
    w: Math.max(1, right - left),
    h: Math.max(1, bottom - top),
    rotation,
  };
}

function hitRotationCorner(
  point: NativePoint,
  frame: SelectionFrame | undefined,
  zoom: number,
): ResizeCorner | undefined {
  if (!frame) return undefined;
  const innerRadius = 13 / zoom;
  const outerRadius = 29 / zoom;
  const localPoint = rotatePoint(point, frame.center, -frame.rotation * Math.PI / 180);
  return (["nw", "ne", "sw", "se"] as const).find((corner) => {
    const handle = localResizeHandlePoint(frame, corner);
    const dx = localPoint.x - handle.x;
    const dy = localPoint.y - handle.y;
    const distance = Math.hypot(dx, dy);
    const inOuterQuadrant = corner === "nw"
      ? dx <= 0 && dy <= 0
      : corner === "ne"
        ? dx >= 0 && dy <= 0
        : corner === "sw"
          ? dx <= 0 && dy >= 0
          : dx >= 0 && dy >= 0;
    return inOuterQuadrant && distance > innerRadius && distance <= outerRadius;
  });
}

const ROTATION_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28"><circle cx="14" cy="14" r="12" fill="white" stroke="#625bc5"/><path d="M19.5 10.5A7 7 0 1 0 20 18" fill="none" stroke="#242838" stroke-width="2" stroke-linecap="round"/><path d="M19.5 6.5v4.5H15" fill="none" stroke="#242838" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
)}") 14 14, grab`;

function rotatePoint(point: NativePoint, center: NativePoint, radians: number): NativePoint {
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const x = point.x - center.x;
  const y = point.y - center.y;
  return {
    x: center.x + x * cosine - y * sine,
    y: center.y + x * sine + y * cosine,
  };
}

function hitArrowEndpoint(
  point: NativePoint,
  shape: NativeWhiteboardShape | undefined,
  zoom: number,
): "start" | "end" | undefined {
  if (!shape) return undefined;
  const endpoints = nativeArrowEndpoints(shape);
  if (!endpoints) return undefined;
  const tolerance = 11 / zoom;
  if (Math.hypot(point.x - endpoints.start.x, point.y - endpoints.start.y) <= tolerance) return "start";
  if (Math.hypot(point.x - endpoints.end.x, point.y - endpoints.end.y) <= tolerance) return "end";
  return undefined;
}

function bezierLocalToPage(shape: NativeWhiteboardShape, point: NativePoint): NativePoint {
  const scale = Math.max(0.01, Math.abs(Number(shape.props.scale) || 1));
  const position = {
    x: shape.x + point.x * scale * Math.max(0.01, Math.abs(Number(shape.props.scaleX) || 1)),
    y: shape.y + point.y * scale * Math.max(0.01, Math.abs(Number(shape.props.scaleY) || 1)),
  };
  const rotation = (Number(shape.rotation) || 0) * Math.PI / 180;
  return rotation ? rotatePoint(position, nativeShapeBounds(shape).center, rotation) : position;
}

function bezierPageToLocal(shape: NativeWhiteboardShape, point: NativePoint): NativePoint {
  const rotation = (Number(shape.rotation) || 0) * Math.PI / 180;
  const unrotated = rotation ? rotatePoint(point, nativeShapeBounds(shape).center, -rotation) : point;
  const scale = Math.max(0.01, Math.abs(Number(shape.props.scale) || 1));
  return {
    x: (unrotated.x - shape.x) / (scale * Math.max(0.01, Math.abs(Number(shape.props.scaleX) || 1))),
    y: (unrotated.y - shape.y) / (scale * Math.max(0.01, Math.abs(Number(shape.props.scaleY) || 1))),
  };
}

function hitBezierHandle(point: NativePoint, shape: NativeWhiteboardShape | undefined, zoom: number):
  { index: number; handle: "anchor" | "in" | "out" } | undefined {
  if (shape?.type !== "bezier") return undefined;
  const anchors = nativeBezierAnchors(shape);
  for (const handle of ["in", "out", "anchor"] as const) {
    for (let index = anchors.length - 1; index >= 0; index -= 1) {
      const anchor = anchors[index]!;
      if (handle !== "anchor" && Math.hypot(anchor[handle].x - anchor.x, anchor[handle].y - anchor.y) < 0.5) continue;
      const target = bezierLocalToPage(shape, handle === "anchor" ? anchor : anchor[handle]);
      if (Math.hypot(point.x - target.x, point.y - target.y) * zoom <= 9) return { index, handle };
    }
  }
  return undefined;
}

function bezierPoint(from: NativeBezierAnchor, to: NativeBezierAnchor, t: number): NativePoint {
  const inverse = 1 - t;
  return {
    x: inverse ** 3 * from.x + 3 * inverse ** 2 * t * from.out.x + 3 * inverse * t ** 2 * to.in.x + t ** 3 * to.x,
    y: inverse ** 3 * from.y + 3 * inverse ** 2 * t * from.out.y + 3 * inverse * t ** 2 * to.in.y + t ** 3 * to.y,
  };
}

function hitBezierSegment(point: NativePoint, shape: NativeWhiteboardShape, zoom: number):
  { index: number; t: number } | undefined {
  if (shape.type !== "bezier") return undefined;
  const anchors = nativeBezierAnchors(shape);
  const count = shape.props.isClosed === true && anchors.length > 2 ? anchors.length : anchors.length - 1;
  let nearest: { index: number; t: number; distance: number } | undefined;
  for (let index = 0; index < count; index += 1) {
    const from = anchors[index]!;
    const to = anchors[(index + 1) % anchors.length]!;
    for (let step = 1; step < 40; step += 1) {
      const t = step / 40;
      const sample = bezierLocalToPage(shape, bezierPoint(from, to, t));
      const distance = Math.hypot(point.x - sample.x, point.y - sample.y) * zoom;
      if (!nearest || distance < nearest.distance) nearest = { index, t, distance };
    }
  }
  return nearest && nearest.distance <= 10 ? { index: nearest.index, t: nearest.t } : undefined;
}

function insertBezierAnchor(anchors: NativeBezierAnchor[], index: number, t: number): NativeBezierAnchor[] {
  const next = anchors.map((anchor) => ({ x: anchor.x, y: anchor.y, in: { ...anchor.in }, out: { ...anchor.out } }));
  const from = next[index]!;
  const to = next[(index + 1) % next.length]!;
  const mix = (a: NativePoint, b: NativePoint): NativePoint => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  const first = mix(from, from.out);
  const middle = mix(from.out, to.in);
  const last = mix(to.in, to);
  const incoming = mix(first, middle);
  const outgoing = mix(middle, last);
  const center = mix(incoming, outgoing);
  from.out = first;
  to.in = last;
  next.splice(index + 1, 0, { ...center, in: incoming, out: outgoing });
  return next;
}

function hitArrowBody(
  point: NativePoint,
  shape: NativeWhiteboardShape | undefined,
  zoom: number,
): boolean {
  const endpoints = shape ? nativeArrowEndpoints(shape) : undefined;
  if (!endpoints) return false;
  const dx = endpoints.end.x - endpoints.start.x;
  const dy = endpoints.end.y - endpoints.start.y;
  const lengthSquared = dx * dx + dy * dy;
  const progress = lengthSquared > 0
    ? Math.max(0, Math.min(1, (
        (point.x - endpoints.start.x) * dx +
        (point.y - endpoints.start.y) * dy
      ) / lengthSquared))
    : 0;
  const closest = {
    x: endpoints.start.x + dx * progress,
    y: endpoints.start.y + dy * progress,
  };
  return Math.hypot(point.x - closest.x, point.y - closest.y) <= 9 / zoom;
}

function localResizeHandlePoint(frame: SelectionFrame, corner: ResizeCorner): NativePoint {
  return {
    x: frame.center.x + (corner.endsWith("e") ? frame.w / 2 : -frame.w / 2),
    y: frame.center.y + (corner.startsWith("s") ? frame.h / 2 : -frame.h / 2),
  };
}

function resizeHandlePoint(frame: SelectionFrame, corner: ResizeCorner): NativePoint {
  return rotatePoint(
    localResizeHandlePoint(frame, corner),
    frame.center,
    frame.rotation * Math.PI / 180,
  );
}

function localEdgeResizeHandlePoint(frame: SelectionFrame, edge: ResizeEdge): NativePoint {
  return {
    x: frame.center.x + (edge === "e" ? frame.w / 2 : edge === "w" ? -frame.w / 2 : 0),
    y: frame.center.y + (edge === "s" ? frame.h / 2 : edge === "n" ? -frame.h / 2 : 0),
  };
}

function edgeResizeHandlePoint(frame: SelectionFrame, edge: ResizeEdge): NativePoint {
  return rotatePoint(
    localEdgeResizeHandlePoint(frame, edge),
    frame.center,
    frame.rotation * Math.PI / 180,
  );
}

function oppositeResizeEdge(edge: ResizeEdge): ResizeEdge {
  return ({ n: "s", e: "w", s: "n", w: "e" } as const)[edge];
}

function oppositeResizeCorner(corner: ResizeCorner): ResizeCorner {
  return ({ nw: "se", ne: "sw", sw: "ne", se: "nw" } as const)[corner];
}

function LinkPreviewFrame({
  shape,
  details,
  editor,
}: {
  shape: NativeWhiteboardShape;
  details: ReturnType<typeof nativeLinkDetails>;
  editor: NativeWhiteboardEditor;
}) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const loadedRef = useRef(false);
  const captureInFlightRef = useRef(false);
  const releasedRef = useRef(false);
  const latestThumbnailRef = useRef("");
  const latestCapturedAtRef = useRef("");
  const persistLatestThumbnail = useCallback(() => {
    const thumbnailUrl = latestThumbnailRef.current;
    if (!thumbnailUrl || shape.props.thumbnailUrl === thumbnailUrl) return;
    editor.updateShapes(
      [{
        id: shape.id,
        props: {
          thumbnailUrl,
          thumbnailUpdatedAt: latestCapturedAtRef.current || new Date().toISOString(),
        },
      }],
      { history: false },
    );
  }, [editor, shape.id, shape.props.thumbnailUrl]);
  const refreshThumbnail = useCallback(async () => {
    if (captureInFlightRef.current) return;
    captureInFlightRef.current = true;
    const capturedAt = new Date().toLocaleString("zh-CN", {
      timeZone: "Asia/Shanghai",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    let pageTitle = "";
    try {
      pageTitle = iframeRef.current?.contentDocument?.title ?? "";
    } catch {
      // Cross-origin pages cannot expose their rendered pixels or document
      // metadata to the workbench. Keep a deterministic visual thumbnail.
    }
    try {
      const frame = iframeRef.current;
      const rect = frame?.getBoundingClientRect();
      const desktopThumbnail = rect && window.mokiDesktop
        ? await window.mokiDesktop.captureWhiteboardLinkPreview({
            x: rect.left,
            y: rect.top,
            width: rect.width,
            height: rect.height,
          })
        : null;
      const previousThumbnail = typeof shape.props.thumbnailUrl === "string"
        ? shape.props.thumbnailUrl
        : "";
      const thumbnailUrl = desktopThumbnail?.startsWith("data:image/")
        ? desktopThumbnail
        : previousThumbnail.startsWith("data:image/jpeg") ||
            previousThumbnail.startsWith("data:image/png")
          ? previousThumbnail
          : createLinkPreviewThumbnailDataUrl({
              title: details.title,
              hostname: details.hostname,
              url: details.url,
              capturedAt,
              ...(pageTitle ? { pageTitle } : {}),
            });
      latestThumbnailRef.current = thumbnailUrl;
      latestCapturedAtRef.current = new Date().toISOString();
      if (releasedRef.current) persistLatestThumbnail();
    } finally {
      captureInFlightRef.current = false;
    }
  }, [details.hostname, details.title, details.url, persistLatestThumbnail, shape.props.thumbnailUrl]);

  useEffect(() => {
    releasedRef.current = false;
    const timer = window.setInterval(() => {
      if (loadedRef.current) void refreshThumbnail();
    }, 2_500);
    return () => {
      releasedRef.current = true;
      window.clearInterval(timer);
      persistLatestThumbnail();
    };
  }, [persistLatestThumbnail, refreshThumbnail]);

  return (
    <iframe
      ref={iframeRef}
      title={`${details.title} 网页预览`}
      src={details.url}
      sandbox="allow-forms allow-same-origin allow-scripts allow-popups allow-popups-to-escape-sandbox"
      referrerPolicy="strict-origin-when-cross-origin"
      onLoad={() => {
        loadedRef.current = true;
        void refreshThumbnail();
      }}
      className="native-whiteboard-link-preview pointer-events-auto absolute bottom-3 left-3 right-3 top-[58px] z-10 h-[calc(100%-70px)] w-[calc(100%-24px)] rounded-[10px] border-0 opacity-100"
    />
  );
}

function hitResizeHandle(
  point: NativePoint,
  frame: SelectionFrame | undefined,
  zoom: number,
): ResizeCorner | undefined {
  if (!frame) return undefined;
  const tolerance = 11 / zoom;
  return (["nw", "ne", "sw", "se"] as const).find((corner) => {
    const handle = resizeHandlePoint(frame, corner);
    return Math.hypot(point.x - handle.x, point.y - handle.y) <= tolerance;
  });
}

function hitEdgeResizeHandle(
  point: NativePoint,
  frame: SelectionFrame | undefined,
  zoom: number,
): ResizeEdge | undefined {
  if (!frame) return undefined;
  const localPoint = rotatePoint(
    point,
    frame.center,
    -frame.rotation * Math.PI / 180,
  );
  const alongTolerance = 14 / zoom;
  const acrossTolerance = 11 / zoom;
  return (["n", "e", "s", "w"] as const).find((edge) => {
    const handle = localEdgeResizeHandlePoint(frame, edge);
    const horizontal = edge === "n" || edge === "s";
    return horizontal
      ? Math.abs(localPoint.x - handle.x) <= alongTolerance &&
          Math.abs(localPoint.y - handle.y) <= acrossTolerance
      : Math.abs(localPoint.x - handle.x) <= acrossTolerance &&
          Math.abs(localPoint.y - handle.y) <= alongTolerance;
  });
}

function resizeCursor(corner: ResizeCorner, rotation = 0): "nwse-resize" | "nesw-resize" {
  const diagonal = corner === "nw" || corner === "se" ? 0 : 90;
  const normalized = normalizeRotation(diagonal + rotation) % 180;
  return normalized >= 45 && normalized < 135 ? "nesw-resize" : "nwse-resize";
}

function edgeResizeCursor(edge: ResizeEdge, rotation = 0): "ew-resize" | "ns-resize" {
  const axisAngle = edge === "e" || edge === "w" ? rotation : rotation + 90;
  const normalized = normalizeRotation(axisAngle) % 180;
  return normalized >= 45 && normalized < 135 ? "ns-resize" : "ew-resize";
}

function NativeGifPlayer({ src, selected }: { src: string; selected: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const decoderRef = useRef<ImageDecoder | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const decodeFrameRef = useRef<(index: number) => Promise<void>>(async () => undefined);
  const frameIndexRef = useRef(0);
  const playingRef = useRef(true);
  const decodingRef = useRef(false);
  const [playing, setPlaying] = useState(true);
  const [frameIndex, setFrameIndex] = useState(0);
  const [frameCount, setFrameCount] = useState(1);
  const [decoderReady, setDecoderReady] = useState(false);
  const [decoderFailed, setDecoderFailed] = useState(false);

  const clearTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = undefined;
  }, []);

  useEffect(() => {
    clearTimer();
    decoderRef.current?.close();
    decoderRef.current = null;
    frameIndexRef.current = 0;
    playingRef.current = true;
    setPlaying(true);
    setFrameIndex(0);
    setFrameCount(1);
    setDecoderReady(false);
    setDecoderFailed(false);
    if (!selected) return undefined;

    let cancelled = false;
    const initialize = async () => {
      try {
        if (typeof ImageDecoder === "undefined") throw new Error("ImageDecoder unavailable");
        const response = await apiFetch(src);
        if (!response.ok) throw new Error(`GIF 读取失败：HTTP ${response.status}`);
        const data = await response.arrayBuffer();
        if (cancelled) return;
        const decoder = new ImageDecoder({
          data,
          type: "image/gif",
          preferAnimation: true,
        });
        decoderRef.current = decoder;
        await decoder.tracks.ready;
        if (cancelled) {
          decoder.close();
          return;
        }
        const count = Math.max(1, decoder.tracks.selectedTrack?.frameCount ?? 1);
        setFrameCount(count);
        decodeFrameRef.current = async (requestedIndex: number) => {
          const activeDecoder = decoderRef.current;
          if (!activeDecoder || cancelled || decodingRef.current) return;
          decodingRef.current = true;
          clearTimer();
          const normalizedIndex = ((requestedIndex % count) + count) % count;
          try {
            const result = await activeDecoder.decode({
              frameIndex: normalizedIndex,
              completeFramesOnly: true,
            });
            if (cancelled) {
              result.image.close();
              return;
            }
            const canvas = canvasRef.current;
            const context = canvas?.getContext("2d");
            if (canvas && context) {
              const width = Math.max(1, result.image.displayWidth);
              const height = Math.max(1, result.image.displayHeight);
              if (canvas.width !== width || canvas.height !== height) {
                canvas.width = width;
                canvas.height = height;
              }
              context.clearRect(0, 0, width, height);
              context.drawImage(result.image, 0, 0, width, height);
            }
            const duration = Math.min(
              10_000,
              Math.max(20, (result.image.duration ?? 100_000) / 1_000),
            );
            result.image.close();
            frameIndexRef.current = normalizedIndex;
            setFrameIndex(normalizedIndex);
            setDecoderReady(true);
            if (playingRef.current && count > 1) {
              timerRef.current = setTimeout(() => {
                void decodeFrameRef.current(normalizedIndex + 1);
              }, duration);
            }
          } catch {
            if (!cancelled) setDecoderFailed(true);
          } finally {
            decodingRef.current = false;
          }
        };
        await decodeFrameRef.current(0);
      } catch {
        if (!cancelled) setDecoderFailed(true);
      }
    };
    void initialize();
    return () => {
      cancelled = true;
      clearTimer();
      decoderRef.current?.close();
      decoderRef.current = null;
      decodeFrameRef.current = async () => undefined;
    };
  }, [clearTimer, selected, src]);

  const pause = () => {
    playingRef.current = false;
    setPlaying(false);
    clearTimer();
  };
  const play = () => {
    playingRef.current = true;
    setPlaying(true);
    if (decoderReady && !decoderFailed) {
      void decodeFrameRef.current(frameIndexRef.current + 1);
    }
  };
  const step = (direction: -1 | 1) => {
    pause();
    if (decoderReady && !decoderFailed) {
      void decodeFrameRef.current(frameIndexRef.current + direction);
    }
  };

  if (!selected) {
    return <img src={src} alt="" draggable={false} className="h-full w-full select-none object-fill" />;
  }

  return (
    <>
      {(!decoderReady || decoderFailed) && (
        <img src={src} alt="" draggable={false} className="absolute inset-0 h-full w-full select-none object-fill" />
      )}
      <canvas
        ref={canvasRef}
        aria-label="GIF 播放画面"
        className={`h-full w-full object-fill ${decoderReady && !decoderFailed ? "block" : "invisible"}`}
      />
      <div
        role="group"
        aria-label="GIF 播放控制"
        className="pointer-events-auto absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-xl border border-white/80 bg-[#242a40]/90 p-1 text-white shadow-lg backdrop-blur"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <button type="button" aria-label="上一帧" title="上一帧" disabled={!decoderReady || decoderFailed || frameCount <= 1} onClick={() => step(-1)} className="grid size-7 place-items-center rounded-lg transition hover:bg-white/15 active:scale-90 disabled:opacity-35"><StepBack size={14} /></button>
        <button type="button" aria-label={playing ? "暂停 GIF" : "播放 GIF"} title={playing ? "暂停" : "播放"} disabled={decoderFailed} onClick={playing ? pause : play} className="grid size-7 place-items-center rounded-lg bg-white text-[#242a40] transition hover:bg-[#eeedff] active:scale-90 disabled:opacity-50">{playing ? <Pause size={14} /> : <Play size={14} />}</button>
        <button type="button" aria-label="下一帧" title="下一帧" disabled={!decoderReady || decoderFailed || frameCount <= 1} onClick={() => step(1)} className="grid size-7 place-items-center rounded-lg transition hover:bg-white/15 active:scale-90 disabled:opacity-35"><StepForward size={14} /></button>
        <span className="min-w-14 px-1 text-center text-[0.625rem] font-bold tabular-nums">{decoderFailed ? "自动播放" : decoderReady ? `${frameIndex + 1}/${frameCount}` : "加载中"}</span>
      </div>
    </>
  );
}

export function NativeWhiteboard({
  store,
  onMount,
  maxAssetSize: _maxAssetSize,
  color = "black",
  drawColor = color,
  drawSize = "m",
  arrowStyle = "single",
  geoPaintStyle = DEFAULT_GEO_PAINT_STYLE,
  onImageFiles,
  onLocalFiles,
  onImageUrl,
  onWhiteboardFiles,
  onResourceOpen,
  onLocalPathOpen,
  onGroupFolderExport,
  onMindMapCreate,
  textStyle = {
    size: "m",
    bold: false,
    italic: false,
    underline: false,
    textAlign: "start",
  },
}: {
  store: NativeWhiteboardStore;
  onMount?: (editor: NativeWhiteboardEditor) => void;
  maxAssetSize?: number;
  color?: NativeCanvasColor;
  drawColor?: NativeCanvasColor;
  drawSize?: NativeStrokeSize;
  arrowStyle?: NativeArrowStyle;
  geoPaintStyle?: NativeGeoPaintStyle;
  onImageFiles?: (files: File[], point?: NativePoint) => void | Promise<void>;
  onLocalFiles?: (items: NativeDroppedLocalItem[], point?: NativePoint) => void | Promise<void>;
  onImageUrl?: (url: string, point?: NativePoint) => void | Promise<void>;
  onWhiteboardFiles?: (files: File[]) => void | Promise<void>;
  onResourceOpen?: (libraryItemId: string) => void | Promise<void>;
  onLocalPathOpen?: (path: string) => void | Promise<void>;
  onGroupFolderExport?: (request: NativeWhiteboardFolderExportRequest, mode: "local" | "library") => void | Promise<void>;
  onMindMapCreate?: (point: NativePoint) => void;
  textStyle?: NativeTextStyle;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const minimapRef = useRef<HTMLCanvasElement | null>(null);
  const minimapTransformRef = useRef<{
    left: number;
    top: number;
    scale: number;
    padding: number;
  } | undefined>(undefined);
  const frameRef = useRef<number | undefined>(undefined);
  const imageCache = useRef(new Map<string, NativeImageCacheEntry>());
  const trimImageCache = useCallback(() => {
    const cache = imageCache.current;
    while (cache.size > 128) {
      const candidate = [...cache.entries()].find(([, entry]) => entry.status !== "loading");
      if (!candidate) break;
      cache.delete(candidate[0]);
    }
  }, []);
  const cameraRef = useRef<Camera>({ x: 0, y: 0, zoom: 1 });
  const actionRef = useRef<PointerAction | undefined>(undefined);
  const draftRef = useRef<NativePoint[]>([]);
  const penDraftRef = useRef<NativeBezierAnchor[]>([]);
  const penDraftPageIdRef = useRef<string | undefined>(undefined);
  const penHoverRef = useRef<NativePoint | undefined>(undefined);
  const marqueeRef = useRef<{ start: NativePoint; current: NativePoint } | undefined>(undefined);
  const textInputRef = useRef<HTMLTextAreaElement | null>(null);
  const textDraftRef = useRef<TextDraft | undefined>(undefined);
  const draftMeasuredSizeRef = useRef<{ width: number; height: number } | undefined>(undefined);
  const selectedPaintMenuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const selectedPaintMenuId = useId();
  const pageMenuRef = useRef<HTMLDivElement | null>(null);
  const pageMenuSelectionTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pageRenameCancelledRef = useRef(false);
  const draggedPageIdRef = useRef<string | undefined>(undefined);
  const draggedPageGroupIdRef = useRef<string | undefined>(undefined);
  const pageGroupPointerDragRef = useRef<{ id: string; pointerId: number; x: number; y: number; target?: { id: string; position: "before" | "after" } | undefined } | undefined>(undefined);
  const copiedElementsRef = useRef("");
  const menuMediaInputRef = useRef<HTMLInputElement | null>(null);
  const menuMediaPointRef = useRef<NativePoint | undefined>(undefined);
  const pastedClipboardRef = useRef({ serialized: "", count: 0 });
  const clipboardNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const drawAgainRef = useRef<() => void>(() => undefined);
  const assistantSelectionExportsRef = useRef(new Map<string, ReturnType<typeof storeVisualSelectionImage>>());
  const linkMetadataRequestsRef = useRef(new Set<string>());
  const [revision, setRevision] = useState(0);
  const [canvasDark, setCanvasDark] = useState(
    () => typeof document !== "undefined" && document.documentElement.dataset.colorScheme === "dark",
  );
  const [zoomLabel, setZoomLabel] = useState(100);
  const [textDraft, setTextDraft] = useState<TextDraft>();
  const [draftMeasuredSize, setDraftMeasuredSize] = useState<{ width: number; height: number }>();
  const [textColorMenu, setTextColorMenu] = useState<"draft" | "selection">();
  const [selectedPaintMenuOpen, setSelectedPaintMenuOpen] = useState(false);
  const [draggingFile, setDraggingFile] = useState(false);
  const [clipboardNotice, setClipboardNotice] = useState("");
  const [pageMenuOpen, setPageMenuOpen] = useState(false);
  const [pageQuery, setPageQuery] = useState("");
  const [collapsedPageGroupIds, setCollapsedPageGroupIds] = useState<Set<string>>(() => new Set());
  const [renamingPageId, setRenamingPageId] = useState<string>();
  const [pageNameDraft, setPageNameDraft] = useState("");
  const [renamingPageGroupId, setRenamingPageGroupId] = useState<string>();
  const [pageGroupNameDraft, setPageGroupNameDraft] = useState("");
  const [draggedPageId, setDraggedPageId] = useState<string>();
  const [draggedPageGroupId, setDraggedPageGroupId] = useState<string>();
  const [pageGroupDropTarget, setPageGroupDropTarget] = useState<{ id: string; position: "before" | "after" }>();
  const [pageDropTarget, setPageDropTarget] = useState<{
    type: "page";
    id: string;
    position: "before" | "after";
  } | { type: "group"; id: string } | { type: "ungrouped" }>();
  const [pendingPageDelete, setPendingPageDelete] = useState<{
    id: string;
    name: string;
  }>();
  const [shapeContextMenu, setShapeContextMenu] = useState<{ x: number; y: number; point: NativePoint }>();
  const [folderColorMenu, setFolderColorMenu] = useState<{ left: number; top: number }>();
  const folderColorMenuId = useId();
  const shapeContextMenuRef = useRef<HTMLDivElement | null>(null);
  const folderColorMenuRef = useRef<HTMLDivElement | null>(null);
  const folderColorTriggerRef = useRef<HTMLButtonElement | null>(null);
  const openFolderColorMenu = (button: HTMLButtonElement) => {
    const trigger = button.getBoundingClientRect();
    const parent = button.closest('[role="menu"]')?.getBoundingClientRect() ?? trigger;
    const width = 224;
    const right = parent.right + 6;
    const left = right + width <= window.innerWidth - 8 ? right : parent.left - width - 6;
    setFolderColorMenu({
      left: Math.max(8, Math.min(left, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(trigger.top - 4, window.innerHeight - 52)),
    });
  };
  const [renamingFolderId, setRenamingFolderId] = useState<string>();
  const [folderNameDraft, setFolderNameDraft] = useState("");
  const [editingFolderDescriptionId, setEditingFolderDescriptionId] = useState<string>();
  const [folderDescriptionDraft, setFolderDescriptionDraft] = useState("");
  const [mindMapConnectionDraft, setMindMapConnectionDraft] = useState<MindMapConnectionDraft>();
  const ensureImageLoaded = useCallback((source: string): Promise<boolean> => {
    const existing = imageCache.current.get(source);
    if (existing) {
      imageCache.current.delete(source);
      imageCache.current.set(source, existing);
      return existing.promise;
    }
    const image = new Image();
    image.decoding = "async";
    let resolveLoading: (loaded: boolean) => void = () => undefined;
    const promise = new Promise<boolean>((resolve) => {
      resolveLoading = resolve;
    });
    const entry: NativeImageCacheEntry = {
      image,
      status: "loading",
      promise,
    };
    imageCache.current.set(source, entry);
    trimImageCache();
    image.onload = () => {
      entry.status = image.naturalWidth > 0 ? "loaded" : "error";
      resolveLoading(entry.status === "loaded");
      drawAgainRef.current();
    };
    image.onerror = () => {
      entry.status = "error";
      resolveLoading(false);
      drawAgainRef.current();
    };
    image.src = source;
    return promise;
  }, [trimImageCache]);
  const preloadImageSources = useCallback(async (sources: string[]) => {
    await Promise.all(sources.map((source) => ensureImageLoaded(source)));
  }, [ensureImageLoaded]);
  const cachePreviewImage = useCallback((source: string, image: HTMLImageElement) => {
    imageCache.current.set(source, {
      image,
      status: "loaded",
      promise: Promise.resolve(true),
    });
    trimImageCache();
    drawAgainRef.current();
  }, [trimImageCache]);
  const editor = useMemo(() => new NativeWhiteboardEditor(store), [store]);

  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  editor.attachRefresh(refresh);
  editor.attachImageHandlers(preloadImageSources, cachePreviewImage);
  editor.attachCameraChange((camera) => {
    cameraRef.current = camera;
    setZoomLabel(Math.round(camera.zoom * 100));
    refresh();
    drawAgainRef.current();
  });

  useEffect(() => {
    for (const shape of shapes(store.snapshot)) {
      if (shape.type !== "link") continue;
      const url = normalizeWhiteboardLinkUrl(String(shape.props.url ?? ""));
      if (!url) continue;
      const currentTitle = typeof shape.props.title === "string" ? shape.props.title.trim() : "";
      const autoTitle = shape.props.titleAuto === true || !currentTitle || currentTitle === whiteboardLinkTitle(url);
      const requestKey = `${shape.id}:${url}`;
      if (!autoTitle || linkMetadataRequestsRef.current.has(requestKey)) continue;
      linkMetadataRequestsRef.current.add(requestKey);
      void fetchWhiteboardLinkMetadata(url).then((metadata) => {
        if (!metadata) return;
        const current = editor.getShape(shape.id);
        if (!current || current.type !== "link" || normalizeWhiteboardLinkUrl(String(current.props.url ?? "")) !== url) return;
        editor.updateShapes([{
          id: shape.id,
          props: { title: metadata.title, titleAuto: false },
        }], { history: false });
      });
    }
  }, [editor, revision, store]);

  useEffect(() => {
    const root = rootRef.current;
    const restore = (event: Event) => {
      const camera = (event as CustomEvent<Camera>).detail;
      if (!camera || ![camera.x, camera.y, camera.zoom].every(Number.isFinite) || camera.zoom <= 0) return;
      cameraRef.current = camera;
      editor.setViewport(camera);
      setZoomLabel(Math.round(camera.zoom * 100));
      refresh();
      drawAgainRef.current();
    };
    root?.addEventListener('moki:whiteboard-annotation-view', restore);
    return () => root?.removeEventListener('moki:whiteboard-annotation-view', restore);
  }, [editor, refresh]);

  useEffect(() => {
    if (visualAnnotationsFromSelection(readWorkbenchSelectionContext()).length) return;
    const ids = editor.getSelectedShapeIds();
    const selected = ids
      .map((id) => editor.getShape(id))
      .filter((shape): shape is NativeWhiteboardShape => Boolean(shape));
    if (selected.length === 0) {
      clearWorkbenchSelectionContext("whiteboard");
      return;
    }
    const selectionPayload = {
      kind: "whiteboard_selection",
      pageId: editor.getCurrentPageId(),
      pageName: pageName(store.snapshot, editor.getCurrentPageId()),
      selectedShapeCount: selected.length,
      shapeDetailsTruncated: selected.length > 80,
      selectedShapes: selected.slice(0, 80).map((shape) => {
        const bounds = nativeShapeBounds(shape);
        const text = nativeRichTextValue(shape.props.richText);
        const asset = ["image", "media"].includes(shape.type) ? imageAsset(store.snapshot, shape) : undefined;
        const assetProps = asset?.props && typeof asset.props === "object"
          ? asset.props as Record<string, unknown>
          : undefined;
        return {
          id: shape.id,
          type: shape.type,
          x: bounds.x,
          y: bounds.y,
          width: bounds.w,
          height: bounds.h,
          ...(text ? { text } : {}),
          ...(typeof shape.props.libraryItemId === "string" ? { libraryItemId: shape.props.libraryItemId } : {}),
          ...(typeof shape.props.localPath === "string" ? { localPath: shape.props.localPath } : {}),
          ...(typeof shape.props.url === "string" ? { url: shape.props.url } : {}),
          ...(typeof assetProps?.src === "string" && shape.type === "image" ? { imageSource: assetProps.src } : {}),
          ...(typeof assetProps?.src === "string" && shape.type === "media" ? { mediaSource: assetProps.src } : {}),
        };
      }),
      guidance: "选中内容的图片保留了涂鸦、文字、形状、图片和相对布局，请结合结构化元素信息进行识别处理。",
    };
    const baseSelection = {
      source: "whiteboard" as const,
      label: `白板已选 ${selected.length} 项`,
      itemCount: Math.min(selected.length, 200),
      content: JSON.stringify(selectionPayload),
    };
    const selectionSignature = JSON.stringify(selected.map((shape) => ({
      id: shape.id,
      type: shape.type,
      x: shape.x,
      y: shape.y,
      rotation: shape.rotation,
      opacity: shape.opacity,
      props: shape.props,
    })));
    publishWorkbenchSelectionContext(baseSelection);
    let cancelled = false;
    const timer = window.setTimeout(() => {
      let pending = assistantSelectionExportsRef.current.get(selectionSignature);
      if (!pending) {
        pending = exportNativeWhiteboardImage(store.snapshot, {
          pageId: editor.getCurrentPageId(),
          scope: "selection",
          shapeIds: ids,
          padding: 24,
          background: "canvas",
          requireImages: true,
          fileName: `${selectionPayload.pageName}-选中内容`,
          maxDimension: 2_048,
          maxPixels: 4_000_000,
        }).then((result) => storeVisualSelectionImage(result.blob, {
          name: result.fileName,
          width: result.width,
          height: result.height,
        }));
        assistantSelectionExportsRef.current.set(selectionSignature, pending);
        while (assistantSelectionExportsRef.current.size > 8) {
          const oldest = assistantSelectionExportsRef.current.keys().next().value as string | undefined;
          if (!oldest) break;
          assistantSelectionExportsRef.current.delete(oldest);
        }
      }
      void pending.then((stored) => {
        if (cancelled) return;
        if (visualAnnotationsFromSelection(readWorkbenchSelectionContext()).length) return;
        const currentIds = editor.getSelectedShapeIds();
        if (currentIds.length !== ids.length || currentIds.some((id, index) => id !== ids[index])) return;
        publishWorkbenchSelectionContext({
          ...baseSelection,
          content: JSON.stringify({ ...selectionPayload, visualAttachments: [stored] }),
        });
      }).catch(() => {
        assistantSelectionExportsRef.current.delete(selectionSignature);
        // Keep the structured selection usable if one image is still loading.
      });
    }, 220);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [editor, revision, store]);
  useEffect(() => () => clearWorkbenchSelectionContext("whiteboard"), []);

  const eventPoint = useCallback((event: { clientX: number; clientY: number }) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    const screenX = event.clientX - (rect?.left ?? 0);
    const screenY = event.clientY - (rect?.top ?? 0);
    return {
      x: cameraRef.current.x + screenX / cameraRef.current.zoom,
      y: cameraRef.current.y + screenY / cameraRef.current.zoom,
    };
  }, []);

  const dropFiles = useCallback((event: React.DragEvent<HTMLCanvasElement>) => {
    const transferred = Array.from(event.dataTransfer.files);
    const whiteboards = transferred.filter((file) =>
      /\.moki(?:-board)?(?:\.json)?$/iu.test(file.name),
    );
    if (whiteboards.length && onWhiteboardFiles) {
      event.preventDefault();
      setDraggingFile(false);
      void onWhiteboardFiles(whiteboards);
      return;
    }
    if (transferred.length && onLocalFiles) {
      event.preventDefault();
      setDraggingFile(false);
      const transferItems = Array.from(event.dataTransfer.items ?? [])
        .filter((item) => item.kind === "file");
      const localItems = transferred.map((file, index): NativeDroppedLocalItem => {
        let path: string | undefined;
        try {
          path = window.mokiDesktop?.getPathForFile?.(file) || undefined;
        } catch {
          path = undefined;
        }
        const entry = transferItems[index]?.webkitGetAsEntry?.();
        return { file, ...(path ? { path } : {}), isDirectory: entry?.isDirectory === true };
      });
      void onLocalFiles(localItems, eventPoint(event));
      return;
    }
    const files = transferred.filter((file) =>
      file.type.startsWith("image/"),
    );
    setDraggingFile(false);
    if (!files.length || !onImageFiles) return;
    event.preventDefault();
    void onImageFiles(files, eventPoint(event));
  }, [eventPoint, onImageFiles, onLocalFiles, onWhiteboardFiles]);

  useEffect(() => {
    const isEditingText = (event: Event) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      const embedded = rootRef.current?.closest('[data-whiteboard-embedded="true"]');
      if (embedded && (embedded.getAttribute('data-whiteboard-active') !== 'true' || !target || !embedded.contains(target))) return true;
      if (!embedded && target?.closest('[data-whiteboard-embedded="true"]')) return true;
      return Boolean(
        target?.closest("input, textarea, select, [contenteditable='true']"),
      );
    };
    const announceClipboard = (message: string) => {
      setClipboardNotice(message);
      if (clipboardNoticeTimerRef.current) {
        clearTimeout(clipboardNoticeTimerRef.current);
      }
      clipboardNoticeTimerRef.current = setTimeout(() => {
        clipboardNoticeTimerRef.current = undefined;
        setClipboardNotice("");
      }, 1_800);
    };
    const handleCopy = (event: ClipboardEvent) => {
      if (isEditingText(event)) return;
      const serialized = editor.copySelectedShapes();
      if (!serialized) return;
      const selectedShapeIds = editor.getSelectedShapeIds();
      copiedElementsRef.current = serialized;
      pastedClipboardRef.current = { serialized, count: 0 };
      if (event.clipboardData) {
        event.preventDefault();
        try {
          event.clipboardData.setData(
            NATIVE_WHITEBOARD_CLIPBOARD_TYPE,
            serialized,
          );
        } catch {
          // Some desktop clipboard bridges filter custom MIME types.
        }
        try {
          event.clipboardData.setData(
            "text/plain",
            `${NATIVE_WHITEBOARD_CLIPBOARD_TEXT_PREFIX}${serialized}`,
          );
        } catch {
          // The in-memory fallback below remains available in this window.
        }
      }
      const count = selectedShapeIds.length;
      announceClipboard(`已复制 ${count} 个元素，可按 Ctrl/⌘+V 粘贴`);
      const includesImage = selectedShapeIds.some(
        (id) => editor.getShape(id)?.type === "image",
      );
      if (includesImage) {
        void writeNativeWhiteboardSelectionToClipboard(
          store.snapshot,
          selectedShapeIds,
          serialized,
        ).then((written) => {
          announceClipboard(written
            ? `已复制 ${count} 个元素及 PNG 图片`
            : `已复制 ${count} 个元素；当前环境不支持系统图片剪贴板`);
        }).catch(() => {
          announceClipboard(`已复制 ${count} 个元素；系统图片复制失败`);
        });
      }
    };
    const handlePaste = (event: ClipboardEvent) => {
      if (isEditingText(event)) return;
      const clipboardTypes = Array.from(event.clipboardData?.types ?? []);
      const readClipboardData = typeof event.clipboardData?.getData === "function"
        ? (type: string) => event.clipboardData?.getData(type) ?? ""
        : () => "";
      const customSerialized = readClipboardData(
        NATIVE_WHITEBOARD_CLIPBOARD_TYPE,
      );
      const plainText = customSerialized
        ? ""
        : readClipboardData("text/plain");
      const textSerialized = plainText.startsWith(
        NATIVE_WHITEBOARD_CLIPBOARD_TEXT_PREFIX,
      )
        ? plainText.slice(NATIVE_WHITEBOARD_CLIPBOARD_TEXT_PREFIX.length)
        : "";
      const serialized = customSerialized || textSerialized || (
        clipboardTypes.length === 0 ? copiedElementsRef.current : ""
      );
      let invalidNativeClipboard = false;
      if (serialized) {
        const previous = pastedClipboardRef.current;
        const count = previous.serialized === serialized
          ? previous.count + 1
          : 1;
        const pastedIds = editor.pasteCopiedShapes(serialized, 32 * count);
        if (pastedIds.length > 0) {
          pastedClipboardRef.current = { serialized, count };
          event.preventDefault();
          return;
        }
        if (customSerialized || textSerialized) {
          invalidNativeClipboard = true;
        }
      }
      const pastedImageUrl = customSerialized || textSerialized
        ? undefined
        : normalizePastedWhiteboardImageUrl(plainText, readClipboardData("text/html"));
      if (pastedImageUrl && onImageUrl) {
        event.preventDefault();
        void onImageUrl(pastedImageUrl, editor.getViewportPageBounds().center);
        return;
      }
      const pastedLinkUrl = customSerialized || textSerialized
        ? undefined
        : normalizePastedWhiteboardLinkUrl(plainText);
      if (pastedLinkUrl) {
        const pastedId = editor.pasteLink(pastedLinkUrl);
        if (pastedId) {
          announceClipboard("已粘贴为超链接");
          event.preventDefault();
          return;
        }
      }
      const directFiles = Array.from(event.clipboardData?.files ?? []);
      const itemFiles = Array.from(event.clipboardData?.items ?? [])
        .map((item) => item.type.startsWith("image/") ? item.getAsFile() : null)
        .filter((file): file is File => Boolean(file));
      // DataTransfer.files and DataTransfer.items are two views of the same
      // clipboard payload in Chromium/Electron. Combining them inserts the
      // same image twice, so only fall back to item files when the direct list
      // does not expose an image.
      const files = clipboardImageFiles(directFiles, itemFiles);
      if (files.length > 0 && onImageFiles) {
        event.preventDefault();
        void onImageFiles(files, editor.getViewportPageBounds().center);
        return;
      }
      if (invalidNativeClipboard) {
        event.preventDefault();
        announceClipboard("白板剪贴板内容不可用，也没有可粘贴的图片");
      }
    };
    window.addEventListener("copy", handleCopy);
    window.addEventListener("paste", handlePaste);
    return () => {
      window.removeEventListener("copy", handleCopy);
      window.removeEventListener("paste", handlePaste);
      if (clipboardNoticeTimerRef.current) {
        clearTimeout(clipboardNoticeTimerRef.current);
        clipboardNoticeTimerRef.current = undefined;
      }
    };
  }, [editor, onImageFiles, onImageUrl, store]);

  useEffect(() => {
    if (!pageMenuOpen) return;
    const closePageMenu = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      if (target && pageMenuRef.current?.contains(target)) return;
      setPageMenuOpen(false);
      setPageQuery("");
      setRenamingPageId(undefined);
    };
    window.addEventListener("pointerdown", closePageMenu);
    return () => window.removeEventListener("pointerdown", closePageMenu);
  }, [pageMenuOpen]);

  useEffect(() => () => {
    if (pageMenuSelectionTimerRef.current) {
      clearTimeout(pageMenuSelectionTimerRef.current);
      pageMenuSelectionTimerRef.current = undefined;
    }
  }, []);

  useEffect(() => {
    if (!selectedPaintMenuOpen) return;
    const closeSelectedPaintMenu = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setSelectedPaintMenuOpen(false);
      selectedPaintMenuTriggerRef.current?.focus();
    };
    window.addEventListener("keydown", closeSelectedPaintMenu);
    return () => window.removeEventListener("keydown", closeSelectedPaintMenu);
  }, [selectedPaintMenuOpen]);

  useEffect(() => {
    if (!shapeContextMenu) return;
    const closeOnPointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      if (target && folderColorMenuRef.current?.contains(target)) return;
      if (target && shapeContextMenuRef.current?.contains(target)) {
        if (!folderColorTriggerRef.current?.contains(target)) setFolderColorMenu(undefined);
        return;
      }
      setFolderColorMenu(undefined);
      setShapeContextMenu(undefined);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setFolderColorMenu(undefined);
      setShapeContextMenu(undefined);
    };
    const closeOnBlur = () => {
      setFolderColorMenu(undefined);
      setShapeContextMenu(undefined);
    };
    document.addEventListener("pointerdown", closeOnPointerDown, true);
    document.addEventListener("keydown", closeOnEscape, true);
    window.addEventListener("blur", closeOnBlur);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown, true);
      document.removeEventListener("keydown", closeOnEscape, true);
      window.removeEventListener("blur", closeOnBlur);
    };
  }, [shapeContextMenu]);

  const scheduleDraw = useCallback(() => {
    if (frameRef.current !== undefined) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = undefined;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      const pixelWidth = Math.max(1, Math.round(rect.width * ratio));
      const pixelHeight = Math.max(1, Math.round(rect.height * ratio));
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
      }
      const context = canvas.getContext("2d");
      if (!context) return;
      const darkCanvas = document.documentElement.dataset.colorScheme === "dark";
      const canvasTheme = nativeCanvasThemePalette(darkCanvas);
      const selectionTheme = nativeCanvasSelectionPalette(darkCanvas);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, rect.width, rect.height);
      context.fillStyle = canvasTheme.background;
      context.fillRect(0, 0, rect.width, rect.height);
      const camera = cameraRef.current;
      if (rootRef.current) rootRef.current.dataset.mokiWhiteboardCamera = JSON.stringify(camera);
      const grid = 24 * camera.zoom;
      if (grid >= 8) {
        context.fillStyle = canvasTheme.grid;
        const offsetX = ((-camera.x * camera.zoom) % grid + grid) % grid;
        const offsetY = ((-camera.y * camera.zoom) % grid + grid) % grid;
        for (let x = offsetX; x < rect.width; x += grid) {
          for (let y = offsetY; y < rect.height; y += grid) context.fillRect(x, y, 1, 1);
        }
      }
      const visible = { x: camera.x - 120 / camera.zoom, y: camera.y - 120 / camera.zoom, w: (rect.width + 240) / camera.zoom, h: (rect.height + 240) / camera.zoom };
      const currentShapes = visibleShapes(store.snapshot);
      const selected = new Set(editor.getSelectedShapeIds());
      let hasLoadingImages = false;
      context.save();
      context.translate(-camera.x * camera.zoom, -camera.y * camera.zoom);
      context.scale(camera.zoom, camera.zoom);
      for (const shape of currentShapes) {
        const bounds = nativeShapeBounds(shape);
        const visualBounds = nativeShapeVisualBounds(shape);
        if (visualBounds.x + visualBounds.w < visible.x || visualBounds.y + visualBounds.h < visible.y || visualBounds.x > visible.x + visible.w || visualBounds.y > visible.y + visible.h) continue;
        context.save();
        context.globalAlpha = typeof shape.opacity === "number" ? shape.opacity : 1;
        const shapeColor = String(shape.props.color) as NativeCanvasColor;
        const color = shapeColor in COLORS
          ? nativeCanvasDisplayColor(shapeColor, darkCanvas)
          : darkCanvas ? canvasTheme.ink : "#30364d";
        const shapeScale = Math.max(0.01, Math.abs(Number(shape.props.scale) || 1));
        const shapeScaleX = shapeScale * Math.max(0.01, Math.abs(Number(shape.props.scaleX) || 1));
        const shapeScaleY = shapeScale * Math.max(0.01, Math.abs(Number(shape.props.scaleY) || 1));
        const width = Math.max(1.5, (STROKE_WIDTHS[String(shape.props.size) as NativeStrokeSize] ?? 2.5) * shapeScale);
        context.strokeStyle = color;
        context.fillStyle = color;
        context.lineWidth = width;
        context.lineCap = "round";
        context.lineJoin = "round";
        const rotation = Number(shape.rotation) || 0;
        if (rotation) {
          context.translate(bounds.center.x, bounds.center.y);
          context.rotate(rotation * Math.PI / 180);
          context.translate(-bounds.center.x, -bounds.center.y);
        }
        if (shape.type === "bezier") {
          const anchors = nativeBezierAnchors(shape);
          if (anchors.length > 1) {
            traceNativeBezierPath(context, anchors, (point) => ({
              x: shape.x + point.x * shapeScaleX,
              y: shape.y + point.y * shapeScaleY,
            }), shape.props.isClosed === true);
            context.stroke();
          }
        } else if (shape.type === "draw") {
          const points = nativeDrawPoints(shape);
          if (points.length) {
            context.beginPath();
            context.moveTo(shape.x + points[0]!.x * shapeScaleX, shape.y + points[0]!.y * shapeScaleY);
            for (let index = 1; index < points.length; index += 1) context.lineTo(shape.x + points[index]!.x * shapeScaleX, shape.y + points[index]!.y * shapeScaleY);
            if (shape.props.isClosed) context.closePath();
            context.stroke();
          }
        } else if (shape.type === "arrow") {
          const start = (shape.props.start as NativePoint | undefined) ?? { x: 0, y: 0 };
          const end = (shape.props.end as NativePoint | undefined) ?? { x: Number(shape.props.w) || 160, y: Number(shape.props.h) || 100 };
          const x1 = shape.x + start.x * shapeScaleX, y1 = shape.y + start.y * shapeScaleY, x2 = shape.x + end.x * shapeScaleX, y2 = shape.y + end.y * shapeScaleY;
          drawNativeArrow(
            context,
            { x: x1, y: y1 },
            { x: x2, y: y2 },
            nativeArrowStyle(shape.props.arrowStyle),
            14 * shapeScale,
            shape.props.mokiMindMapEdge === true,
          );
        } else if (shape.type === "image") {
          const asset = imageAsset(store.snapshot, shape);
          const assetProps = asset?.props && typeof asset.props === "object"
            ? asset.props as Record<string, unknown>
            : undefined;
          const src = typeof assetProps?.src === "string" ? assetProps.src : "";
          let imageEntry = imageCache.current.get(src);
          if (src && !imageEntry) {
            void ensureImageLoaded(src);
            imageEntry = imageCache.current.get(src);
          }
          if (imageEntry?.status === "loaded") {
            context.drawImage(imageEntry.image, bounds.x, bounds.y, bounds.w, bounds.h);
          } else {
            const status = src && imageEntry?.status !== "error" ? "loading" : "error";
            drawNativeImagePlaceholder(context, bounds, status);
            if (status === "loading") hasLoadingImages = true;
          }
        } else if (shape.type === "link") {
          const thumbnailUrl = typeof shape.props.thumbnailUrl === "string"
            ? shape.props.thumbnailUrl
            : "";
          let thumbnailEntry = imageCache.current.get(thumbnailUrl);
          if (thumbnailUrl && !thumbnailEntry) {
            void ensureImageLoaded(thumbnailUrl);
            thumbnailEntry = imageCache.current.get(thumbnailUrl);
          }
          if (thumbnailUrl && thumbnailEntry?.status === "loading") {
            hasLoadingImages = true;
          }
          drawNativeLinkCard(
            context,
            bounds,
            shape,
            thumbnailEntry?.status === "loaded"
              ? thumbnailEntry.image
              : undefined,
            selected.has(shape.id),
          );
        } else if (shape.type === "resource") {
          drawNativeResourceCard(context, bounds, shape);
        } else if (shape.type === "media") {
          drawNativeMediaCard(context, bounds, shape);
        } else if (shape.type === "group-folder") {
          const groupId = nativeGroupId(shape);
          const members = groupId
            ? shapes(store.snapshot, shape.parentId).filter((member) => nativeGroupId(member) === groupId && member.type !== "group-folder")
            : [];
          const previews = members.slice(0, 2).map((member, index): NativeGroupFolderPreview => {
            let source = "";
            if (member.type === "image") {
              const asset = imageAsset(store.snapshot, member);
              const props = asset?.props && typeof asset.props === "object"
                ? asset.props as Record<string, unknown>
                : undefined;
              source = typeof props?.src === "string" ? props.src : "";
            } else if (member.type === "link") {
              source = typeof member.props.thumbnailUrl === "string" ? member.props.thumbnailUrl : "";
            }
            let imageEntry = imageCache.current.get(source);
            if (source && !imageEntry) {
              void ensureImageLoaded(source);
              imageEntry = imageCache.current.get(source);
            }
            if (source && imageEntry?.status === "loading") hasLoadingImages = true;
            return {
              label: nativeGroupFolderPreviewLabel(member),
              ...(imageEntry?.status === "loaded" ? { image: imageEntry.image } : {}),
              color: index === 0 ? "#f5f4f1" : "#eeeff9",
            };
          });
          drawNativeGroupFolder(context, bounds, shape, previews, members.length);
        } else if (shape.type === "note") {
          context.fillStyle = nativeNoteBackgroundColor(shape.props.color);
          context.shadowColor = "rgba(40,44,66,.12)"; context.shadowBlur = 12; context.shadowOffsetY = 4;
          context.fillRect(bounds.x, bounds.y, bounds.w, bounds.h); context.shadowColor = "transparent";
        } else if (shape.type === "geo") {
          const geo = String(shape.props.geo ?? "rectangle");
          const paint = nativeGeoPaintStyle(shape);
          traceGeoPath(context, geo, bounds);
          if (paint.fillEnabled) {
            context.globalAlpha = (typeof shape.opacity === "number" ? shape.opacity : 1) * paint.fillOpacity;
            context.fillStyle = nativeCanvasDisplayColor(paint.fillColor, darkCanvas);
            context.fill();
          }
          if (paint.strokeEnabled) {
            context.globalAlpha = (typeof shape.opacity === "number" ? shape.opacity : 1) * paint.strokeOpacity;
            context.strokeStyle = nativeCanvasDisplayColor(paint.strokeColor, darkCanvas);
            context.stroke();
          }
          context.globalAlpha = typeof shape.opacity === "number" ? shape.opacity : 1;
        }
        const text = nativeRichTextValue(shape.props.richText);
        if (text && shape.id !== textDraftRef.current?.shapeId && ["note", "text", "geo"].includes(shape.type)) {
          const size = ({ s: 14, m: 18, l: 24, xl: 32 } as Record<string, number>)[String(shape.props.size)] ?? 18;
          const fontSize = Math.max(12, size * Number(shape.props.scale || 1));
          const bold = shape.props.bold === true;
          const italic = shape.props.italic === true;
          const underline = shape.props.underline === true;
          const align = String(shape.props.textAlign ?? shape.props.align ?? "start");
          const textColor = shape.type === "note"
            ? COLORS[String(shape.props.labelColor ?? "black") as NativeCanvasColor] ?? COLORS.black
            : color;
          context.fillStyle = textColor;
          context.strokeStyle = textColor;
          context.font = `${bold ? "700 " : "400 "}${fontSize}px system-ui, sans-serif`;
          context.textBaseline = "top";
          context.textAlign = align === "middle" ? "center" : align === "end" ? "right" : "left";
          const textX = align === "middle"
            ? bounds.center.x
            : align === "end"
              ? bounds.x + bounds.w - 16
              : bounds.x + 16;
          const maxWidth = Math.max(20, bounds.w - 32);
          const lineHeight = fontSize * 1.35;
          const maxLines = shape.type === "note"
            ? Math.max(1, Math.floor((bounds.h - 32) / lineHeight))
            : 20;
          const lines = wrapNativeCanvasText(context, text, maxWidth, maxLines);
          let y = nativeCanvasTextStartY(
            bounds,
            fontSize,
            lineHeight,
            lines.length,
            shape.type === "geo" && isMindMapNode(shape),
          );
          if (shape.type === "note") {
            context.save();
            context.beginPath();
            context.rect(bounds.x, bounds.y, bounds.w, bounds.h);
            context.clip();
          }
          for (const line of lines) {
            drawNativeCanvasTextLine(context, line, textX, y, maxWidth, fontSize, italic);
            if (underline && line) {
              const measured = Math.min(maxWidth, context.measureText(line).width);
              const lineStart = align === "middle" ? textX - measured / 2 : align === "end" ? textX - measured : textX;
              context.lineWidth = Math.max(1, fontSize / 14);
              context.beginPath();
              context.moveTo(lineStart, y + fontSize + 2);
              context.lineTo(lineStart + measured, y + fontSize + 2);
              context.stroke();
            }
            y += lineHeight;
          }
          if (shape.type === "note") context.restore();
        }
        context.restore();
      }
      const editingTextShapeId = textDraftRef.current?.shapeId;
      const selectedShapes = currentShapes.filter((shape) => selected.has(shape.id) && shape.id !== editingTextShapeId);
      const selectedFrame = selectionFrame(selectedShapes);
      const expandedGroupId = selectedExpandedGroupId(selectedShapes);
      const selectedArrowEndpoints = selectedShapes.length === 1
        ? nativeArrowEndpoints(selectedShapes[0]!)
        : undefined;
      if (selectedArrowEndpoints) {
        const handleRadius = 6 / camera.zoom;
        context.save();
        context.strokeStyle = selectionTheme.stroke;
        context.lineWidth = 1.5 / camera.zoom;
        context.setLineDash([5 / camera.zoom, 4 / camera.zoom]);
        context.beginPath();
        context.moveTo(selectedArrowEndpoints.start.x, selectedArrowEndpoints.start.y);
        context.lineTo(selectedArrowEndpoints.end.x, selectedArrowEndpoints.end.y);
        context.stroke();
        context.setLineDash([]);
        for (const [endpoint, point] of Object.entries(selectedArrowEndpoints) as Array<[
          "start" | "end",
          NativePoint,
        ]>) {
          context.fillStyle = endpoint === "end" ? selectionTheme.stroke : selectionTheme.handleFill;
          context.strokeStyle = selectionTheme.stroke;
          context.lineWidth = 2 / camera.zoom;
          context.beginPath();
          context.arc(point.x, point.y, handleRadius, 0, Math.PI * 2);
          context.fill();
          context.stroke();
        }
        context.restore();
      } else if (selectedFrame) {
        const handleSize = 10 / camera.zoom;
        const edgeHandleLong = 18 / camera.zoom;
        const edgeHandleShort = 8 / camera.zoom;
        context.save();
        context.translate(selectedFrame.center.x, selectedFrame.center.y);
        context.rotate(selectedFrame.rotation * Math.PI / 180);
        context.strokeStyle = selectionTheme.stroke;
        context.lineWidth = 1.75 / camera.zoom;
        context.setLineDash([6 / camera.zoom, 4 / camera.zoom]);
        context.strokeRect(
          -selectedFrame.w / 2,
          -selectedFrame.h / 2,
          selectedFrame.w,
          selectedFrame.h,
        );
        context.setLineDash([]);
        for (const corner of ["nw", "ne", "sw", "se"] as const) {
          const handle = localResizeHandlePoint(
            { ...selectedFrame, center: { x: 0, y: 0 } },
            corner,
          );
          context.fillStyle = selectionTheme.handleFill;
          context.strokeStyle = selectionTheme.stroke;
          context.lineWidth = 2 / camera.zoom;
          context.beginPath();
          context.rect(
            handle.x - handleSize / 2,
            handle.y - handleSize / 2,
            handleSize,
            handleSize,
          );
          context.fill();
          context.stroke();
        }
        if (selectionSupportsEdgeResize(selectedShapes)) {
          for (const edge of ["n", "e", "s", "w"] as const) {
            const handle = localEdgeResizeHandlePoint(
              { ...selectedFrame, center: { x: 0, y: 0 } },
              edge,
            );
            const horizontal = edge === "n" || edge === "s";
            const width = horizontal ? edgeHandleLong : edgeHandleShort;
            const height = horizontal ? edgeHandleShort : edgeHandleLong;
            context.fillStyle = selectionTheme.handleFill;
            context.strokeStyle = selectionTheme.stroke;
            context.lineWidth = 2 / camera.zoom;
            context.beginPath();
            context.roundRect(
              handle.x - width / 2,
              handle.y - height / 2,
              width,
              height,
              3 / camera.zoom,
            );
            context.fill();
            context.stroke();
          }
        }
        context.restore();
        if (expandedGroupId) {
          drawNativeGroupToggleButton(
            context,
            nativeExpandedGroupCollapseButtonBounds(selectedFrame, camera.zoom),
            "collapse",
          );
        }
      }
      if (selectedShapes.length === 1 && selectedShapes[0]!.type === "bezier") {
        const shape = selectedShapes[0]!;
        const anchors = nativeBezierAnchors(shape);
        context.save();
        context.lineWidth = 1.5 / camera.zoom;
        for (const anchor of anchors) {
          const center = bezierLocalToPage(shape, anchor);
          for (const handle of ["in", "out"] as const) {
            const local = anchor[handle];
            if (Math.hypot(local.x - anchor.x, local.y - anchor.y) < 0.5) continue;
            const control = bezierLocalToPage(shape, local);
            context.strokeStyle = selectionTheme.stroke;
            context.beginPath();
            context.moveTo(center.x, center.y);
            context.lineTo(control.x, control.y);
            context.stroke();
            context.fillStyle = selectionTheme.handleFill;
            context.beginPath();
            context.arc(control.x, control.y, 4 / camera.zoom, 0, Math.PI * 2);
            context.fill();
            context.stroke();
          }
          context.fillStyle = selectionTheme.handleFill;
          context.strokeStyle = selectionTheme.stroke;
          context.beginPath();
          context.arc(center.x, center.y, 5 / camera.zoom, 0, Math.PI * 2);
          context.fill();
          context.stroke();
        }
        context.restore();
      }
      const draft = draftRef.current;
      const pointerAction = actionRef.current;
      const penAnchors = penDraftRef.current;
      if (penAnchors.length && editor.getCurrentTool() === "pen") {
        context.save();
        context.strokeStyle = nativeCanvasDisplayColor(drawColor, darkCanvas);
        context.lineWidth = STROKE_WIDTHS[drawSize];
        context.lineCap = "round";
        context.lineJoin = "round";
        traceNativeBezierPath(context, penAnchors, (point) => point);
        context.stroke();
        const last = penAnchors.at(-1)!;
        if (penHoverRef.current && !pointerAction && penAnchors.length > 0) {
          const hover = penHoverRef.current;
          context.setLineDash([5 / camera.zoom, 4 / camera.zoom]);
          context.beginPath();
          context.moveTo(last.x, last.y);
          context.lineTo(hover.x, hover.y);
          context.stroke();
          context.setLineDash([]);
        }
        for (const anchor of penAnchors) {
          if (Math.hypot(anchor.out.x - anchor.x, anchor.out.y - anchor.y) > 0.5) {
            context.globalAlpha = 0.55;
            context.beginPath();
            context.moveTo(anchor.in.x, anchor.in.y);
            context.lineTo(anchor.out.x, anchor.out.y);
            context.stroke();
            context.globalAlpha = 1;
            for (const handle of [anchor.in, anchor.out]) {
              context.beginPath();
              context.arc(handle.x, handle.y, 3 / camera.zoom, 0, Math.PI * 2);
              context.fillStyle = canvasTheme.background;
              context.fill();
              context.stroke();
            }
          }
          context.beginPath();
          context.arc(anchor.x, anchor.y, 4 / camera.zoom, 0, Math.PI * 2);
          context.fillStyle = canvasTheme.background;
          context.fill();
          context.stroke();
        }
        context.restore();
      }
      if (pointerAction?.kind === "draw" && draft.length > 1) {
        context.strokeStyle = COLORS[drawColor]; context.lineWidth = STROKE_WIDTHS[drawSize]; context.lineCap = "round"; context.beginPath(); context.moveTo(draft[0]!.x, draft[0]!.y); for (const point of draft.slice(1)) context.lineTo(point.x, point.y); context.stroke();
      } else if (pointerAction?.kind === "create" && pointerAction.points.length > 1) {
        const start = pointerAction.start;
        const end = pointerAction.points.at(-1)!;
        const activeTool = editor.getCurrentTool();
        context.save();
        context.globalAlpha = 0.82;
        context.strokeStyle = COLORS[color];
        context.fillStyle = "rgba(235,234,253,.62)";
        context.lineWidth = 2.5 / camera.zoom;
        context.lineCap = "round";
        context.lineJoin = "round";
        if (activeTool === "arrow") {
          drawNativeArrow(context, start, end, arrowStyle, 14 / camera.zoom);
        } else if (activeTool === "geo") {
          const x = start.x;
          const y = start.y;
          const w = Math.max(1, end.x - start.x);
          const h = Math.max(1, end.y - start.y);
          const bounds: NativeBounds = {
            x,
            y,
            w,
            h,
            width: w,
            height: h,
            center: { x: x + w / 2, y: y + h / 2 },
          };
          traceGeoPath(context, editor.getNextGeo(), bounds);
          context.fill();
          context.stroke();
        }
        context.restore();
      }
      const marquee = marqueeRef.current;
      if (marquee) {
        const x = Math.min(marquee.start.x, marquee.current.x);
        const y = Math.min(marquee.start.y, marquee.current.y);
        const width = Math.abs(marquee.current.x - marquee.start.x);
        const height = Math.abs(marquee.current.y - marquee.start.y);
        context.fillStyle = selectionTheme.marqueeFill;
        context.strokeStyle = selectionTheme.stroke;
        context.lineWidth = 1.5 / camera.zoom;
        context.setLineDash([6 / camera.zoom, 4 / camera.zoom]);
        context.fillRect(x, y, width, height);
        context.strokeRect(x, y, width, height);
        context.setLineDash([]);
      }
      context.restore();
      editor.setViewport({ ...camera, width: rect.width, height: rect.height });

      const minimap = minimapRef.current;
      if (minimap) {
        const minimapRect = minimap.getBoundingClientRect();
        const minimapRatio = Math.min(2, window.devicePixelRatio || 1);
        const minimapWidth = Math.max(1, Math.round(minimapRect.width * minimapRatio));
        const minimapHeight = Math.max(1, Math.round(minimapRect.height * minimapRatio));
        if (minimap.width !== minimapWidth || minimap.height !== minimapHeight) {
          minimap.width = minimapWidth;
          minimap.height = minimapHeight;
        }
        const mapContext = minimap.getContext("2d");
        if (mapContext) {
          mapContext.setTransform(minimapRatio, 0, 0, minimapRatio, 0, 0);
          mapContext.clearRect(0, 0, minimapRect.width, minimapRect.height);
          mapContext.fillStyle = canvasTheme.minimapBackground;
          mapContext.fillRect(0, 0, minimapRect.width, minimapRect.height);
          const viewport = {
            x: camera.x,
            y: camera.y,
            w: rect.width / camera.zoom,
            h: rect.height / camera.zoom,
          };
          const contentBounds = currentShapes.map(nativeShapeVisualBounds);
          const left = Math.min(viewport.x, ...contentBounds.map((box) => box.x));
          const top = Math.min(viewport.y, ...contentBounds.map((box) => box.y));
          const right = Math.max(viewport.x + viewport.w, ...contentBounds.map((box) => box.x + box.w));
          const bottom = Math.max(viewport.y + viewport.h, ...contentBounds.map((box) => box.y + box.h));
          const padding = 8;
          const mapScale = Math.min(
            (minimapRect.width - padding * 2) / Math.max(1, right - left),
            (minimapRect.height - padding * 2) / Math.max(1, bottom - top),
          );
          minimapTransformRef.current = { left, top, scale: mapScale, padding };
          for (const shape of currentShapes) {
            const box = nativeShapeVisualBounds(shape);
            mapContext.fillStyle = shape.type === "note"
              ? nativeNoteBackgroundColor(shape.props.color)
              : String(shape.props.color) in COLORS
                ? nativeCanvasDisplayColor(String(shape.props.color) as NativeCanvasColor, darkCanvas)
                : "#7c63d9";
            mapContext.globalAlpha = shape.type === "image" ? 0.45 : 0.75;
            mapContext.fillRect(
              padding + (box.x - left) * mapScale,
              padding + (box.y - top) * mapScale,
              Math.max(2, box.w * mapScale),
              Math.max(2, box.h * mapScale),
            );
          }
          mapContext.globalAlpha = 1;
          mapContext.fillStyle = selectionTheme.marqueeFill;
          mapContext.strokeStyle = selectionTheme.stroke;
          mapContext.lineWidth = 1.5;
          const viewportX = padding + (viewport.x - left) * mapScale;
          const viewportY = padding + (viewport.y - top) * mapScale;
          const viewportWidth = Math.max(4, viewport.w * mapScale);
          const viewportHeight = Math.max(4, viewport.h * mapScale);
          mapContext.fillRect(viewportX, viewportY, viewportWidth, viewportHeight);
          mapContext.strokeRect(viewportX, viewportY, viewportWidth, viewportHeight);
        }
      }
      if (hasLoadingImages) drawAgainRef.current();
    });
  }, [arrowStyle, color, drawColor, drawSize, editor, ensureImageLoaded, store]);
  drawAgainRef.current = scheduleDraw;

  useEffect(() => {
    onMount?.(editor);
    const unsubscribe = store.listen(() => { refresh(); scheduleDraw(); });
    const observer = typeof ResizeObserver === "undefined"
      ? undefined
      : new ResizeObserver(() => scheduleDraw());
    const themeObserver = typeof MutationObserver === "undefined"
      ? undefined
      : new MutationObserver(() => {
          setCanvasDark(document.documentElement.dataset.colorScheme === "dark");
          scheduleDraw();
        });
    if (canvasRef.current) observer?.observe(canvasRef.current);
    themeObserver?.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-color-scheme"],
    });
    scheduleDraw();
    requestAnimationFrame(() => editor.fitCurrentPage());
    return () => {
      unsubscribe();
      observer?.disconnect();
      themeObserver?.disconnect();
      if (frameRef.current !== undefined) cancelAnimationFrame(frameRef.current);
      frameRef.current = undefined;
      for (const entry of imageCache.current.values()) entry.image.src = "";
      imageCache.current.clear();
    };
  }, [editor, onMount, refresh, scheduleDraw, store]);

  useEffect(() => { scheduleDraw(); }, [revision, scheduleDraw]);

  useEffect(() => {
    if (!textDraft) return;
    const frame = requestAnimationFrame(() => textInputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [textDraft?.point.x, textDraft?.point.y]);

  const measureTextDraft = useCallback((draft: TextDraft, value = draft.value) => {
    const style = draft.style ?? textStyle;
    const baseFontSize = ({ s: 14, m: 18, l: 24, xl: 32 } as const)[style.size];
    const fontSize = baseFontSize * (draft.shapeScale ?? 1);
    const context = canvasRef.current?.getContext("2d");
    if (context) {
      context.font = `${style.italic ? "italic " : ""}${style.bold ? "700 " : "400 "}${fontSize}px system-ui, sans-serif`;
    }
    return nativeAutoTextBoxSize(
      value,
      fontSize,
      context ? (text) => context.measureText(text).width : undefined,
    );
  }, [textStyle]);

  const beginTextDraft = useCallback((draft: TextDraft) => {
    setTextColorMenu(undefined);
    draftMeasuredSizeRef.current = undefined;
    setDraftMeasuredSize(undefined);
    textDraftRef.current = draft;
    setTextDraft(draft);
  }, []);

  const commitTextDraft = useCallback(() => {
    const draft = textDraftRef.current;
    if (!draft) return;
    textDraftRef.current = undefined;
    setTextColorMenu(undefined);
    const value = draft.value.trim();
    const style = draft.style ?? textStyle;
    const draftColor = draft.color ?? color;
    const estimatedAutoSize = draft.autoSize ? measureTextDraft(draft, value) : undefined;
    const measuredAutoSize = draft.autoSize ? draftMeasuredSizeRef.current : undefined;
    const autoSize = estimatedAutoSize
      ? {
          width: Math.max(estimatedAutoSize.width, measuredAutoSize?.width ?? 0),
          height: Math.max(estimatedAutoSize.height, measuredAutoSize?.height ?? 0),
        }
      : undefined;
    if (draft.shapeId) {
      const shape = editor.getShape(draft.shapeId);
      const shapeScale = Math.max(0.01, draft.shapeScale ?? 1);
      const shapeScaleX = Math.max(0.01, draft.shapeScaleX ?? 1);
      const shapeScaleY = Math.max(0.01, draft.shapeScaleY ?? 1);
      editor.updateShapes([{
        id: draft.shapeId,
        props: {
          richText: nativeRichText(value),
          size: style.size,
          bold: style.bold,
          italic: style.italic,
          underline: style.underline,
          textAlign: style.textAlign,
          ...(shape?.type === "text" && autoSize
            ? {
                w: autoSize.width / shapeScale / shapeScaleX,
                h: autoSize.height / shapeScale / shapeScaleY,
              }
            : {}),
          ...(shape?.type === "note"
            ? { labelColor: draftColor }
            : { color: draftColor }),
        },
      }]);
      if (!editor.selectGroupMemberForEditing(draft.shapeId)) {
        editor.select(draft.shapeId);
      }
    } else if (value) {
      const size = autoSize ?? measureTextDraft({ ...draft, autoSize: true }, value);
      editor.createShapes([{
        type: "text",
        x: draft.point.x,
        y: draft.point.y,
        parentId: editor.getCurrentPageId(),
        props: {
          w: size.width,
          h: size.height,
          richText: nativeRichText(value),
          color: draftColor,
          size: style.size,
          bold: style.bold,
          italic: style.italic,
          underline: style.underline,
          textAlign: style.textAlign,
          scale: 1,
        },
      }]);
    }
    setTextDraft(undefined);
    scheduleDraw();
  }, [color, editor, measureTextDraft, scheduleDraw, textStyle]);

  const cancelTextDraft = useCallback(() => {
    textDraftRef.current = undefined;
    setTextColorMenu(undefined);
    setTextDraft(undefined);
    scheduleDraw();
  }, [scheduleDraw]);

  const hitShape = useCallback((point: NativePoint) => {
    const tolerance = 8 / cameraRef.current.zoom;
    return [...visibleShapes(store.snapshot)].reverse().find((shape) => {
      const box = nativeShapeBounds(shape);
      const rotation = (Number(shape.rotation) || 0) * Math.PI / 180;
      const localPoint = rotation
        ? rotatePoint(point, box.center, -rotation)
        : point;
      return localPoint.x >= box.x - tolerance && localPoint.x <= box.x + box.w + tolerance && localPoint.y >= box.y - tolerance && localPoint.y <= box.y + box.h + tolerance;
    });
  }, [store]);

  const hitArrowAtPoint = useCallback((point: NativePoint) => (
    [...visibleShapes(store.snapshot)].reverse().find((shape) => (
      shape.type === "arrow" && hitArrowBody(point, shape, cameraRef.current.zoom)
    ))
  ), [store]);

  const finishPenDraft = useCallback((closed = false) => {
    const anchors = penDraftRef.current;
    penDraftRef.current = [];
    penHoverRef.current = undefined;
    actionRef.current = undefined;
    const pageId = penDraftPageIdRef.current ?? editor.getCurrentPageId();
    penDraftPageIdRef.current = undefined;
    if (anchors.length < 2) {
      scheduleDraw();
      return;
    }
    const origin = anchors[0]!;
    const relative = anchors.map((anchor) => ({
      x: anchor.x - origin.x,
      y: anchor.y - origin.y,
      in: { x: anchor.in.x - origin.x, y: anchor.in.y - origin.y },
      out: { x: anchor.out.x - origin.x, y: anchor.out.y - origin.y },
    }));
    const id = createNativeShapeId();
    editor.createShapes([{
      id,
      type: "bezier",
      x: origin.x,
      y: origin.y,
      parentId: pageId,
      props: { anchors: relative, isClosed: closed, color: drawColor, size: drawSize, scale: 1 },
    }]);
    if (pageId === editor.getCurrentPageId()) editor.select(id);
    scheduleDraw();
  }, [drawColor, drawSize, editor, scheduleDraw]);

  useEffect(() => {
    if (penDraftRef.current.length && (
      editor.getCurrentTool() !== "pen" || penDraftPageIdRef.current !== editor.getCurrentPageId()
    )) finishPenDraft();
  });

  useEffect(() => {
    const handlePenKey = (event: KeyboardEvent) => {
      if (editor.getCurrentTool() !== "pen" || !penDraftRef.current.length) return;
      if (event.key === "Enter") {
        event.preventDefault();
        finishPenDraft();
      } else if (event.key === "Escape") {
        event.preventDefault();
        penDraftRef.current = [];
        penDraftPageIdRef.current = undefined;
        penHoverRef.current = undefined;
        actionRef.current = undefined;
        scheduleDraw();
      }
    };
    window.addEventListener("keydown", handlePenKey, true);
    return () => window.removeEventListener("keydown", handlePenKey, true);
  }, [editor, finishPenDraft, scheduleDraw]);

  const beginDirectResize = useCallback((
    event: React.PointerEvent<HTMLCanvasElement>,
    point: NativePoint,
    selectedShapes: NativeWhiteboardShape[],
  ): boolean => {
    const frame = selectionFrame(selectedShapes);
    const corner = hitResizeHandle(point, frame, cameraRef.current.zoom);
    const edge = !corner && selectionSupportsEdgeResize(selectedShapes)
      ? hitEdgeResizeHandle(point, frame, cameraRef.current.zoom)
      : undefined;
    if (!frame || (!corner && !edge)) return false;
    event.currentTarget.setPointerCapture(event.pointerId);
    if (corner) {
      actionRef.current = {
        kind: "resize",
        anchor: resizeHandlePoint(frame, oppositeResizeCorner(corner)),
        start: resizeHandlePoint(frame, corner),
        corner,
        origins: new Map(selectedShapes.map((shape) => [shape.id, {
          x: shape.x,
          y: shape.y,
          scale: Math.max(0.01, Math.abs(Number(shape.props.scale) || 1)),
        }])),
        changed: false,
      };
      event.currentTarget.style.setProperty("cursor", resizeCursor(corner, frame.rotation), "important");
      return true;
    }
    const anchor = edgeResizeHandlePoint(frame, oppositeResizeEdge(edge!));
    const start = edgeResizeHandlePoint(frame, edge!);
    const distance = Math.max(0.0001, Math.hypot(start.x - anchor.x, start.y - anchor.y));
    actionRef.current = {
      kind: "stretch",
      anchor,
      start,
      edge: edge!,
      axis: { x: (start.x - anchor.x) / distance, y: (start.y - anchor.y) / distance },
      origins: new Map(selectedShapes.map((shape) => [shape.id, {
        x: shape.x,
        y: shape.y,
        center: nativeShapeBounds(shape).center,
        scaleX: Math.max(0.01, Math.abs(Number(shape.props.scaleX) || 1)),
        scaleY: Math.max(0.01, Math.abs(Number(shape.props.scaleY) || 1)),
      }])),
      changed: false,
    };
    event.currentTarget.style.setProperty("cursor", edgeResizeCursor(edge!, frame.rotation), "important");
    return true;
  }, []);

  const pointerDown = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    if (textDraftRef.current) commitTextDraft();
    const point = eventPoint(event);
    const tool = editor.getCurrentTool();
    const hit = hitShape(point);
    if (event.button === 2) return;
    if ((tool === "text" || tool === "geo") && event.button === 0) {
      const acceptedTypes = tool === "text" ? new Set(["text", "note"]) : new Set(["geo"]);
      const selectionIds = editor.getSelectedShapeIds();
      const directSelection = selectionIds
        .map((id) => editor.getShape(id))
        .filter((shape): shape is NativeWhiteboardShape => Boolean(shape && acceptedTypes.has(shape.type)));
      if (directSelection.length === selectionIds.length && beginDirectResize(event, point, directSelection)) return;
    }
    if (tool === "text" && event.button === 0) {
      const movableHit = hit && ["text", "note"].includes(hit.type) ? hit : undefined;
      if (movableHit) {
        event.currentTarget.setPointerCapture(event.pointerId);
        editor.select(movableHit.id);
        actionRef.current = {
          kind: "move",
          start: point,
          origins: new Map([[movableHit.id, { x: movableHit.x, y: movableHit.y }]]),
          changed: false,
        };
        event.currentTarget.style.setProperty("cursor", "move", "important");
        return;
      }
      if (hit?.type === "geo") {
        editor.select(hit.id);
        return;
      }
      beginTextDraft({ point, value: "", autoSize: true });
      editor.select();
      scheduleDraw();
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    if (tool === "hand" || event.button === 1) {
      event.currentTarget.dataset.panning = "true";
      event.currentTarget.style.setProperty("cursor", "grabbing", "important");
      actionRef.current = { kind: "pan", start: { x: event.clientX, y: event.clientY }, camera: { ...cameraRef.current } };
      return;
    }
    if ((tool === "select" || (tool === "pen" && penDraftRef.current.length === 0)) && editor.getSelectedShapeIds().length === 1) {
      const selectedShape = editor.getShape(editor.getSelectedShapeIds()[0]!);
      const handle = hitBezierHandle(point, selectedShape, cameraRef.current.zoom);
      if (selectedShape && handle) {
        if (event.altKey && handle.handle === "anchor") {
          const anchors = nativeBezierAnchors(selectedShape);
          const minimum = selectedShape.props.isClosed === true ? 3 : 2;
          if (anchors.length > minimum) {
            editor.updateShapes([{ id: selectedShape.id, props: { anchors: anchors.filter((_, index) => index !== handle.index) } }]);
            scheduleDraw();
          }
          return;
        }
        actionRef.current = {
          kind: "bezier-handle",
          id: selectedShape.id,
          shape: structuredClone(selectedShape),
          index: handle.index,
          handle: handle.handle,
          start: bezierPageToLocal(selectedShape, point),
          anchors: nativeBezierAnchors(selectedShape).map((anchor) => ({
            x: anchor.x, y: anchor.y, in: { ...anchor.in }, out: { ...anchor.out },
          })),
          changed: false,
        };
        event.currentTarget.style.setProperty("cursor", "grabbing", "important");
        return;
      }
    }
    if (tool === "pen") {
      const anchors = penDraftRef.current;
      if (anchors.length >= 3 && Math.hypot(point.x - anchors[0]!.x, point.y - anchors[0]!.y) * cameraRef.current.zoom <= 10) {
        finishPenDraft(true);
        return;
      }
      if (event.detail >= 2 && anchors.length >= 2) {
        finishPenDraft();
        return;
      }
      if (!anchors.length) penDraftPageIdRef.current = editor.getCurrentPageId();
      anchors.push({ x: point.x, y: point.y, in: { ...point }, out: { ...point } });
      penHoverRef.current = undefined;
      actionRef.current = { kind: "pen-handle", index: anchors.length - 1 };
      scheduleDraw();
      return;
    }
    if (tool === "eraser") {
      if (hit) editor.deleteShapes([hit.id]);
      return;
    }
    if (tool === "geo" && event.button === 0) {
      const movableHit = hit?.type === "geo" ? hit : undefined;
      if (movableHit) {
        editor.select(movableHit.id);
        actionRef.current = {
          kind: "move",
          start: point,
          origins: new Map([[movableHit.id, { x: movableHit.x, y: movableHit.y }]]),
          changed: false,
        };
        event.currentTarget.style.setProperty("cursor", "move", "important");
        return;
      }
    }
    if ((tool === "select" || tool === "arrow") && event.button === 0) {
      const selectedArrow = editor.getSelectedShapeIds().length === 1
        ? editor.getShape(editor.getSelectedShapeIds()[0]!)
        : undefined;
      const endpoint = hitArrowEndpoint(point, selectedArrow, cameraRef.current.zoom);
      const endpoints = selectedArrow && endpoint ? nativeArrowEndpoints(selectedArrow) : undefined;
      if (selectedArrow && endpoint && endpoints) {
        actionRef.current = {
          kind: "arrow-endpoint",
          id: selectedArrow.id,
          endpoint,
          start: endpoints.start,
          end: endpoints.end,
          changed: false,
        };
        event.currentTarget.style.setProperty("cursor", "grabbing", "important");
        return;
      }
      if (tool === "arrow") {
        const arrowHit = hitArrowAtPoint(point);
        if (arrowHit) {
          if (!editor.selectGroupMemberForEditing(arrowHit.id)) editor.select(arrowHit.id);
          const directEndpoint = hitArrowEndpoint(point, arrowHit, cameraRef.current.zoom);
          const directEndpoints = directEndpoint ? nativeArrowEndpoints(arrowHit) : undefined;
          if (directEndpoint && directEndpoints) {
            actionRef.current = {
              kind: "arrow-endpoint",
              id: arrowHit.id,
              endpoint: directEndpoint,
              start: directEndpoints.start,
              end: directEndpoints.end,
              changed: false,
            };
            event.currentTarget.style.setProperty("cursor", "grabbing", "important");
          } else {
            actionRef.current = {
              kind: "move",
              start: point,
              origins: new Map([[arrowHit.id, { x: arrowHit.x, y: arrowHit.y }]]),
              changed: false,
            };
            event.currentTarget.style.setProperty("cursor", "move", "important");
          }
          scheduleDraw();
          return;
        }
      }
    }
    if (tool === "select") {
      const selectedShapes = editor.getSelectedShapeIds()
        .map((id) => editor.getShape(id))
        .filter((shape): shape is NativeWhiteboardShape => Boolean(shape));
      const frame = selectionFrame(selectedShapes);
      const expandedGroupId = selectedExpandedGroupId(selectedShapes);
      if (frame && expandedGroupId && pointInNativeBounds(
        point,
        nativeExpandedGroupCollapseButtonBounds(frame, cameraRef.current.zoom),
      )) {
        editor.collapseSelectedGroup();
        event.currentTarget.style.setProperty("cursor", "pointer", "important");
        scheduleDraw();
        return;
      }
      if (hit?.type === "group-folder" && pointInNativeBounds(
        point,
        nativeGroupFolderToggleButtonBounds(nativeShapeBounds(hit)),
      )) {
        editor.expandGroupFolder(hit.id);
        event.currentTarget.style.setProperty("cursor", "pointer", "important");
        scheduleDraw();
        return;
      }
      const resizeCorner = hitResizeHandle(point, frame, cameraRef.current.zoom);
      const resizeEdge = !resizeCorner && selectionSupportsEdgeResize(selectedShapes)
        ? hitEdgeResizeHandle(point, frame, cameraRef.current.zoom)
        : undefined;
      const rotationCorner = resizeCorner || resizeEdge
        ? undefined
        : hitRotationCorner(point, frame, cameraRef.current.zoom);
      if (frame && rotationCorner) {
        const origins = new Map(selectedShapes.map((shape) => [shape.id, {
          x: shape.x,
          y: shape.y,
          rotation: Number(shape.rotation) || 0,
          center: nativeShapeBounds(shape).center,
        }]));
        actionRef.current = {
          kind: "rotate",
          center: frame.center,
          startAngle: Math.atan2(point.y - frame.center.y, point.x - frame.center.x),
          origins,
          changed: false,
        };
        event.currentTarget.style.setProperty("cursor", "grabbing", "important");
        return;
      }
      const corner = resizeCorner;
      if (frame && corner) {
        const origins = new Map(selectedShapes.map((shape) => [shape.id, {
          x: shape.x,
          y: shape.y,
          scale: Math.max(0.01, Math.abs(Number(shape.props.scale) || 1)),
        }]));
        actionRef.current = {
          kind: "resize",
          anchor: resizeHandlePoint(frame, oppositeResizeCorner(corner)),
          start: resizeHandlePoint(frame, corner),
          corner,
          origins,
          changed: false,
        };
        event.currentTarget.style.setProperty("cursor", resizeCursor(corner, frame.rotation), "important");
        return;
      }
      if (frame && resizeEdge) {
        const anchor = edgeResizeHandlePoint(frame, oppositeResizeEdge(resizeEdge));
        const start = edgeResizeHandlePoint(frame, resizeEdge);
        const distance = Math.max(0.0001, Math.hypot(start.x - anchor.x, start.y - anchor.y));
        const origins = new Map(selectedShapes.map((shape) => [shape.id, {
          x: shape.x,
          y: shape.y,
          center: nativeShapeBounds(shape).center,
          scaleX: Math.max(0.01, Math.abs(Number(shape.props.scaleX) || 1)),
          scaleY: Math.max(0.01, Math.abs(Number(shape.props.scaleY) || 1)),
        }]));
        actionRef.current = {
          kind: "stretch",
          anchor,
          start,
          edge: resizeEdge,
          axis: {
            x: (start.x - anchor.x) / distance,
            y: (start.y - anchor.y) / distance,
          },
          origins,
          changed: false,
        };
        event.currentTarget.style.setProperty(
          "cursor",
          edgeResizeCursor(resizeEdge, frame.rotation),
          "important",
        );
        return;
      }
      if (!hit) {
        const initial = editor.getSelectedShapeIds();
        if (!event.shiftKey) editor.select();
        const action = { kind: "marquee" as const, start: point, current: point, initial, additive: event.shiftKey };
        actionRef.current = action;
        marqueeRef.current = { start: point, current: point };
        scheduleDraw();
        return;
      }
      const selected = editor.getSelectedShapeIds();
      if (event.shiftKey && !selected.includes(hit.id)) editor.setSelection([...selected, hit.id]);
      else if (!selected.includes(hit.id)) editor.select(hit.id);
      const origins = new Map(editor.getSelectedShapeIds().map((id) => { const shape = editor.getShape(id)!; return [id, { x: shape.x, y: shape.y }]; }));
      actionRef.current = { kind: "move", start: point, origins, changed: false };
      return;
    }
    draftRef.current = [point];
    actionRef.current = { kind: tool === "draw" ? "draw" : "create", start: point, points: [point] };
    scheduleDraw();
  }, [beginDirectResize, beginTextDraft, commitTextDraft, editor, eventPoint, finishPenDraft, hitArrowAtPoint, hitShape, scheduleDraw]);

  const pointerMove = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const action = actionRef.current;
    if (!action) {
      const tool = editor.getCurrentTool();
      const point = eventPoint(event);
      const selectedShape = editor.getSelectedShapeIds().length === 1
        ? editor.getShape(editor.getSelectedShapeIds()[0]!) : undefined;
      if ((tool === "select" || tool === "pen") && hitBezierHandle(point, selectedShape, cameraRef.current.zoom)) {
        event.currentTarget.style.setProperty("cursor", "grab", "important");
        return;
      }
      if (tool === "pen") {
        penHoverRef.current = point;
        scheduleDraw();
        return;
      }
      const selectedArrow = editor.getSelectedShapeIds().length === 1
        ? editor.getShape(editor.getSelectedShapeIds()[0]!)
        : undefined;
      const hoveredArrow = tool === "arrow" ? hitArrowAtPoint(point) : undefined;
      const endpointArrow = tool === "arrow" ? hoveredArrow ?? selectedArrow : selectedArrow;
      if ((tool === "select" || tool === "arrow") && hitArrowEndpoint(
        point,
        endpointArrow,
        cameraRef.current.zoom,
      )) {
        event.currentTarget.style.setProperty("cursor", "grab", "important");
      } else if (tool === "arrow" && hoveredArrow) {
        event.currentTarget.style.setProperty("cursor", "move", "important");
      } else if (tool === "text" || tool === "geo") {
        const acceptedTypes = tool === "text" ? new Set(["text", "note"]) : new Set(["geo"]);
        const selectionIds = editor.getSelectedShapeIds();
        const selectedShapes = selectionIds
          .map((id) => editor.getShape(id))
          .filter((shape): shape is NativeWhiteboardShape => Boolean(shape && acceptedTypes.has(shape.type)));
        const frame = selectedShapes.length === selectionIds.length
          ? selectionFrame(selectedShapes)
          : undefined;
        const corner = hitResizeHandle(point, frame, cameraRef.current.zoom);
        const edge = !corner && selectionSupportsEdgeResize(selectedShapes)
          ? hitEdgeResizeHandle(point, frame, cameraRef.current.zoom)
          : undefined;
        const hoveredShape = hitShape(point);
        if (corner) event.currentTarget.style.setProperty("cursor", resizeCursor(corner, frame?.rotation), "important");
        else if (edge) event.currentTarget.style.setProperty("cursor", edgeResizeCursor(edge, frame?.rotation), "important");
        else if (hoveredShape && acceptedTypes.has(hoveredShape.type)) event.currentTarget.style.setProperty("cursor", "move", "important");
        else event.currentTarget.style.removeProperty("cursor");
      } else if (tool === "select") {
        const selectedShapes = editor.getSelectedShapeIds()
          .map((id) => editor.getShape(id))
          .filter((shape): shape is NativeWhiteboardShape => Boolean(shape));
        const frame = selectionFrame(selectedShapes);
        const corner = hitResizeHandle(point, frame, cameraRef.current.zoom);
        const edge = !corner && selectionSupportsEdgeResize(selectedShapes)
          ? hitEdgeResizeHandle(point, frame, cameraRef.current.zoom)
          : undefined;
        const rotationCorner = corner || edge
          ? undefined
          : hitRotationCorner(point, frame, cameraRef.current.zoom);
        const expandedGroupId = selectedExpandedGroupId(selectedShapes);
        const collapseButton = frame && expandedGroupId
          ? nativeExpandedGroupCollapseButtonBounds(frame, cameraRef.current.zoom)
          : undefined;
        const hoveredShape = hitShape(point);
        const folderButton = hoveredShape?.type === "group-folder"
          ? nativeGroupFolderToggleButtonBounds(nativeShapeBounds(hoveredShape))
          : undefined;
        if ((collapseButton && pointInNativeBounds(point, collapseButton)) ||
          (folderButton && pointInNativeBounds(point, folderButton))) {
          event.currentTarget.style.setProperty("cursor", "pointer", "important");
        } else if (corner) event.currentTarget.style.setProperty("cursor", resizeCursor(corner, frame?.rotation), "important");
        else if (edge) event.currentTarget.style.setProperty("cursor", edgeResizeCursor(edge, frame?.rotation), "important");
        else if (rotationCorner) event.currentTarget.style.setProperty("cursor", ROTATION_CURSOR, "important");
        else if (hoveredShape?.type === "group-folder") event.currentTarget.style.setProperty("cursor", "move", "important");
        else event.currentTarget.style.removeProperty("cursor");
      } else event.currentTarget.style.removeProperty("cursor");
      return;
    }
    if (action.kind === "pan") {
      cameraRef.current = { ...cameraRef.current, x: action.camera.x - (event.clientX - action.start.x) / cameraRef.current.zoom, y: action.camera.y - (event.clientY - action.start.y) / cameraRef.current.zoom };
      refresh(); scheduleDraw(); return;
    }
    const point = eventPoint(event);
    if (action.kind === "bezier-handle") {
      const shape = editor.getShape(action.id);
      if (!shape) return;
      const local = bezierPageToLocal(action.shape, point);
      const dx = local.x - action.start.x;
      const dy = local.y - action.start.y;
      if (Math.hypot(dx, dy) < 0.001 && !action.changed) return;
      action.changed = true;
      const anchors = action.anchors.map((anchor) => ({
        x: anchor.x, y: anchor.y, in: { ...anchor.in }, out: { ...anchor.out },
      }));
      const anchor = anchors[action.index];
      const origin = action.anchors[action.index];
      if (!anchor || !origin) return;
      if (action.handle === "anchor") {
        anchor.x = origin.x + dx;
        anchor.y = origin.y + dy;
        anchor.in = { x: origin.in.x + dx, y: origin.in.y + dy };
        anchor.out = { x: origin.out.x + dx, y: origin.out.y + dy };
      } else {
        anchor[action.handle] = { x: origin[action.handle].x + dx, y: origin[action.handle].y + dy };
        if (!event.altKey) {
          const opposite = action.handle === "in" ? "out" : "in";
          const originalOpposite = origin[opposite];
          const originalLength = Math.hypot(originalOpposite.x - origin.x, originalOpposite.y - origin.y);
          const vx = anchor[action.handle].x - anchor.x;
          const vy = anchor[action.handle].y - anchor.y;
          const movedLength = Math.hypot(vx, vy);
          if (originalLength > 0.001 && movedLength > 0.001) {
            anchor[opposite] = { x: anchor.x - vx * originalLength / movedLength, y: anchor.y - vy * originalLength / movedLength };
          }
        }
      }
      store.mutate((snapshot) => {
        const current = snapshot.document.store[action.id];
        if (isNativeShape(current)) current.props = { ...current.props, anchors };
      }, "document", false);
      refresh(); scheduleDraw();
      return;
    }
    if (action.kind === "pen-handle") {
      const anchor = penDraftRef.current[action.index];
      if (anchor) {
        anchor.out = { x: point.x, y: point.y };
        anchor.in = { x: 2 * anchor.x - point.x, y: 2 * anchor.y - point.y };
        scheduleDraw();
      }
      return;
    }
    if (action.kind === "marquee") {
      action.current = point;
      marqueeRef.current = { start: action.start, current: point };
      scheduleDraw();
      return;
    }
    if (action.kind === "arrow-endpoint") {
      const start = action.endpoint === "start" ? point : action.start;
      const end = action.endpoint === "end" ? point : action.end;
      const changed = Math.hypot(
        point.x - (action.endpoint === "start" ? action.start.x : action.end.x),
        point.y - (action.endpoint === "start" ? action.start.y : action.end.y),
      ) > 0.001;
      if (!changed && !action.changed) return;
      action.changed = action.changed || changed;
      store.mutate((snapshot) => {
        const shape = snapshot.document.store[action.id];
        if (!isNativeShape(shape)) return;
        shape.x = start.x;
        shape.y = start.y;
        shape.rotation = 0;
        shape.props = {
          ...shape.props,
          start: { x: 0, y: 0 },
          end: { x: end.x - start.x, y: end.y - start.y },
          scale: 1,
          scaleX: 1,
          scaleY: 1,
        };
      }, "document", false);
      refresh();
      scheduleDraw();
      return;
    }
    if (action.kind === "move") {
      let dx = point.x - action.start.x, dy = point.y - action.start.y;
      if (event.shiftKey) {
        if (!action.axis && Math.hypot(dx, dy) > 3 / cameraRef.current.zoom) action.axis = Math.abs(dx) >= Math.abs(dy) ? "x" : "y";
        if (action.axis === "x") dy = 0;
        else if (action.axis === "y") dx = 0;
      } else delete action.axis;
      const moved = Math.abs(dx) > 0.001 || Math.abs(dy) > 0.001;
      if (!moved && !action.changed) return;
      action.changed = action.changed || moved;
      store.mutate((snapshot) => { for (const [id, origin] of action.origins) { const shape = snapshot.document.store[id]; if (isNativeShape(shape)) { shape.x = origin.x + dx; shape.y = origin.y + dy; if (isMindMapNode(shape)) shape.props = { ...shape.props, mokiMindMapAutoManaged: false }; } } }, "document", false);
      refresh(); scheduleDraw(); return;
    }
    if (action.kind === "resize") {
      const startVector = {
        x: action.start.x - action.anchor.x,
        y: action.start.y - action.anchor.y,
      };
      const currentVector = {
        x: point.x - action.anchor.x,
        y: point.y - action.anchor.y,
      };
      const denominator = startVector.x ** 2 + startVector.y ** 2;
      const factor = Math.max(
        0.05,
        Math.min(50, denominator > 0
          ? (currentVector.x * startVector.x + currentVector.y * startVector.y) / denominator
          : 1),
      );
      const resized = Math.abs(factor - 1) > 0.0001;
      if (!resized && !action.changed) return;
      action.changed = action.changed || resized;
      store.mutate((snapshot) => {
        for (const [id, origin] of action.origins) {
          const shape = snapshot.document.store[id];
          if (!isNativeShape(shape)) continue;
          shape.x = action.anchor.x + (origin.x - action.anchor.x) * factor;
          shape.y = action.anchor.y + (origin.y - action.anchor.y) * factor;
          shape.props = { ...shape.props, scale: origin.scale * factor };
        }
      }, "document", false);
      refresh(); scheduleDraw();
      return;
    }
    if (action.kind === "stretch") {
      const startDistance =
        (action.start.x - action.anchor.x) * action.axis.x +
        (action.start.y - action.anchor.y) * action.axis.y;
      const currentDistance =
        (point.x - action.anchor.x) * action.axis.x +
        (point.y - action.anchor.y) * action.axis.y;
      const factor = Math.max(
        0.05,
        Math.min(50, Math.abs(startDistance) > 0.0001
          ? currentDistance / startDistance
          : 1),
      );
      const stretched = Math.abs(factor - 1) > 0.0001;
      if (!stretched && !action.changed) return;
      action.changed = action.changed || stretched;
      const horizontal = action.edge === "e" || action.edge === "w";
      store.mutate((snapshot) => {
        for (const [id, origin] of action.origins) {
          const shape = snapshot.document.store[id];
          if (!isNativeShape(shape)) continue;
          const centerOffset = {
            x: origin.center.x - action.anchor.x,
            y: origin.center.y - action.anchor.y,
          };
          const parallelDistance =
            centerOffset.x * action.axis.x + centerOffset.y * action.axis.y;
          const desiredCenter = {
            x: origin.center.x + action.axis.x * parallelDistance * (factor - 1),
            y: origin.center.y + action.axis.y * parallelDistance * (factor - 1),
          };
          shape.x = origin.x;
          shape.y = origin.y;
          shape.props = {
            ...shape.props,
            ...(horizontal
              ? { scaleX: origin.scaleX * factor }
              : { scaleY: origin.scaleY * factor }),
          };
          const resizedBounds = nativeShapeBounds(shape);
          shape.x += desiredCenter.x - resizedBounds.center.x;
          shape.y += desiredCenter.y - resizedBounds.center.y;
        }
      }, "document", false);
      refresh(); scheduleDraw();
      return;
    }
    if (action.kind === "rotate") {
      const angle = Math.atan2(point.y - action.center.y, point.x - action.center.x);
      let delta = (angle - action.startAngle) * 180 / Math.PI;
      if (event.shiftKey) delta = Math.round(delta / 90) * 90;
      const rotated = Math.abs(delta) > 0.0001;
      if (!rotated && !action.changed) return;
      action.changed = action.changed || rotated;
      const radians = delta * Math.PI / 180;
      store.mutate((snapshot) => {
        for (const [id, origin] of action.origins) {
          const shape = snapshot.document.store[id];
          if (!isNativeShape(shape)) continue;
          const nextCenter = rotatePoint(origin.center, action.center, radians);
          shape.x = origin.x + nextCenter.x - origin.center.x;
          shape.y = origin.y + nextCenter.y - origin.center.y;
          shape.rotation = origin.rotation + delta;
        }
      }, "document", false);
      refresh(); scheduleDraw();
      return;
    }
    action.points.push(point); draftRef.current = action.points; scheduleDraw();
  }, [editor, eventPoint, hitArrowAtPoint, hitShape, refresh, scheduleDraw, store]);

  const pointerUp = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    delete event.currentTarget.dataset.panning;
    event.currentTarget.style.removeProperty("cursor");
    const action = actionRef.current; actionRef.current = undefined;
    if (!action) return;
    if (action.kind === "move" || action.kind === "resize" || action.kind === "stretch" || action.kind === "rotate" || action.kind === "arrow-endpoint" || action.kind === "bezier-handle") {
      if (action.changed) {
        store.mutate((snapshot) => touchPageEdited(snapshot, editor.getCurrentPageId()), "document", false);
        store.touch("document");
      }
      return;
    }
    if (action.kind === "pan") return;
    if (action.kind === "pen-handle") {
      const anchor = penDraftRef.current[action.index];
      if (anchor) {
        const point = eventPoint(event);
        anchor.out = { x: point.x, y: point.y };
        anchor.in = { x: 2 * anchor.x - point.x, y: 2 * anchor.y - point.y };
      }
      scheduleDraw();
      return;
    }
    if (action.kind === "marquee") {
      const left = Math.min(action.start.x, action.current.x);
      const top = Math.min(action.start.y, action.current.y);
      const right = Math.max(action.start.x, action.current.x);
      const bottom = Math.max(action.start.y, action.current.y);
      const isClick = (right - left) * cameraRef.current.zoom < 4 && (bottom - top) * cameraRef.current.zoom < 4;
      const matches = isClick ? [] : visibleShapes(store.snapshot)
        .filter((shape) => {
          const bounds = nativeShapeBounds(shape);
          return bounds.x <= right && bounds.x + bounds.w >= left && bounds.y <= bottom && bounds.y + bounds.h >= top;
        })
        .map((shape) => shape.id);
      editor.setSelection(action.additive ? [...new Set([...action.initial, ...matches])] : matches);
      marqueeRef.current = undefined;
      scheduleDraw();
      return;
    }
    const end = eventPoint(event); const pageId = editor.getCurrentPageId(); const tool = editor.getCurrentTool();
    const minX = Math.min(action.start.x, end.x), minY = Math.min(action.start.y, end.y);
    const dragDistance = Math.hypot(end.x - action.start.x, end.y - action.start.y) * cameraRef.current.zoom;
    if (action.kind === "create" && (tool === "arrow" || tool === "geo") && dragDistance < 4) {
      draftRef.current = [];
      scheduleDraw();
      return;
    }
    if (action.kind === "draw") {
      const source = action.points.length > 1 ? action.points : [action.start, end];
      const points = source.map((point) => ({ x: point.x - minX, y: point.y - minY }));
      editor.createShapes([{ type: "draw", x: minX, y: minY, parentId: pageId, props: { points, color: drawColor, size: drawSize, isComplete: true, isClosed: false, scale: 1 } }]);
    } else if (tool === "arrow") {
      const id = createNativeShapeId();
      editor.createShapes([{ id, type: "arrow", x: action.start.x, y: action.start.y, parentId: pageId, props: { start: { x: 0, y: 0 }, end: { x: end.x - action.start.x, y: end.y - action.start.y }, color, size: "m", arrowStyle } }]);
      editor.select(id);
    } else if (tool === "geo") {
      const id = createNativeShapeId();
      const width = Math.max(80, end.x - action.start.x);
      const height = Math.max(60, end.y - action.start.y);
      editor.createShapes([{
        id,
        type: "geo",
        x: action.start.x,
        y: action.start.y,
        parentId: pageId,
        props: {
          w: width,
          h: height,
          geo: editor.getNextGeo(),
          size: drawSize,
          color: geoPaintStyle.strokeColor,
          strokeEnabled: geoPaintStyle.strokeEnabled,
          strokeColor: geoPaintStyle.strokeColor,
          strokeOpacity: geoPaintStyle.strokeOpacity,
          fillEnabled: geoPaintStyle.fillEnabled,
          fillColor: geoPaintStyle.fillColor,
          fillOpacity: geoPaintStyle.fillOpacity,
          richText: nativeRichText(""),
          scale: 1,
        },
      }]);
      editor.select(id);
    }
    draftRef.current = []; scheduleDraw();
  }, [arrowStyle, color, drawColor, drawSize, editor, eventPoint, geoPaintStyle, scheduleDraw, store]);

  const doubleClick = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
    const tool = editor.getCurrentTool();
    if (tool === "pen") {
      event.preventDefault();
      const anchors = penDraftRef.current;
      if (anchors.length > 2) {
        const last = anchors.at(-1)!;
        const previous = anchors.at(-2)!;
        if (Math.hypot(last.x - previous.x, last.y - previous.y) * cameraRef.current.zoom <= 4) anchors.pop();
      }
      finishPenDraft();
      return;
    }
    if (tool !== "select" && tool !== "text") return;
    if (tool === "select" && editor.getSelectedShapeIds().length === 1) {
      const selectedShape = editor.getShape(editor.getSelectedShapeIds()[0]!);
      if (selectedShape?.type === "bezier") {
        const point = eventPoint(event);
        if (hitBezierHandle(point, selectedShape, cameraRef.current.zoom)) return;
        const segment = hitBezierSegment(point, selectedShape, cameraRef.current.zoom);
        if (segment) {
          event.preventDefault();
          editor.updateShapes([{
            id: selectedShape.id,
            props: { anchors: insertBezierAnchor(nativeBezierAnchors(selectedShape), segment.index, segment.t) },
          }]);
          scheduleDraw();
          return;
        }
      }
    }
    const shape = hitShape(eventPoint(event));
    if (shape?.type === "group-folder") {
      event.preventDefault();
      editor.expandGroupFolder(shape.id);
      scheduleDraw();
      return;
    }
    const editingGroupMember = shape
      ? editor.selectGroupMemberForEditing(shape.id)
      : false;
    if (shape?.type === "resource") {
      const libraryItemId = typeof shape.props.libraryItemId === "string"
        ? shape.props.libraryItemId
        : "";
      const localPath = typeof shape.props.localPath === "string"
        ? shape.props.localPath
        : "";
      if (libraryItemId) {
        event.preventDefault();
        if (!editingGroupMember) editor.select(shape.id);
        void onResourceOpen?.(libraryItemId);
      } else if (localPath) {
        event.preventDefault();
        if (!editingGroupMember) editor.select(shape.id);
        void onLocalPathOpen?.(localPath);
      }
      return;
    }
    if (shape?.type === "media") {
      const localPath = typeof shape.props.localPath === "string" ? shape.props.localPath : "";
      if (localPath) {
        event.preventDefault();
        if (!editingGroupMember) editor.select(shape.id);
        void onLocalPathOpen?.(localPath);
      }
      return;
    }
    if (editingGroupMember && !["note", "text", "geo"].includes(shape!.type)) {
      event.preventDefault();
      scheduleDraw();
      return;
    }
    if (!shape || !["note", "text", "geo"].includes(shape.type)) return;
    event.preventDefault();
    const bounds = nativeShapeBounds(shape);
    const size = ["s", "m", "l", "xl"].includes(String(shape.props.size))
      ? shape.props.size as NativeTextStyle["size"]
      : "m";
    const align = String(shape.props.textAlign ?? shape.props.align ?? "start");
    const shapeColor = String(
      shape.type === "note"
        ? shape.props.labelColor ?? "black"
        : shape.props.color ?? "black",
    );
    if (!editingGroupMember) editor.select(shape.id);
    beginTextDraft({
      point: { x: bounds.x, y: bounds.y },
      value: nativeRichTextValue(shape.props.richText),
      shapeId: shape.id,
      width: bounds.w,
      height: bounds.h,
      shapeScale: Math.max(0.01, Math.abs(Number(shape.props.scale) || 1)),
      shapeScaleX: Math.max(0.01, Math.abs(Number(shape.props.scaleX) || 1)),
      shapeScaleY: Math.max(0.01, Math.abs(Number(shape.props.scaleY) || 1)),
      autoSize: shape.type === "text",
      color: shapeColor in COLORS ? shapeColor as NativeCanvasColor : "black",
      style: {
        size,
        bold: shape.props.bold === true,
        italic: shape.props.italic === true,
        underline: shape.props.underline === true,
        textAlign: align === "middle" || align === "end" ? align : "start",
      },
      rotation: Number(shape.rotation) || 0,
    });
    scheduleDraw();
  }, [beginTextDraft, editor, eventPoint, finishPenDraft, hitShape, onLocalPathOpen, onResourceOpen, scheduleDraw]);

  const wheel = useCallback((event: WheelEvent) => {
    event.preventDefault();
    if (event.ctrlKey || event.metaKey || event.altKey) {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const sx = event.clientX - rect.left, sy = event.clientY - rect.top;
      const next = whiteboardWheelZoom(cameraRef.current.zoom, event.deltaY, event.deltaMode, rect.height);
      cameraRef.current = zoomWhiteboardAt(cameraRef.current, next, { x: sx, y: sy });
      setZoomLabel(next * 100);
    } else {
      cameraRef.current = { ...cameraRef.current, x: cameraRef.current.x + event.deltaX / cameraRef.current.zoom, y: cameraRef.current.y + event.deltaY / cameraRef.current.zoom };
    }
    refresh(); scheduleDraw();
  }, [refresh, scheduleDraw]);

  const changeZoom = useCallback((direction: -1 | 1) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const oldZoom = cameraRef.current.zoom;
    const nextZoom = clampWhiteboardZoom(oldZoom * (direction > 0 ? 1.2 : 1 / 1.2));
    if (Math.abs(nextZoom - oldZoom) < Number.EPSILON) return;
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    cameraRef.current = zoomWhiteboardAt(cameraRef.current, nextZoom, { x: centerX, y: centerY });
    setZoomLabel(nextZoom * 100);
    refresh();
    scheduleDraw();
  }, [refresh, scheduleDraw]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.addEventListener("wheel", wheel, { passive: false });
    return () => canvas.removeEventListener("wheel", wheel);
  }, [wheel]);

  const navigateFromMinimap = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const transform = minimapTransformRef.current;
    const canvas = canvasRef.current;
    if (!transform || !canvas) return;
    const mapRect = event.currentTarget.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    const pageX = transform.left + (event.clientX - mapRect.left - transform.padding) / transform.scale;
    const pageY = transform.top + (event.clientY - mapRect.top - transform.padding) / transform.scale;
    cameraRef.current = {
      ...cameraRef.current,
      x: pageX - canvasRect.width / cameraRef.current.zoom / 2,
      y: pageY - canvasRect.height / cameraRef.current.zoom / 2,
    };
    refresh();
    scheduleDraw();
  }, [refresh, scheduleDraw]);

  const pages = whiteboardPages(store.snapshot);
  const rootBounds = rootRef.current?.getBoundingClientRect();
  const overlayScale = rootRef.current?.clientWidth && rootBounds
    ? rootBounds.width / rootRef.current.clientWidth
    : 1;
  const toOverlayPixel = (value: number) => value / (Number.isFinite(overlayScale) && overlayScale > 0 ? overlayScale : 1);
  const currentPageId = editor.getCurrentPageId();
  const currentPageName = pageName(store.snapshot, currentPageId);
  const normalizedPageQuery = pageQuery.trim().toLocaleLowerCase();
  const pageGroups = whiteboardPageGroups(store.snapshot)
    .map((group, index) => {
      const groupMatches = Boolean(normalizedPageQuery) && group.name.toLocaleLowerCase().includes(normalizedPageQuery);
      return {
        ...group,
        accent: WHITEBOARD_PAGE_GROUP_ACCENTS[index % WHITEBOARD_PAGE_GROUP_ACCENTS.length]!,
        groupMatches,
        pages: !normalizedPageQuery || groupMatches
          ? group.pages
          : group.pages.filter((page) => pageName(store.snapshot, page.id).toLocaleLowerCase().includes(normalizedPageQuery)),
      };
    })
    .filter((group) => !normalizedPageQuery || group.groupMatches || group.pages.length > 0);
  const ungroupedPages = pages.filter((page) => (
    !pageGroupId(page) &&
    (!normalizedPageQuery || pageName(store.snapshot, page.id).toLocaleLowerCase().includes(normalizedPageQuery))
  ));
  const hasVisiblePageMenuItems = pageGroups.length > 0 || ungroupedPages.length > 0;
  const startPageRename = (id: string) => {
    pageRenameCancelledRef.current = false;
    setPageNameDraft(pageName(store.snapshot, id));
    setRenamingPageId(id);
  };
  const commitPageRename = (id: string) => {
    if (!pageRenameCancelledRef.current && pageNameDraft.trim() && renamingPageId === id) {
      editor.renamePage(id, pageNameDraft);
    }
    pageRenameCancelledRef.current = false;
    setRenamingPageId(undefined);
  };
  const startPageGroupRename = (id: string, name: string) => {
    setPageGroupNameDraft(name);
    setRenamingPageGroupId(id);
  };
  const commitPageGroupRename = (id: string) => {
    if (pageGroupNameDraft.trim() && renamingPageGroupId === id) {
      editor.renamePageGroup(id, pageGroupNameDraft);
    }
    setRenamingPageGroupId(undefined);
  };
  const finishPageDrag = () => {
    draggedPageIdRef.current = undefined;
    setDraggedPageId(undefined);
    setPageDropTarget(undefined);
  };
  const finishPageGroupDrag = () => {
    pageGroupPointerDragRef.current = undefined;
    draggedPageGroupIdRef.current = undefined;
    setDraggedPageGroupId(undefined);
    setPageGroupDropTarget(undefined);
  };
  const renderPageRow = (page: NativeWhiteboardRecord) => {
    const name = pageName(store.snapshot, page.id);
    const editedAt = formatPageEditedAt(page);
    const isCurrent = page.id === currentPageId;
    const isRenaming = page.id === renamingPageId;
    const isDropTarget = pageDropTarget?.type === "page" &&
      pageDropTarget.id === page.id && draggedPageId !== page.id;
    return (
      <li
        key={page.id}
        draggable={!isRenaming}
        onDragStart={(event) => {
          draggedPageIdRef.current = page.id;
          setDraggedPageId(page.id);
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", page.id);
        }}
        onDragOver={(event) => {
          const sourceId = draggedPageIdRef.current;
          if (!sourceId || sourceId === page.id) return;
          event.preventDefault();
          const rect = event.currentTarget.getBoundingClientRect();
          setPageDropTarget({
            type: "page",
            id: page.id,
            position: event.clientY < rect.top + rect.height / 2 ? "before" : "after",
          });
        }}
        onDrop={(event) => {
          if (draggedPageGroupIdRef.current) return;
          event.preventDefault();
          const sourceId = draggedPageIdRef.current || event.dataTransfer.getData("text/plain");
          if (sourceId) {
            const rect = event.currentTarget.getBoundingClientRect();
            const position = event.clientY < rect.top + rect.height / 2 ? "before" : "after";
            editor.movePage(sourceId, page.id, position);
            editor.movePageToGroup(sourceId, pageGroupId(page));
          }
          finishPageDrag();
        }}
        onDragEnd={finishPageDrag}
        className={`group relative flex min-h-10 cursor-grab items-center gap-1 rounded-[16px] border px-2.5 transition active:cursor-grabbing ${isCurrent ? "border-[#cbc7ef] bg-[#f0efff]" : "border-[#e8e9f0] bg-white"} ${draggedPageId === page.id ? "opacity-45" : ""}`}
      >
        {isDropTarget && (
          <span className={`pointer-events-none absolute left-2 right-2 h-0.5 rounded-full bg-[#625bc5] ${pageDropTarget.position === "before" ? "-top-0.5" : "-bottom-0.5"}`} />
        )}
        <GripVertical aria-hidden="true" className="size-4 shrink-0 cursor-grab text-[#a4a8b6] active:cursor-grabbing" />
        {isRenaming ? (
          <input
            autoFocus
            aria-label={`重命名白板页面 ${name}`}
            value={pageNameDraft}
            maxLength={120}
            placeholder="请输入页面名称"
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => setPageNameDraft(event.target.value)}
            onBlur={() => commitPageRename(page.id)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                event.currentTarget.blur();
              } else if (event.key === "Escape") {
                event.preventDefault();
                pageRenameCancelledRef.current = true;
                setRenamingPageId(undefined);
              }
            }}
            className="h-8 min-w-0 flex-1 rounded-lg border border-[#aaa5e9] bg-white px-2 text-xs font-bold text-[#30364d] outline-none"
          />
        ) : (
          <>
            <button
              type="button"
              draggable={false}
              aria-label={`切换到页面 ${name}`}
              onClick={(event) => {
                editor.setCurrentPage(page.id);
                if (event.detail === 0) {
                  setPageMenuOpen(false);
                  setPageQuery("");
                  return;
                }
                if (event.detail === 1) {
                  if (pageMenuSelectionTimerRef.current) clearTimeout(pageMenuSelectionTimerRef.current);
                  pageMenuSelectionTimerRef.current = setTimeout(() => {
                    setPageMenuOpen(false);
                    setPageQuery("");
                    pageMenuSelectionTimerRef.current = undefined;
                  }, 220);
                }
              }}
              onDoubleClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                if (pageMenuSelectionTimerRef.current) {
                  clearTimeout(pageMenuSelectionTimerRef.current);
                  pageMenuSelectionTimerRef.current = undefined;
                }
                startPageRename(page.id);
              }}
              className="min-w-0 flex-1 px-1 py-1.5 text-left outline-none"
            >
              <span title="双击重命名页面" className="block cursor-text truncate text-xs font-bold text-[#30364d]">{name}</span>
              <span className="mt-0.5 block truncate text-[0.625rem] font-semibold text-[#989dae]">{editedAt}</span>
            </button>
            <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
              <button
                type="button"
                draggable={false}
                aria-label={`重命名页面 ${name}`}
                title="重命名"
                onClick={() => startPageRename(page.id)}
                className="grid size-7 place-items-center rounded-lg text-[#73798c] transition hover:bg-white hover:text-[#625bc5] hover:shadow-sm"
              >
                <Pencil className="size-3.5" />
              </button>
              <button
                type="button"
                draggable={false}
                aria-label={`删除页面 ${name}`}
                title="删除"
                disabled={pages.length <= 1}
                onClick={() => {
                  setPendingPageDelete({ id: page.id, name });
                  setPageMenuOpen(false);
                  setPageQuery("");
                }}
                className="grid size-7 place-items-center rounded-lg text-[#a36a7b] transition hover:bg-[#fff0f3] hover:text-[#c43e68] disabled:pointer-events-none disabled:opacity-30"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          </>
        )}
      </li>
    );
  };
  const activeDraftStyle = textDraft?.style ?? textStyle;
  const activeDraftColor = textDraft?.color ?? color;
  const draftFontSize = ({ s: 14, m: 18, l: 24, xl: 32 } as const)[activeDraftStyle.size];
  const draftPosition = textDraft
    ? {
        left: toOverlayPixel((textDraft.point.x - cameraRef.current.x) * cameraRef.current.zoom),
        top: toOverlayPixel((textDraft.point.y - cameraRef.current.y) * cameraRef.current.zoom),
      }
    : undefined;
  const draftShape = textDraft?.shapeId ? editor.getShape(textDraft.shapeId) : undefined;
  const draftIsMindMapNode = Boolean(draftShape && isMindMapNode(draftShape));
  const draftCanvasScale = cameraRef.current.zoom / (Number.isFinite(overlayScale) && overlayScale > 0 ? overlayScale : 1);
  const draftTextScale = textDraft?.shapeScale ?? 1;
  const draftAutoSize = textDraft?.autoSize ? measureTextDraft(textDraft) : undefined;
  const draftEstimatedWidth = textDraft
    ? Math.max(1, (draftAutoSize?.width ?? textDraft.width ?? 288) * draftCanvasScale)
    : 0;
  const draftEditorWidth = Math.max(draftEstimatedWidth, draftMeasuredSize?.width ?? 0);
  const draftHorizontalPadding = 16 * draftCanvasScale;
  const scaledDraftFontSize = draftFontSize * draftTextScale * draftCanvasScale;
  const draftEditorColor = draftShape && draftShape.type !== "text"
    ? COLORS[activeDraftColor]
    : nativeCanvasDisplayColor(activeDraftColor, canvasDark);
  const draftEstimatedHeight = draftAutoSize
    ? Math.max(1, draftAutoSize.height * draftCanvasScale)
    : textDraft?.height
      ? Math.max(1, textDraft.height * draftCanvasScale)
    : Math.max(40 * draftCanvasScale, scaledDraftFontSize * 1.35 + 32 * draftCanvasScale);
  const draftEditorHeight = Math.max(draftEstimatedHeight, draftMeasuredSize?.height ?? 0);
  const draftLineCount = Math.max(1, textDraft?.value.split(/\r?\n/u).length ?? 1);
  const draftEditorVisualHeight = draftEditorHeight;
  const draftToolbarBelow = Boolean(draftPosition && draftPosition.top < 64);
  const draftVerticalPadding = draftIsMindMapNode && draftEditorHeight
    ? Math.max(6 * draftCanvasScale, (draftEditorHeight - scaledDraftFontSize * 1.35 * draftLineCount) / 2)
    : 16 * draftCanvasScale;
  useLayoutEffect(() => {
    const input = textInputRef.current;
    if (!textDraft?.autoSize || !input) return;

    const previousWidth = input.style.width;
    const previousHeight = input.style.height;
    input.style.width = "1px";
    input.style.height = "0px";
    const computed = window.getComputedStyle(input);
    const borderWidth = (Number.parseFloat(computed.borderLeftWidth) || 0)
      + (Number.parseFloat(computed.borderRightWidth) || 0);
    const borderHeight = (Number.parseFloat(computed.borderTopWidth) || 0)
      + (Number.parseFloat(computed.borderBottomWidth) || 0);
    const contentWidth = Math.ceil(input.scrollWidth + borderWidth);
    input.style.width = `${Math.max(draftEstimatedWidth, contentWidth)}px`;
    const measuredSize = {
      width: Math.max(draftEstimatedWidth, contentWidth),
      height: Math.max(draftEstimatedHeight, Math.ceil(input.scrollHeight + borderHeight)),
    };
    input.style.width = previousWidth;
    input.style.height = previousHeight;
    draftMeasuredSizeRef.current = {
      width: measuredSize.width / draftCanvasScale,
      height: measuredSize.height / draftCanvasScale,
    };
    setDraftMeasuredSize((current) => current?.width === measuredSize.width && current.height === measuredSize.height
      ? current
      : measuredSize);
  }, [
    activeDraftStyle.bold,
    activeDraftStyle.italic,
    activeDraftStyle.size,
    draftCanvasScale,
    draftEstimatedHeight,
    draftEstimatedWidth,
    draftHorizontalPadding,
    draftVerticalPadding,
    textDraft?.shapeId,
    textDraft?.value,
  ]);
  const selectedTextShapes = editor.getSelectedShapeIds()
    .map((id) => editor.getShape(id))
    .filter((shape): shape is NativeWhiteboardShape => Boolean(
      shape && ["text", "note"].includes(shape.type),
    ));
  const selectedTextBounds = selectionBounds(selectedTextShapes);
  const selectedTextSize = selectedTextShapes.length > 0 && selectedTextShapes.every(
    (shape) => String(shape.props.size ?? "m") === String(selectedTextShapes[0]!.props.size ?? "m"),
  )
    ? String(selectedTextShapes[0]!.props.size ?? "m") as NativeStrokeSize
    : undefined;
  const textColorForShape = (shape: NativeWhiteboardShape): NativeCanvasColor => {
    const value = String(shape.type === "note"
      ? shape.props.labelColor ?? "black"
      : shape.props.color ?? "black");
    return value in COLORS ? value as NativeCanvasColor : "black";
  };
  const selectedTextColor = selectedTextShapes.length > 0 && selectedTextShapes.every(
    (shape) => textColorForShape(shape) === textColorForShape(selectedTextShapes[0]!),
  )
    ? textColorForShape(selectedTextShapes[0]!)
    : undefined;
  const textAlignForShape = (shape: NativeWhiteboardShape): NativeTextStyle["textAlign"] => {
    const value = String(shape.props.textAlign ?? shape.props.align ?? "start");
    return value === "middle" || value === "end" ? value : "start";
  };
  const selectedTextAlign = selectedTextShapes.length > 0 && selectedTextShapes.every(
    (shape) => textAlignForShape(shape) === textAlignForShape(selectedTextShapes[0]!),
  )
    ? textAlignForShape(selectedTextShapes[0]!)
    : undefined;
  const selectedTextStyle: NativeTextStyle = {
    size: selectedTextSize ?? "m",
    bold: selectedTextShapes.length > 0 && selectedTextShapes.every((shape) => shape.props.bold === true),
    italic: selectedTextShapes.length > 0 && selectedTextShapes.every((shape) => shape.props.italic === true),
    underline: selectedTextShapes.length > 0 && selectedTextShapes.every((shape) => shape.props.underline === true),
    textAlign: selectedTextAlign ?? "start",
  };
  const selectedTextToolbarPosition = selectedTextBounds
    ? {
        left: toOverlayPixel((selectedTextBounds.center.x - cameraRef.current.x) * cameraRef.current.zoom),
        top: toOverlayPixel((selectedTextBounds.y - cameraRef.current.y) * cameraRef.current.zoom),
        bottom: toOverlayPixel((selectedTextBounds.y + selectedTextBounds.h - cameraRef.current.y) * cameraRef.current.zoom),
      }
    : undefined;
  const selectedTextToolbarPlacement = selectedTextToolbarPosition
    ? nativeFloatingPalettePlacement({
        selectionTop: selectedTextToolbarPosition.top,
        selectionBottom: selectedTextToolbarPosition.bottom,
        viewportHeight: rootRef.current?.clientHeight ?? 800,
        paletteHeight: textColorMenu === "selection" ? 56 : 0,
      })
    : undefined;
  const selectedShapeIds = new Set(editor.getSelectedShapeIds());
  const selectedPaintShapes = [...selectedShapeIds]
    .map((id) => editor.getShape(id))
    .filter((shape): shape is NativeWhiteboardShape => Boolean(
      shape && ["geo", "draw", "arrow"].includes(shape.type),
    ));
  const selectedPaintBounds = selectedPaintShapes.length === selectedShapeIds.size
    ? selectionBounds(selectedPaintShapes)
    : undefined;
  const selectedPaintIsGeo = selectedPaintShapes.length > 0 && selectedPaintShapes.every((shape) => shape.type === "geo");
  const selectedPaintToolbarPosition = selectedPaintBounds
    ? {
        left: toOverlayPixel((selectedPaintBounds.center.x - cameraRef.current.x) * cameraRef.current.zoom),
        selectionLeft: toOverlayPixel((selectedPaintBounds.x - cameraRef.current.x) * cameraRef.current.zoom),
        selectionRight: toOverlayPixel((selectedPaintBounds.x + selectedPaintBounds.w - cameraRef.current.x) * cameraRef.current.zoom),
        top: toOverlayPixel((selectedPaintBounds.y - cameraRef.current.y) * cameraRef.current.zoom),
        bottom: toOverlayPixel((selectedPaintBounds.y + selectedPaintBounds.h - cameraRef.current.y) * cameraRef.current.zoom),
      }
    : undefined;
  const selectedPaintToolbarPlacement = selectedPaintToolbarPosition
    ? nativeFloatingPalettePlacement({
        selectionTop: selectedPaintToolbarPosition.top,
        selectionBottom: selectedPaintToolbarPosition.bottom,
        viewportHeight: rootRef.current?.clientHeight ?? 800,
        paletteHeight: selectedPaintMenuOpen ? (selectedPaintIsGeo ? 300 : 56) : 0,
      })
    : undefined;
  const whiteboardUiRem = typeof window === "undefined"
    ? 16
    : Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize) || 16;
  const selectedPaintMenuPosition = selectedPaintMenuOpen && selectedPaintToolbarPosition
    ? nativeSelectionPalettePosition({
        selectionLeft: selectedPaintToolbarPosition.selectionLeft,
        selectionTop: selectedPaintToolbarPosition.top,
        selectionRight: selectedPaintToolbarPosition.selectionRight,
        selectionBottom: selectedPaintToolbarPosition.bottom,
        viewportWidth: rootRef.current?.clientWidth ?? 1200,
        viewportHeight: rootRef.current?.clientHeight ?? 800,
        paletteWidth: (selectedPaintIsGeo ? 18 : 10) * whiteboardUiRem,
        paletteHeight: (selectedPaintIsGeo ? 20.125 : 3.5) * whiteboardUiRem,
      })
    : undefined;
  const selectedPaintSize = selectedPaintShapes.length > 0 && selectedPaintShapes.every(
    (shape) => String(shape.props.size ?? "m") === String(selectedPaintShapes[0]!.props.size ?? "m"),
  ) ? String(selectedPaintShapes[0]!.props.size ?? "m") as NativeStrokeSize : "m";
  const selectedPaintColor = selectedPaintShapes.length > 0
    ? selectedPaintShapes[0]!.type === "geo"
      ? nativeGeoPaintStyle(selectedPaintShapes[0]!).strokeColor
      : nativeCanvasColor(selectedPaintShapes[0]!.props.color, "black")
    : "black";
  const selectedGeoPaint = selectedPaintIsGeo ? nativeGeoPaintStyle(selectedPaintShapes[0]!) : undefined;
  const selectedMindMapNodes = [...selectedShapeIds]
    .map((id) => editor.getShape(id))
    .filter((shape): shape is NativeWhiteboardShape => Boolean(shape && isMindMapNode(shape)));
  const selectedMindMapNode = selectedMindMapNodes.length === 1 ? selectedMindMapNodes[0] : undefined;
  const selectedMindMapBounds = selectedMindMapNode ? nativeShapeBounds(selectedMindMapNode) : undefined;
  const selectedMindMapToolbarPosition = selectedMindMapBounds
    ? {
        left: toOverlayPixel((selectedMindMapBounds.center.x - cameraRef.current.x) * cameraRef.current.zoom),
        top: toOverlayPixel((selectedMindMapBounds.y - cameraRef.current.y) * cameraRef.current.zoom),
      }
    : undefined;
  const selectedMindMapToolbarBeside = Boolean(
    selectedMindMapToolbarPosition && selectedMindMapToolbarPosition.top < 120,
  );
  const selectedMindMapHasChildren = selectedMindMapNode
    ? editor.mindMapHasChildren(selectedMindMapNode.id)
    : false;
  const selectedLinkShapes = shapes(store.snapshot).filter(
    (shape) => shape.type === "link" && selectedShapeIds.has(shape.id),
  );
  const selectedControlShapes = [...selectedShapeIds]
    .map((id) => editor.getShape(id))
    .filter((shape): shape is NativeWhiteboardShape => Boolean(shape));
  const expandedGroupSelected = Boolean(selectedExpandedGroupId(selectedControlShapes));
  const interactiveLinkShapes = !expandedGroupSelected && selectedLinkShapes.length === 1
    ? selectedLinkShapes
    : [];
  const animatedImageShapes = shapes(store.snapshot).flatMap((shape) => {
    if (shape.type !== "image" || !selectedShapeIds.has(shape.id)) return [];
    const asset = imageAsset(store.snapshot, shape);
    if (!isAnimatedNativeImageAsset(asset)) return [];
    const props = asset?.props && typeof asset.props === "object"
      ? asset.props as Record<string, unknown>
      : {};
    const src = typeof props.src === "string" ? props.src : "";
    return src ? [{ shape, src }] : [];
  });
  const mediaShapes = visibleShapes(store.snapshot).flatMap((shape) => {
    if (shape.type !== "media") return [];
    const asset = imageAsset(store.snapshot, shape);
    const props = asset?.props && typeof asset.props === "object"
      ? asset.props as Record<string, unknown>
      : {};
    const src = typeof props.src === "string" ? props.src : "";
    const mimeType = typeof props.mimeType === "string" ? props.mimeType : "";
    return src ? [{ shape, src, mimeType }] : [];
  });
  const updateDraftStyle = (patch: Partial<NativeTextStyle>) => {
    const current = textDraftRef.current;
    if (!current) return;
    const next = {
      ...current,
      style: { ...(current.style ?? textStyle), ...patch },
    };
    textDraftRef.current = next;
    setTextDraft(next);
  };
  const updateDraftColor = (nextColor: NativeCanvasColor) => {
    const current = textDraftRef.current;
    if (!current) return;
    const next = { ...current, color: nextColor };
    textDraftRef.current = next;
    setTextDraft(next);
    setTextColorMenu(undefined);
  };
  const updateSelectedTextStyle = (patch: Partial<NativeTextStyle>) => {
    if (!selectedTextShapes.length) return;
    editor.updateShapes(selectedTextShapes.map((shape) => ({
      id: shape.id,
      props: patch,
    })));
    scheduleDraw();
  };
  const updateSelectedTextColor = (nextColor: NativeCanvasColor) => {
    if (!selectedTextShapes.length) return;
    editor.updateShapes(selectedTextShapes.map((shape) => ({
      id: shape.id,
      props: shape.type === "note"
        ? { labelColor: nextColor }
        : { color: nextColor },
    })));
    setTextColorMenu(undefined);
    scheduleDraw();
  };
  const updateSelectedPaintSize = (size: NativeStrokeSize) => {
    if (!selectedPaintShapes.length) return;
    editor.updateShapes(selectedPaintShapes.map((shape) => ({ id: shape.id, props: { size } })));
    scheduleDraw();
  };
  const updateSelectedPaintColor = (nextColor: NativeCanvasColor) => {
    if (!selectedPaintShapes.length) return;
    editor.updateShapes(selectedPaintShapes.map((shape) => ({
      id: shape.id,
      props: shape.type === "geo"
        ? { color: nextColor, strokeColor: nextColor }
        : { color: nextColor },
    })));
    setSelectedPaintMenuOpen(false);
    scheduleDraw();
  };
  const updateSelectedGeoPaint = (patch: Partial<NativeGeoPaintStyle>) => {
    if (!selectedPaintIsGeo) return;
    editor.updateShapes(selectedPaintShapes.map((shape) => ({
      id: shape.id,
      props: { ...patch, ...(patch.strokeColor ? { color: patch.strokeColor } : {}) },
    })));
    scheduleDraw();
  };
  const mindMapNodeScreenPoint = (
    shape: NativeWhiteboardShape,
    mode: MindMapConnectionDraft["mode"],
  ): NativePoint => {
    const bounds = nativeShapeBounds(shape);
    const direction = String(shape.props.mokiMindMapDirection ?? "right");
    const output = mode === "set-child";
    const pagePoint = direction === "down"
      ? { x: bounds.center.x, y: output ? bounds.y + bounds.h : bounds.y }
      : direction === "left"
        ? { x: output ? bounds.x : bounds.x + bounds.w, y: bounds.center.y }
        : { x: output ? bounds.x + bounds.w : bounds.x, y: bounds.center.y };
    return {
      x: toOverlayPixel((pagePoint.x - cameraRef.current.x) * cameraRef.current.zoom),
      y: toOverlayPixel((pagePoint.y - cameraRef.current.y) * cameraRef.current.zoom),
    };
  };
  const connectionScreenPoint = (event: { clientX: number; clientY: number }): NativePoint => {
    const rect = rootRef.current?.getBoundingClientRect();
    return {
      x: toOverlayPixel(event.clientX - (rect?.left ?? 0)),
      y: toOverlayPixel(event.clientY - (rect?.top ?? 0)),
    };
  };
  const connectionTargetId = (
    sourceId: string,
    mode: MindMapConnectionDraft["mode"],
    event: { clientX: number; clientY: number },
  ): string | undefined => {
    const source = editor.getShape(sourceId);
    const target = hitShape(eventPoint(event));
    if (!source || !target || !isMindMapNode(source) || !isMindMapNode(target) || source.id === target.id) return undefined;
    if (source.props.mokiMindMapId !== target.props.mokiMindMapId) return undefined;
    if (mode === "set-parent") {
      if (source.props.mokiMindMapRoot === true || mindMapDescendantIds(store.snapshot, source.id).has(target.id)) return undefined;
    } else if (target.props.mokiMindMapRoot === true || mindMapDescendantIds(store.snapshot, target.id).has(source.id)) {
      return undefined;
    }
    return target.id;
  };
  const beginMindMapConnection = (
    mode: MindMapConnectionDraft["mode"],
    event: React.PointerEvent<HTMLButtonElement>,
  ) => {
    if (!selectedMindMapNode) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const start = mindMapNodeScreenPoint(selectedMindMapNode, mode);
    setMindMapConnectionDraft({ sourceId: selectedMindMapNode.id, mode, start, current: start });
  };
  const moveMindMapConnection = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!mindMapConnectionDraft) return;
    event.preventDefault();
    event.stopPropagation();
    const targetId = connectionTargetId(
      mindMapConnectionDraft.sourceId,
      mindMapConnectionDraft.mode,
      event,
    );
    const { targetId: _previousTargetId, ...currentDraft } = mindMapConnectionDraft;
    setMindMapConnectionDraft({
      ...currentDraft,
      current: connectionScreenPoint(event),
      ...(targetId ? { targetId } : {}),
    });
  };
  const endMindMapConnection = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!mindMapConnectionDraft) return;
    event.preventDefault();
    event.stopPropagation();
    const targetId = connectionTargetId(
      mindMapConnectionDraft.sourceId,
      mindMapConnectionDraft.mode,
      event,
    );
    if (targetId) {
      const moved = mindMapConnectionDraft.mode === "set-parent"
        ? editor.reparentMindMapNode(mindMapConnectionDraft.sourceId, targetId)
        : editor.reparentMindMapNode(targetId, mindMapConnectionDraft.sourceId);
      if (moved) scheduleDraw();
    } else if (mindMapConnectionDraft.mode === "set-child") {
      const current = connectionScreenPoint(event);
      const distance = Math.hypot(
        current.x - mindMapConnectionDraft.start.x,
        current.y - mindMapConnectionDraft.start.y,
      );
      const occupied = hitShape(eventPoint(event));
      if (!occupied && distance >= 32) {
        const created = editor.addMindMapChild(
          mindMapConnectionDraft.sourceId,
          eventPoint(event),
        );
        if (created) scheduleDraw();
      }
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setMindMapConnectionDraft(undefined);
  };
  const selectedMindMapInputPoint = selectedMindMapNode
    ? mindMapNodeScreenPoint(selectedMindMapNode, "set-parent")
    : undefined;
  const selectedMindMapOutputPoint = selectedMindMapNode
    ? mindMapNodeScreenPoint(selectedMindMapNode, "set-child")
    : undefined;
  const connectionTargetShape = mindMapConnectionDraft?.targetId
    ? editor.getShape(mindMapConnectionDraft.targetId)
    : undefined;
  const connectionTargetBounds = connectionTargetShape
    ? nativeShapeBounds(connectionTargetShape)
    : undefined;
  const connectionPath = mindMapConnectionDraft
    ? (() => {
        const { start, current } = mindMapConnectionDraft;
        const dx = current.x - start.x;
        const dy = current.y - start.y;
        if (Math.abs(dx) >= Math.abs(dy)) {
          const bend = Math.max(36, Math.abs(dx) * 0.45) * (dx < 0 ? -1 : 1);
          return `M ${start.x} ${start.y} C ${start.x + bend} ${start.y}, ${current.x - bend} ${current.y}, ${current.x} ${current.y}`;
        }
        const bend = Math.max(36, Math.abs(dy) * 0.45) * (dy < 0 ? -1 : 1);
        return `M ${start.x} ${start.y} C ${start.x} ${start.y + bend}, ${current.x} ${current.y - bend}, ${current.x} ${current.y}`;
      })()
    : undefined;
  return (
    <div ref={rootRef} data-moki-whiteboard-page-id={editor.getCurrentPageId()} data-moki-whiteboard-page-name={pageName(store.snapshot, editor.getCurrentPageId())} className="native-whiteboard relative h-full w-full overflow-hidden bg-[#fafbfe]">
      <canvas
        ref={canvasRef}
        className="native-whiteboard-canvas block h-full w-full touch-none"
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onPointerCancel={pointerUp}
        onDoubleClick={doubleClick}
        onContextMenu={(event) => {
          event.preventDefault();
          const point = eventPoint(event);
          const shape = hitShape(point);
          if (shape && !editor.getSelectedShapeIds().includes(shape.id)) editor.select(shape.id);
          if (!shape) editor.select();
          setRenamingFolderId(undefined);
          setFolderNameDraft("");
          setEditingFolderDescriptionId(undefined);
          setFolderDescriptionDraft("");
          setFolderColorMenu(undefined);
          setShapeContextMenu({ x: event.clientX - event.currentTarget.getBoundingClientRect().left, y: event.clientY - event.currentTarget.getBoundingClientRect().top, point });
        }}
        onDragEnter={(event) => {
          if (Array.from(event.dataTransfer.items).some((item) => item.kind === "file")) {
            event.preventDefault();
            setDraggingFile(true);
          }
        }}
        onDragOver={(event) => {
          if (Array.from(event.dataTransfer.items).some((item) => item.kind === "file")) {
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
          }
        }}
        onDragLeave={() => setDraggingFile(false)}
        onDrop={dropFiles}
      />
      <input ref={menuMediaInputRef} type="file" accept="image/*,video/*,.mkv,.avi" multiple className="hidden" aria-label="添加图片或视频" onChange={event => {const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ""; if (files.length) void onImageFiles?.(files, menuMediaPointRef.current);}} />
      {mindMapConnectionDraft && connectionPath ? (
        <svg aria-hidden="true" className="pointer-events-none absolute inset-0 z-[42] h-full w-full overflow-visible">
          <path d={connectionPath} fill="none" stroke="#625bc5" strokeWidth="3" strokeLinecap="round" strokeDasharray="7 5" />
          <circle cx={mindMapConnectionDraft.current.x} cy={mindMapConnectionDraft.current.y} r="5" fill="#625bc5" />
        </svg>
      ) : null}
      {connectionTargetBounds ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute z-[41] rounded-xl ring-4 ring-[#776ed8]/35"
          style={{
            left: toOverlayPixel((connectionTargetBounds.x - cameraRef.current.x) * cameraRef.current.zoom) - 4,
            top: toOverlayPixel((connectionTargetBounds.y - cameraRef.current.y) * cameraRef.current.zoom) - 4,
            width: toOverlayPixel(connectionTargetBounds.w * cameraRef.current.zoom) + 8,
            height: toOverlayPixel(connectionTargetBounds.h * cameraRef.current.zoom) + 8,
          }}
        />
      ) : null}
      {!textDraft && selectedMindMapNode && selectedMindMapInputPoint && selectedMindMapNode.props.mokiMindMapRoot !== true ? (
        <button
          type="button"
          data-mind-map-connector="parent"
          data-mind-map-source={selectedMindMapNode.id}
          aria-label="拖拽连接新的父节点"
          title="拖到节点上，将其设为父节点"
          className="absolute z-[45] cursor-crosshair border-[3px] border-white bg-[#625bc5] shadow-[0_2px_10px_rgba(56,51,128,.35)] ring-1 ring-[#625bc5] transition hover:scale-125"
          style={{
            left: selectedMindMapInputPoint.x,
            top: selectedMindMapInputPoint.y,
            width: 20,
            minWidth: 20,
            height: 20,
            minHeight: 20,
            padding: 0,
            borderRadius: "9999px",
            transform: "translate(-50%, -50%)",
          }}
          onPointerDown={(event) => beginMindMapConnection("set-parent", event)}
          onPointerMove={moveMindMapConnection}
          onPointerUp={endMindMapConnection}
          onPointerCancel={() => setMindMapConnectionDraft(undefined)}
        />
      ) : null}
      {!textDraft && selectedMindMapNode && selectedMindMapOutputPoint ? (
        <button
          type="button"
          data-mind-map-connector="child"
          data-mind-map-source={selectedMindMapNode.id}
          aria-label="拖拽连接子节点"
          title="拖到节点上，将其接到当前节点下"
          className="absolute z-[45] cursor-crosshair border-[3px] border-white bg-[#625bc5] shadow-[0_2px_10px_rgba(56,51,128,.35)] ring-1 ring-[#625bc5] transition hover:scale-125"
          style={{
            left: selectedMindMapOutputPoint.x,
            top: selectedMindMapOutputPoint.y,
            width: 20,
            minWidth: 20,
            height: 20,
            minHeight: 20,
            padding: 0,
            borderRadius: "9999px",
            transform: "translate(-50%, -50%)",
          }}
          onPointerDown={(event) => beginMindMapConnection("set-child", event)}
          onPointerMove={moveMindMapConnection}
          onPointerUp={endMindMapConnection}
          onPointerCancel={() => setMindMapConnectionDraft(undefined)}
        />
      ) : null}
      {!textDraft && selectedMindMapNode && selectedMindMapToolbarPosition ? (
        <div
          aria-label="思维导图节点操作"
          data-whiteboard-control-surface
          className="absolute z-40 flex items-center gap-1 rounded-xl border border-[#dedcf0] bg-white/96 p-1 shadow-[0_8px_24px_rgba(35,39,61,.16)] backdrop-blur"
          style={{
            left: selectedMindMapToolbarBeside
              ? selectedMindMapToolbarPosition.left + toOverlayPixel((selectedMindMapBounds?.w ?? 0) * cameraRef.current.zoom) / 2 + 20
              : selectedMindMapToolbarPosition.left,
            top: selectedMindMapToolbarBeside
              ? selectedMindMapToolbarPosition.top + toOverlayPixel((selectedMindMapBounds?.h ?? 0) * cameraRef.current.zoom) / 2
              : selectedMindMapToolbarPosition.top - 12,
            transform: selectedMindMapToolbarBeside
              ? "translate(0, -50%)"
              : "translate(-50%, -100%)",
          }}
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          <button
            type="button"
            aria-label="添加子节点"
            title="添加子节点"
            onClick={() => {
              editor.addMindMapChild(selectedMindMapNode.id);
              scheduleDraw();
            }}
            className="native-whiteboard-edit-control flex h-8 items-center gap-1 rounded-lg px-2 text-[0.6875rem] font-bold text-[#5650ae] hover:bg-[#efedff]"
          >
            <Plus size={13} />子节点
          </button>
          <button
            type="button"
            aria-label="添加同级节点"
            title="添加同级节点"
            disabled={selectedMindMapNode.props.mokiMindMapRoot === true}
            onClick={() => {
              editor.addMindMapSibling(selectedMindMapNode.id);
              scheduleDraw();
            }}
            className="native-whiteboard-edit-control flex h-8 items-center gap-1 rounded-lg px-2 text-[0.6875rem] font-bold text-[#5650ae] hover:bg-[#efedff] disabled:cursor-not-allowed disabled:opacity-35"
          >
            <GitBranch size={13} />同级
          </button>
          {selectedMindMapHasChildren ? (
            <button
              type="button"
              aria-label={selectedMindMapNode.props.mokiMindMapCollapsed === true ? "展开分支" : "收起分支"}
              title={selectedMindMapNode.props.mokiMindMapCollapsed === true ? "展开分支" : "收起分支"}
              onClick={() => {
                editor.toggleMindMapBranch(selectedMindMapNode.id);
                scheduleDraw();
              }}
              className="native-whiteboard-edit-control flex h-8 items-center gap-1 rounded-lg px-2 text-[0.6875rem] font-bold text-[#6d7284] hover:bg-[#f2f3f7]"
            >
              {selectedMindMapNode.props.mokiMindMapCollapsed === true
                ? <ChevronRight size={13} />
                : <ChevronDown size={13} />}
              {selectedMindMapNode.props.mokiMindMapCollapsed === true ? "展开" : "收起"}
            </button>
          ) : null}
        </div>
      ) : null}
      {shapeContextMenu ? (
        <div
          ref={shapeContextMenuRef}
          role="menu"
          aria-label="白板右键菜单"
          className="moki-menu-surface absolute z-[60] min-w-44 max-h-[calc(100%-16px)] overflow-y-auto p-1.5"
          style={{ left: Math.max(8, Math.min(shapeContextMenu.x, (rootRef.current?.clientWidth ?? 800) - 220)), top: Math.max(8, Math.min(shapeContextMenu.y, (rootRef.current?.clientHeight ?? 600) - 320)) }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {(() => {
            const selected = editor.getSelectedShapeIds().map((id) => editor.getShape(id)).filter((shape): shape is NativeWhiteboardShape => Boolean(shape));
            const selectedGroupId = selected.length ? nativeGroupId(selected[0]) : undefined;
            const sameGroup = Boolean(selectedGroupId && selected.every((shape) => nativeGroupId(shape) === selectedGroupId));
            const folder = selected.length === 1 && selected[0]?.type === "group-folder" ? selected[0] : undefined;
            const itemClass = "native-whiteboard-edit-control flex h-9 w-full items-center gap-2 rounded-lg px-3 text-left text-xs font-bold text-[#444b61] hover:bg-[#f0efff] hover:text-[#5f58bd] disabled:opacity-35";
            const copySelection = async () => {
              const serialized = editor.copySelectedShapes();
              if (!serialized) return;
              copiedElementsRef.current = serialized;
              pastedClipboardRef.current = { serialized, count: 0 };
              try { await navigator.clipboard.writeText(`${NATIVE_WHITEBOARD_CLIPBOARD_TEXT_PREFIX}${serialized}`); }
              catch { /* The in-memory clipboard remains available in this window. */ }
              setClipboardNotice(`已复制 ${selected.length} 个元素`);
              setShapeContextMenu(undefined);
            };
            const pasteAtMenu = async () => {
              const point = shapeContextMenu.point;
              setShapeContextMenu(undefined);
              let clipboardText = "";
              try { clipboardText = await navigator.clipboard.readText(); } catch { /* Use the in-memory clipboard below. */ }
              const serialized = clipboardText.startsWith(NATIVE_WHITEBOARD_CLIPBOARD_TEXT_PREFIX)
                ? clipboardText.slice(NATIVE_WHITEBOARD_CLIPBOARD_TEXT_PREFIX.length)
                : clipboardText ? "" : copiedElementsRef.current;
              if (serialized) {
                const ids = editor.pasteCopiedShapes(serialized, 32);
                if (ids.length) {
                  const pasted = ids.map(id => editor.getShape(id)).filter((shape): shape is NativeWhiteboardShape => Boolean(shape));
                  const bounds = selectionBounds(pasted);
                  if (bounds) editor.updateShapes(pasted.map(shape => ({id: shape.id, x: shape.x + point.x - bounds.center.x, y: shape.y + point.y - bounds.center.y})));
                  return;
                }
              }
              if (!clipboardText) {
                try {
                  const entries = await navigator.clipboard.read();
                  const files: File[] = [];
                  for (const entry of entries) for (const mime of entry.types) {
                    if (!/^(?:image|video)\//u.test(mime)) continue;
                    files.push(new File([await entry.getType(mime)], `剪贴板媒体.${mime.split("/")[1] ?? "png"}`, {type: mime}));
                  }
                  if (files.length && onImageFiles) { await onImageFiles(files, point); return; }
                } catch { /* Clipboard read may require browser permission. */ }
              }
              const imageUrl = normalizePastedWhiteboardImageUrl(clipboardText, "");
              if (imageUrl && onImageUrl) { await onImageUrl(imageUrl, point); return; }
              const url = normalizePastedWhiteboardLinkUrl(clipboardText);
              if (url) { editor.pasteLink(url, point); return; }
              if (clipboardText.trim()) beginTextDraft({point, value: clipboardText, autoSize: true});
            };
            const equalize = (dimension: "w" | "h") => {
              const materials = selected.filter((shape) => ["image", "media", "link", "resource"].includes(shape.type));
              if (materials.length < 2) return;
              const target = nativeShapeBounds(materials[0]!)[dimension];
              const updates = materials.slice(1).map((shape) => {
                const before = nativeShapeBounds(shape);
                const factor = target / Math.max(1, before[dimension]);
                const key = dimension === "w" ? "scaleX" : "scaleY";
                const props = {...shape.props, [key]: Math.max(0.01, Math.abs(Number(shape.props[key]) || 1) * factor)};
                const after = nativeShapeBounds({...shape, props});
                return {id: shape.id, x: shape.x + before.center.x - after.center.x, y: shape.y + before.center.y - after.center.y, props};
              });
              editor.updateShapes(updates);
              setShapeContextMenu(undefined);
              scheduleDraw();
            };
            if (folder && editingFolderDescriptionId === folder.id) return (
              <form
                aria-label="编辑资料夹描述"
                className="grid min-w-64 gap-2 p-1.5"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!editor.updateGroupFolderDescription(folder.id, folderDescriptionDraft)) return;
                  setEditingFolderDescriptionId(undefined);
                  setShapeContextMenu(undefined);
                  scheduleDraw();
                }}
              >
                <label htmlFor={`folder-description-${folder.id}`} className="text-[0.6875rem] font-bold text-[#6d7386]">资料夹描述</label>
                <textarea
                  id={`folder-description-${folder.id}`}
                  autoFocus
                  aria-label="资料夹描述"
                  maxLength={120}
                  rows={3}
                  value={folderDescriptionDraft}
                  onChange={(event) => setFolderDescriptionDraft(event.target.value)}
                  className="min-h-20 w-full resize-none rounded-lg border border-[#dfe2ec] bg-white px-3 py-2 text-xs font-semibold leading-5 text-[#242838] outline-none focus:border-[#756bd6] focus:ring-2 focus:ring-[#756bd6]/15"
                />
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[0.625rem] font-semibold text-[#9aa0b1]">{folderDescriptionDraft.length}/120</span>
                  <span className="flex gap-2">
                    <button type="button" className="h-8 rounded-lg px-3 text-xs font-bold text-[#6d7386] hover:bg-[#f4f5f8]" onClick={() => setEditingFolderDescriptionId(undefined)}>取消</button>
                    <button type="submit" className="h-8 rounded-lg bg-[#242838] px-3 text-xs font-bold text-white">保存</button>
                  </span>
                </div>
              </form>
            );
            if (folder && renamingFolderId === folder.id) return (
              <form
                aria-label="重命名资料夹"
                className="grid min-w-56 gap-2 p-1.5"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!editor.renameGroupFolder(folder.id, folderNameDraft)) return;
                  setRenamingFolderId(undefined);
                  setShapeContextMenu(undefined);
                  scheduleDraw();
                }}
              >
                <label htmlFor={`folder-name-${folder.id}`} className="text-[0.6875rem] font-bold text-[#6d7386]">资料夹名称</label>
                <input
                  id={`folder-name-${folder.id}`}
                  autoFocus
                  aria-label="资料夹名称"
                  maxLength={60}
                  value={folderNameDraft}
                  onChange={(event) => setFolderNameDraft(event.target.value)}
                  className="h-9 w-full rounded-lg border border-[#dfe2ec] bg-white px-3 text-xs font-semibold text-[#242838] outline-none focus:border-[#756bd6] focus:ring-2 focus:ring-[#756bd6]/15"
                />
                <div className="flex justify-end gap-2">
                  <button type="button" className="h-8 rounded-lg px-3 text-xs font-bold text-[#6d7386] hover:bg-[#f4f5f8]" onClick={() => setRenamingFolderId(undefined)}>取消</button>
                  <button type="submit" disabled={!folderNameDraft.trim()} className="h-8 rounded-lg bg-[#242838] px-3 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-35">保存</button>
                </div>
              </form>
            );
            if (folder) return <>
              <button type="button" role="menuitem" className={itemClass} onClick={() => {void copySelection();}}><Copy size={14}/>复制</button>
              <button type="button" role="menuitem" className={itemClass} onClick={() => { setEditingFolderDescriptionId(undefined); setFolderNameDraft(String(folder.props.groupLabel ?? "新空间")); setRenamingFolderId(folder.id); }}><Pencil size={14}/>重命名资料夹</button>
              <button type="button" role="menuitem" className={itemClass} onClick={() => { setRenamingFolderId(undefined); setFolderDescriptionDraft(String(folder.props.groupDescription ?? "把相关想法放在一起")); setEditingFolderDescriptionId(folder.id); }}><FileText size={14}/>编辑资料夹描述</button>
              <button ref={folderColorTriggerRef} type="button" role="menuitem" aria-haspopup="menu" aria-expanded={Boolean(folderColorMenu)} aria-controls={folderColorMenu ? folderColorMenuId : undefined} className={itemClass} onPointerEnter={event => openFolderColorMenu(event.currentTarget)} onClick={event => openFolderColorMenu(event.currentTarget)}><Palette size={14}/>资料夹颜色<ChevronRight size={13} className="ml-auto"/></button>
              <button type="button" role="menuitem" className={itemClass} onClick={() => { editor.expandGroupFolder(folder.id); setShapeContextMenu(undefined); }}><FolderOpen size={14}/>展开资料夹</button>
              <button type="button" role="menuitem" disabled={!onGroupFolderExport} className={itemClass} onClick={() => {
                const request = createNativeGroupFolderExportRequest(store.snapshot, folder.id);
                setShapeContextMenu(undefined);
                if (request) void Promise.resolve(onGroupFolderExport?.(request, "local")).catch((error) => setClipboardNotice(error instanceof Error ? error.message : "资料夹另存为失败"));
              }}><Download size={14}/>另存为本地文件夹</button>
              <button type="button" role="menuitem" disabled={!onGroupFolderExport} className={itemClass} onClick={() => {
                const request = createNativeGroupFolderExportRequest(store.snapshot, folder.id);
                setShapeContextMenu(undefined);
                if (request) void Promise.resolve(onGroupFolderExport?.(request, "library")).catch((error) => setClipboardNotice(error instanceof Error ? error.message : "保存到资料库失败"));
              }}><LibraryBig size={14}/>保存到资料库</button>
            </>;
            if (!selected.length) return <>
              <button type="button" role="menuitem" className={itemClass} onClick={() => {const point = shapeContextMenu.point; setShapeContextMenu(undefined); beginTextDraft({point, value: "", autoSize: true});}}><Pencil size={14}/>添加文字</button>
              <button type="button" role="menuitem" className={itemClass} onClick={() => {const point = shapeContextMenu.point; editor.createShapes([{type: "note", x: point.x, y: point.y, props: {w: 220, h: 180, richText: nativeRichText(""), color: "yellow", labelColor: "black"}}]); setShapeContextMenu(undefined);}}><FileText size={14}/>添加便签</button>
              <button type="button" role="menuitem" className={itemClass} onClick={() => {const point = shapeContextMenu.point; editor.createShapes([{type: "geo", x: point.x - 90, y: point.y - 60, props: {geo: "rectangle", w: 180, h: 120, color, strokeColor: color, scale: 1}}]); setShapeContextMenu(undefined);}}><Plus size={14}/>添加矩形</button>
              {onMindMapCreate && <button type="button" role="menuitem" className={itemClass} onClick={() => {onMindMapCreate(shapeContextMenu.point); setShapeContextMenu(undefined);}}><GitBranch size={14}/>添加思维导图</button>}
              <button type="button" role="menuitem" className={itemClass} onClick={() => {menuMediaPointRef.current = shapeContextMenu.point; setShapeContextMenu(undefined); menuMediaInputRef.current?.click();}}><ImageIcon size={14}/>添加图片或视频</button>
              <button type="button" role="menuitem" className={itemClass} onClick={() => {const point = shapeContextMenu.point; const url = window.prompt("输入网页链接"); if (url) editor.pasteLink(url, point); setShapeContextMenu(undefined);}}><Link2 size={14}/>添加网页链接</button>
              <button type="button" role="menuitem" className={itemClass} onClick={() => {void pasteAtMenu().catch(error => setClipboardNotice(error instanceof Error ? error.message : "粘贴失败"));}}><ClipboardPaste size={14}/>粘贴</button>
            </>;
            return <>
              <button type="button" role="menuitem" className={itemClass} onClick={() => {void copySelection();}}><Copy size={14}/>复制</button>
              <button type="button" role="menuitem" disabled={selected.length < 2 || sameGroup} className={itemClass} onClick={() => { editor.groupSelectedShapes(); setShapeContextMenu(undefined); }}><Group size={14}/>编组</button>
              <button type="button" role="menuitem" disabled={!sameGroup} className={itemClass} onClick={() => { editor.ungroupSelectedShapes(); setShapeContextMenu(undefined); }}><Ungroup size={14}/>取消编组</button>
              <button type="button" role="menuitem" disabled={!sameGroup} className={itemClass} onClick={() => { editor.collapseSelectedGroup(); setShapeContextMenu(undefined); }}><Folder size={14}/>收起为资料夹</button>
              {selected.filter((shape) => ["image", "media", "link", "resource"].includes(shape.type)).length >= 2 && <><button type="button" role="menuitem" className={itemClass} onClick={() => equalize("w")}>等宽缩放</button><button type="button" role="menuitem" className={itemClass} onClick={() => equalize("h")}>等高缩放</button></>}
            </>;
          })()}
        </div>
      ) : null}
      {shapeContextMenu && folderColorMenu && !renamingFolderId && !editingFolderDescriptionId && editor.getSelectedShapeIds().length === 1 && editor.getShape(editor.getSelectedShapeIds()[0]!)?.type === "group-folder" ? createPortal(
        <div ref={folderColorMenuRef} id={folderColorMenuId} role="menu" aria-label="资料夹颜色" data-whiteboard-control-surface className="moki-menu-surface fixed z-[100] flex items-center justify-between gap-2 p-2" style={{left: folderColorMenu.left, top: folderColorMenu.top, width: 224}} onPointerDown={event => event.stopPropagation()}>
          {["#776bd8", "#5086d7", "#36a391", "#e79d45", "#ce668a", "#7d8799"].map(value => {
            const folder = editor.getShape(editor.getSelectedShapeIds()[0]!);
            const checked = (folder?.props.groupColor ?? "#776bd8") === value;
            return <button key={value} type="button" role="menuitemradio" aria-label={`资料夹颜色 ${value}`} aria-checked={checked} title={value} onClick={() => {if (folder) editor.setGroupFolderColor(folder.id, value); setFolderColorMenu(undefined); setShapeContextMenu(undefined); scheduleDraw();}} className="grid shrink-0 place-items-center rounded-full border-2 border-white shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#625bc5]" style={{width: 26, height: 26, minWidth: 26, minHeight: 26, flex: "0 0 26px", aspectRatio: "1 / 1", borderRadius: "50%", backgroundColor: value, outline: checked ? "2px solid #776bd8" : undefined, outlineOffset: 2}} />;
          })}
        </div>, document.body) : null}
      {animatedImageShapes.map(({ shape, src }) => {
        const bounds = nativeShapeBounds(shape);
        const camera = cameraRef.current;
        const selected = selectedShapeIds.has(shape.id);
        const overlayBounds = nativeOverlayBounds(bounds, camera, overlayScale);
        return (
          <div
            key={`animated-${shape.id}`}
            aria-label={selected ? "GIF 动画播放器" : undefined}
            aria-hidden={selected ? undefined : true}
            className="pointer-events-none absolute z-[1] overflow-hidden"
            style={{
              ...overlayBounds,
              opacity: typeof shape.opacity === "number" ? shape.opacity : 1,
              transform: shape.rotation ? `rotate(${shape.rotation}deg)` : undefined,
              transformOrigin: "center center",
              boxShadow: selected ? "inset 0 0 0 2px #625bc5" : undefined,
            }}
          >
            <NativeGifPlayer src={src} selected={selected} />
          </div>
        );
      })}
      {mediaShapes.map(({ shape, src, mimeType }) => {
        const bounds = nativeShapeBounds(shape);
        const camera = cameraRef.current;
        const selected = selectedShapeIds.has(shape.id);
        const video = shape.props.mediaKind === "video" || mimeType.startsWith("video/");
        const localPath = typeof shape.props.localPath === "string" ? shape.props.localPath : "";
        const overlayBounds = nativeOverlayBounds(bounds, camera, overlayScale);
        const common = {
          src,
          preload: "metadata" as const,
          controls: selected,
          className: "size-full",
          onDoubleClick: (event: React.MouseEvent<HTMLMediaElement>) => {
            if (!localPath) return;
            event.preventDefault();
            event.stopPropagation();
            void onLocalPathOpen?.(localPath);
          },
        };
        return (
          <div
            key={`media-${shape.id}`}
            aria-label={`${video ? "视频" : "音频"}预览 ${String(shape.props.name ?? "")}`}
            className={`absolute z-[2] overflow-hidden rounded-2xl ${selected && selectedShapeIds.size === 1 ? "pointer-events-auto ring-2 ring-[#625bc5]" : "pointer-events-none"}`}
            onContextMenu={event => {
              if (!selected) return;
              event.preventDefault();
              event.stopPropagation();
              const rect = canvasRef.current?.getBoundingClientRect();
              setShapeContextMenu({x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0), point: eventPoint(event)});
            }}
            style={{
              ...overlayBounds,
              opacity: typeof shape.opacity === "number" ? shape.opacity : 1,
              transform: shape.rotation ? `rotate(${shape.rotation}deg)` : undefined,
              transformOrigin: "center center",
            }}
          >
            {video
              ? <video {...common} aria-label="白板视频播放器" className="size-full bg-[#171b2a] object-contain" />
              : <audio {...common} aria-label="白板音频播放器" className="h-full w-full px-4" />}
          </div>
        );
      })}
      {interactiveLinkShapes.map((shape) => {
        const bounds = nativeShapeBounds(shape);
        const details = nativeLinkDetails(shape);
        const camera = cameraRef.current;
        const overlayBounds = nativeOverlayBounds(bounds, camera, overlayScale);
        const linkCanvasScale = camera.zoom / (Number.isFinite(overlayScale) && overlayScale > 0 ? overlayScale : 1);
        return (
          <div
            key={shape.id}
            data-whiteboard-link={shape.id}
            className="pointer-events-none absolute z-10 overflow-hidden rounded-2xl"
            style={{
              ...overlayBounds,
              transform: shape.rotation ? `rotate(${shape.rotation}deg)` : undefined,
              transformOrigin: "center center",
            }}
          >
            <div
              data-whiteboard-link-content
              className="absolute left-0 top-0"
              style={{
                width: bounds.w,
                height: bounds.h,
                transform: `scale(${linkCanvasScale})`,
                transformOrigin: "top left",
              }}
            >
              <div data-whiteboard-link-actions data-whiteboard-control-surface className="pointer-events-auto absolute right-2 top-2 z-20 flex items-center gap-1 rounded-lg border border-[#dfe2ec] bg-white/95 p-1 shadow-sm">
                <button
                  type="button"
                  aria-label="切换为链接模式"
                  aria-pressed={details.mode === "link"}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => editor.updateShapes([{
                    id: shape.id,
                    props: { mode: "link", h: 82 },
                  }])}
                  className={`native-whiteboard-edit-control rounded-md px-2 py-1 text-[0.625rem] font-bold ${details.mode === "link" ? "bg-[#ebeafd] text-[#625bc5]" : "text-[#73798b] hover:bg-[#f4f5f8]"}`}
                >
                  链接
                </button>
                <button
                  type="button"
                  aria-label="切换为预览卡片模式"
                  aria-pressed={details.mode === "preview"}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => editor.updateShapes([{
                    id: shape.id,
                    props: { mode: "preview", h: 300 },
                  }])}
                  className={`native-whiteboard-edit-control rounded-md px-2 py-1 text-[0.625rem] font-bold ${details.mode === "preview" ? "bg-[#ebeafd] text-[#625bc5]" : "text-[#73798b] hover:bg-[#f4f5f8]"}`}
                >
                  预览
                </button>
                <button
                  type="button"
                  aria-label="在系统浏览器中打开网页"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => void openWhiteboardExternalUrl(details.url)}
                  className="rounded-md px-2 py-1 text-[0.625rem] font-bold text-[#625bc5] hover:bg-[#f0efff]"
                >
                  浏览
                </button>
              </div>
              {details.mode === "preview" && details.url && (
                <LinkPreviewFrame
                  shape={shape}
                  details={details}
                  editor={editor}
                />
              )}
            </div>
          </div>
        );
      })}
      {clipboardNotice && (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none absolute left-1/2 top-4 z-50 -translate-x-1/2 rounded-xl border border-[#dfe1ee] bg-white/95 px-3 py-2 text-xs font-bold text-[#4f5570] shadow-[0_8px_24px_rgba(35,39,61,.14)] backdrop-blur"
        >
          {clipboardNotice}
        </div>
      )}
      {draggingFile && (
        <div className="pointer-events-none absolute inset-3 z-30 grid place-items-center rounded-2xl border-2 border-dashed border-[#625bc5] bg-[#f0efff]/75 text-sm font-black text-[#625bc5] backdrop-blur-sm">
          松开鼠标，添加本地文件或文件夹
        </div>
      )}
      {textDraft && draftPosition && (
        <>
          <div
            aria-label="编辑文字字号"
            data-whiteboard-control-surface
            className="absolute z-30 flex -translate-x-1/2 items-center gap-1 rounded-xl border border-[#e2e4ed] bg-white/95 p-1 shadow-[0_8px_24px_rgba(35,39,61,.16)] backdrop-blur"
            style={{
              left: draftPosition.left + draftEditorWidth / 2,
              top: draftToolbarBelow
                ? draftPosition.top + draftEditorVisualHeight + 8
                : draftPosition.top - 8,
              transform: draftToolbarBelow
                ? "translate(-50%, 0)"
                : "translate(-50%, -100%)",
            }}
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
          >
            <NativeTextFormattingControls
              labelPrefix="编辑文字"
              sizeLabelPrefix="编辑"
              style={activeDraftStyle}
              color={activeDraftColor}
              colorMenuOpen={textColorMenu === "draft"}
              colorMenuSide={draftToolbarBelow ? "bottom" : "top"}
              onStyleChange={updateDraftStyle}
              onColorChange={updateDraftColor}
              onColorMenuToggle={() => setTextColorMenu((current) => current === "draft" ? undefined : "draft")}
            />
          </div>
          <textarea
            ref={textInputRef}
            aria-label="输入白板文字"
            data-whiteboard-inline-text-editor={textDraft.shapeId ?? "new"}
            rows={1}
            wrap={textDraft.autoSize ? "off" : "soft"}
            value={textDraft.value}
            data-auto-size={textDraft.autoSize ? "true" : "false"}
            placeholder="输入文字…"
            onPointerDown={(event) => event.stopPropagation()}
            onChange={(event) => {
              const current = textDraftRef.current;
              if (!current) return;
              const next = { ...current, value: event.target.value };
              textDraftRef.current = next;
              setTextDraft(next);
            }}
            onBlur={commitTextDraft}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                cancelTextDraft();
              } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                commitTextDraft();
              }
            }}
            className="absolute z-20 resize-none overflow-hidden rounded-[4px] border border-[#625bc5] bg-transparent leading-[1.35] shadow-none outline-none"
            style={{
              left: draftPosition.left,
              top: draftPosition.top,
              width: draftEditorWidth,
              height: draftEditorHeight,
              minHeight: draftEditorHeight,
              paddingLeft: draftHorizontalPadding,
              paddingRight: draftHorizontalPadding,
              paddingTop: draftVerticalPadding,
              paddingBottom: draftVerticalPadding,
              color: draftEditorColor,
              borderColor: nativeCanvasSelectionPalette(canvasDark).stroke,
              fontSize: scaledDraftFontSize,
              fontWeight: activeDraftStyle.bold ? 700 : 400,
              fontStyle: activeDraftStyle.italic ? "italic" : "normal",
              // The app disables synthetic font faces globally. MOKI CJK has no
              // dedicated italic face, so allow Chromium to slant CJK glyphs in
              // the whiteboard editor when the italic control is active.
              fontSynthesis: activeDraftStyle.italic ? "style" : "none",
              textDecoration: activeDraftStyle.underline ? "underline" : "none",
              textAlign: activeDraftStyle.textAlign === "middle" ? "center" : activeDraftStyle.textAlign === "end" ? "right" : "left",
              transform: textDraft.rotation ? `rotate(${textDraft.rotation}deg)` : undefined,
              transformOrigin: "center center",
            }}
          />
        </>
      )}
      {!textDraft && selectedTextToolbarPosition && (
        <div
          aria-label="选中文字工具"
          data-whiteboard-control-surface
          className="absolute z-30 flex items-center gap-1 rounded-xl border border-[#e2e4ed] bg-white/95 p-1 shadow-[0_8px_24px_rgba(35,39,61,.16)] backdrop-blur"
          style={{
            left: selectedTextToolbarPosition.left,
            top: selectedTextToolbarPlacement?.anchorTop,
            transform: selectedTextToolbarPlacement?.toolbarBelow
              ? "translate(-50%, 0)"
              : "translate(-50%, -100%)",
          }}
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          <NativeTextFormattingControls
            labelPrefix="选中文字"
            sizeLabelPrefix="选中"
            style={selectedTextStyle}
            color={selectedTextColor ?? "black"}
            colorMenuOpen={textColorMenu === "selection"}
            colorMenuSide={selectedTextToolbarPlacement?.menuSide ?? "top"}
            onStyleChange={updateSelectedTextStyle}
            onColorChange={updateSelectedTextColor}
            onColorMenuToggle={() => setTextColorMenu((current) => current === "selection" ? undefined : "selection")}
          />
        </div>
      )}
      {!textDraft && selectedPaintToolbarPosition && (
        <div
          aria-label="选中内容样式"
          data-whiteboard-control-surface
          className="absolute z-30 flex items-center gap-1 rounded-xl border border-[#e2e4ed] bg-white/95 p-1 shadow-[0_8px_24px_rgba(35,39,61,.16)] backdrop-blur"
          style={{
            left: selectedPaintToolbarPosition.left,
            top: selectedPaintToolbarPlacement?.anchorTop,
            transform: selectedPaintToolbarPlacement?.toolbarBelow
              ? "translate(-50%, 0)"
              : "translate(-50%, -100%)",
          }}
          onPointerDown={(event) => {
            if (event.target instanceof HTMLInputElement && event.target.type === "range") {
              event.stopPropagation();
              return;
            }
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          {(["s", "m", "l", "xl"] as const).map((size) => (
            <button
              type="button"
              key={size}
              aria-label={`选中内容粗细 ${size.toUpperCase()}`}
              aria-pressed={selectedPaintSize === size}
              onClick={() => updateSelectedPaintSize(size)}
              className={`native-whiteboard-edit-control grid size-8 place-items-center rounded-lg transition ${selectedPaintSize === size ? "bg-[#ebeafd] text-[#625bc5]" : "text-[#73798b] hover:bg-[#f4f5f8]"}`}
            >
              <span className="block rounded-full bg-current" style={{ width: 19, height: STROKE_WIDTHS[size] }} />
            </button>
          ))}
          <div className="relative border-l border-[#e2e4ed] pl-1">
            <button
              ref={selectedPaintMenuTriggerRef}
              type="button"
              aria-label="选中内容颜色"
              aria-controls={selectedPaintMenuId}
              aria-expanded={selectedPaintMenuOpen}
              onClick={() => setSelectedPaintMenuOpen((open) => !open)}
              className="native-whiteboard-edit-control native-whiteboard-paint-color-trigger relative grid size-8 place-items-center rounded-lg hover:bg-[#f4f5f8]"
            >
              <Palette size={15} aria-hidden="true" />
              <span
                aria-hidden="true"
                className="native-whiteboard-current-color absolute bottom-1 right-1 block size-2 rounded-full border border-white shadow-[0_0_0_1px_rgba(35,39,61,.32)]"
                style={{ backgroundColor: COLORS[selectedPaintColor] }}
              />
            </button>
            {selectedPaintMenuOpen && selectedPaintMenuPosition && rootRef.current ? createPortal(
              <div
                id={selectedPaintMenuId}
                role="dialog"
                aria-label="选中内容调色盘"
                data-whiteboard-color-menu
                data-whiteboard-color-menu-side={selectedPaintMenuPosition.side}
                className={`moki-menu-surface absolute z-50 p-2 ${selectedGeoPaint ? "w-72" : "grid w-40 grid-cols-6 gap-1"}`}
                style={{ left: selectedPaintMenuPosition.left, top: selectedPaintMenuPosition.top }}
              >
                {selectedGeoPaint ? (
                  <div className="space-y-2" aria-label="选中图形描边和填充">
                    {(["stroke", "fill"] as const).map((kind) => {
                      const enabled = kind === "stroke" ? selectedGeoPaint.strokeEnabled : selectedGeoPaint.fillEnabled;
                      const currentColor = kind === "stroke" ? selectedGeoPaint.strokeColor : selectedGeoPaint.fillColor;
                      const opacity = kind === "stroke" ? selectedGeoPaint.strokeOpacity : selectedGeoPaint.fillOpacity;
                      const label = kind === "stroke" ? "描边" : "填充";
                      return (
                        <section key={kind} className="native-whiteboard-color-section native-whiteboard-menu-section rounded-xl bg-[#f7f8fb] p-2">
                          <div className="mb-2 flex items-center justify-between">
                            <b className="text-[0.6875rem] text-[#3d4358]">{label}</b>
                            <button
                              type="button"
                              aria-label={`${enabled ? "关闭" : "启用"}选中图形${label}`}
                              aria-pressed={enabled}
                              onClick={() => updateSelectedGeoPaint(kind === "stroke" ? { strokeEnabled: !enabled } : { fillEnabled: !enabled })}
                              className={`native-whiteboard-edit-control grid size-7 place-items-center rounded-lg ${enabled ? "bg-[#ebeafd] text-[#625bc5]" : "bg-[#eceef3] text-[#858b9d]"}`}
                            >
                              {enabled ? <Eye size={14} /> : <EyeOff size={14} />}
                            </button>
                          </div>
                          <div className={`grid grid-cols-6 gap-1 ${enabled ? "" : "pointer-events-none opacity-35"}`}>
                            {NATIVE_COLOR_OPTIONS.map((option) => (
                              <button
                                type="button"
                                key={`${kind}:${option.value}`}
                                aria-label={`选中图形${label}颜色 ${option.label}`}
                                aria-pressed={currentColor === option.value}
                                onClick={() => updateSelectedGeoPaint(kind === "stroke" ? { strokeColor: option.value } : { fillColor: option.value })}
                                className={`native-whiteboard-color-swatch size-7 min-h-0 min-w-7 shrink-0 rounded-full border border-black/5 p-0 ${currentColor === option.value ? "ring-2 ring-[#625bc5] ring-offset-1" : ""}`}
                                style={{
                                  backgroundColor: option.hex,
                                  borderRadius: "50%",
                                  width: 28,
                                  minWidth: 28,
                                  height: 28,
                                  minHeight: 28,
                                  padding: 0,
                                }}
                              />
                            ))}
                          </div>
                          <label className={`mt-2 flex items-center gap-2 text-[0.625rem] font-bold text-[#73798b] ${enabled ? "" : "pointer-events-none opacity-35"}`}>
                            <span>透明度</span>
                            <input
                              aria-label={`选中图形${label}透明度`}
                              type="range"
                              min="0"
                              max="100"
                              value={Math.round(opacity * 100)}
                              onChange={(event) => updateSelectedGeoPaint(kind === "stroke" ? { strokeOpacity: Number(event.target.value) / 100 } : { fillOpacity: Number(event.target.value) / 100 })}
                              className="native-whiteboard-opacity-slider min-w-0 flex-1 accent-[#625bc5]"
                            />
                          </label>
                        </section>
                      );
                    })}
                  </div>
                ) : NATIVE_COLOR_OPTIONS.map((option) => (
                  <button
                    type="button"
                    key={option.value}
                    aria-label={`选中内容颜色 ${option.label}`}
                    aria-pressed={selectedPaintColor === option.value}
                    onClick={() => updateSelectedPaintColor(option.value)}
                    className={`native-whiteboard-color-swatch size-5 min-h-0 min-w-5 shrink-0 rounded-full border border-black/5 p-0 ${selectedPaintColor === option.value ? "ring-2 ring-[#625bc5] ring-offset-1" : ""}`}
                    style={{
                      backgroundColor: option.hex,
                      borderRadius: "50%",
                      width: 20,
                      minWidth: 20,
                      height: 20,
                      minHeight: 20,
                      padding: 0,
                    }}
                  />
                ))}
              </div>,
              rootRef.current,
            ) : null}
          </div>
        </div>
      )}
      <div ref={pageMenuRef} data-whiteboard-page-toolbar data-whiteboard-control-surface className="absolute left-3 top-3 z-40 flex items-center gap-1 rounded-xl border border-[#e2e4ed] bg-white/95 p-1 shadow-sm backdrop-blur">
        <button
          type="button"
          aria-label="打开白板页面菜单"
          aria-expanded={pageMenuOpen}
          onClick={() => {
            setPageMenuOpen((open) => !open);
            setPageQuery("");
            setRenamingPageId(undefined);
          }}
          className="flex h-8 min-w-28 max-w-52 items-center justify-between gap-2 rounded-lg px-2.5 text-left text-xs font-bold text-[#30364d] outline-none transition hover:bg-[#f4f3fb] focus-visible:ring-2 focus-visible:ring-[#8a84de]"
        >
          <span className="truncate">{currentPageName}</span>
          <ChevronDown className={`size-3.5 shrink-0 transition ${pageMenuOpen ? "rotate-180" : ""}`} />
        </button>
        <button
          type="button"
          aria-label="新建白板页面"
          title="新建页面"
          onClick={() => {
            const id = editor.createPage();
            setPageMenuOpen(true);
            setPageQuery("");
            startPageRename(id);
          }}
          className="grid size-8 place-items-center rounded-lg text-base text-[#555b70] transition hover:bg-[#f0efff] hover:text-[#625bc5]"
        >
          ＋
        </button>
        <span aria-hidden="true" className="mx-0.5 h-5 w-px bg-[#e2e4ed]" />
        <button
          type="button"
          aria-label="撤回"
          title="撤回"
          disabled={!editor.canUndo()}
          onClick={() => editor.undo()}
          className="grid size-8 place-items-center rounded-lg text-[#555b70] transition hover:bg-[#f0efff] hover:text-[#625bc5] disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-[#555b70]"
        >
          <Undo2 className="size-4" />
        </button>
        <button
          type="button"
          aria-label="重做"
          title="重做"
          disabled={!editor.canRedo()}
          onClick={() => editor.redo()}
          className="grid size-8 place-items-center rounded-lg text-[#555b70] transition hover:bg-[#f0efff] hover:text-[#625bc5] disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-[#555b70]"
        >
          <Redo2 className="size-4" />
        </button>
        {pageMenuOpen && (
          <div
            role="dialog"
            aria-label="白板页面管理"
            onKeyDown={(event) => {
              if (event.key !== "Escape" || renamingPageId) return;
              event.preventDefault();
              setPageMenuOpen(false);
              setPageQuery("");
            }}
            className="moki-menu-surface absolute left-0 top-[calc(100%+8px)] w-72 overflow-hidden p-2"
          >
            <label className="flex h-9 items-center gap-2 rounded-xl bg-[#f5f6fa] px-3 text-[#8b90a2] focus-within:ring-2 focus-within:ring-[#d8d5f6]">
              <Search className="size-3.5 shrink-0" />
              <input
                autoFocus={!renamingPageId}
                type="search"
                aria-label="搜索白板页面"
                value={pageQuery}
                onChange={(event) => setPageQuery(event.target.value)}
                placeholder="搜索页面或分组"
                className="min-w-0 flex-1 bg-transparent text-xs font-semibold text-[#30364d] outline-none placeholder:text-[#9ba0b1]"
              />
            </label>
            <div className="mt-2 flex items-center justify-between px-1">
              <span className="text-[.625rem] font-bold text-[#9ba0b1]">页面与分组</span>
              <button
                type="button"
                aria-label="新建页面分组"
                title="以当前页创建分组"
                onClick={() => {
                  const id = editor.createPageGroup();
                  if (id) startPageGroupRename(id, "新分组");
                }}
                className="grid size-7 place-items-center rounded-lg text-[#625bc5] transition hover:bg-[#f0efff]"
              >
                <Plus className="size-3.5" />
              </button>
            </div>
            <ul aria-label="白板页面列表" className="mt-1 max-h-[min(32rem,calc(100dvh-11rem))] space-y-1 overflow-y-auto overscroll-y-auto pr-0.5">
              {pageGroups.map((group) => {
                const isGroupDropTarget = pageDropTarget?.type === "group" && pageDropTarget.id === group.id;
                const isRenamingGroup = renamingPageGroupId === group.id;
                const isCollapsed = collapsedPageGroupIds.has(group.id) && !normalizedPageQuery;
                return (
                  <li
                    key={group.id}
                    className={`mb-4 rounded-lg transition last:mb-0 ${draggedPageGroupId === group.id ? "opacity-40" : ""} ${isGroupDropTarget ? "bg-[#eeecff]/65 ring-2 ring-[#8b84dd]/55 ring-offset-2" : ""}`}
                  >
                    <div
                      data-page-group-header={group.id}
                      onPointerDown={(event) => {
                        if (event.button !== 0 || isRenamingGroup || (event.target as Element).closest("button, input")) return;
                        finishPageDrag();
                        pageGroupPointerDragRef.current = { id: group.id, pointerId: event.pointerId, x: event.clientX, y: event.clientY };
                        (event.target as Element).setPointerCapture?.(event.pointerId);
                      }}
                      onPointerMove={(event) => {
                        const drag = pageGroupPointerDragRef.current;
                        if (!drag || drag.pointerId !== event.pointerId) return;
                        if (!draggedPageGroupIdRef.current && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 4) return;
                        event.preventDefault();
                        draggedPageGroupIdRef.current = drag.id;
                        setDraggedPageGroupId(drag.id);
                        const list = pageMenuRef.current?.querySelector<HTMLElement>('[aria-label="白板页面列表"]');
                        const bounds = list?.getBoundingClientRect();
                        drag.target = undefined;
                        if (list && bounds && event.clientX >= bounds.left && event.clientX <= bounds.right && event.clientY >= bounds.top && event.clientY <= bounds.bottom) {
                          if (event.clientY > bounds.bottom - 24) list.scrollTop += 12;
                          else if (event.clientY < bounds.top + 24) list.scrollTop -= 12;
                          const headers = [...list.querySelectorAll<HTMLElement>('[data-page-group-header]')];
                          const header = headers.findLast(value => value.getBoundingClientRect().top <= event.clientY) ?? headers[0];
                          if (header && header.dataset.pageGroupHeader !== drag.id) {
                            const box = header.getBoundingClientRect();
                            drag.target = { id: header.dataset.pageGroupHeader!, position: event.clientY < box.top + box.height / 2 ? "before" : "after" };
                          }
                        }
                        setPageGroupDropTarget(drag.target);
                      }}
                      onPointerUp={(event) => {
                        const drag = pageGroupPointerDragRef.current;
                        if (!drag || drag.pointerId !== event.pointerId) return;
                        if (drag.target) editor.movePageGroup(drag.id, drag.target.id, drag.target.position);
                        finishPageGroupDrag();
                      }}
                      onPointerCancel={finishPageGroupDrag}
                      onLostPointerCapture={finishPageGroupDrag}
                      onDragStart={(event) => event.preventDefault()}
                      onDragOver={(event) => {
                        if (!draggedPageIdRef.current) return;
                        event.preventDefault();
                        setPageDropTarget({ type: "group", id: group.id });
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        const sourceId = draggedPageIdRef.current || event.dataTransfer.getData("text/plain");
                        if (sourceId) editor.movePageToGroup(sourceId, group.id);
                        finishPageDrag();
                      }}
                      className="relative mb-2 flex min-h-8 touch-none select-none cursor-grab items-center gap-1 px-1 text-xs font-extrabold text-[#6f7488] active:cursor-grabbing"
                    >
                      {pageGroupDropTarget?.id === group.id ? <span aria-hidden="true" className={`pointer-events-none absolute inset-x-0 h-0.5 rounded-full bg-[#8178d5] ${pageGroupDropTarget.position === "before" ? "-top-1" : "-bottom-1"}`} /> : null}
                      <GripVertical aria-label={`拖动排序分组 ${group.name}`} className="size-3.5 shrink-0 text-[#a2a6b6]" />
                      <span data-page-group-accent={group.accent.id} className={`grid size-6 shrink-0 place-items-center rounded-lg ${group.accent.className}`}>
                        <Folder className="size-3.5" />
                      </span>
                      {isRenamingGroup ? (
                        <>
                          <input
                            autoFocus
                            aria-label={`重命名页面分组 ${group.name}`}
                            value={pageGroupNameDraft}
                            maxLength={80}
                            onFocus={(event) => event.currentTarget.select()}
                            onChange={(event) => setPageGroupNameDraft(event.target.value)}
                            onBlur={() => commitPageGroupRename(group.id)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                event.currentTarget.blur();
                              } else if (event.key === "Escape") {
                                event.preventDefault();
                                setRenamingPageGroupId(undefined);
                              }
                            }}
                            className="h-7 min-w-0 flex-1 rounded-lg border border-[#aaa5e9] bg-white px-2 text-xs font-extrabold text-[#555b70] outline-none focus:ring-2 focus:ring-[#d8d5f6]"
                          />
                          <button
                            type="button"
                            aria-label={`${isCollapsed ? "展开" : "收起"}页面分组 ${group.name}`}
                            title={isCollapsed ? "展开分组" : "收起分组"}
                            aria-expanded={!isCollapsed}
                            onClick={(event) => {
                              event.stopPropagation();
                              setCollapsedPageGroupIds((current) => {
                                const next = new Set(current);
                                if (next.has(group.id)) next.delete(group.id);
                                else next.add(group.id);
                                return next;
                              });
                            }}
                            className="grid size-7 shrink-0 place-items-center border-0 bg-transparent p-0 text-[#959aac] transition-colors hover:bg-transparent hover:text-[#625bc5]"
                          >
                            <ChevronDown size={13} className={`transition-transform ${isCollapsed ? "-rotate-90" : ""}`} />
                          </button>
                        </>
                      ) : (
                        <>
                          <span
                            title="双击重命名分组"
                            onDoubleClick={() => startPageGroupRename(group.id, group.name)}
                            className="min-w-0 flex-1 cursor-text truncate"
                          >
                            {group.name}
                          </span>
                          <button
                            type="button"
                            aria-label={`${isCollapsed ? "展开" : "收起"}页面分组 ${group.name}`}
                            title={isCollapsed ? "展开分组" : "收起分组"}
                            aria-expanded={!isCollapsed}
                            onClick={(event) => {
                              event.stopPropagation();
                              setCollapsedPageGroupIds((current) => {
                                const next = new Set(current);
                                if (next.has(group.id)) next.delete(group.id);
                                else next.add(group.id);
                                return next;
                              });
                            }}
                            className="grid size-7 shrink-0 place-items-center border-0 bg-transparent p-0 text-[#959aac] transition-colors hover:bg-transparent hover:text-[#625bc5]"
                          >
                            <ChevronDown size={13} className={`transition-transform ${isCollapsed ? "-rotate-90" : ""}`} />
                          </button>
                          <span className="rounded-full bg-[#f0effa] px-1.5 text-[.5625rem] font-bold text-[#7770a7]">{group.pages.length}</span>
                          <button
                            type="button"
                            aria-label={`取消页面分组 ${group.name}`}
                            title="取消分组，保留页面"
                            onClick={() => editor.deletePageGroup(group.id)}
                            className="grid size-7 place-items-center rounded-lg text-[#a0a5b4] transition hover:bg-[#fff0f3] hover:text-[#bd4568]"
                          >
                              <Trash2 className="size-3" />
                          </button>
                        </>
                      )}
                    </div>
                    {!isCollapsed ? <ul aria-label={`页面分组 ${group.name}`} className="space-y-2">
                      {group.pages.map(renderPageRow)}
                    </ul> : null}
                  </li>
                );
              })}
              <li
                onDragOver={(event) => {
                  if (!draggedPageIdRef.current) return;
                  event.preventDefault();
                  setPageDropTarget({ type: "ungrouped" });
                }}
                onDrop={(event) => {
                  if (draggedPageGroupIdRef.current) return;
                  event.preventDefault();
                  const sourceId = draggedPageIdRef.current || event.dataTransfer.getData("text/plain");
                  if (sourceId) editor.movePageToGroup(sourceId);
                  finishPageDrag();
                }}
                className={`mb-4 rounded-lg transition last:mb-0 ${pageDropTarget?.type === "ungrouped" ? "bg-[#eeecff]/65 ring-2 ring-[#8b84dd]/55 ring-offset-2" : ""}`}
              >
                {pageGroups.length > 0 && (
                  <div className="mb-2 flex h-7 items-center gap-1.5 px-1 text-xs font-extrabold text-[#858b9d]">
                    <span className="grid size-6 shrink-0 place-items-center rounded-lg bg-[#edf0f5] text-[#747b8f]"><FileText className="size-3.5" /></span>
                    未分组
                  </div>
                )}
                <ul aria-label="未分组页面" className="space-y-2">
                  {ungroupedPages.map(renderPageRow)}
                </ul>
              </li>
              {!hasVisiblePageMenuItems && (
                <li className="px-3 py-7 text-center text-xs font-semibold text-[#9297a7]">未找到匹配页面</li>
              )}
            </ul>
            <p className="px-2 pb-1 pt-2 text-[.625rem] font-semibold text-[#9ba0b1]">拖拽分组标题可排序；拖拽页面可排序、移入或移出分组</p>
          </div>
        )}
      </div>
      {pendingPageDelete && (
        <div className="absolute inset-0 z-[80] grid place-items-center bg-[#1f2437]/35 p-5 backdrop-blur-[2px]">
          <section
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="whiteboard-delete-page-title"
            aria-describedby="whiteboard-delete-page-description"
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              event.preventDefault();
              setPendingPageDelete(undefined);
            }}
            className="w-full max-w-sm rounded-[22px] border border-white/80 bg-white p-5 shadow-[0_24px_70px_rgba(25,29,48,.28)]"
          >
            <div className="flex items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-[#fff0f3] text-[#c43e68]">
                <AlertTriangle className="size-5" />
              </span>
              <div className="min-w-0">
                <h3 id="whiteboard-delete-page-title" className="text-base font-black text-[#20263b]">
                  删除“{pendingPageDelete.name}”？
                </h3>
                <p id="whiteboard-delete-page-description" className="mt-1 text-sm leading-6 text-[#747b90]">
                  删除后无法恢复，该页面中的所有内容和历史版本都会被永久删除。是否确认删除？
                </p>
              </div>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button
                type="button"
                autoFocus
                onClick={() => setPendingPageDelete(undefined)}
                className="min-h-10 rounded-xl border border-[#dfe2ec] bg-white px-4 text-sm font-bold text-[#4f566c] transition hover:bg-[#f7f8fb]"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => {
                  editor.deletePage(pendingPageDelete.id);
                  setPendingPageDelete(undefined);
                }}
                className="min-h-10 rounded-xl bg-[#c43e68] px-4 text-sm font-bold text-white transition hover:bg-[#ad3159]"
              >
                确认删除
              </button>
            </div>
          </section>
        </div>
      )}
      <div data-whiteboard-navigation className="absolute bottom-3 left-3 z-10 flex w-44 max-w-[calc(100%-1.5rem)] flex-col gap-2">
        <canvas
          ref={minimapRef}
          data-whiteboard-control-surface
          aria-label="画布导航缩略图"
          title="点击缩略图快速定位画布"
          onPointerDown={navigateFromMinimap}
          className="h-[108px] w-full cursor-crosshair rounded-xl border border-[#dfe2ec] bg-white/95 shadow-[0_8px_24px_rgba(35,39,61,.12)]"
        />
        <div data-whiteboard-control-surface aria-label="白板缩放工具" className="flex w-full items-center rounded-xl border border-[#e2e4ed] bg-white/95 p-1 text-[.6875rem] font-bold text-[#62687a] shadow-sm">
          <button
            type="button"
            aria-label="缩小白板"
            title="缩小"
            disabled={zoomLabel <= WHITEBOARD_MIN_ZOOM * 100}
            onClick={() => changeZoom(-1)}
            className="grid size-7 place-items-center rounded-lg transition hover:bg-[#f0efff] active:scale-90 disabled:cursor-not-allowed disabled:opacity-35"
          >
            <Minus size={13} strokeWidth={2.2} />
          </button>
          <span aria-live="polite" className="min-w-0 flex-1 px-1 text-center tabular-nums">
            {formatWhiteboardZoom(zoomLabel / 100)}% · MOKI白板
          </span>
          <button
            type="button"
            aria-label="放大白板"
            title="放大"
            disabled={zoomLabel >= WHITEBOARD_MAX_ZOOM * 100}
            onClick={() => changeZoom(1)}
            className="grid size-7 place-items-center rounded-lg transition hover:bg-[#f0efff] active:scale-90 disabled:cursor-not-allowed disabled:opacity-35"
          >
            <Plus size={13} strokeWidth={2.2} />
          </button>
        </div>
      </div>
    </div>
  );
}
