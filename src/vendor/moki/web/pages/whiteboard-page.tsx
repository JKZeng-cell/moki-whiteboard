import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  ArrowUpRight,
  BrainCircuit,
  CheckCircle2,
  CloudOff,
  Download,
  Eraser,
  Hand,
  History,
  Image as ImageIcon,
  Eye,
  ExternalLink,
  FileDown,
  FileUp,
  File as FileIcon,
  Folder,
  GitBranch,
  GitFork,
  Keyboard,
  Link2,
  ListTree,
  LoaderCircle,
  Maximize2,
  Minimize2,
  MousePointer2,
  Network,
  PanelRightClose,
  PanelRightOpen,
  Palette,
  PenTool,
  PencilLine,
  Save,
  Search,
  Square,
  StickyNote,
  Type,
  Waypoints,
  X,
} from "lucide-react";
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  NativeWhiteboard,
  createNativeWhiteboardStore,
  createNativeShapeId,
  downloadNativeWhiteboardImage,
  exportNativeWhiteboardImage,
  fetchWhiteboardLinkMetadata,
  NativeGeoShapeStyle,
  NATIVE_COLOR_OPTIONS,
  getNativeSnapshot,
  loadNativeSnapshot,
  normalizeWhiteboardLinkUrl,
  toNativeRichText,
  type NativeWhiteboardEditor,
  type NativeWhiteboardFolderExportRequest,
  type NativeCanvasColor,
  type NativeNoteShapeUtil,
  type NativeGeoShape,
  type NativeGeoPaintStyle,
  type NativeEditorSnapshot,
  type NativeWhiteboardImageExportOptions,
  type NativeWhiteboardLinkMode,
  type NativeDroppedLocalItem,
  type NativeArrowStyle,
  type NativeShape,
  type NativeShapeId,
  type NativeTextStyle,
  type NativeStrokeSize,
  type NativeVecLike,
} from "../components/native-whiteboard.js";
import type {
  WhiteboardLatest,
  WhiteboardSnapshot,
  WhiteboardVersionSummary,
} from "../../shared/whiteboard-contract.js";
import type { ResourceLibraryItem } from "../../shared/resource-library-contract.js";
import {
  isNativeShape,
} from "../../whiteboard/native-whiteboard-model.js";
import {
  buildMindMapTemplate,
  type MindMapTemplateId,
} from "../../whiteboard/mind-map.js";
import { AppShell } from "../components/app-shell.js";
import { WorkbenchPageHeader } from "../components/workbench-page-header.js";
import { PageFeedback } from "../components/page-feedback.js";
import {importLocalLibrary,uploadLibraryFile} from '../../../../web/library-adapter.js';
import { apiFetch } from "../lib/api-fetch.js";
import {
  getWhiteboard,
  getWhiteboardVersion,
  getWhiteboardVersions,
  saveWhiteboard,
  syncWhiteboardPages,
} from "../lib/api.js";
import {
  ASSISTANT_MEDIA_INSERT_EVENT,
  PENDING_ASSISTANT_MEDIA_KEY,
  type AssistantMediaInsertRequest,
  isWorkbenchDataUpdateFor,
  type WorkbenchDataUpdatedDetail,
  WORKBENCH_DATA_UPDATED_EVENT,
} from "../lib/workbench-events.js";
import {
  getResourceLibraryItems,
  exportWhiteboardFolder,
  getResourceLibraryImageFile,
  isResourceLibraryImage,
  openResourceLibraryItem,
  resourceLibraryPreviewUrl,
} from "../lib/resource-library-api.js";
import {
  createWhiteboardTransferFile,
  downloadWhiteboardTransferFile,
  importWhiteboardTransferFile,
  type WhiteboardPortableResource,
  type WhiteboardPortableResourceSource,
  WHITEBOARD_TRANSFER_MIME,
} from "../lib/whiteboard-transfer.js";

type SaveState = "idle" | "pending" | "saving" | "saved" | "error";
type InsertKind = "text" | "note";
type CanvasToolId =
  | "select"
  | "hand"
  | "eraser"
  | "arrow"
  | "draw"
  | "pen"
  | "text"
  | "geo";
type AlignKind =
  | "left"
  | "center-x"
  | "right"
  | "top"
  | "center-y"
  | "bottom";
type ShapeOption = { geo: NativeGeoShape; label: string };
type WhiteboardPageInfo = { pageId: string; pageName: string };
type WhiteboardMaterial = {
  shapeId: string;
  name: string;
  kind: "image" | "link" | "resource" | "media";
  previewUrl?: string;
  openUrl?: string;
  localPath?: string;
  mediaKind?: "audio" | "video";
  libraryItemId?: string;
};
type MeasuredShape = {
  shape: NativeShape;
  members: NativeShape[];
  x: number;
  y: number;
  w: number;
  h: number;
  right: number;
  bottom: number;
  centerX: number;
  centerY: number;
};

const MAX_WHITEBOARD_FILE_BYTES = 200 * 1024 * 1024;
const DEFAULT_CANVAS_INSERT_SIZE = 220;
const MIN_CANVAS_INSERT_SIZE = 140;

function imageMediaTypeFromPath(value: string): string | undefined {
  const path = value.split(/[?#]/u, 1)[0]?.toLowerCase() ?? "";
  const extension = path.match(/\.(png|jpe?g|webp|gif|avif|bmp|svg)$/u)?.[1];
  if (!extension) return undefined;
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "svg") return "image/svg+xml";
  return `image/${extension}`;
}

function isDroppedPreviewableMedia(file: File): boolean {
  if (/^(?:image|audio|video)\//u.test(file.type.toLowerCase())) return true;
  return /\.(?:png|jpe?g|webp|gif|avif|bmp|svg|mp4|m4v|mov|webm|ogv|mkv|avi|mp3|wav|m4a|aac|ogg|oga|opus|flac)$/iu.test(file.name);
}

function portableWhiteboardResources(
  snapshot: WhiteboardSnapshot,
  pageId: string,
  libraryItems: ResourceLibraryItem[],
): WhiteboardPortableResource[] {
  const pageIds = pageRecordIds(snapshot.document.store, pageId);
  const libraryById = new Map(libraryItems.map((item) => [item.id, item]));
  const libraryChildren = new Map<string | null, ResourceLibraryItem[]>();
  for (const item of libraryItems) {
    const siblings = libraryChildren.get(item.parentId) ?? [];
    siblings.push(item);
    libraryChildren.set(item.parentId, siblings);
  }
  const virtualFolderSources = (rootId: string): WhiteboardPortableResourceSource[] => {
    const sources: WhiteboardPortableResourceSource[] = [];
    const visit = (parentId: string, prefix: string) => {
      for (const child of libraryChildren.get(parentId) ?? []) {
        if (child.target) {
          const pathPrefix = [prefix, child.kind === "local_folder" ? child.name : ""]
            .filter(Boolean).join("/");
          sources.push({
            source: child.target,
            name: child.name,
            ...(pathPrefix ? { pathPrefix } : {}),
          });
        } else if (child.kind === "folder") {
          visit(child.id, [prefix, child.name].filter(Boolean).join("/"));
        }
      }
    };
    visit(rootId, "");
    return sources;
  };
  return Object.values(snapshot.document.store)
    .filter((record): record is NativeShape => isNativeShape(record) && pageIds.has(record.id))
    .flatMap((shape): WhiteboardPortableResource[] => {
      const localPath = typeof shape.props.localPath === "string" ? shape.props.localPath.trim() : "";
      const name = String(shape.props.name ?? shape.props.altText ?? "白板资料").trim() || "白板资料";
      if (localPath) {
        return [{
          shapeId: shape.id,
          name,
          kind: shape.type === "resource" && ["folder", "local_folder"].includes(String(shape.props.kind)) ? "folder" : "file",
          sources: [{ source: localPath, name }],
        }];
      }
      if (shape.type !== "resource") return [];
      const libraryItemId = typeof shape.props.libraryItemId === "string" ? shape.props.libraryItemId : "";
      const item = libraryById.get(libraryItemId);
      if (!item) throw new Error(`白板映射资料不存在，无法打包：${name}`);
      if (item.target) {
        return [{
          shapeId: shape.id,
          name: item.name,
          kind: item.kind === "local_folder" ? "folder" : "file",
          sources: [{ source: item.target, name: item.name }],
        }];
      }
      if (item.kind !== "folder") throw new Error(`白板映射资料没有可读取来源：${item.name}`);
      return [{
        shapeId: shape.id,
        name: item.name,
        kind: "folder",
        sources: virtualFolderSources(item.id),
      }];
    });
}

export function resolveAssistantImageMediaType(
  request: AssistantMediaInsertRequest,
  responseMediaType: string,
): string | undefined {
  const declaredType =
    typeof request.mediaType === "string"
      ? request.mediaType.trim().toLowerCase()
      : "";
  if (declaredType.startsWith("image/")) return declaredType;

  const downloadedType = responseMediaType.trim().toLowerCase();
  if (downloadedType.startsWith("image/")) return downloadedType;

  return (
    imageMediaTypeFromPath(request.name) ??
    imageMediaTypeFromPath(request.url)
  );
}

function assistantMediaRequestKey(request: AssistantMediaInsertRequest): string {
  return request.requestId ?? `${request.url}\n${request.name}`;
}
const MAX_CANVAS_INSERT_SIZE = 620;
const ALIGN_STAGGER_GAP = 10;
const SHAPE_OPTIONS: ShapeOption[] = [
  { geo: "rectangle", label: "矩形" },
  { geo: "ellipse", label: "圆形" },
  { geo: "triangle", label: "三角形" },
  { geo: "diamond", label: "菱形" },
  { geo: "cloud", label: "云朵" },
  { geo: "star", label: "星形" },
];
const WHITEBOARD_SHORTCUTS = [
  { label: "粘贴图片或元素", keys: "Ctrl / ⌘ + V" },
  { label: "复制选中元素", keys: "Ctrl / ⌘ + C" },
  { label: "全选当前页面", keys: "Ctrl / ⌘ + A" },
  { label: "创建选中副本", keys: "Ctrl / ⌘ + D" },
  { label: "编组选中元素", keys: "Ctrl / ⌘ + G" },
  { label: "取消选中编组", keys: "Ctrl / ⌘ + Alt + G" },
  { label: "撤销 / 重做", keys: "Ctrl / ⌘ + Z / Shift + Z" },
  { label: "立即保存", keys: "Ctrl / ⌘ + S" },
  { label: "适配当前页面", keys: "Ctrl / ⌘ + 0" },
  { label: "按方向对齐选中元素", keys: "Ctrl / ⌘ + 方向键" },
  { label: "删除选中元素", keys: "Delete / Backspace" },
  { label: "指针 / 抓手", keys: "V / H" },
  { label: "画笔 / 钢笔 / 文字 / 图形", keys: "P / B / T / R" },
  { label: "新建便签", keys: "N" },
  { label: "选择图片文件", keys: "I" },
] as const;

function svgCursor(
  svg: string,
  x: number,
  y: number,
  fallback: string,
): string {
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${x} ${y}, ${fallback}`;
}

function outlinedCursorSvg(
  paths: string,
  foreground: string,
  outline: string,
): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round"><g stroke="${outline}" stroke-width="5">${paths}</g><g stroke="${foreground}" stroke-width="2.3">${paths}</g></svg>`;
}

function buildToolCursors(
  foreground: string,
  outline: string,
): Partial<Record<CanvasToolId, string>> {
  return {
    select: "default",
    hand: "grab",
    eraser: svgCursor(
      outlinedCursorSvg(
        '<path d="m7 21 10.5-10.5a3 3 0 0 0 0-4.2l-.8-.8a3 3 0 0 0-4.2 0L3 15l6 6Z"/><path d="m14 7 3 3"/><path d="M7 21h11"/>',
        foreground,
        outline,
      ),
      8,
      18,
      "auto",
    ),
    arrow: svgCursor(
      outlinedCursorSvg(
        '<path d="M5 19 19 5"/><path d="M8 5h11v11"/>',
        foreground,
        outline,
      ),
      17,
      5,
      "crosshair",
    ),
    draw: svgCursor(
      outlinedCursorSvg(
        '<path d="M15.2 5.3 18.7 8.8"/><path d="M4 20l4.4-1 10.2-10.2a2.5 2.5 0 0 0-3.5-3.5L4.9 15.5 4 20Z"/>',
        foreground,
        outline,
      ),
      4,
      20,
      "crosshair",
    ),
    pen: "crosshair",
    text: "text",
    geo: "crosshair",
  };
}

const LIGHT_TOOL_CURSORS = buildToolCursors("#171b2c", "#ffffff");
const DARK_TOOL_CURSORS = buildToolCursors("#f4f2ff", "#111625");

const LOCKED_CANVAS_TOOLS = new Set<CanvasToolId>([
  "eraser",
  "arrow",
  "draw",
  "pen",
  "text",
  "geo",
]);

const MIND_MAP_TEMPLATE_GROUPS: Array<{
  label: string;
  options: Array<{
    id: MindMapTemplateId;
    label: string;
    description: string;
    icon: "branch" | "fork" | "network" | "tree" | "timeline";
  }>;
}> = [
  {
    label: "思维导图",
    options: [
      { id: "mind-right", label: "向右展开", description: "中心主题位于左侧", icon: "branch" },
      { id: "mind-left", label: "向左展开", description: "中心主题位于右侧", icon: "branch" },
      { id: "mind-down", label: "向下展开", description: "适合演示和拆解", icon: "fork" },
      { id: "mind-both", label: "双向展开", description: "左右平衡组织", icon: "network" },
    ],
  },
  {
    label: "树状图",
    options: [
      { id: "tree-right", label: "右向树", description: "两级树状结构", icon: "tree" },
      { id: "tree-left", label: "左向树", description: "从右向左阅读", icon: "tree" },
      { id: "tree-down", label: "组织树", description: "自上而下分层", icon: "fork" },
    ],
  },
  {
    label: "时间线",
    options: [
      { id: "timeline-right", label: "横向时间线", description: "连续阶段向右推进", icon: "timeline" },
      { id: "timeline-down", label: "纵向时间线", description: "连续阶段向下推进", icon: "timeline" },
    ],
  },
];

function MindMapTemplateIcon({ type }: { type: "branch" | "fork" | "network" | "tree" | "timeline" }) {
  const Icon = type === "branch"
    ? GitBranch
    : type === "fork"
      ? GitFork
      : type === "network"
        ? Network
        : type === "tree"
          ? ListTree
          : Waypoints;
  return <Icon aria-hidden="true" size={26} strokeWidth={1.7} />;
}

function ShapeOptionIcon({ geo }: { geo: NativeGeoShape }) {
  const commonProps = {
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 2.2,
  };

  return (
    <svg
      aria-hidden="true"
      className="size-4 shrink-0"
      viewBox="0 0 24 24"
    >
      {geo === "rectangle" ? (
        <rect x="5" y="5" width="14" height="14" rx="3" {...commonProps} />
      ) : geo === "ellipse" ? (
        <circle cx="12" cy="12" r="7" {...commonProps} />
      ) : geo === "triangle" ? (
        <path d="M12 4.5 20 19H4L12 4.5Z" {...commonProps} />
      ) : geo === "diamond" ? (
        <path d="M12 3.5 20.5 12 12 20.5 3.5 12 12 3.5Z" {...commonProps} />
      ) : geo === "cloud" ? (
        <path d="M7.5 17.5h9a4 4 0 0 0 .6-7.95 5.5 5.5 0 0 0-10.55 1.6 3.2 3.2 0 0 0 .95 6.35Z" {...commonProps} />
      ) : (
        <path d="m12 3.5 2.3 5 5.4.6-4 3.7 1.1 5.3L12 15.4 7.2 18.1l1.1-5.3-4-3.7 5.4-.6L12 3.5Z" {...commonProps} />
      )}
    </svg>
  );
}

function rangesOverlap(
  startA: number,
  endA: number,
  startB: number,
  endB: number,
) {
  return Math.max(startA, startB) < Math.min(endA, endB);
}

function axisOverlapGroups(
  entries: MeasuredShape[],
  axis: "x" | "y",
): MeasuredShape[][] {
  const overlaps = (left: MeasuredShape, right: MeasuredShape) => (
    axis === "x"
      ? rangesOverlap(left.x, left.right, right.x, right.right)
      : rangesOverlap(left.y, left.bottom, right.y, right.bottom)
  );
  const groups: MeasuredShape[][] = [];
  for (const entry of entries) {
    const matched = groups
      .map((group, index) => group.some((item) => overlaps(item, entry)) ? index : -1)
      .filter((index) => index >= 0);
    if (!matched.length) {
      groups.push([entry]);
      continue;
    }
    const primary = groups[matched[0]!]!;
    primary.push(entry);
    for (let index = matched.length - 1; index >= 1; index -= 1) {
      primary.push(...groups.splice(matched[index]!, 1)[0]!);
    }
  }
  return groups;
}

function aggregateAlignmentUnits(entries: MeasuredShape[]): MeasuredShape {
  const x = Math.min(...entries.map((entry) => entry.x));
  const y = Math.min(...entries.map((entry) => entry.y));
  const right = Math.max(...entries.map((entry) => entry.right));
  const bottom = Math.max(...entries.map((entry) => entry.bottom));
  return {
    shape: entries[0]!.shape,
    members: entries.flatMap((entry) => entry.members),
    x,
    y,
    w: right - x,
    h: bottom - y,
    right,
    bottom,
    centerX: (x + right) / 2,
    centerY: (y + bottom) / 2,
  };
}

/**
 * Detect wrapped horizontal runs. Vertical alignment must move each run as one
 * unit; otherwise overlapping x ranges pair individual shapes from different
 * rows and destroy the row's internal stagger.
 */
function wrappedAlignmentRows(entries: MeasuredShape[]): MeasuredShape[] {
  const ordered = [...entries].sort(
    (a, b) => a.y - b.y || a.x - b.x || String(a.shape.id).localeCompare(String(b.shape.id)),
  );
  const rows: MeasuredShape[][] = [];
  for (const entry of ordered) {
    const row = rows.at(-1);
    const previous = row?.at(-1);
    const overlapsCurrentRun = row?.some((item) => rangesOverlap(item.y, item.bottom, entry.y, entry.bottom));
    if (!row || (previous && entry.centerX < previous.centerX && !overlapsCurrentRun)) rows.push([entry]);
    else row.push(entry);
  }
  return rows.map(aggregateAlignmentUnits);
}

function alignmentGroupId(shape: NativeShape): string | undefined {
  const value = shape.props.mokiGroupId;
  return shape.type !== "group-folder" && shape.props.mokiGroupCollapsed !== true &&
    typeof value === "string" && value
    ? value
    : undefined;
}

function alignmentShapes(
  editor: NativeWhiteboardEditor,
  selectedShapeIds: NativeShapeId[],
): NativeShape[] {
  const selected = selectedShapeIds
    .map((id) => editor.getShape(id))
    .filter((shape): shape is NativeShape => Boolean(shape));
  const selectedGroupIds = new Set(
    selected.map(alignmentGroupId).filter((id): id is string => Boolean(id)),
  );
  if (!selectedGroupIds.size) return selected;
  const byId = new Map(selected.map((shape) => [shape.id, shape]));
  for (const id of editor.getCurrentPageShapeIds()) {
    const shape = editor.getShape(id);
    const groupId = shape ? alignmentGroupId(shape) : undefined;
    if (shape && groupId && selectedGroupIds.has(groupId)) byId.set(shape.id, shape);
  }
  return [...byId.values()];
}

function measureAlignmentUnits(
  editor: NativeWhiteboardEditor,
  selectedShapeIds: NativeShapeId[],
): MeasuredShape[] {
  const measured = alignmentShapes(editor, selectedShapeIds)
    .map((shape) => ({ shape, bounds: editor.getShapePageBounds(shape.id) }))
    .filter((item): item is {
      shape: NativeShape;
      bounds: NonNullable<ReturnType<NativeWhiteboardEditor["getShapePageBounds"]>>;
    } => Boolean(item.bounds))
    .map(({ shape, bounds }) => {
      const x = boxValue(bounds, "x");
      const y = boxValue(bounds, "y");
      const w = boxValue(bounds, "w");
      const h = boxValue(bounds, "h");
      return { shape, x, y, w, h, right: x + w, bottom: y + h };
    });
  const grouped = new Map<string, typeof measured>();
  for (const entry of measured) {
    const key = alignmentGroupId(entry.shape) ?? `shape:${entry.shape.id}`;
    const members = grouped.get(key) ?? [];
    members.push(entry);
    grouped.set(key, members);
  }
  return [...grouped.values()].map((entries) => {
    const x = Math.min(...entries.map((entry) => entry.x));
    const y = Math.min(...entries.map((entry) => entry.y));
    const right = Math.max(...entries.map((entry) => entry.right));
    const bottom = Math.max(...entries.map((entry) => entry.bottom));
    return {
      shape: entries[0]!.shape,
      members: entries.map((entry) => entry.shape),
      x,
      y,
      w: right - x,
      h: bottom - y,
      right,
      bottom,
      centerX: (x + right) / 2,
      centerY: (y + bottom) / 2,
    };
  });
}

function clampValue(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function boxValue(box: unknown, key: "x" | "y" | "w" | "h"): number {
  if (!box || typeof box !== "object") return 0;
  const value = (box as Record<string, unknown>)[key];
  if (typeof value === "number") return value;
  if (key === "w") {
    const width = (box as Record<string, unknown>).width;
    return typeof width === "number" ? width : 0;
  }
  if (key === "h") {
    const height = (box as Record<string, unknown>).height;
    return typeof height === "number" ? height : 0;
  }
  return 0;
}

function boxCenter(box: unknown): NativeVecLike {
  if (
    box &&
    typeof box === "object" &&
    "center" in box &&
    typeof (box as { center?: unknown }).center === "object"
  ) {
    return (box as { center: NativeVecLike }).center;
  }
  return {
    x: boxValue(box, "x") + boxValue(box, "w") / 2,
    y: boxValue(box, "y") + boxValue(box, "h") / 2,
  };
}

function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : sorted[middle];
}

function getCanvasInsertMetrics(editor: NativeWhiteboardEditor) {
  const viewport = editor.getViewportPageBounds?.();
  const center = viewport
    ? boxCenter(viewport)
    : { x: 0, y: 0 };
  const currentPageShapeIds = Array.from(
    editor.getCurrentPageShapeIds?.() ?? [],
  );
  const shapeSizes = currentPageShapeIds
    .map((id) => editor.getShapePageBounds?.(id as NativeShapeId))
    .filter(Boolean)
    .map((box) =>
      Math.max(boxValue(box, "w"), boxValue(box, "h")),
    )
    .filter((size) => Number.isFinite(size) && size > 0);
  const viewportBase = viewport
    ? Math.min(boxValue(viewport, "w"), boxValue(viewport, "h")) *
      0.22
    : DEFAULT_CANVAS_INSERT_SIZE;
  const size = clampValue(
    median(shapeSizes) ?? viewportBase,
    MIN_CANVAS_INSERT_SIZE,
    MAX_CANVAS_INSERT_SIZE,
  );
  return {
    size,
    x: center.x - size / 2,
    y: center.y - size / 2,
  };
}

type MindMapInsertBounds = { x: number; y: number; w: number; h: number };

function mindMapTemplateBounds(
  shapes: ReturnType<typeof buildMindMapTemplate>["shapes"],
): MindMapInsertBounds {
  const nodes = shapes.filter((shape) => shape.props?.mokiMindMapNode === true);
  const left = Math.min(...nodes.map((shape) => Number(shape.x ?? 0)));
  const top = Math.min(...nodes.map((shape) => Number(shape.y ?? 0)));
  const right = Math.max(...nodes.map((shape) => Number(shape.x ?? 0) + Number(shape.props?.w ?? 0)));
  const bottom = Math.max(...nodes.map((shape) => Number(shape.y ?? 0) + Number(shape.props?.h ?? 0)));
  return { x: left, y: top, w: right - left, h: bottom - top };
}

function boundsOverlapWithGap(
  candidate: MindMapInsertBounds,
  existing: MindMapInsertBounds,
  gap = 72,
): boolean {
  return candidate.x - gap < existing.x + existing.w
    && candidate.x + candidate.w + gap > existing.x
    && candidate.y - gap < existing.y + existing.h
    && candidate.y + candidate.h + gap > existing.y;
}

function findMindMapInsertCenter(
  editor: NativeWhiteboardEditor,
  preferredCenter: NativeVecLike,
  templateBounds: MindMapInsertBounds,
): NativeVecLike {
  const existingBounds = [...editor.getCurrentPageShapeIds()]
    .map((id) => editor.getShapePageBounds(id as NativeShapeId))
    .filter((bounds): bounds is NonNullable<typeof bounds> => Boolean(bounds))
    .map((bounds) => ({
      x: boxValue(bounds, "x"),
      y: boxValue(bounds, "y"),
      w: boxValue(bounds, "w"),
      h: boxValue(bounds, "h"),
    }));
  if (existingBounds.length === 0) return preferredCenter;

  const stepX = templateBounds.w + 96;
  const stepY = templateBounds.h + 96;
  const offsets: Array<[number, number]> = [[0, 0]];
  for (let ring = 1; ring <= 8; ring += 1) {
    offsets.push([ring, 0], [-ring, 0], [0, ring], [0, -ring]);
    for (let axis = 1; axis <= ring; axis += 1) {
      offsets.push(
        [ring, axis], [ring, -axis], [-ring, axis], [-ring, -axis],
        [axis, ring], [-axis, ring], [axis, -ring], [-axis, -ring],
      );
    }
  }
  for (const [column, row] of offsets) {
    const center = {
      x: preferredCenter.x + column * stepX,
      y: preferredCenter.y + row * stepY,
    };
    const candidate = {
      x: templateBounds.x + column * stepX,
      y: templateBounds.y + row * stepY,
      w: templateBounds.w,
      h: templateBounds.h,
    };
    if (existingBounds.every((bounds) => !boundsOverlapWithGap(candidate, bounds))) return center;
  }

  const farRight = Math.max(...existingBounds.map((bounds) => bounds.x + bounds.w));
  return {
    x: preferredCenter.x + farRight + 96 - templateBounds.x,
    y: preferredCenter.y,
  };
}

function sizeStyle(size: number) {
  if (size >= 420) return "xl";
  if (size >= 260) return "l";
  return "m";
}

function noteScale(size: number) {
  return clampValue(size / DEFAULT_CANVAS_INSERT_SIZE, 0.75, 3);
}

function savedLabel(
  state: SaveState,
  version?: number,
  createdAt?: string,
): string {
  if (state === "pending") return "有未保存更改";
  if (state === "saving") return "正在保存到本机";
  if (state === "error") return "保存失败";
  if (state === "saved" && version) {
    const time = createdAt
      ? new Intl.DateTimeFormat("zh-CN", {
          timeZone: "Asia/Shanghai",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
        }).format(new Date(createdAt))
      : "";
    return `已保存 · 版本 ${version}${time ? ` · ${time}` : ""}`;
  }
  return "仅保存在本机";
}

function latestForWhiteboardPage(
  current: WhiteboardLatest | undefined,
  page: WhiteboardPageInfo | undefined,
  version: WhiteboardVersionSummary | WhiteboardLatest | undefined,
): WhiteboardLatest | undefined {
  if (!page) return current;
  return {
    version: version?.version ?? null,
    pageId: page.pageId,
    pageName: page.pageName,
    snapshot: current?.snapshot ?? null,
    ...(version?.pageVersion !== undefined
      ? { pageVersion: version.pageVersion }
      : {}),
    ...(version?.contentDigest !== undefined
      ? { contentDigest: version.contentDigest }
      : {}),
    ...(version?.createdAt !== undefined
      ? { createdAt: version.createdAt }
      : {}),
    ...(current?.recoveredFromVersion &&
    (!current.pageId || current.pageId === page.pageId)
      ? { recoveredFromVersion: current.recoveredFromVersion }
      : {}),
  };
}

function isSnapshotRecord(
  value: unknown,
): value is Record<string, unknown> & {
  id: string;
  typeName: string;
} {
  return Boolean(value) && typeof value === "object" &&
    typeof (value as { id?: unknown }).id === "string" &&
    typeof (value as { typeName?: unknown }).typeName === "string";
}

function snapshotPageInfo(
  snapshot: WhiteboardSnapshot | null | undefined,
  preferredPageId?: string,
): WhiteboardPageInfo | undefined {
  if (!snapshot) return undefined;
  const records = Object.values(snapshot.document.store).filter(
    isSnapshotRecord,
  );
  const sessionPageId =
    snapshot.session && typeof snapshot.session === "object" &&
    "currentPageId" in snapshot.session &&
    typeof snapshot.session.currentPageId === "string"
      ? snapshot.session.currentPageId
      : undefined;
  const exactPage = records.find(
    (record) =>
      record.typeName === "page" &&
      record.id === (preferredPageId ?? sessionPageId),
  );
  const sessionPage = records.find(
    (record) => record.typeName === "page" && record.id === sessionPageId,
  );
  const page = preferredPageId
    ? exactPage
    : exactPage ?? sessionPage ?? records.find(
        (record) => record.typeName === "page",
      );
  if (!page) return undefined;
  return {
    pageId: page.id,
    pageName:
      typeof page.name === "string" && page.name.trim()
        ? page.name.trim()
        : "未命名页面",
  };
}

function pageRecordIds(
  store: Record<string, unknown>,
  pageId: string,
): Set<string> {
  const records = Object.values(store).filter(isSnapshotRecord);
  const ids = new Set([pageId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const record of records) {
      if (
        typeof record.parentId === "string" &&
        ids.has(record.parentId) &&
        !ids.has(record.id)
      ) {
        ids.add(record.id);
        changed = true;
      }
    }
  }
  for (const record of records) {
    if (record.typeName !== "binding") continue;
    const fromId = typeof record.fromId === "string" ? record.fromId : "";
    const toId = typeof record.toId === "string" ? record.toId : "";
    if (ids.has(fromId) || ids.has(toId)) ids.add(record.id);
  }
  return ids;
}

function whiteboardPageTopology(snapshot: WhiteboardSnapshot): string {
  return JSON.stringify(
    Object.values(snapshot.document.store)
      .filter((record) => record.typeName === "page")
      .map((record) => ({
        id: record.id,
        name: typeof record.name === "string" ? record.name : "",
        index: typeof record.index === "string" ? record.index : "",
        groupId: record.meta && typeof record.meta === "object" &&
            "mokiPageGroupId" in record.meta && typeof record.meta.mokiPageGroupId === "string"
          ? record.meta.mokiPageGroupId
          : "",
        groupName: record.meta && typeof record.meta === "object" &&
            "mokiPageGroupName" in record.meta && typeof record.meta.mokiPageGroupName === "string"
          ? record.meta.mokiPageGroupName
          : "",
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  );
}

export function extractWhiteboardPageSnapshot(
  snapshot: NativeEditorSnapshot,
  pageId: string,
): NativeEditorSnapshot {
  const value = snapshot as unknown as WhiteboardSnapshot;
  const ids = pageRecordIds(value.document.store, pageId);
  const store: WhiteboardSnapshot["document"]["store"] = {};
  for (const id of ids) {
    const record = value.document.store[id];
    if (!record) continue;
    store[id] = record;
    if (
      record.props &&
      typeof record.props === "object" &&
      "assetId" in record.props &&
      typeof record.props.assetId === "string"
    ) {
      const asset = value.document.store[record.props.assetId];
      if (asset) store[record.props.assetId] = asset;
    }
  }
  const session = value.session && typeof value.session === "object"
    ? {
        ...value.session,
        currentPageId: pageId,
        ...(Array.isArray(
          (value.session as { pageStates?: unknown }).pageStates,
        )
          ? {
              pageStates: (
                value.session as { pageStates: unknown[] }
              ).pageStates.filter(
                (state) =>
                  state !== null &&
                  typeof state === "object" &&
                  "pageId" in state &&
                  state.pageId === pageId,
              ),
            }
          : {}),
      }
    : { currentPageId: pageId };
  return {
    ...value,
    document: {
      ...value.document,
      store,
    },
    session,
  } as unknown as NativeEditorSnapshot;
}

export function rebaseWhiteboardPageSnapshot(
  snapshot: NativeEditorSnapshot,
  sourcePageId: string,
  targetPageId: string,
): NativeEditorSnapshot {
  if (sourcePageId === targetPageId) return snapshot;
  const value = structuredClone(snapshot as unknown as WhiteboardSnapshot);
  const sourcePage = value.document.store[sourcePageId];
  if (!sourcePage || sourcePage.typeName !== "page") return snapshot;
  delete value.document.store[sourcePageId];
  value.document.store[targetPageId] = { ...sourcePage, id: targetPageId };
  for (const [id, record] of Object.entries(value.document.store)) {
    if (id === targetPageId) continue;
    if (record && typeof record === "object" && "parentId" in record && record.parentId === sourcePageId) {
      value.document.store[id] = { ...record, parentId: targetPageId };
    }
  }
  if (value.session && typeof value.session === "object") {
    const session = value.session as Record<string, unknown>;
    value.session = { ...session, currentPageId: targetPageId };
    const pageStates = (value.session as { pageStates?: unknown }).pageStates;
    if (Array.isArray(pageStates)) {
      value.session = {
        ...session,
        pageStates: pageStates.map((state) => state && typeof state === "object" && "pageId" in state && state.pageId === sourcePageId
          ? { ...state, pageId: targetPageId }
          : state),
      };
    }
  }
  return value as unknown as NativeEditorSnapshot;
}

export function restoreWhiteboardPageSnapshot(
  current: NativeEditorSnapshot,
  historical: NativeEditorSnapshot,
  pageId: string,
): NativeEditorSnapshot {
  const currentValue = current as unknown as WhiteboardSnapshot;
  const historicalValue = historical as unknown as WhiteboardSnapshot;
  const currentStore = { ...currentValue.document.store };
  const currentPageRecord = currentStore[pageId];
  const historicalStore = historicalValue.document.store;
  const currentIds = pageRecordIds(currentStore, pageId);
  const historicalIds = pageRecordIds(historicalStore, pageId);
  for (const id of currentIds) delete currentStore[id];
  for (const id of historicalIds) {
    const record = historicalStore[id];
    if (record) currentStore[id] = record;
  }
  if (currentPageRecord?.typeName === "page") {
    currentStore[pageId] = currentPageRecord;
  }
  for (const id of historicalIds) {
    const record = historicalStore[id];
    if (!isSnapshotRecord(record) || !record.props ||
        typeof record.props !== "object" ||
        !("assetId" in record.props) ||
        typeof record.props.assetId !== "string") {
      continue;
    }
    const asset = historicalStore[record.props.assetId];
    if (asset) currentStore[record.props.assetId] = asset;
  }
  return {
    ...currentValue,
    document: {
      ...currentValue.document,
      store: currentStore,
    },
  } as unknown as NativeEditorSnapshot;
}

export function mergeWhiteboardPageAsNew(
  current: NativeEditorSnapshot,
  imported: NativeEditorSnapshot,
  sourcePageId: string,
  targetPageId: string,
  targetPageName: string,
  createId: (typeName: string) => string = (typeName) =>
    `${typeName}:${crypto.randomUUID()}`,
): NativeEditorSnapshot {
  const currentValue = structuredClone(current as unknown as WhiteboardSnapshot);
  const importedValue = imported as unknown as WhiteboardSnapshot;
  const importedIds = pageRecordIds(importedValue.document.store, sourcePageId);
  for (const id of [...importedIds]) {
    const record = importedValue.document.store[id];
    const assetId = record?.props && typeof record.props === "object" &&
        "assetId" in record.props && typeof record.props.assetId === "string"
      ? record.props.assetId
      : undefined;
    if (assetId && importedValue.document.store[assetId]) importedIds.add(assetId);
  }
  const idMap = new Map<string, string>([[sourcePageId, targetPageId]]);
  for (const id of importedIds) {
    if (id === sourcePageId) continue;
    const record = importedValue.document.store[id];
    if (record) idMap.set(id, createId(record.typeName));
  }
  const targetPage = currentValue.document.store[targetPageId];
  if (!targetPage || targetPage.typeName !== "page") {
    throw new Error("新白板页面创建失败。");
  }
  currentValue.document.store[targetPageId] = {
    ...targetPage,
    name: targetPageName,
  };
  for (const id of importedIds) {
    if (id === sourcePageId) continue;
    const record = importedValue.document.store[id];
    const nextId = idMap.get(id);
    if (!record || !nextId) continue;
    const next = structuredClone(record) as Record<string, unknown>;
    next.id = nextId;
    if (typeof next.parentId === "string" && idMap.has(next.parentId)) {
      next.parentId = idMap.get(next.parentId);
    }
    if (typeof next.fromId === "string" && idMap.has(next.fromId)) {
      next.fromId = idMap.get(next.fromId);
    }
    if (typeof next.toId === "string" && idMap.has(next.toId)) {
      next.toId = idMap.get(next.toId);
    }
    if (next.props && typeof next.props === "object" &&
        "assetId" in next.props && typeof next.props.assetId === "string" &&
        idMap.has(next.props.assetId)) {
      next.props = {
        ...next.props,
        assetId: idMap.get(next.props.assetId),
      };
    }
    currentValue.document.store[nextId] = next as WhiteboardSnapshot["document"]["store"][string];
  }
  currentValue.session = {
    ...(currentValue.session && typeof currentValue.session === "object"
      ? currentValue.session
      : {}),
    currentPageId: targetPageId,
  };
  return currentValue as unknown as NativeEditorSnapshot;
}

const ASSISTANT_WHITEBOARD_REFRESH_ATTEMPTS = 6;
const ASSISTANT_WHITEBOARD_REFRESH_DELAY_MS = 250;

function activateWhiteboardPage(
  snapshot: WhiteboardSnapshot,
  pageId?: string,
): WhiteboardSnapshot {
  if (!pageId || !snapshot.document.store[pageId]) return snapshot;
  return {
    ...snapshot,
    session: {
      ...(snapshot.session ?? {}),
      currentPageId: pageId,
    },
  };
}

function copyReferencedAsset(
  target: WhiteboardSnapshot["document"]["store"],
  source: WhiteboardSnapshot["document"]["store"],
  record: WhiteboardSnapshot["document"]["store"][string],
): void {
  if (
    !record?.props ||
    typeof record.props !== "object" ||
    !("assetId" in record.props) ||
    typeof record.props.assetId !== "string"
  ) {
    return;
  }
  const asset = source[record.props.assetId];
  if (asset) target[record.props.assetId] = asset;
}

function snapshotImageSources(
  snapshot: WhiteboardSnapshot,
  shapeIds: string[] = [],
): string[] {
  if (!shapeIds.length) return [];
  const store = snapshot.document.store;
  const sources = shapeIds.flatMap((shapeId) => {
    const shape = store[shapeId];
    if (
      !isSnapshotRecord(shape) ||
      shape.typeName !== "shape" ||
      shape.type !== "image" ||
      !shape.props ||
      typeof shape.props !== "object" ||
      !("assetId" in shape.props) ||
      typeof shape.props.assetId !== "string"
    ) {
      return [];
    }
    const asset = store[shape.props.assetId];
    if (
      !isSnapshotRecord(asset) ||
      !asset.props ||
      typeof asset.props !== "object" ||
      !("src" in asset.props) ||
      typeof asset.props.src !== "string"
    ) {
      return [];
    }
    return [asset.props.src];
  });
  return [...new Set(sources)];
}

function mergeAssistantWhiteboardUpdate(
  current: WhiteboardSnapshot,
  remote: WhiteboardSnapshot,
  detail?: WorkbenchDataUpdatedDetail,
): WhiteboardSnapshot {
  const merged = structuredClone(current);
  const target = merged.document.store;
  const source = remote.document.store;
  const pageId = detail?.pageId;

  if (pageId && source[pageId]) {
    const pageWasMissing = !target[pageId];
    target[pageId] = source[pageId]!;
    if (pageWasMissing) {
      for (const id of pageRecordIds(source, pageId)) {
        const record = source[id];
        if (!record) continue;
        target[id] = record;
        copyReferencedAsset(target, source, record);
      }
    }
  }

  for (const shapeId of detail?.changedShapeIds ?? []) {
    const record = source[shapeId];
    if (!record) {
      delete target[shapeId];
      continue;
    }
    target[shapeId] = record;
    copyReferencedAsset(target, source, record);
  }

  return activateWhiteboardPage(merged, pageId);
}

async function getAssistantWhiteboardUpdate(
  detail?: WorkbenchDataUpdatedDetail,
): Promise<WhiteboardLatest> {
  let value = await getWhiteboard();
  const expectedVersion = detail?.version;
  for (
    let attempt = 1;
    expectedVersion &&
      (value.version ?? 0) < expectedVersion &&
      attempt < ASSISTANT_WHITEBOARD_REFRESH_ATTEMPTS;
    attempt += 1
  ) {
    await new Promise<void>((resolve) => {
      globalThis.setTimeout(
        resolve,
        ASSISTANT_WHITEBOARD_REFRESH_DELAY_MS * attempt,
      );
    });
    value = await getWhiteboard();
  }
  if (expectedVersion && (value.version ?? 0) < expectedVersion) {
    throw new Error(
      `AI 白板版本 ${expectedVersion} 已保存，但前端暂未读取到该版本。`,
    );
  }
  return value;
}

export function WhiteboardPage({ embedded = false, active = true, initialPageId, onActivePageChange, onCheckpointReady }: {
  embedded?: boolean;
  active?: boolean;
  initialPageId?: string | undefined;
  onActivePageChange?: ((page: WhiteboardPageInfo) => void) | undefined;
  onCheckpointReady?: (checkpoint: (() => Promise<void>) | undefined) => void;
} = {}) {
  const embeddedRootRef = useRef<HTMLDivElement>(null);
  const store = useMemo(() => createNativeWhiteboardStore(), []);
  const [latest, setLatest] = useState<WhiteboardLatest>();
  const [versions, setVersions] = useState<
    WhiteboardVersionSummary[]
  >([]);
  const [activePage, setActivePage] = useState<WhiteboardPageInfo>();
  const [ready, setReady] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [transferMenuOpen, setTransferMenuOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [exportPadding, setExportPadding] = useState(48);
  const [exporting, setExporting] = useState(false);
  const [transferring, setTransferring] = useState<"export" | "import">();
  const [activeTool, setActiveTool] =
    useState<CanvasToolId>("select");
  const [shapeMenuOpen, setShapeMenuOpen] = useState(false);
  const [drawMenuOpen, setDrawMenuOpen] = useState(false);
  const [alignmentToolsOpen, setAlignmentToolsOpen] = useState(false);
  const [arrowMenuOpen, setArrowMenuOpen] = useState(false);
  const [mindMapMenuOpen, setMindMapMenuOpen] = useState(false);
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const linkUrlRef = useRef("");
  const [linkTitle, setLinkTitle] = useState("");
  const [linkMode, setLinkMode] = useState<NativeWhiteboardLinkMode>("link");
  const [linkError, setLinkError] = useState("");
  const [libraryItems, setLibraryItems] = useState<ResourceLibraryItem[]>([]);
  const [fileInsertMenuOpen, setFileInsertMenuOpen] = useState(false);
  const [pendingFolderExport, setPendingFolderExport] = useState<NativeWhiteboardFolderExportRequest>();
  const [folderExportTargetId, setFolderExportTargetId] = useState("");
  const [folderExportBusy, setFolderExportBusy] = useState(false);
  const [folderExportNotice, setFolderExportNotice] = useState("");
  const [materialPanelOpen, setMaterialPanelOpen] = useState(false);
  const [materialQuery, setMaterialQuery] = useState("");
  const [previewMaterial, setPreviewMaterial] = useState<WhiteboardMaterial>();
  const [renamingMaterialId, setRenamingMaterialId] = useState<string>();
  const [materialRenameValue, setMaterialRenameValue] = useState("");
  const [canvasRevision, setCanvasRevision] = useState(0);
  const [selectedColor] = useState<NativeCanvasColor>("black");
  const [geoPaintStyle, setGeoPaintStyle] = useState<NativeGeoPaintStyle>({
    strokeEnabled: true,
    strokeColor: "black",
    strokeOpacity: 1,
    fillEnabled: true,
    fillColor: "light-violet",
    fillOpacity: 0.28,
  });
  const [textStyle] = useState<NativeTextStyle>({
    size: "m",
    bold: false,
    italic: false,
    underline: false,
    textAlign: "start",
  });
  const [drawSize, setDrawSize] = useState<NativeStrokeSize>("m");
  const [drawColor, setDrawColor] = useState<NativeCanvasColor>("black");
  const [arrowStyle, setArrowStyle] = useState<NativeArrowStyle>("single");
  const [isCanvasFullscreen, setIsCanvasFullscreen] = useState(false);
  const [selectedGeo, setSelectedGeo] =
    useState<NativeGeoShape>("rectangle");
  const dirtyRef = useRef(false);
  const dirtyPageRevisionsRef = useRef(new Map<string, number>());
  const pageTopologyDirtyRef = useRef(false);
  const pageTopologyRevisionRef = useRef(0);
  const persistedPageTopologyRef = useRef("");
  const observedPageTopologyRef = useRef("");
  const activePageRef = useRef<WhiteboardPageInfo | undefined>(undefined);
  const initialPageIdRef = useRef(initialPageId);
  const onActivePageChangeRef = useRef(onActivePageChange);
  onActivePageChangeRef.current = onActivePageChange;
  const applyingRemoteSnapshotRef = useRef(false);
  const remoteLoadGenerationRef = useRef(0);
  const pageMetadataLoadGenerationRef = useRef(0);
  const refreshedAssistantActionIdsRef = useRef(new Set<string>());
  const handledAssistantMediaRequestsRef = useRef(new Set<string>());
  const editorRef = useRef<NativeWhiteboardEditor | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const whiteboardInputRef = useRef<HTMLInputElement | null>(null);
  const timerRef = useRef<
    ReturnType<typeof setTimeout> | undefined
  >(undefined);
  const saveInFlightRef = useRef(false);
  const saveAgainAfterFlightRef = useRef(false);
  const mountedRef = useRef(true);

  const currentMaterials = useMemo<WhiteboardMaterial[]>(() => {
    void canvasRevision;
    const pageId = activePage?.pageId;
    if (!pageId) return [];
    const snapshot = (store as unknown as { snapshot?: WhiteboardSnapshot }).snapshot;
    if (!snapshot?.document?.store) return [];
    const libraryById = new Map(libraryItems.map((item) => [item.id, item]));
    return Object.values(snapshot.document.store)
      .filter((record): record is NativeShape => isNativeShape(record) && record.parentId === pageId)
      .flatMap((shape): WhiteboardMaterial[] => {
        if (shape.type === "link") {
          const url = typeof shape.props.url === "string" ? shape.props.url : "";
          return [{ shapeId: shape.id, name: String(shape.props.title ?? url ?? "网页链接"), kind: "link" as const, previewUrl: url, openUrl: url }];
        }
        if (shape.type === "resource") {
            const libraryItemId = typeof shape.props.libraryItemId === "string" ? shape.props.libraryItemId : "";
            const item = libraryById.get(libraryItemId);
            const previewUrl = item ? resourceLibraryPreviewUrl(item) : undefined;
            const whiteboardName = typeof shape.props.name === "string" && shape.props.name.trim()
              ? shape.props.name
              : undefined;
            return [{
              shapeId: shape.id,
              name: whiteboardName ?? item?.name ?? "资料",
              kind: "resource" as const,
              libraryItemId,
              ...(typeof shape.props.localPath === "string" ? { localPath: shape.props.localPath } : {}),
              ...(previewUrl ? { previewUrl } : {}),
            }];
        }
        if (shape.type === "image") {
          const assetId = typeof shape.props.assetId === "string" ? shape.props.assetId : "";
          const asset = snapshot.document.store[assetId];
          const props = asset?.props && typeof asset.props === "object" ? asset.props as Record<string, unknown> : {};
          const src = typeof props.src === "string" ? props.src : "";
          return [{ shapeId: shape.id, name: String(shape.props.altText ?? props.name ?? "画布图片"), kind: "image" as const, previewUrl: src, openUrl: src }];
        }
        if (shape.type === "media") {
          const assetId = typeof shape.props.assetId === "string" ? shape.props.assetId : "";
          const asset = snapshot.document.store[assetId];
          const props = asset?.props && typeof asset.props === "object" ? asset.props as Record<string, unknown> : {};
          const src = typeof props.src === "string" ? props.src : "";
          const mediaKind = shape.props.mediaKind === "audio" ? "audio" : "video";
          return [{
            shapeId: shape.id,
            name: String(shape.props.name ?? props.name ?? (mediaKind === "video" ? "视频" : "音频")),
            kind: "media" as const,
            mediaKind,
            previewUrl: src,
            ...(typeof shape.props.localPath === "string" ? { localPath: shape.props.localPath } : {}),
          }];
        }
        return [];
      });
  }, [activePage?.pageId, canvasRevision, libraryItems, store]);
  const filteredMaterials = useMemo(() => {
    const query = materialQuery.trim().toLocaleLowerCase("zh-CN");
    if (!query) return currentMaterials;
    return currentMaterials.filter((material) => {
      const typeLabel = material.kind === "image"
        ? "图片"
        : material.kind === "link"
          ? "链接 网页"
          : material.kind === "media"
            ? material.mediaKind === "audio" ? "媒体 音频" : "媒体 视频"
            : "资料 文件";
      return [material.name, material.localPath, material.openUrl, typeLabel]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLocaleLowerCase("zh-CN").includes(query));
    });
  }, [currentMaterials, materialQuery]);
  const beginMaterialRename = useCallback((material: WhiteboardMaterial) => {
    setRenamingMaterialId(material.shapeId);
    setMaterialRenameValue(material.name);
  }, []);
  const cancelMaterialRename = useCallback(() => {
    setRenamingMaterialId(undefined);
    setMaterialRenameValue("");
  }, []);
  const commitMaterialRename = useCallback((material: WhiteboardMaterial) => {
    const nextName = materialRenameValue.trim();
    if (!nextName) {
      setError("内容名称不能为空");
      cancelMaterialRename();
      return;
    }
    const editor = editorRef.current;
    if (!editor?.renameMaterial(material.shapeId, nextName)) {
      setError("内容重命名失败，请稍后重试");
      cancelMaterialRename();
      return;
    }
    setPreviewMaterial((current) => current?.shapeId === material.shapeId
      ? { ...current, name: nextName }
      : current);
    setError("");
    cancelMaterialRename();
  }, [cancelMaterialRename, materialRenameValue]);
  const refreshLibrary = useCallback(async () => {
    const value = await getResourceLibraryItems();
    setLibraryItems(value);
    return value;
  }, []);

  useEffect(() => {
    void refreshLibrary().catch(() => undefined);
  }, [refreshLibrary]);

  useEffect(() => {
    if (!previewMaterial) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setPreviewMaterial(undefined);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [previewMaterial]);

  useEffect(() => {
    if (activePage) onActivePageChangeRef.current?.(activePage);
  }, [activePage]);

  useEffect(() => {
    mountedRef.current = true;
    const loadGeneration = ++remoteLoadGenerationRef.current;
    void getWhiteboard()
      .then(async (value) => {
        if (
          !mountedRef.current ||
          loadGeneration !== remoteLoadGenerationRef.current
        ) {
          return;
        }
        const requestedUrlPageId = new URLSearchParams(window.location.search).get("pageId") ?? undefined;
        const requestedPageId = initialPageIdRef.current ?? requestedUrlPageId;
        const requestedSnapshot = value.snapshot
          ? activateWhiteboardPage(value.snapshot, requestedPageId)
          : null;
        if (requestedSnapshot) {
          loadNativeSnapshot(
            store,
            requestedSnapshot as unknown as NativeEditorSnapshot,
          );
        }
        const loadedSnapshot = (
          requestedSnapshot ?? getNativeSnapshot(store)
        ) as unknown as WhiteboardSnapshot;
        const topology = whiteboardPageTopology(loadedSnapshot);
        persistedPageTopologyRef.current = topology;
        observedPageTopologyRef.current = topology;
        pageTopologyDirtyRef.current = false;
        const page = snapshotPageInfo(loadedSnapshot);
        activePageRef.current = page;
        setActivePage(page);
        const versionList = page
          ? await getWhiteboardVersions(page.pageId)
          : [];
        const loadedLatest = requestedSnapshot
          ? { ...value, snapshot: requestedSnapshot }
          : value;
        const loadedPageVersion = versionList[0] ?? (
          loadedLatest.version &&
          (!loadedLatest.pageId || loadedLatest.pageId === page?.pageId)
            ? loadedLatest
            : undefined
        );
        setLatest(latestForWhiteboardPage(loadedLatest, page, loadedPageVersion));
        setVersions(versionList);
        setSaveState(loadedPageVersion ? "saved" : "idle");
        setReady(true);
        if (requestedUrlPageId) {
          const url = new URL(window.location.href);
          url.searchParams.delete("pageId");
          window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
        }
      })
      .catch((reason) => {
        if (loadGeneration !== remoteLoadGenerationRef.current) return;
        setError(
          reason instanceof Error
            ? reason.message
            : "白板加载失败",
        );
        setReady(true);
      });
    return () => {
      mountedRef.current = false;
    };
  }, [store]);

  const persist = useCallback(
    async (keepalive = false) => {
      if (saveInFlightRef.current) {
        dirtyRef.current = true;
        saveAgainAfterFlightRef.current = true;
        if (!keepalive && mountedRef.current) {
          setSaveState("pending");
        }
        return;
      }
      saveInFlightRef.current = true;
      saveAgainAfterFlightRef.current = false;
      if (!keepalive && mountedRef.current) {
        setSaveState("saving");
        setError("");
      }
      try {
        let snapshot: NativeEditorSnapshot;
        try {
          snapshot = getNativeSnapshot(editorRef.current?.store ?? store);
        } catch (reason) {
          dirtyRef.current = true;
          throw reason;
        }
        const snapshotValue = snapshot as unknown as WhiteboardSnapshot;
        const topology = whiteboardPageTopology(snapshotValue);
        if (topology !== observedPageTopologyRef.current) {
          observedPageTopologyRef.current = topology;
          pageTopologyRevisionRef.current += 1;
        }
        pageTopologyDirtyRef.current = topology !==
          persistedPageTopologyRef.current;
        const topologyRevision = pageTopologyRevisionRef.current;
        const requestedPages = dirtyPageRevisionsRef.current.size > 0
          ? [...dirtyPageRevisionsRef.current.entries()]
          : [[
              activePageRef.current?.pageId ??
                snapshotPageInfo(snapshotValue)?.pageId ??
                "legacy:board",
              0,
            ] as const];
        let activeResult: Awaited<ReturnType<typeof saveWhiteboard>> | undefined;
        if (pageTopologyDirtyRef.current) {
          activeResult = await syncWhiteboardPages(snapshot, keepalive);
          for (const [pageId, revision] of requestedPages) {
            if (dirtyPageRevisionsRef.current.get(pageId) === revision) {
              dirtyPageRevisionsRef.current.delete(pageId);
            }
          }
          persistedPageTopologyRef.current = topology;
          if (pageTopologyRevisionRef.current === topologyRevision) {
            observedPageTopologyRef.current = topology;
            pageTopologyDirtyRef.current = false;
          }
        } else {
          for (const [pageId, revision] of requestedPages) {
            const page = snapshotPageInfo(snapshotValue, pageId) ?? {
              pageId,
              pageName: activePageRef.current?.pageName ?? "白板",
            };
            const result = await saveWhiteboard(
              extractWhiteboardPageSnapshot(snapshot, pageId),
              keepalive,
              page,
            );
            if (dirtyPageRevisionsRef.current.get(pageId) === revision) {
              dirtyPageRevisionsRef.current.delete(pageId);
            }
            if (activePageRef.current?.pageId === pageId) {
              activeResult = result;
            }
          }
        }
        dirtyRef.current = pageTopologyDirtyRef.current ||
          dirtyPageRevisionsRef.current.size > 0;
        if (mountedRef.current) {
          if (activeResult) {
            setLatest((current) => ({
              ...activeResult,
              snapshot:
                snapshot as unknown as NonNullable<
                  WhiteboardLatest["snapshot"]
                >,
              ...(current?.recoveredFromVersion
                ? {
                    recoveredFromVersion:
                      current.recoveredFromVersion,
                  }
                : {}),
            }));
          }
          const pageId = activePageRef.current?.pageId;
          setVersions(
            pageId ? await getWhiteboardVersions(pageId) : [],
          );
          setSaveState(dirtyRef.current ? "pending" : "saved");
        }
      } catch (reason) {
        dirtyRef.current = true;
        if (mountedRef.current) {
          setSaveState("error");
          setError(
            reason instanceof Error
              ? reason.message
              : "本地保存失败",
          );
        }
      } finally {
        saveInFlightRef.current = false;
        if (
          saveAgainAfterFlightRef.current &&
          dirtyRef.current &&
          mountedRef.current &&
          !keepalive
        ) {
          saveAgainAfterFlightRef.current = false;
          if (!timerRef.current) {
            timerRef.current = setTimeout(() => {
              timerRef.current = undefined;
              void persist();
            }, 800);
          }
        }
      }
    },
    [store],
  );

  useEffect(() => {
    onCheckpointReady?.(async () => {
      const deadline = Date.now() + 30_000;
      while (saveInFlightRef.current && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      if (saveInFlightRef.current) throw new Error("白板仍在保存，请稍后重试");
      if (!dirtyRef.current) return;
      await persist();
      if (dirtyRef.current) throw new Error("白板尚未保存，请重试后再关闭");
    });
    return () => onCheckpointReady?.(undefined);
  }, [onCheckpointReady, persist]);

  const queuePersist = useCallback((requestedPageId?: string) => {
    const pageId = requestedPageId ??
      editorRef.current?.getCurrentPageId() ??
      activePageRef.current?.pageId ??
      "legacy:board";
    dirtyPageRevisionsRef.current.set(
      pageId,
      (dirtyPageRevisionsRef.current.get(pageId) ?? 0) + 1,
    );
    dirtyRef.current = true;
    setSaveState("pending");
    if (saveInFlightRef.current) {
      saveAgainAfterFlightRef.current = true;
      return;
    }
    if (!timerRef.current) {
      timerRef.current = setTimeout(() => {
        timerRef.current = undefined;
        void persist();
      }, 2_000);
    }
  }, [persist]);

  const exportSnapshotImage = useCallback(async (
    snapshot: WhiteboardSnapshot,
    options: NativeWhiteboardImageExportOptions,
  ) => {
    setExporting(true);
    setError("");
    try {
      const result = await exportNativeWhiteboardImage(snapshot, options);
      downloadNativeWhiteboardImage(result);
      setExportMenuOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "白板图片导出失败。");
    } finally {
      setExporting(false);
    }
  }, []);

  const exportPortableWhiteboard = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor) return;
    setTransferring("export");
    setError("");
    try {
      const currentSnapshot = getNativeSnapshot(editor.store);
      const currentPageId = activePageRef.current?.pageId ?? snapshotPageInfo(currentSnapshot)?.pageId ?? "legacy:board";
      const pageSnapshot = extractWhiteboardPageSnapshot(currentSnapshot, currentPageId) as WhiteboardSnapshot;
      const result = await createWhiteboardTransferFile(
        pageSnapshot,
        {
          ...(activePageRef.current?.pageId ? { pageId: activePageRef.current.pageId } : {}),
          ...(activePageRef.current?.pageName ? { pageName: activePageRef.current.pageName } : {}),
          fileName: `MOKI-白板-${activePageRef.current?.pageName ?? "当前页面"}-${new Date().toISOString().slice(0, 10)}`,
          resources: portableWhiteboardResources(pageSnapshot, currentPageId, libraryItems),
          ...(window.mokiDesktop?.whiteboardFiles?.readResource
            ? { readResource: (input) => window.mokiDesktop!.whiteboardFiles!.readResource!(input) }
            : {}),
        },
      );
      downloadWhiteboardTransferFile(result);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "白板文件导出失败。");
    } finally {
      setTransferring(undefined);
    }
  }, [libraryItems]);

  const importPortableWhiteboard = useCallback(async (files: File[] | FileList) => {
    const file = Array.from(files)[0];
    if (!file) return;
    setTransferring("import");
    setError("");
    try {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = undefined;
      }
      const startedAt = Date.now();
      while (saveInFlightRef.current) {
        if (Date.now() - startedAt > 10_000) throw new Error("当前白板仍在保存，请稍后重试导入。");
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      const imported = await importWhiteboardTransferFile(file, {
        ...(window.mokiDesktop?.whiteboardFiles?.restoreResources
          ? { restoreResources: (resources) => window.mokiDesktop!.whiteboardFiles!.restoreResources!(resources) }
          : {}),
      });
      const editor = editorRef.current;
      if (!editor) throw new Error("当前白板页面尚未准备完成，请稍后重试。");
      const importedPage = snapshotPageInfo(imported.snapshot, imported.pageId);
      if (!importedPage) throw new Error("导入文件中没有可用的白板页面。");
      const newPageId = editor.createPage();
      const filePageName = file.name.replace(/\.moki(?:-board)?(?:\.json)?$/iu, "");
      const newPage = {
        pageId: newPageId,
        pageName: imported.pageName?.trim() || importedPage.pageName || filePageName || "导入白板",
      };
      editor.renamePage(newPageId, newPage.pageName);
      const currentSnapshot = getNativeSnapshot(store);
      const mergedSnapshot = mergeWhiteboardPageAsNew(
        currentSnapshot,
        imported.snapshot as NativeEditorSnapshot,
        importedPage.pageId,
        newPage.pageId,
        newPage.pageName,
      );
      const saved = await saveWhiteboard(
        extractWhiteboardPageSnapshot(mergedSnapshot, newPage.pageId) as WhiteboardSnapshot,
        false,
        newPage,
      );
      applyingRemoteSnapshotRef.current = true;
      loadNativeSnapshot(store, mergedSnapshot);
      applyingRemoteSnapshotRef.current = false;
      const topology = whiteboardPageTopology(mergedSnapshot as unknown as WhiteboardSnapshot);
      persistedPageTopologyRef.current = topology;
      observedPageTopologyRef.current = topology;
      pageTopologyDirtyRef.current = false;
      dirtyPageRevisionsRef.current.clear();
      dirtyRef.current = false;
      activePageRef.current = newPage;
      setActivePage(newPage);
      setLatest({ ...saved, snapshot: mergedSnapshot as unknown as WhiteboardSnapshot });
      setVersions(await getWhiteboardVersions(newPage.pageId));
      setSaveState("saved");
      setCanvasRevision((value) => value + 1);
    } catch (reason) {
      applyingRemoteSnapshotRef.current = false;
      setError(reason instanceof Error ? reason.message : "白板文件导入失败。");
    } finally {
      setTransferring(undefined);
    }
  }, [store]);


  useEffect(() => {
    const handleWhiteboardUpdated = (event: Event) => {
      if (!isWorkbenchDataUpdateFor(event, "whiteboard")) return;
      const detail = (
        event as CustomEvent<WorkbenchDataUpdatedDetail>
      ).detail;
      const actionId = detail?.actionId;
      if (
        actionId &&
        refreshedAssistantActionIdsRef.current.has(actionId)
      ) {
        return;
      }
      const hadUnsavedChanges = dirtyRef.current;
      if (actionId) {
        refreshedAssistantActionIdsRef.current.add(actionId);
        if (refreshedAssistantActionIdsRef.current.size > 100) {
          const oldest = refreshedAssistantActionIdsRef.current
            .values()
            .next().value;
          if (oldest) {
            refreshedAssistantActionIdsRef.current.delete(oldest);
          }
        }
      }
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = undefined;
      }
      const refreshGeneration = ++remoteLoadGenerationRef.current;
      void getAssistantWhiteboardUpdate(detail)
        .then(async (value) => {
          if (
            !mountedRef.current ||
            refreshGeneration !== remoteLoadGenerationRef.current
          ) {
            return;
          }
          const remoteSnapshot = value.snapshot
            ? activateWhiteboardPage(value.snapshot, detail?.pageId)
            : undefined;
          const mergeUnsavedChanges =
            hadUnsavedChanges || dirtyRef.current;
          const editor = editorRef.current;
          const currentLocalSnapshot = getNativeSnapshot(editor?.store ?? store);
          let loadedSnapshot = remoteSnapshot && mergeUnsavedChanges
            ? mergeAssistantWhiteboardUpdate(
                currentLocalSnapshot,
                remoteSnapshot,
                detail,
              )
            : remoteSnapshot;
          if (loadedSnapshot) {
            await editorRef.current?.preloadImages?.(
              snapshotImageSources(
                loadedSnapshot,
                detail?.changedShapeIds ?? [],
              ),
              700,
            );
            applyingRemoteSnapshotRef.current = true;
            try {
              loadNativeSnapshot(
                store,
                loadedSnapshot as unknown as NativeEditorSnapshot,
              );
            } finally {
              applyingRemoteSnapshotRef.current = false;
            }
          }
          const page = snapshotPageInfo(
            loadedSnapshot,
            detail?.pageId ?? activePageRef.current?.pageId,
          );
          activePageRef.current = page;
          setActivePage(page);
          const versionList = page
            ? await getWhiteboardVersions(page.pageId)
            : [];
          if (!mergeUnsavedChanges) {
            dirtyPageRevisionsRef.current.clear();
          }
          const remoteTopology = remoteSnapshot
            ? whiteboardPageTopology(remoteSnapshot)
            : "";
          const loadedTopology = loadedSnapshot
            ? whiteboardPageTopology(loadedSnapshot)
            : remoteTopology;
          persistedPageTopologyRef.current = remoteTopology;
          observedPageTopologyRef.current = loadedTopology;
          pageTopologyDirtyRef.current = remoteTopology !== loadedTopology;
          dirtyRef.current = mergeUnsavedChanges;
          setLatest(
            loadedSnapshot ? { ...value, snapshot: loadedSnapshot } : value,
          );
          setVersions(versionList);
          setSaveState(
            mergeUnsavedChanges ? "pending" : value.version ? "saved" : "idle",
          );
          setReady(true);
          setError("");
          if (loadedSnapshot && detail?.exportRequests?.length) {
            for (const request of detail.exportRequests) {
              await exportSnapshotImage(loadedSnapshot, request);
            }
          }
          const changedShapeIds = detail?.changedShapeIds ?? [];
          const visibleChangedShapeIds = loadedSnapshot
            ? changedShapeIds.filter((id) => isNativeShape(loadedSnapshot.document.store[id]))
            : [];
          if (visibleChangedShapeIds.length > 0) {
            window.requestAnimationFrame(() => {
              const editor = editorRef.current;
              if (!editor) return;
              editor.select(...(visibleChangedShapeIds as NativeShapeId[]));
              editor.zoomToSelection({ animation: { duration: 220 } });
            });
          }
          if (mergeUnsavedChanges) {
            queuePersist(detail?.pageId ?? page?.pageId);
          }
        })
        .catch((reason) => {
          if (refreshGeneration !== remoteLoadGenerationRef.current) return;
          if (actionId) {
            refreshedAssistantActionIdsRef.current.delete(actionId);
          }
          if (!mountedRef.current) return;
          setError(
            reason instanceof Error
              ? reason.message
              : "AI 白板修改已保存，但画布刷新失败",
          );
          setReady(true);
        });
    };
    window.addEventListener(
      WORKBENCH_DATA_UPDATED_EVENT,
      handleWhiteboardUpdated,
    );
    return () =>
      window.removeEventListener(
        WORKBENCH_DATA_UPDATED_EVENT,
        handleWhiteboardUpdated,
      );
  }, [exportSnapshotImage, queuePersist, store]);

  const insertScaledShape = useCallback(
    (kind: InsertKind) => {
      const editor = editorRef.current;
      if (!editor) return;
      const metrics = getCanvasInsertMetrics(editor);
      const id = createNativeShapeId();
      const common = {
        id,
        x: metrics.x,
        y: metrics.y,
      };
      const styleSize = sizeStyle(metrics.size);
      const shape =
        kind === "text"
          ? {
              ...common,
              type: "text",
               props: {
                 richText: toNativeRichText("双击编辑文字"),
                 size: styleSize,
                 bold: textStyle.bold,
                 italic: textStyle.italic,
                 underline: textStyle.underline,
                 textAlign: textStyle.textAlign,
                 color: selectedColor,
               },
            }
          : {
              ...common,
              type: "note",
              props: {
                richText: toNativeRichText("便签"),
                 color: selectedColor,
                 labelColor: selectedColor,
                 size: styleSize,
                 bold: textStyle.bold,
                 italic: textStyle.italic,
                 underline: textStyle.underline,
                 textAlign: textStyle.textAlign,
                scale: noteScale(metrics.size),
              },
            };
      editor.markHistoryStoppingPoint?.("workbench quick insert");
      editor.createShapes(
        [shape] as Parameters<NativeWhiteboardEditor["createShapes"]>[0],
      );
      editor.select?.(id);
      queuePersist();
    },
    [queuePersist, selectedColor, textStyle],
  );

  const insertMindMap = useCallback((template: MindMapTemplateId = "mind-right", requestedCenter?: NativeVecLike) => {
    const editor = editorRef.current;
    if (!editor) return;
    const preferredCenter = editor.getViewportPageBounds().center;
    const mindMap = buildMindMapTemplate({ template, center: preferredCenter, color: selectedColor });
    const templateBounds = mindMapTemplateBounds(mindMap.shapes);
    const center = requestedCenter ?? findMindMapInsertCenter(editor, preferredCenter, templateBounds);
    const dx = center.x - preferredCenter.x;
    const dy = center.y - preferredCenter.y;
    const positionedShapes = mindMap.shapes.map((shape) => ({
      ...shape,
      x: Number(shape.x ?? 0) + dx,
      y: Number(shape.y ?? 0) + dy,
    }));
    editor.markHistoryStoppingPoint?.("insert mind map");
    editor.createShapes(positionedShapes as Parameters<NativeWhiteboardEditor["createShapes"]>[0]);
    editor.select(...mindMap.nodeIds);
    editor.zoomToSelection({ animation: { duration: 220 } });
    editor.select(mindMap.rootId);
    editor.setCurrentTool("select");
    setActiveTool("select");
    setMindMapMenuOpen(false);
    queuePersist();
  }, [queuePersist, selectedColor]);

  const insertLink = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const normalizedUrl = normalizeWhiteboardLinkUrl(linkUrl);
    if (!normalizedUrl) {
      setLinkError("请输入有效的 http 或 https 链接");
      return;
    }
    const metrics = getCanvasInsertMetrics(editor);
    const id = createNativeShapeId();
    let hostname = normalizedUrl;
    try {
      hostname = new URL(normalizedUrl).hostname;
    } catch {
      // normalizeWhiteboardLinkUrl already validated the URL.
    }
    editor.markHistoryStoppingPoint?.("workbench link insert");
    editor.createShapes([{
      id,
      type: "link",
      x: metrics.x,
      y: metrics.y,
      props: {
        url: normalizedUrl,
        title: linkTitle.trim() || hostname || "网页链接",
        titleAuto: !linkTitle.trim(),
        mode: linkMode,
        w: 360,
        h: linkMode === "preview" ? 300 : 82,
        scale: 1,
      },
    }]);
    editor.select?.(id);
    setLinkDialogOpen(false);
    setLinkUrl("");
    setLinkTitle("");
    setLinkMode("link");
    setLinkError("");
    queuePersist();
  }, [linkMode, linkTitle, linkUrl, queuePersist]);

  const openLibraryItem = useCallback(async (libraryItemId: string) => {
    const item = libraryItems.find((entry) => entry.id === libraryItemId);
    if (item?.kind === "folder") {
      window.location.assign("/library");
      return;
    }
    try {
      await openResourceLibraryItem(libraryItemId);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "资料打开失败");
    }
  }, [libraryItems]);

  const exportGroupFolder = useCallback(async (
    request: NativeWhiteboardFolderExportRequest,
    mode: "local" | "library",
  ) => {
    setError("");
    setFolderExportNotice("");
    if (mode === "library") {
      setFolderExportTargetId("");
      setPendingFolderExport(request);
      return;
    }
    const destination = await window.mokiDesktop?.selectLocalFolder?.();
    if (!destination) {
      if (!window.mokiDesktop?.selectLocalFolder) setError("请在 MOKI 客户端中另存为白板资料夹");
      return;
    }
    setFolderExportBusy(true);
    try {
      const { folderId: _folderId, ...input } = request;
      const result = await exportWhiteboardFolder({ ...input, mode: "local", destination });
      setFolderExportNotice(`资料夹已保存到 ${result.path}（${result.files} 个文件）`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "白板资料夹另存为失败");
    } finally {
      setFolderExportBusy(false);
    }
  }, []);

  const savePendingFolderToLibrary = useCallback(async () => {
    if (!pendingFolderExport) return;
    setFolderExportBusy(true);
    setError("");
    try {
      const { folderId: _folderId, ...input } = pendingFolderExport;
      const result = await exportWhiteboardFolder({
        ...input,
        mode: "library",
        parentId: folderExportTargetId || null,
      });
      setLibraryItems(await getResourceLibraryItems());
      setPendingFolderExport(undefined);
      setFolderExportTargetId("");
      setFolderExportNotice(`已在资料库中创建“${result.item?.name ?? pendingFolderExport.name}”资料夹`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存到资料库失败");
    } finally {
      setFolderExportBusy(false);
    }
  }, [folderExportTargetId, pendingFolderExport]);

  const insertLibraryItems = useCallback(async (items: ResourceLibraryItem[]) => {
    const editor = editorRef.current;
    if (!editor || items.length === 0) return;
    const metrics = getCanvasInsertMetrics(editor);
    const imageItems = items.filter(isResourceLibraryImage);
    const resourceItems = items.filter((item) => !isResourceLibraryImage(item));
    try {
      setError("");
      editor.markHistoryStoppingPoint?.("workbench library insert");
      for (const [index, item] of imageItems.entries()) {
        const file = await getResourceLibraryImageFile(item);
        if (file.size > MAX_WHITEBOARD_FILE_BYTES) throw new Error(`图片文件不能超过 200MB：${item.name}`);
        await editor.putExternalContent({
          type: "files",
          files: [file],
          point: {
            x: metrics.x + (index % 2) * 360 + metrics.size / 2,
            y: metrics.y + Math.floor(index / 2) * 260 + metrics.size / 2,
          },
        }, { force: true });
      }
      const ids = resourceItems.map(() => createNativeShapeId());
      if (resourceItems.length) {
        editor.createShapes(resourceItems.map((item, index) => ({
          id: ids[index]!,
          type: "resource",
          x: metrics.x + (index % 2) * 350,
          y: metrics.y + Math.floor(index / 2) * 102,
          props: {
            libraryItemId: item.id,
            name: item.name,
            kind: item.kind,
            w: 330,
            h: 82,
            scale: 1,
          },
        })));
        editor.select?.(...ids);
      }
      setCanvasRevision((value) => value + 1);
      queuePersist();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "资料添加到白板失败");
    }
  }, [queuePersist]);

  const importLocalMaterial = useCallback(async (folder: boolean) => {
    setFileInsertMenuOpen(false);
    try {
      setError("");
      const items = await importLocalLibrary(folder);
      if (items.length === 0) return;
      await insertLibraryItems(items);
      await refreshLibrary();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "本地文件添加失败");
    }
  }, [insertLibraryItems, refreshLibrary]);

  const openMaterial = useCallback((material: WhiteboardMaterial) => {
    if (material.libraryItemId) {
      void openLibraryItem(material.libraryItemId);
      return;
    }
    if (material.localPath) {
      void window.mokiDesktop?.openLocalPath?.(material.localPath);
      return;
    }
    if (material.openUrl) window.open(material.openUrl, "_blank", "noopener,noreferrer");
  }, [openLibraryItem]);

  const openLocalPath = useCallback(async (path: string) => {
    const opened = await window.mokiDesktop?.openLocalPath?.(path);
    if (!opened) setError("本地路径不存在或无法使用系统应用打开");
  }, []);

  const locateMaterial = useCallback((shapeId: string) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.select(shapeId as NativeShapeId);
    editor.zoomToSelection({ animation: { duration: 220 } });
  }, []);

  const insertImageFiles = useCallback(
    async (
      files: FileList | File[],
      point?: NativeVecLike,
      throwOnError = false,
    ) => {
      const editor = editorRef.current;
      if (!editor) {
        if (throwOnError) throw new Error("白板尚未就绪");
        return;
      }
      const imageFiles = Array.from(files).filter((file) =>
        file.type.startsWith("image/") || file.type.startsWith("video/") || /\.(?:gif|mp4|webm|mov|m4v|avi|mkv)$/iu.test(file.name),
      );
      if (imageFiles.length === 0) {
        if (throwOnError) throw new Error("请选择图片或视频文件");
        return;
      }
      const oversized = imageFiles.find(
        (file) => file.size > MAX_WHITEBOARD_FILE_BYTES,
      );
      if (oversized) {
        setError(
          `媒体文件不能超过 200MB：${oversized.name}`,
        );
        if (throwOnError) {
          throw new Error(`媒体文件不能超过 200MB：${oversized.name}`);
        }
        return;
      }
      const metrics = getCanvasInsertMetrics(editor);
      const insertionPoint = point ?? {
        x: metrics.x + metrics.size / 2,
        y: metrics.y + metrics.size / 2,
      };
      try {
        setError("");
        editor.markHistoryStoppingPoint?.("workbench image insert");
        await editor.putExternalContent(
          {
            type: "files",
            files: imageFiles,
            point: insertionPoint,
          },
          { force: true },
        );
        queuePersist();
      } catch (reason) {
        const resolved =
          reason instanceof Error ? reason : new Error("图片插入失败");
        setError(resolved.message);
        if (throwOnError) throw resolved;
      }
    },
    [queuePersist],
  );

  const insertDroppedLocalItems = useCallback(async (
    items: NativeDroppedLocalItem[],
    point?: NativeVecLike,
  ) => {
    const editor = editorRef.current;
    if (!editor || items.length === 0) return;
    const previewable = items.filter(({ file, isDirectory }) =>
      !isDirectory && isDroppedPreviewableMedia(file),
    );
    const mapped = items.filter((item) => !previewable.includes(item));
    const oversized = previewable.find(({ file }) => file.size > MAX_WHITEBOARD_FILE_BYTES);
    if (oversized) {
      setError(`白板媒体文件不能超过 200MB：${oversized.file.name}`);
      return;
    }
    try{for(const item of mapped){if(!item.path&&!item.isDirectory){const uploaded=await uploadLibraryFile(item.file);if(!uploaded.target)throw new Error('本地文件没有可用路径');item.path=uploaded.target;}}}catch(reason){setError(reason instanceof Error?reason.message:'本地文件上传失败');return;}
    const unavailable = mapped.find((item) => !item.path);
    if (unavailable) {
      setError(`无法读取本地路径：${unavailable.file.name}`);
      return;
    }
    const insertionPoint = point ?? editor.getViewportPageBounds().center;
    try {
      setError("");
      editor.markHistoryStoppingPoint?.("workbench local drop");
      if (previewable.length) {
        await editor.putExternalContent({
          type: "files",
          files: previewable.map((item) => item.file),
          localPaths: previewable.map((item) => item.path),
          point: insertionPoint,
        }, { force: true });
      }
      if (mapped.length) {
        const ids = mapped.map(() => createNativeShapeId());
        editor.createShapes(mapped.map((item, index) => ({
          id: ids[index]!,
          type: "resource",
          x: insertionPoint.x - 165 + (index % 2) * 350,
          y: insertionPoint.y - 41 + Math.floor(index / 2) * 102,
          props: {
            name: item.file.name || item.path!.split(/[\\/]/u).pop() || "本地资料",
            kind: item.isDirectory ? "local_folder" : "local_file",
            localPath: item.path,
            w: 330,
            h: 82,
            scale: 1,
          },
        })));
        editor.select?.(...ids);
      }
      setCanvasRevision((value) => value + 1);
      queuePersist();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "本地文件添加失败");
    }
  }, [queuePersist]);

  const insertRemoteImage = useCallback(async (url: string, point?: NativeVecLike) => {
    try {
      setError("");
      const cached = await apiFetch("/api/whiteboard/assets/remote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const payload = await cached.json() as { src?: string; mimeType?: string; error?: string };
      if (!cached.ok || !payload.src) throw new Error(payload.error ?? "网络图片缓存失败");
      const response = await apiFetch(payload.src);
      if (!response.ok) throw new Error(`读取本地图片缓存失败：HTTP ${response.status}`);
      const blob = await response.blob();
      const sourceName = (() => {
        try { return decodeURIComponent(new URL(url).pathname.split("/").pop() || "网络图片"); }
        catch { return "网络图片"; }
      })();
      await insertImageFiles([
        new File([blob], sourceName, { type: payload.mimeType || blob.type || "image/png" }),
      ], point, true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "网络图片缓存失败");
    }
  }, [insertImageFiles]);

  useEffect(() => {
    if (!ready) return;
    const insertRequest = async (request: AssistantMediaInsertRequest) => {
      const requestKey = assistantMediaRequestKey(request);
      if (handledAssistantMediaRequestsRef.current.has(requestKey)) return;
      handledAssistantMediaRequestsRef.current.add(requestKey);
      try {
        const response = await apiFetch(request.url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();
        const mediaType = resolveAssistantImageMediaType(request, blob.type);
        if (!mediaType) {
          throw new Error("当前白板只支持插入图片媒体");
        }
        await insertImageFiles([
          new File([blob], request.name || "AI 生成图片", { type: mediaType }),
        ], undefined, true);
        const pending = window.localStorage.getItem(
          PENDING_ASSISTANT_MEDIA_KEY,
        );
        if (pending) {
          try {
            const stored = JSON.parse(pending) as AssistantMediaInsertRequest;
            if (assistantMediaRequestKey(stored) === requestKey) {
              window.localStorage.removeItem(PENDING_ASSISTANT_MEDIA_KEY);
            }
          } catch {
            window.localStorage.removeItem(PENDING_ASSISTANT_MEDIA_KEY);
          }
        }
      } catch (reason) {
        handledAssistantMediaRequestsRef.current.delete(requestKey);
        setError(reason instanceof Error ? reason.message : "助手图片插入失败");
      }
    };
    const handle = (event: Event) => {
      const request = (event as CustomEvent<AssistantMediaInsertRequest>).detail;
      if (request) void insertRequest(request);
    };
    window.addEventListener(ASSISTANT_MEDIA_INSERT_EVENT, handle);
    const consumePending = () => {
      const pending = window.localStorage.getItem(PENDING_ASSISTANT_MEDIA_KEY);
      if (!pending) return;
      try {
        void insertRequest(JSON.parse(pending) as AssistantMediaInsertRequest);
      } catch {
        window.localStorage.removeItem(PENDING_ASSISTANT_MEDIA_KEY);
        setError("待插入的助手图片数据无效");
      }
    };
    const handleStoredRequest = (event: StorageEvent) => {
      if (event.key === PENDING_ASSISTANT_MEDIA_KEY && event.newValue) consumePending();
    };
    window.addEventListener("storage", handleStoredRequest);
    consumePending();
    return () => {
      window.removeEventListener(ASSISTANT_MEDIA_INSERT_EVENT, handle);
      window.removeEventListener("storage", handleStoredRequest);
    };
  }, [insertImageFiles, ready]);

  const alignSelectedShapes = useCallback(
    (kind: AlignKind) => {
      const editor = editorRef.current;
      if (!editor) return;
      const selectedShapeIds = editor.getSelectedShapeIds();
      const measuredEntries = measureAlignmentUnits(editor, selectedShapeIds);
      if (measuredEntries.length < 2) {
        setError("请选择至少两个对象或编组后再进行对齐");
        return;
      }
      const left = Math.min(...measuredEntries.map((item) => item.x));
      const top = Math.min(...measuredEntries.map((item) => item.y));
      const right = Math.max(
        ...measuredEntries.map((item) => item.right),
      );
      const bottom = Math.max(
        ...measuredEntries.map((item) => item.bottom),
      );
      const centerX = (left + right) / 2;
      const centerY = (top + bottom) / 2;
      const toUpdate = (
        item: MeasuredShape,
        nextBoundsX: number,
        nextBoundsY: number,
      ) => ({ item, nextBoundsX, nextBoundsY });
      let updates: ReturnType<typeof toUpdate>[];
      const alignsOnXAxis =
        kind === "left" || kind === "center-x" || kind === "right";
      const overlapGroups = axisOverlapGroups(
        measuredEntries,
        alignsOnXAxis ? "y" : "x",
      );
      const shouldStagger = overlapGroups.some((group) => group.length > 1);
      const wrappedRows = alignsOnXAxis ? [] : wrappedAlignmentRows(measuredEntries);
      if (!alignsOnXAxis && wrappedRows.length > 1) {
        if (kind === "top") {
          let cursor = top;
          updates = wrappedRows.map((row) => {
            const update = toUpdate(row, row.x, cursor);
            cursor += row.h + ALIGN_STAGGER_GAP;
            return update;
          });
        } else if (kind === "bottom") {
          let cursor = bottom;
          const positions = new Map<MeasuredShape, number>();
          for (const row of [...wrappedRows].reverse()) {
            const nextY = cursor - row.h;
            positions.set(row, nextY);
            cursor = nextY - ALIGN_STAGGER_GAP;
          }
          updates = wrappedRows.map((row) => toUpdate(row, row.x, positions.get(row)!));
        } else {
          const packedHeight = wrappedRows.reduce((sum, row) => sum + row.h, 0) +
            ALIGN_STAGGER_GAP * (wrappedRows.length - 1);
          let cursor = centerY - packedHeight / 2;
          updates = wrappedRows.map((row) => {
            const update = toUpdate(row, row.x, cursor);
            cursor += row.h + ALIGN_STAGGER_GAP;
            return update;
          });
        }
      } else if (kind === "left") {
        if (!shouldStagger) {
          updates = measuredEntries.map((item) => toUpdate(item, left, item.y));
        } else {
          updates = overlapGroups.flatMap((group) => {
            if (group.length === 1) return [toUpdate(group[0]!, left, group[0]!.y)];
            const ordered = [...group].sort(
              (a, b) => a.x - b.x || a.y - b.y || String(a.shape.id).localeCompare(String(b.shape.id)),
            );
            let cursor = left;
            return ordered.map((item) => {
              const nextX = cursor;
              cursor = nextX + item.w + ALIGN_STAGGER_GAP;
              return toUpdate(item, nextX, item.y);
            });
          });
        }
      } else if (kind === "right") {
        if (!shouldStagger) {
          updates = measuredEntries.map((item) =>
            toUpdate(item, right - item.w, item.y),
          );
        } else {
          updates = overlapGroups.flatMap((group) => {
            if (group.length === 1) return [toUpdate(group[0]!, right - group[0]!.w, group[0]!.y)];
            const ordered = [...group].sort(
              (a, b) => b.right - a.right || b.y - a.y || String(a.shape.id).localeCompare(String(b.shape.id)),
            );
            let cursor = right;
            return ordered.map((item) => {
              const nextX = cursor - item.w;
              cursor = nextX - ALIGN_STAGGER_GAP;
              return toUpdate(item, nextX, item.y);
            });
          });
        }
      } else if (kind === "top") {
        if (!shouldStagger) {
          updates = measuredEntries.map((item) => toUpdate(item, item.x, top));
        } else {
          updates = overlapGroups.flatMap((group) => {
            if (group.length === 1) return [toUpdate(group[0]!, group[0]!.x, top)];
            const ordered = [...group].sort(
              (a, b) => a.y - b.y || a.x - b.x || String(a.shape.id).localeCompare(String(b.shape.id)),
            );
            let cursor = top;
            return ordered.map((item) => {
              const nextY = cursor;
              cursor = nextY + item.h + ALIGN_STAGGER_GAP;
              return toUpdate(item, item.x, nextY);
            });
          });
        }
      } else if (kind === "bottom") {
        if (!shouldStagger) {
          updates = measuredEntries.map((item) =>
            toUpdate(item, item.x, bottom - item.h),
          );
        } else {
          updates = overlapGroups.flatMap((group) => {
            if (group.length === 1) return [toUpdate(group[0]!, group[0]!.x, bottom - group[0]!.h)];
            const ordered = [...group].sort(
              (a, b) => b.bottom - a.bottom || b.x - a.x || String(a.shape.id).localeCompare(String(b.shape.id)),
            );
            let cursor = bottom;
            return ordered.map((item) => {
              const nextY = cursor - item.h;
              cursor = nextY - ALIGN_STAGGER_GAP;
              return toUpdate(item, item.x, nextY);
            });
          });
        }
      } else if (kind === "center-x") {
        updates = overlapGroups.flatMap((group) => {
          const ordered = group.length > 1
            ? [...group].sort((a, b) => a.y - b.y || a.x - b.x || String(a.shape.id).localeCompare(String(b.shape.id)))
            : group;
          let cursor = Math.min(...group.map((item) => item.y));
          return ordered.map((item) => {
            const nextY = group.length > 1 ? cursor : item.y;
            if (group.length > 1) cursor += item.h + ALIGN_STAGGER_GAP;
            return toUpdate(item, centerX - item.w / 2, nextY);
          });
        });
      } else {
        updates = overlapGroups.flatMap((group) => {
          const ordered = group.length > 1
            ? [...group].sort((a, b) => a.x - b.x || a.y - b.y || String(a.shape.id).localeCompare(String(b.shape.id)))
            : group;
          let cursor = Math.min(...group.map((item) => item.x));
          return ordered.map((item) => {
            const nextX = group.length > 1 ? cursor : item.x;
            if (group.length > 1) cursor += item.w + ALIGN_STAGGER_GAP;
            return toUpdate(item, nextX, centerY - item.h / 2);
          });
        });
      }
      const shapeUpdates = updates.flatMap(({ item, nextBoundsX, nextBoundsY }) => {
        const dx = nextBoundsX - item.x;
        const dy = nextBoundsY - item.y;
        return item.members.map((shape) => ({
          id: shape.id,
          type: shape.type,
          x: shape.x + dx,
          y: shape.y + dy,
        }));
      });
      editor.markHistoryStoppingPoint?.("workbench align shapes");
      editor.updateShapes(
        shapeUpdates as Parameters<NativeWhiteboardEditor["updateShapes"]>[0],
      );
      setError("");
      queuePersist();
    },
    [queuePersist],
  );

  useEffect(() => {
    if (!ready) return;
    const stopListening = store.listen(
      (event) => {
        if (applyingRemoteSnapshotRef.current) return;
        setCanvasRevision((value) => value + 1);
        const editor = editorRef.current;
        const pageId = editor?.getCurrentPageId();
        const currentPage = editor?.getCurrentPage();
        if (
          editor &&
          pageId &&
          (activePageRef.current?.pageId !== pageId ||
            activePageRef.current?.pageName !== currentPage?.name)
        ) {
          const pageName = editor.getCurrentPage().name || "未命名页面";
          const page = { pageId, pageName };
          activePageRef.current = page;
          setActivePage(page);
          setVersions([]);
          setLatest((current) => latestForWhiteboardPage(current, page, undefined));
          setSaveState(
            dirtyPageRevisionsRef.current.has(pageId) ? "pending" : "idle",
          );
          const metadataLoadGeneration =
            ++pageMetadataLoadGenerationRef.current;
          void getWhiteboardVersions(pageId)
            .then((versionList) => {
              if (
                metadataLoadGeneration !== pageMetadataLoadGenerationRef.current ||
                activePageRef.current?.pageId !== pageId
              ) {
                return;
              }
              setVersions(versionList);
              setLatest((current) =>
                latestForWhiteboardPage(current, page, versionList[0]),
              );
              setSaveState(
                dirtyPageRevisionsRef.current.has(pageId)
                  ? "pending"
                  : versionList[0]
                    ? "saved"
                    : "idle",
              );
            })
            .catch(() => undefined);
        }
        if (event.scope === "document") queuePersist(pageId);
      },
      { source: "all", scope: "all" },
    );
    return () => {
      stopListening();
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = undefined;
      }
      if (dirtyRef.current) {
        void persist(true);
      }
    };
  }, [persist, queuePersist, ready, store]);

  const handleMount = useCallback(
    (editor: NativeWhiteboardEditor) => {
      editorRef.current = editor;
      const noteUtil = editor.getShapeUtil("note") as NativeNoteShapeUtil;
      noteUtil.options.resizeMode = "scale";
    },
    [],
  );

  const setCanvasTool = useCallback((tool: CanvasToolId) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.setCurrentTool(tool);
    editor.updateInstanceState({
      isToolLocked: LOCKED_CANVAS_TOOLS.has(tool),
    });
    setActiveTool(tool);
    setShapeMenuOpen(false);
    setDrawMenuOpen(false);
    setArrowMenuOpen(false);
    setMindMapMenuOpen(false);
    setExportMenuOpen(false);
  }, []);

  const applyArrowStyle = useCallback((style: NativeArrowStyle) => {
    setArrowStyle(style);
    setArrowMenuOpen(false);
    const editor = editorRef.current;
    if (!editor) return;
    const updates = editor.getSelectedShapeIds().flatMap((id) => {
      const shape = editor.getShape(id);
      return shape?.type === "arrow" ? [{ id, props: { arrowStyle: style } }] : [];
    });
    if (updates.length > 0) editor.updateShapes(updates);
    editor.setCurrentTool("arrow");
    editor.updateInstanceState({ isToolLocked: true });
    setActiveTool("arrow");
  }, []);

  const setShapeTool = useCallback((geo: NativeGeoShape) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.setStyleForNextShapes(NativeGeoShapeStyle, geo);
    editor.updateInstanceState({ isToolLocked: true });
    editor.setCurrentTool("geo");
    setSelectedGeo(geo);
    setActiveTool("geo");
    setShapeMenuOpen(false);
    setArrowMenuOpen(false);
    setExportMenuOpen(false);
  }, []);

  const applyDrawSize = useCallback((size: NativeStrokeSize) => {
    setDrawSize(size);
    const editor = editorRef.current;
    if (!editor) return;
    const updates = editor.getSelectedShapeIds()
      .map((id) => editor.getShape(id))
      .filter((shape): shape is NativeShape => Boolean(shape && ["draw", "bezier", "arrow", "geo"].includes(shape.type)))
      .map((shape) => ({ id: shape.id, props: { size } }));
    if (updates.length > 0) editor.updateShapes(updates);
  }, [libraryItems]);

  const applyDrawColor = useCallback((color: NativeCanvasColor) => {
    setDrawColor(color);
    const editor = editorRef.current;
    if (!editor) return;
    const updates = editor.getSelectedShapeIds()
      .map((id) => editor.getShape(id))
      .filter((shape): shape is NativeShape => Boolean(shape && ["draw", "bezier"].includes(shape.type)))
      .map((shape) => ({ id: shape.id, props: { color } }));
    if (updates.length > 0) editor.updateShapes(updates);
  }, []);

  useEffect(() => {
    if (!isCanvasFullscreen) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsCanvasFullscreen(false);
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isCanvasFullscreen]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target =
        event.target instanceof HTMLElement
          ? event.target
          : null;
      if (
        target?.closest(
          "input, textarea, select, [contenteditable='true']",
        )
      ) {
        return;
      }
      const editor = editorRef.current;
      if (!editor) return;
      const modifier = event.ctrlKey || event.metaKey;
      if (embedded && (!active || !target || !embeddedRootRef.current?.contains(target))) return;
      if (!embedded && target?.closest('[data-whiteboard-embedded="true"]')) return;
      const key = event.key.toLowerCase();
      if (key === "escape") {
        setAlignmentToolsOpen(false);
        setShortcutsOpen(false);
        setExportMenuOpen(false);
        setTransferMenuOpen(false);
        setFileInsertMenuOpen(false);
        setShapeMenuOpen(false);
        setArrowMenuOpen(false);
        setMindMapMenuOpen(false);
            return;
      }
      if (modifier && !event.altKey && key === "a") {
        event.preventDefault();
        editor.select(...editor.getCurrentPageShapeIds());
        return;
      }
      if (modifier && !event.altKey && key === "d") {
        const serialized = editor.copySelectedShapes();
        if (!serialized) return;
        event.preventDefault();
        const pastedIds = editor.pasteCopiedShapes(serialized, 32);
        if (pastedIds.length > 0) queuePersist();
        return;
      }
      if (modifier && event.altKey && !event.shiftKey && key === "g") {
        event.preventDefault();
        if (!event.repeat && editor.ungroupSelectedShapes()) queuePersist();
        return;
      }
      if (modifier && !event.altKey && !event.shiftKey && key === "g") {
        event.preventDefault();
        if (!event.repeat && editor.groupSelectedShapes()) queuePersist();
        return;
      }
      if (modifier && !event.altKey && key === "s") {
        event.preventDefault();
        void persist();
        return;
      }
      if (modifier && !event.altKey && key === "0") {
        event.preventDefault();
        editor.fitCurrentPage();
        return;
      }
      if (modifier && !event.altKey && (key === "z" || key === "y")) {
        event.preventDefault();
        if (key === "y" || event.shiftKey) editor.redo();
        else editor.undo();
        return;
      }
      if (modifier && !event.altKey) {
        const alignKind: AlignKind | undefined =
          key === "arrowleft"
            ? "left"
            : key === "arrowright"
              ? "right"
              : key === "arrowup"
                ? "top"
                : key === "arrowdown"
                  ? "bottom"
                  : undefined;
        if (alignKind) {
          event.preventDefault();
          alignSelectedShapes(alignKind);
          return;
        }
      }
      if (!modifier && !event.altKey && !event.repeat) {
        if (key === "v" || key === "1") {
          event.preventDefault();
          editor.setCurrentTool("select");
          setActiveTool("select");
          return;
        }
        if (key === "h" || key === "2") {
          event.preventDefault();
          editor.setCurrentTool("hand");
          setActiveTool("hand");
          return;
        }
        if (key === "p" || key === "3") {
          event.preventDefault();
          editor.setCurrentTool("draw");
          setActiveTool("draw");
          return;
        }
        if (key === "b") {
          event.preventDefault();
          editor.setCurrentTool("pen");
          setActiveTool("pen");
          return;
        }
        if (key === "t" || key === "4") {
          event.preventDefault();
          editor.setCurrentTool("text");
          setActiveTool("text");
          return;
        }
        if (key === "r" || key === "5") {
          event.preventDefault();
          editor.setStyleForNextShapes(NativeGeoShapeStyle, selectedGeo);
          editor.updateInstanceState({ isToolLocked: true });
          editor.setCurrentTool("geo");
          setActiveTool("geo");
          return;
        }
        if (key === "n") {
          event.preventDefault();
          insertScaledShape("note");
          return;
        }
        if (key === "i") {
          event.preventDefault();
          imageInputRef.current?.click();
          return;
        }
      }
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      const selectedShapeIds = editor.getSelectedShapeIds();
      if (selectedShapeIds.length === 0) return;
      event.preventDefault();
      editor.deleteShapes(selectedShapeIds);
      queuePersist();
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () =>
      window.removeEventListener("keydown", handleKeyDown, true);
  }, [active, embedded, alignSelectedShapes, insertScaledShape, persist, queuePersist, selectedGeo]);

  async function loadVersion(version: number) {
    setError("");
    try {
      const value = await getWhiteboardVersion(version);
      const current = getNativeSnapshot(
        editorRef.current?.store ?? store,
      );
      const pageId = value.pageId ?? activePageRef.current?.pageId;
      if (!pageId) {
        throw new Error("无法确定要恢复的白板页面。");
      }
      loadNativeSnapshot(
        store,
        restoreWhiteboardPageSnapshot(
          current,
          value.snapshot as unknown as NativeEditorSnapshot,
          pageId,
        ),
      );
      queuePersist(pageId);
      setHistoryOpen(false);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "历史版本加载失败",
      );
    }
  }

  function manualSave() {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = undefined;
    }
    void persist();
  }

  function exportCurrentWhiteboard(scope: "selection" | "canvas") {
    const editor = editorRef.current;
    if (!editor) return;
    const snapshot = getNativeSnapshot(editor.store) as WhiteboardSnapshot;
    void exportSnapshotImage(snapshot, {
      pageId: editor.getCurrentPageId(),
      scope,
      shapeIds: scope === "selection" ? editor.getSelectedShapeIds() : [],
      padding: exportPadding,
    });
  }

  const toolButtonClass = (tool: CanvasToolId) =>
    `native-whiteboard-edit-control grid size-9 shrink-0 place-items-center rounded-xl transition ${
      activeTool === tool
        ? "bg-[#171b2c] text-white shadow-[0_8px_18px_rgba(23,27,44,.18)]"
        : "hover:bg-[#f0efff]"
    }`;
  const actionButtonClass =
    "native-whiteboard-edit-control grid size-9 shrink-0 place-items-center rounded-xl transition hover:bg-[#f0efff]";
  const lightCanvasCursor = LIGHT_TOOL_CURSORS[activeTool];
  const darkCanvasCursor = DARK_TOOL_CURSORS[activeTool];
  const canvasCursorStyle = lightCanvasCursor
    ? ({
        "--whiteboard-tool-cursor-light": lightCanvasCursor,
        "--whiteboard-tool-cursor-dark": darkCanvasCursor ?? lightCanvasCursor,
      } as CSSProperties)
    : undefined;
  void canvasRevision;

  const content = (
      <div ref={embeddedRootRef} data-whiteboard-embedded={embedded ? "true" : undefined} data-whiteboard-active={active ? "true" : "false"} tabIndex={embedded ? -1 : undefined} onPointerDownCapture={embedded ? () => {
        if (!embeddedRootRef.current?.contains(document.activeElement)) embeddedRootRef.current?.focus({ preventScroll: true });
      } : undefined} className={`flex h-full w-full min-w-0 min-h-0 flex-col outline-none ${embedded ? "p-2" : ""}`}>
        <WorkbenchPageHeader
          eyebrow="MOKI Canvas"
          title="无限白板"
          description="便签、文本、图片、链接与涂鸦均保存在当前电脑"
          actionsClassName="gap-2"
          actions={(
            <>
            <input
              ref={whiteboardInputRef}
              type="file"
              accept=".moki,.moki-board,application/vnd.moki.whiteboard+json"
              className="hidden"
              onChange={(event) => {
                void importPortableWhiteboard(event.currentTarget.files ?? []);
                event.currentTarget.value = "";
              }}
            />
            <div
              role="status"
              aria-label="白板保存状态"
              title={savedLabel(saveState, latest?.pageVersion ?? latest?.version ?? undefined, latest?.createdAt)}
              className={`flex h-9 items-center gap-2 rounded-[14px] border border-white/80 bg-white px-3 text-[0.6875rem] font-bold shadow-sm ${
                saveState === "error"
                  ? "text-[#b33c63]"
                  : saveState === "pending"
                    ? "text-[#a87632]"
                    : "text-[#397c66]"
              }`}
            >
              {saveState === "saving" ? (
                <LoaderCircle size={13} className="animate-spin" />
              ) : saveState === "error" ? (
                <CloudOff size={13} />
              ) : (
                <CheckCircle2 size={13} />
              )}
              <span className={embedded ? "min-w-0 truncate" : undefined}>{savedLabel(
                saveState,
                latest?.pageVersion ?? latest?.version ?? undefined,
                latest?.createdAt,
              )}</span>
            </div>
            <button
              type="button"
              aria-label="立即保存白板"
              onClick={manualSave}
              className="grid size-9 place-items-center rounded-xl bg-white text-[#625bc5] shadow-sm"
            >
              <Save size={15} />
            </button>
            <div className="relative">
              <button
                type="button"
                aria-label="导入或导出白板文件"
                title="导入或导出可在其他 MOKI 客户端使用的白板文件"
                aria-expanded={transferMenuOpen}
                disabled={Boolean(transferring)}
                onClick={() => setTransferMenuOpen((value) => !value)}
                className="grid size-9 place-items-center rounded-xl bg-white text-[#625bc5] shadow-sm disabled:opacity-45"
              >
                {transferring ? <LoaderCircle size={15} className="animate-spin" /> : <FileDown size={15} />}
              </button>
              {transferMenuOpen && (
                <div className="moki-menu-surface absolute right-0 top-11 z-50 w-52 p-2 text-xs text-[#30364d]">
                  <p className="px-2 py-1 font-black">白板文件</p>
                  <button type="button" aria-label="导出白板文件" disabled={Boolean(transferring)} onClick={() => { setTransferMenuOpen(false); void exportPortableWhiteboard(); }} className="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left font-bold hover:bg-[#f2f1ff] disabled:opacity-45"><FileDown size={14} />导出白板文件</button>
                  <button type="button" aria-label="导入白板文件" disabled={Boolean(transferring)} onClick={() => { setTransferMenuOpen(false); whiteboardInputRef.current?.click(); }} className="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left font-bold hover:bg-[#f2f1ff] disabled:opacity-45"><FileUp size={14} />导入白板文件</button>
                </div>
              )}
            </div>
            <button
              type="button"
              aria-label="查看白板版本"
              onClick={() => setHistoryOpen((value) => !value)}
              className="grid size-9 place-items-center rounded-xl bg-[#242a40] text-white shadow-sm"
            >
              <History size={15} />
            </button>
            </>
          )}
        />

        {latest?.recoveredFromVersion && latest.version && (
          <div className="mb-2 rounded-[13px] bg-[#fff5e8] px-3 py-2 text-[0.6875rem] font-semibold text-[#a87632]">
            版本 {latest.recoveredFromVersion} 损坏，已恢复版本{" "}
            {latest.version}
          </div>
        )}
        {error && (
          <div
            role="alert"
            className="mb-2 rounded-[13px] bg-[#fff0f3] px-3 py-2 text-[0.75rem] font-semibold text-[#b33c63]"
          >
            {error}
          </div>
        )}
        {folderExportNotice && (
          <div role="status" className="mb-2 rounded-[13px] bg-[#edf9f5] px-3 py-2 text-[0.75rem] font-semibold text-[#397c66]">
            {folderExportNotice}
          </div>
        )}

        <div className={`${isCanvasFullscreen
          ? "fixed inset-0 z-[1000] overflow-hidden bg-white"
          : "relative min-h-0 flex-1 overflow-hidden rounded-[24px] border border-white/90 bg-white shadow-[0_12px_38px_rgba(58,64,98,.08)]"
        }`}>
          {!ready ? (
            <PageFeedback title="正在加载本地白板" description="正在恢复白板内容和上次浏览的位置。" />
          ) : (
            <div
              className="whiteboard-canvas absolute inset-0"
              data-active-tool={activeTool}
              data-tool-cursor={lightCanvasCursor ? "true" : undefined}
              style={canvasCursorStyle}
            >
              {lightCanvasCursor && (
                <style>
                  {`.whiteboard-canvas[data-tool-cursor="true"] .native-whiteboard-canvas {
  cursor: var(--whiteboard-tool-cursor-light) !important;
}
html[data-color-scheme="dark"] .whiteboard-canvas[data-tool-cursor="true"] .native-whiteboard-canvas {
  cursor: var(--whiteboard-tool-cursor-dark) !important;
}
.whiteboard-canvas[data-tool-cursor="true"] .native-whiteboard-canvas[data-panning="true"] {
  cursor: grabbing !important;
}`}
                </style>
              )}
              <input
                ref={imageInputRef}
                type="file"
                accept="image/*,video/*,.mkv,.avi"
                multiple
                className="hidden"
                onChange={(event) => {
                  void insertImageFiles(event.currentTarget.files ?? []);
                  event.currentTarget.value = "";
                }}
              />
              <NativeWhiteboard
                store={store}
                onMount={handleMount}
                onImageFiles={insertImageFiles}
                onLocalFiles={insertDroppedLocalItems}
                onImageUrl={insertRemoteImage}
                onWhiteboardFiles={importPortableWhiteboard}
                onResourceOpen={openLibraryItem}
                onLocalPathOpen={openLocalPath}
                onGroupFolderExport={exportGroupFolder}
                onMindMapCreate={point => insertMindMap("mind-right", point)}
                maxAssetSize={MAX_WHITEBOARD_FILE_BYTES}
                color={selectedColor}
                drawColor={drawColor}
                drawSize={drawSize}
                arrowStyle={arrowStyle}
                geoPaintStyle={geoPaintStyle}
                textStyle={textStyle}
              />
              {materialPanelOpen ? (
                <aside
                  aria-label="当前页面素材列表"
                  data-whiteboard-control-surface
                  className="absolute bottom-24 right-3 top-16 z-30 flex w-72 flex-col overflow-hidden rounded-2xl border border-[#e2e4ed] bg-white/95 shadow-[0_14px_36px_rgba(35,39,61,.18)] backdrop-blur"
                >
                  <header className="flex h-9 shrink-0 items-center justify-between px-3">
                    <div className="flex min-w-0 items-center gap-1.5"><b className="truncate text-[0.75rem] leading-none text-[#30364d]">当前页面素材</b><span className="inline-flex h-4 shrink-0 items-center rounded-full bg-[#efedff] px-1.5 text-[0.5625rem] font-bold leading-none text-[#625bc5]">{currentMaterials.length} 项</span></div>
                    <button type="button" aria-label="收起素材列表" onClick={() => setMaterialPanelOpen(false)} className="grid size-7 place-items-center border-0 bg-transparent p-0 text-[#73798b] shadow-none transition hover:text-[#625bc5]"><PanelRightClose size={15}/></button>
                  </header>
                  <div className="border-b border-[#eceef4] px-3 pb-2">
                    <label className="relative block">
                      <Search size={13} aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[#9ba0af]"/>
                      <input aria-label="搜索当前页面素材" value={materialQuery} onChange={(event) => setMaterialQuery(event.target.value)} placeholder="搜索素材名称或路径" className="h-8 w-full rounded-lg border border-[#e1e4ed] bg-[#f8f9fc] pl-8 pr-8 text-[0.6875rem] font-semibold text-[#43495d] outline-none transition placeholder:text-[#a0a5b5] focus:border-[#8881da] focus:bg-white"/>
                      {materialQuery ? <button type="button" aria-label="清除素材搜索" onClick={() => setMaterialQuery("")} className="absolute right-1 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-md text-[#9297a7] hover:bg-[#eceafd] hover:text-[#625bc5]"><X size={12}/></button> : null}
                    </label>
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto p-2">
                    {filteredMaterials.length ? filteredMaterials.map((material) => {
                      const Icon = material.kind === "image" ? ImageIcon : material.kind === "link" ? Link2 : FileIcon;
                      return <article key={material.shapeId} role="button" tabIndex={renamingMaterialId === material.shapeId ? -1 : 0} aria-label={`定位 ${material.name}`} onClick={() => { if (renamingMaterialId !== material.shapeId) locateMaterial(material.shapeId); }} onKeyDown={(event) => { if (renamingMaterialId !== material.shapeId && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); locateMaterial(material.shapeId); } }} className="group mb-1.5 cursor-pointer rounded-xl border border-[#eceef4] bg-[#fafbfe] p-2 transition hover:border-[#d7d3f5] hover:bg-white"><div className="flex items-center gap-1.5">{material.kind === "image" && material.previewUrl ? <img src={material.previewUrl} alt="" aria-hidden="true" className="size-8 shrink-0 rounded-lg border border-[#e0e2ec] bg-white object-cover" /> : <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[#ebeafd] text-[#625bc5]"><Icon size={14}/></span>}{renamingMaterialId === material.shapeId ? <input autoFocus aria-label={`重命名 ${material.name}`} value={materialRenameValue} maxLength={200} onFocus={(event) => event.currentTarget.select()} onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()} onChange={(event) => setMaterialRenameValue(event.target.value)} onBlur={() => commitMaterialRename(material)} onKeyDown={(event) => { event.stopPropagation(); if (event.key === "Enter") { event.preventDefault(); commitMaterialRename(material); } else if (event.key === "Escape") { event.preventDefault(); cancelMaterialRename(); } }} className="h-7 min-w-0 flex-1 rounded-md border border-[#8881da] bg-white px-2 text-[0.6875rem] font-bold text-[#43495d] outline-none ring-2 ring-[#8881da]/15" /> : <span className="min-w-0 flex-1 truncate text-left text-[0.6875rem] font-bold text-[#43495d]" title={`${material.name} · 双击重命名`} onDoubleClick={(event) => { event.stopPropagation(); beginMaterialRename(material); }}>{material.name}</span>}<div className="flex shrink-0 items-center gap-0.5"><button type="button" aria-label={`预览 ${material.name}`} title="预览" disabled={!material.previewUrl || renamingMaterialId === material.shapeId} onClick={(event) => { event.stopPropagation(); setPreviewMaterial(material); }} className="grid size-7 place-items-center rounded-lg text-[#6761bf] hover:bg-[#f5f3ff] disabled:opacity-35"><Eye size={13}/></button><button type="button" aria-label={`打开 ${material.name}`} title="打开" disabled={renamingMaterialId === material.shapeId} onClick={(event) => { event.stopPropagation(); openMaterial(material); }} className="grid size-7 place-items-center rounded-lg text-[#6761bf] hover:bg-[#f5f3ff] disabled:opacity-35"><ExternalLink size={13}/></button></div></div></article>;
                    }) : <div className="grid h-full min-h-32 place-items-center px-4 text-center"><p className="text-[0.6875rem] text-[#979cad]">{currentMaterials.length ? "没有匹配的素材。" : "当前页面暂无图片、链接或资料库文件。"}</p></div>}
                  </div>
                </aside>
              ) : (
                <button type="button" data-whiteboard-control-button aria-label="展开素材列表" title="当前页面素材" onClick={() => setMaterialPanelOpen(true)} className="absolute right-3 top-16 z-30 grid size-9 place-items-center rounded-xl border border-[#e2e4ed] bg-white/95 text-[#625bc5] shadow-sm"><PanelRightOpen size={16}/></button>
              )}
              {pendingFolderExport && (
                <div className="absolute inset-0 z-[72] grid place-items-center bg-[#171b2a]/30 p-6 backdrop-blur-[2px]">
                  <section role="dialog" aria-modal="true" aria-label="保存白板资料夹到资料库" className="w-full max-w-lg rounded-3xl border border-white bg-white p-5 shadow-[0_24px_70px_rgba(30,34,54,.24)]">
                    <header className="moki-dialog-header moki-dialog-header-inset-5 flex items-start justify-between gap-3">
                      <div><h2 className="text-sm font-black text-[#242838]">保存到资料库</h2><p className="mt-1 text-[0.6875rem] leading-5 text-[#858b9c]">将在所选位置创建同名资料夹“{pendingFolderExport.name}”，并保存白板数据、文字、链接和可读取素材。</p></div>
                      <button type="button" aria-label="关闭保存到资料库" onClick={() => { if (!folderExportBusy) setPendingFolderExport(undefined); }} className="grid size-8 shrink-0 place-items-center rounded-xl bg-[#f4f5f8] text-[#555c70]"><X size={15}/></button>
                    </header>
                    <label className="mt-5 grid gap-2 text-xs font-bold text-[#555c70]">保存位置
                      <select aria-label="资料库保存位置" value={folderExportTargetId} onChange={(event) => setFolderExportTargetId(event.target.value)} className="h-11 rounded-xl border border-[#dfe2ec] bg-white px-3 outline-none focus:border-[#625bc5]">
                        <option value="">资料库根目录</option>
                        {libraryItems.filter((item) => item.kind === "folder" || item.kind === "local_folder").map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                      </select>
                    </label>
                    <footer className="mt-5 flex justify-end gap-2"><button type="button" disabled={folderExportBusy} onClick={() => setPendingFolderExport(undefined)} className="rounded-xl bg-[#f4f5f8] px-4 py-2 text-xs font-bold text-[#62687a] disabled:opacity-40">取消</button><button type="button" disabled={folderExportBusy} onClick={() => void savePendingFolderToLibrary()} className="flex items-center gap-1.5 rounded-xl bg-[#242a40] px-4 py-2 text-xs font-bold text-white disabled:opacity-40">{folderExportBusy ? <LoaderCircle size={13} className="animate-spin"/> : <Save size={13}/>}保存</button></footer>
                  </section>
                </div>
              )}
              {previewMaterial?.previewUrl && (
                <div className="absolute inset-0 z-[75] grid min-h-0 place-items-center overflow-hidden bg-[#171b2a]/35 p-4 backdrop-blur-[2px]">
                  <section role="dialog" aria-modal="true" aria-label={`预览 ${previewMaterial.name}`} className="flex min-h-0 min-w-0 flex-col rounded-3xl bg-white p-4 shadow-2xl" style={{ width: "64rem", height: "40rem", maxWidth: "calc(100% - 2rem)", maxHeight: "calc(100% - 2rem)" }}><header className="moki-dialog-header moki-dialog-header-inset-4 mb-3 flex items-center justify-between"><div className="min-w-0"><b className="block truncate text-[0.8125rem] text-[#30364d]">{previewMaterial.name}</b>{previewMaterial.kind === "link" ? <span className="text-[0.625rem] font-semibold text-[#8d6b2d]">网页交互保留在工作台内，弹窗不会调用系统浏览器</span> : null}</div><div className="flex gap-2">{previewMaterial.kind !== "link" ? <button type="button" onClick={() => openMaterial(previewMaterial)} className="flex items-center gap-1 rounded-xl bg-[#242a40] px-3 py-2 text-[0.6875rem] font-bold text-white"><ExternalLink size={12}/>打开</button> : null}<button type="button" aria-label="关闭素材预览" title="关闭预览" onClick={() => setPreviewMaterial(undefined)} className="grid size-8 place-items-center rounded-xl bg-[#f4f5f8] text-[#555c70] hover:bg-[#ebeafd] hover:text-[#242838]"><X size={15}/></button></div></header><div className="min-h-0 flex-1 overflow-hidden rounded-2xl border border-[#e4e6ef] bg-[#f5f6fa]">{previewMaterial.kind === "image" ? <img src={previewMaterial.previewUrl} alt={previewMaterial.name} className="size-full object-contain"/> : previewMaterial.kind === "media" ? (previewMaterial.mediaKind === "audio" ? <audio src={previewMaterial.previewUrl} controls autoPlay className="h-full w-full px-8"/> : <video src={previewMaterial.previewUrl} controls autoPlay className="size-full bg-[#171b2a] object-contain"/>) : <iframe src={previewMaterial.previewUrl} title={previewMaterial.name} sandbox={previewMaterial.kind === "link" ? "allow-forms allow-same-origin allow-scripts" : undefined} className="size-full border-0"/>}</div></section>
                </div>
              )}
              {linkDialogOpen && (
                <div className="absolute inset-0 z-[70] grid place-items-center bg-[#171b2a]/25 p-6 backdrop-blur-[2px]">
                  <form
                    aria-label="插入白板链接"
                    className="w-full max-w-md rounded-3xl border border-white bg-white p-5 shadow-[0_24px_70px_rgba(30,34,54,.24)]"
                    onSubmit={(event) => {
                      event.preventDefault();
                      insertLink();
                    }}
                  >
                    <div className="mb-4 flex items-start gap-3">
                      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#ebeafd] text-[#625bc5]"><Link2 size={18} /></span>
                      <div>
                        <h2 className="text-sm font-black text-[#242838]">插入网页链接</h2>
                        <p className="mt-0.5 text-[0.6875rem] text-[#858b9c]">可保存为链接卡片，或直接嵌入网页进行预览与操作。</p>
                      </div>
                    </div>
                    <label className="grid gap-1.5 text-xs font-bold text-[#555c70]">
                      链接地址
                      <input
                        autoFocus
                        aria-label="链接地址"
                        value={linkUrl}
                        onChange={(event) => {
                          linkUrlRef.current = event.target.value;
                          setLinkUrl(event.target.value);
                          setLinkError("");
                        }}
                        onBlur={() => {
                          if (linkTitle.trim()) return;
                          const requestedUrl = normalizeWhiteboardLinkUrl(linkUrl);
                          if (!requestedUrl) return;
                          void fetchWhiteboardLinkMetadata(requestedUrl).then((metadata) => {
                            if (metadata && normalizeWhiteboardLinkUrl(linkUrlRef.current) === requestedUrl) {
                              setLinkTitle((current) => current || metadata.title);
                            }
                          });
                        }}
                        placeholder="https://example.com"
                        className="h-10 rounded-xl border border-[#dfe2ec] bg-[#f8f9fc] px-3 text-[#242838] outline-none focus:border-[#625bc5]"
                      />
                    </label>
                    <label className="mt-3 grid gap-1.5 text-xs font-bold text-[#555c70]">
                      显示标题（可选）
                      <input
                        aria-label="链接标题"
                        value={linkTitle}
                        onChange={(event) => setLinkTitle(event.target.value)}
                        placeholder="未填写时自动获取网页标题"
                        className="h-10 rounded-xl border border-[#dfe2ec] bg-[#f8f9fc] px-3 text-[#242838] outline-none focus:border-[#625bc5]"
                      />
                    </label>
                    <fieldset className="mt-4">
                      <legend className="mb-1.5 text-xs font-bold text-[#555c70]">展示模式</legend>
                      <div className="grid grid-cols-2 gap-2 rounded-xl bg-[#f4f5f8] p-1">
                        <button
                          type="button"
                          aria-pressed={linkMode === "link"}
                          onClick={() => setLinkMode("link")}
                          className={`rounded-lg px-3 py-2 text-xs font-bold ${linkMode === "link" ? "bg-white text-[#625bc5] shadow-sm" : "text-[#73798b]"}`}
                        >
                          链接卡片
                        </button>
                        <button
                          type="button"
                          aria-pressed={linkMode === "preview"}
                          onClick={() => setLinkMode("preview")}
                          className={`rounded-lg px-3 py-2 text-xs font-bold ${linkMode === "preview" ? "bg-white text-[#625bc5] shadow-sm" : "text-[#73798b]"}`}
                        >
                          网页预览
                        </button>
                      </div>
                    </fieldset>
                    {linkError && <p role="alert" className="mt-3 text-xs font-semibold text-[#bd4668]">{linkError}</p>}
                    <div className="mt-5 flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setLinkDialogOpen(false);
                          setLinkError("");
                        }}
                        className="rounded-xl bg-[#f2f3f7] px-4 py-2 text-xs font-bold text-[#62687a]"
                      >
                        取消
                      </button>
                      <button type="submit" className="rounded-xl bg-[#242a40] px-4 py-2 text-xs font-bold text-white">
                        插入链接
                      </button>
                    </div>
                  </form>
                </div>
              )}
              <div className="absolute bottom-3 right-3 z-40">
                <button
                  type="button"
                  data-whiteboard-control-button
                  aria-label="白板快捷键"
                  title="查看白板快捷键"
                  aria-expanded={shortcutsOpen}
                  onClick={() => {
                    setShortcutsOpen((value) => !value);
                    setExportMenuOpen(false);
                    setShapeMenuOpen(false);
                                  }}
                  className="grid size-9 place-items-center rounded-xl border border-[#e2e4ed] bg-white/95 text-[#30364d] shadow-sm transition hover:bg-[#f0efff]"
                >
                  <Keyboard size={16} />
                </button>
                {shortcutsOpen && (
                  <section
                    aria-label="白板快捷键列表"
                    className="moki-menu-surface absolute bottom-11 right-0 max-h-[min(32rem,calc(100dvh-14rem))] w-72 overflow-y-auto p-3"
                  >
                    <div className="mb-2.5">
                      <p className="text-xs font-black text-[#30364d]">白板快捷键</p>
                      <p className="mt-0.5 text-[0.625rem] text-[#8b90a1]">
                        在文字输入时不会触发画布快捷键
                      </p>
                    </div>
                    <div className="grid gap-1.5">
                      {WHITEBOARD_SHORTCUTS.map((shortcut) => (
                        <div
                          key={shortcut.label}
                          className="flex items-center justify-between gap-3 rounded-lg bg-[#f6f7fa] px-2.5 py-1.5"
                        >
                          <span className="text-[0.6875rem] font-semibold text-[#555c70]">
                            {shortcut.label}
                          </span>
                          <kbd className="shrink-0 rounded-md border border-[#dde0e9] bg-white px-1.5 py-0.5 text-[0.625rem] font-bold text-[#4e5570] shadow-sm">
                            {shortcut.keys}
                          </kbd>
                        </div>
                      ))}
                    </div>
                  </section>
                )}
              </div>
              <div className="absolute right-14 top-3 z-40">
                <button
                  type="button"
                  data-whiteboard-control-button
                  aria-label="导出白板图片"
                  title="导出为 PNG 图片"
                  aria-expanded={exportMenuOpen}
                  onClick={() => {
                    setExportMenuOpen((value) => !value);
                    setShortcutsOpen(false);
                    setShapeMenuOpen(false);
                                  }}
                  className="grid size-9 place-items-center rounded-xl border border-[#e2e4ed] bg-white/95 text-[#30364d] shadow-sm transition hover:bg-[#f0efff]"
                >
                  {exporting ? <LoaderCircle size={16} className="animate-spin" /> : <Download size={16} />}
                </button>
                {exportMenuOpen && (
                  <div className="moki-menu-surface absolute right-0 top-11 w-60 p-3 text-xs text-[#30364d]">
                    <p className="font-black">导出白板图片</p>
                    <label className="mt-3 grid gap-1 font-bold text-[#62687a]">
                      延展边缘边距（像素）
                      <input
                        type="number"
                        min={0}
                        max={1000}
                        step={1}
                        value={exportPadding}
                        onChange={(event) => setExportPadding(Math.min(1000, Math.max(0, Number(event.target.value) || 0)))}
                        className="h-9 rounded-xl border border-[#dfe2ec] bg-[#f8f9fc] px-3 text-[#242838] outline-none focus:border-[#625bc5]"
                      />
                    </label>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        disabled={exporting}
                        onClick={() => exportCurrentWhiteboard("selection")}
                        className="rounded-xl border border-[#dddff0] px-2 py-2 font-bold transition hover:bg-[#f0efff] disabled:opacity-50"
                      >
                        导出选中内容
                      </button>
                      <button
                        type="button"
                        disabled={exporting}
                        onClick={() => exportCurrentWhiteboard("canvas")}
                        className="rounded-xl bg-[#242a40] px-2 py-2 font-bold text-white transition hover:bg-[#30364d] disabled:opacity-50"
                      >
                        导出整个画布
                      </button>
                    </div>
                  </div>
                )}
            </div>
            <button
                type="button"
                data-whiteboard-control-button
                aria-label={isCanvasFullscreen ? "退出画布全屏" : "画布全屏"}
                title={isCanvasFullscreen ? "退出全屏（Esc）" : "画布全屏"}
                aria-pressed={isCanvasFullscreen}
                onClick={() => setIsCanvasFullscreen((value) => !value)}
                className="absolute right-3 top-3 z-30 grid size-9 place-items-center rounded-xl border border-[#e2e4ed] bg-white/95 text-[#30364d] shadow-sm transition hover:bg-[#f0efff]"
              >
                {isCanvasFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
              </button>
              <div
                data-whiteboard-toolbox
                data-whiteboard-control-surface
                className="pointer-events-auto absolute bottom-6 left-1/2 z-30 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center justify-center gap-1 overflow-visible rounded-2xl border border-[#e2e4ed] bg-white/95 p-1.5 text-[#30364d] shadow-[0_12px_32px_rgba(23,27,44,.14)] backdrop-blur"
                onPointerDown={(event) => {
                  event.stopPropagation();
                  if ((event.target as HTMLElement).closest('input[type="range"]')) return;
                  event.preventDefault();
                }}
                onClick={(event) => event.stopPropagation()}
              >
                <button
                  type="button"
                  aria-label="选择"
                  title="选择"
                  aria-pressed={activeTool === "select"}
                  onClick={() => setCanvasTool("select")}
                  className={toolButtonClass("select")}
                >
                  <MousePointer2 size={16} />
                </button>
                <button
                  type="button"
                  aria-label="拖动画布"
                  title="拖动画布"
                  aria-pressed={activeTool === "hand"}
                  onClick={() => setCanvasTool("hand")}
                  className={toolButtonClass("hand")}
                >
                  <Hand size={16} />
                </button>
                <button
                  type="button"
                  aria-label="橡皮"
                  title="橡皮"
                  aria-pressed={activeTool === "eraser"}
                  onClick={() => setCanvasTool("eraser")}
                  className={toolButtonClass("eraser")}
                >
                  <Eraser size={16} />
                </button>
                <div className="relative shrink-0">
                  <button
                    type="button"
                    aria-label="箭头"
                    title="箭头与连线"
                    aria-pressed={activeTool === "arrow"}
                    aria-expanded={arrowMenuOpen}
                    onClick={() => {
                      const nextOpen = !(activeTool === "arrow" && arrowMenuOpen);
                      setCanvasTool("arrow");
                      setArrowMenuOpen(nextOpen);
                    }}
                    className={toolButtonClass("arrow")}
                  >
                    <ArrowUpRight size={16} />
                  </button>
                  {activeTool === "arrow" && arrowMenuOpen && (
                    <div
                      role="menu"
                      aria-label="箭头样式"
                      data-outside-dismiss="pass-through"
                      className="moki-menu-surface absolute bottom-full left-1/2 z-40 mb-2 w-44 -translate-x-1/2 p-2"
                      onMouseDown={(event) => {
                        if ((event.target as HTMLElement).closest('input[type="range"]')) return;
                        event.preventDefault();
                      }}
                    >
                      <p className="mb-1.5 px-1 text-[0.625rem] font-bold text-[#9297a7]">箭头样式</p>
                      {([
                        ["single", "单向箭头", "→"],
                        ["double", "双向箭头", "↔"],
                        ["line", "直线", "─"],
                        ["dashed", "虚线箭头", "⇢"],
                      ] as const).map(([style, label, preview]) => (
                        <button
                          type="button"
                          role="menuitemradio"
                          aria-checked={arrowStyle === style}
                          aria-label={`箭头样式 ${label}`}
                          key={style}
                          onClick={() => applyArrowStyle(style)}
                          className={`native-whiteboard-edit-control flex h-9 w-full items-center gap-3 rounded-xl px-2 text-left text-xs font-bold transition ${arrowStyle === style ? "bg-[#ebeafd] text-[#625bc5]" : "text-[#555b70] hover:bg-[#f5f5fa]"}`}
                        >
                          <span aria-hidden="true" className="w-10 text-center text-xl leading-none">{preview}</span>
                          <span>{label}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="relative flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    aria-label="钢笔"
                    title="钢笔：点击添加锚点，拖拽调整曲线；双击或 Enter 完成，点击起点闭合"
                    aria-pressed={activeTool === "pen"}
                    aria-expanded={activeTool === "pen" && drawMenuOpen}
                    onClick={() => {
                      const nextOpen = !(activeTool === "pen" && drawMenuOpen);
                      setCanvasTool("pen");
                      setDrawMenuOpen(nextOpen);
                    }}
                    className={toolButtonClass("pen")}
                  >
                    <PenTool size={16} />
                  </button>
                  <button
                    type="button"
                    aria-label="画笔"
                    title="自由绘制"
                    aria-pressed={activeTool === "draw"}
                    aria-expanded={drawMenuOpen}
                    onClick={() => {
                      const nextOpen = !(activeTool === "draw" && drawMenuOpen);
                      setCanvasTool("draw");
                      setDrawMenuOpen(nextOpen);
                    }}
                    className={toolButtonClass("draw")}
                  >
                    <PencilLine size={16} />
                  </button>
                  {(activeTool === "draw" || activeTool === "pen") && drawMenuOpen && (
                    <div
                      aria-label="画笔粗细"
                      data-outside-dismiss="false"
                      className="moki-menu-surface absolute bottom-full left-1/2 z-40 mb-2 w-52 -translate-x-1/2 p-2"
                      onMouseDown={(event) => {
                        if ((event.target as HTMLElement).closest('input[type="range"]')) return;
                        event.preventDefault();
                      }}
                    >
                      <p className="mb-2 px-1 text-[0.625rem] font-bold text-[#9297a7]">笔画粗细</p>
                      <div className="grid grid-cols-4 gap-1 rounded-xl bg-[#f4f5f8] p-1">
                        {([
                          ["s", "细"],
                          ["m", "中"],
                          ["l", "粗"],
                          ["xl", "特粗"],
                        ] as const).map(([size, label]) => (
                          <button
                            type="button"
                            key={size}
                            aria-label={`画笔粗细 ${label}`}
                            aria-pressed={drawSize === size}
                            onClick={() => applyDrawSize(size)}
                            className={`native-whiteboard-edit-control grid h-9 place-items-center rounded-lg transition ${drawSize === size ? "bg-white text-[#625bc5] shadow-sm" : "text-[#73798b] hover:text-[#30364d]"}`}
                          >
                            <span
                              className="block rounded-full bg-current"
                              style={{ width: 22, height: { s: 2, m: 3, l: 5, xl: 8 }[size] }}
                            />
                            <span className="sr-only">{label}</span>
                          </button>
                        ))}
                      </div>
                      <div className="mb-2 mt-3 flex items-center gap-1.5 px-1 text-[0.625rem] font-bold text-[#9297a7]">
                        <Palette size={12} />
                        <span>画笔颜色</span>
                      </div>
                      <div aria-label="画笔颜色" className="grid grid-cols-6 gap-1">
                        {NATIVE_COLOR_OPTIONS.map((option) => (
                          <button
                            type="button"
                            key={option.value}
                            aria-label={`画笔颜色 ${option.label}`}
                            aria-pressed={drawColor === option.value}
                            title={option.label}
                            onClick={() => applyDrawColor(option.value)}
                            className={`native-whiteboard-color-swatch size-6 min-h-0 min-w-6 shrink-0 rounded-full border border-black/5 p-0 ${drawColor === option.value ? "ring-2 ring-[#625bc5] ring-offset-1" : ""}`}
                            style={{
                              backgroundColor: option.hex,
                              borderRadius: "50%",
                              width: 24,
                              minWidth: 24,
                              height: 24,
                              minHeight: 24,
                              padding: 0,
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <span className="mx-1 h-6 w-px shrink-0 bg-[#e2e4ed]" />
                <div className="relative shrink-0">
                  <button
                    type="button"
                    aria-label="文字"
                    title="点击画布输入文字"
                    aria-pressed={activeTool === "text"}
                    onClick={() => setCanvasTool("text")}
                    className={toolButtonClass("text")}
                  >
                    <Type size={16} />
                  </button>
                </div>
                <button
                  type="button"
                  aria-label="便签"
                  title="添加便签"
                  onClick={() => insertScaledShape("note")}
                  className={actionButtonClass}
                >
                  <StickyNote size={16} />
                </button>
                <div className="relative shrink-0">
                  <button
                    type="button"
                    aria-label="插入思维导图"
                    title="选择思维导图模板"
                    aria-expanded={mindMapMenuOpen}
                    onClick={() => {
                      editorRef.current?.setCurrentTool("select");
                      setActiveTool("select");
                      setShapeMenuOpen(false);
                      setArrowMenuOpen(false);
                                        setMindMapMenuOpen((value) => !value);
                    }}
                    className={`${actionButtonClass} ${mindMapMenuOpen ? "bg-[#ebeafd] text-[#625bc5]" : ""}`}
                  >
                    <BrainCircuit size={16} />
                  </button>
                  {mindMapMenuOpen ? (
                    <div
                      role="menu"
                      aria-label="思维导图模板"
                      className="moki-menu-surface absolute bottom-full left-1/2 z-50 mb-2 max-h-[30rem] w-[24rem] -translate-x-1/2 overflow-y-auto p-3"
                      onPointerDown={(event) => event.stopPropagation()}
                    >
                      <div className="mb-3 flex items-center justify-between gap-3 px-1">
                        <span>
                          <b className="block text-xs text-[#34394d]">从模板创建</b>
                          <small className="mt-0.5 block text-[0.625rem] font-semibold text-[#9297a7]">创建后可无限添加、拖动改层级并收起分支</small>
                        </span>
                        <button type="button" aria-label="关闭思维导图模板" onClick={() => setMindMapMenuOpen(false)} className="grid size-7 place-items-center rounded-lg text-[#7a8092] hover:bg-[#f2f3f7]"><X size={14}/></button>
                      </div>
                      <div className="space-y-3">
                        {MIND_MAP_TEMPLATE_GROUPS.map((group) => (
                          <section key={group.label} aria-label={group.label}>
                            <h4 className="mb-1.5 px-1 text-[0.6875rem] font-black text-[#565c70]">{group.label}</h4>
                            <div className="grid grid-cols-3 gap-2">
                              {group.options.map((option) => (
                                <button
                                  type="button"
                                  role="menuitem"
                                  key={option.id}
                                  aria-label={`使用${option.label}模板`}
                                  title={option.description}
                                  onClick={() => insertMindMap(option.id)}
                                  className="native-whiteboard-menu-card group flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-xl border border-[#dfe2eb] bg-white px-2 py-2 text-center text-[#3b4154] transition hover:border-[#aca7e6] hover:bg-[#f5f3ff] hover:text-[#5b54b5]"
                                >
                                  <MindMapTemplateIcon type={option.icon}/>
                                  <span className="text-[0.6875rem] font-bold">{option.label}</span>
                                </button>
                              ))}
                            </div>
                          </section>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
                <div className="relative shrink-0">
                  <button
                    type="button"
                    aria-label="形状"
                    title="形状"
                    aria-pressed={activeTool === "geo"}
                    aria-expanded={shapeMenuOpen}
                    onClick={() => {
                      const editor = editorRef.current;
                      if (editor) {
                        editor.setStyleForNextShapes(
                          NativeGeoShapeStyle,
                          selectedGeo,
                        );
                        editor.updateInstanceState({
                          isToolLocked: true,
                        });
                        editor.setCurrentTool("geo");
                      }
                      setActiveTool("geo");
                      setDrawMenuOpen(false);
                      setShapeMenuOpen((value) => !value);
                    }}
                    className={toolButtonClass("geo")}
                  >
                    <Square size={16} />
                  </button>
                  {shapeMenuOpen && (
                    <div role="menu" aria-label="形状选择" data-outside-dismiss="pass-through" className="moki-menu-surface absolute bottom-full left-1/2 z-40 mb-2 w-60 -translate-x-1/2 p-2">
                      <div className="grid grid-cols-3 gap-1.5">
                        {SHAPE_OPTIONS.map((option) => (
                          <button
                            type="button"
                            role="menuitemradio"
                            aria-checked={selectedGeo === option.geo}
                            key={option.geo}
                            aria-label={option.label}
                            title={option.label}
                            onClick={() => setShapeTool(option.geo)}
                            className={`native-whiteboard-edit-control flex h-10 min-w-0 items-center gap-1.5 rounded-xl px-2 text-left text-[0.6875rem] font-bold transition ${
                              selectedGeo === option.geo
                                ? "bg-[#ebeafd] text-[#625bc5]"
                                : "hover:bg-[#f4f5f8]"
                            }`}
                          >
                            <ShapeOptionIcon geo={option.geo} />
                            <span className="truncate">{option.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  aria-label="图片或 GIF"
                  title="插入图片或 GIF（I），也可 Ctrl/⌘+V 粘贴"
                  onClick={() => imageInputRef.current?.click()}
                  className={actionButtonClass}
                >
                  <ImageIcon size={16} />
                </button>
                <div className="relative">
                  <button
                    type="button"
                    aria-label="添加文件"
                    title="添加本地文件或文件夹"
                    aria-expanded={fileInsertMenuOpen}
                    onClick={() => setFileInsertMenuOpen((value) => !value)}
                    className={actionButtonClass}
                  >
                    <FileIcon size={16} />
                  </button>
                  {fileInsertMenuOpen ? (
                    <div role="menu" aria-label="选择本地文件或文件夹" data-outside-dismiss="pass-through" className="moki-menu-surface absolute bottom-full left-1/2 z-40 mb-2 w-44 -translate-x-1/2 p-2">
                      <button type="button" role="menuitem" onClick={() => void importLocalMaterial(false)} className="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left text-[0.6875rem] font-bold text-[#43495d] hover:bg-[#f2f1ff]"><FileIcon size={14}/>选择本地文件</button>
                      <button type="button" role="menuitem" onClick={() => void importLocalMaterial(true)} className="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left text-[0.6875rem] font-bold text-[#43495d] hover:bg-[#f2f1ff]"><Folder size={14}/>选择本地文件夹</button>
                    </div>
                  ) : null}
                </div>
                <button
                  type="button"
                  aria-label="链接"
                  title="插入网页链接"
                  onClick={() => {
                    setLinkDialogOpen(true);
                    setLinkError("");
                    setShapeMenuOpen(false);
                                  }}
                  className={actionButtonClass}
                >
                  <Link2 size={16} />
                </button>
                <span className="mx-1 h-6 w-px shrink-0 bg-[#e2e4ed]" />
                <button
                  type="button"
                  aria-label="对齐工具"
                  title={alignmentToolsOpen ? "收起对齐工具" : "展开对齐工具"}
                  aria-expanded={alignmentToolsOpen}
                  onClick={() => setAlignmentToolsOpen(value => !value)}
                  className={`${actionButtonClass} ${alignmentToolsOpen ? "bg-[#ebeafd] text-[#625bc5]" : ""}`}
                >
                  <AlignCenterHorizontal size={16}/>
                </button>
                {alignmentToolsOpen ? <>
                <button
                  type="button"
                  aria-label="左对齐"
                  title="左对齐"
                  onClick={() => alignSelectedShapes("left")}
                  className={actionButtonClass}
                >
                  <AlignStartVertical size={16} />
                </button>
                <button
                  type="button"
                  aria-label="水平居中"
                  title="水平居中"
                  onClick={() => alignSelectedShapes("center-x")}
                  className={actionButtonClass}
                >
                  <AlignCenterVertical size={16} />
                </button>
                <button
                  type="button"
                  aria-label="右对齐"
                  title="右对齐"
                  onClick={() => alignSelectedShapes("right")}
                  className={actionButtonClass}
                >
                  <AlignEndVertical size={16} />
                </button>
                <button
                  type="button"
                  aria-label="顶部对齐"
                  title="顶部对齐"
                  onClick={() => alignSelectedShapes("top")}
                  className={actionButtonClass}
                >
                  <AlignStartHorizontal size={16} />
                </button>
                <button
                  type="button"
                  aria-label="垂直居中"
                  title="垂直居中"
                  onClick={() => alignSelectedShapes("center-y")}
                  className={actionButtonClass}
                >
                  <AlignCenterHorizontal size={16} />
                </button>
                <button
                  type="button"
                  aria-label="底部对齐"
                  title="底部对齐"
                  onClick={() => alignSelectedShapes("bottom")}
                  className={actionButtonClass}
                >
                  <AlignEndHorizontal size={16} />
                </button>
                </> : null}
              </div>
            </div>
          )}

          {historyOpen && (
            <aside
              aria-label="白板版本记录"
              data-whiteboard-control-surface
              className="absolute bottom-3 right-3 top-3 z-50 w-[250px] overflow-auto rounded-[18px] border border-[#e2e4ed] bg-white/95 p-3 shadow-[0_18px_46px_rgba(23,27,44,.18)] backdrop-blur"
            >
              <header className="mb-3">
                <h2 className="text-[0.75rem] font-black">
                  {activePage?.pageName ?? "当前页面"} · 版本记录
                </h2>
                <p className="text-[0.625rem] text-[#9297a7]">
                  每个页面独立保存，最多保留最近 20 个版本
                </p>
              </header>
              <div className="space-y-1.5">
                {versions.map((version) => (
                  <button
                    type="button"
                    key={version.version}
                    onClick={() => void loadVersion(version.version)}
                    className="flex w-full items-center justify-between rounded-xl bg-[#f4f5f8] px-3 py-2 text-left transition hover:bg-[#ebeafd]"
                  >
                    <span>
                      <b className="block text-[0.6875rem]">
                        版本 {version.pageVersion ?? version.version}
                      </b>
                      <small className="text-[0.625rem] text-[#9297a7]">
                        {new Intl.DateTimeFormat("zh-CN", {
                          timeZone: "Asia/Shanghai",
                          month: "numeric",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                          hour12: false,
                        }).format(new Date(version.createdAt))}
                      </small>
                    </span>
                    <span className="text-[0.625rem] font-bold text-[#625bc5]">
                      恢复
                    </span>
                  </button>
                ))}
                {versions.length === 0 && (
                  <p className="py-8 text-center text-[0.6875rem] text-[#9297a7]">
                    保存后将显示版本记录
                  </p>
                )}
              </div>
            </aside>
          )}
        </div>
      </div>
  );
  return embedded ? content : <AppShell hideMainScrollbar fitMainContent>{content}</AppShell>;
}
