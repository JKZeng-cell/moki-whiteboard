export const WORKBENCH_SELECTION_STORAGE_KEY = "moki.current-workbench-selection";
export const WORKBENCH_SELECTION_EVENT = "workbench:selection-context-changed";
export const MOKI_ASSISTANT_COMPOSE_STORAGE_KEY = "moki.pending-assistant-compose";
export const MOKI_ASSISTANT_COMPOSE_EVENT = "moki:assistant-compose-request";
export const MOKI_ASSISTANT_EDITOR_EXIT_EVENT = "moki:assistant-editor-exit";
export const NATIVE_WHITEBOARD_CLIPBOARD_TYPE =
  "application/x-moki-whiteboard-elements+json";
export const NATIVE_WHITEBOARD_CLIPBOARD_TEXT_PREFIX =
  "MOKI_WHITEBOARD_ELEMENTS_V1:";

export type MokiAssistantComposeRequest = {
  prompt: string;
  capturedAt: string;
  anchor?: { x: number; y: number };
  emptyComposer?: boolean;
  editorAssist?: boolean;
};

export type WorkbenchSelectionContext = {
  source: "whiteboard" | "library" | "browser";
  label: string;
  content: string;
  itemCount: number;
  capturedAt: string;
};

export const MAX_VISUAL_ANNOTATIONS = 6;

export type VisualAnnotationAttachment = {
  id: string;
  name: string;
  imageSource: string;
  mediaType: string;
  size: number;
  width?: number;
  height?: number;
};

export type VisualAnnotationEditorLocation = {
  mode: "preview" | "text_editor" | "office_editor";
  contentKind: string;
  extension?: string;
  pageNumber?: number;
  sheetIndex?: number;
  sheetName?: string;
  sessionId?: string;
  worktreeId?: string;
  unitId?: string;
  unitKind?: string;
  focus?: Record<string, string | number | boolean | null>;
};

export type VisualAnnotationLocation = {
  coordinateSpace: "visible_surface";
  positionLabel: string;
  selectedPercent: { left: number; top: number; width: number; height: number };
  contextPercent: { left: number; top: number; width: number; height: number };
  editor?: VisualAnnotationEditorLocation;
};

export type VisualAnnotationItem = {
  id: string;
  source: "browser" | "library" | "whiteboard";
  sourceId: string;
  sourceTitle: string;
  annotation: string;
  rect: { x: number; y: number; width: number; height: number };
  contextRect?: { x: number; y: number; width: number; height: number };
  surface: { width: number; height: number };
  location?: VisualAnnotationLocation;
  visualAttachment: VisualAnnotationAttachment;
  capturedAt: string;
  file?: { id: string; name: string; kind: string };
  page?: { title: string; url: string; tabId: string };
  whiteboard?: { pageId: string; pageName: string; camera: { x: number; y: number; zoom: number }; bounds: { x: number; y: number; width: number; height: number } };
};

export function isWorkbenchSelectionContext(value: unknown): value is WorkbenchSelectionContext {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<WorkbenchSelectionContext>;
  return (
    (candidate.source === "whiteboard" || candidate.source === "library" || candidate.source === "browser") &&
    typeof candidate.label === "string" &&
    typeof candidate.content === "string" &&
    typeof candidate.itemCount === "number" &&
    typeof candidate.capturedAt === "string"
  );
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function validVisualAnnotation(value: unknown): value is VisualAnnotationItem {
  const item = record(value);
  const rect = record(item?.rect);
  const surface = record(item?.surface);
  const attachment = record(item?.visualAttachment);
  const contextRect = record(item?.contextRect);
  const location = record(item?.location);
  const selectedPercent = record(location?.selectedPercent);
  const contextPercent = record(location?.contextPercent);
  const whiteboard = record(item?.whiteboard);
  const camera = record(whiteboard?.camera);
  const bounds = record(whiteboard?.bounds);
  const validPercentRect = (candidate: Record<string, unknown> | undefined) => Boolean(
    candidate && [candidate.left, candidate.top, candidate.width, candidate.height].every(
      (entry) => typeof entry === "number" && Number.isFinite(entry),
    ),
  );
  return Boolean(
    item &&
    typeof item.id === "string" && item.id &&
    (item.source === "browser" || item.source === "library" || item.source === "whiteboard") &&
    (item.source !== "whiteboard" || (whiteboard && typeof whiteboard.pageId === "string" && whiteboard.pageId && typeof whiteboard.pageName === "string" && camera && bounds && [camera.x, camera.y, camera.zoom, bounds.x, bounds.y, bounds.width, bounds.height].every(value => typeof value === "number" && Number.isFinite(value)) && Number(camera.zoom) > 0)) &&
    typeof item.sourceId === "string" && item.sourceId &&
    typeof item.sourceTitle === "string" && item.sourceTitle &&
    typeof item.annotation === "string" &&
    rect && [rect.x, rect.y, rect.width, rect.height].every(
      (entry) => typeof entry === "number" && Number.isFinite(entry),
    ) &&
    (!contextRect || [contextRect.x, contextRect.y, contextRect.width, contextRect.height].every(
      (entry) => typeof entry === "number" && Number.isFinite(entry),
    )) &&
    surface && [surface.width, surface.height].every(
      (entry) => typeof entry === "number" && Number.isFinite(entry),
    ) &&
    Number(surface.width) > 0 && Number(surface.height) > 0 &&
    attachment &&
    typeof attachment.id === "string" && attachment.id &&
    typeof attachment.name === "string" && attachment.name &&
    typeof attachment.imageSource === "string" && attachment.imageSource &&
    typeof attachment.mediaType === "string" && attachment.mediaType.startsWith("image/") &&
    typeof attachment.size === "number" && attachment.size > 0 &&
    (!location || (
      location.coordinateSpace === "visible_surface" &&
      typeof location.positionLabel === "string" &&
      validPercentRect(selectedPercent) &&
      validPercentRect(contextPercent)
    )) &&
    typeof item.capturedAt === "string"
  );
}

function roundedPercent(value: number, total: number): number {
  return Math.round(Math.max(0, Math.min(100, value / Math.max(1, total) * 100)) * 10) / 10;
}

export function visualAnnotationLocation(
  rect: VisualAnnotationItem["rect"],
  contextRect: NonNullable<VisualAnnotationItem["contextRect"]>,
  surface: VisualAnnotationItem["surface"],
  editor?: VisualAnnotationEditorLocation,
): VisualAnnotationLocation {
  const centerX = (rect.x + rect.width / 2) / Math.max(1, surface.width);
  const centerY = (rect.y + rect.height / 2) / Math.max(1, surface.height);
  const horizontal = centerX < 1 / 3 ? "左侧" : centerX > 2 / 3 ? "右侧" : "中央";
  const vertical = centerY < 1 / 3 ? "上方" : centerY > 2 / 3 ? "下方" : "中部";
  const percentRect = (value: VisualAnnotationItem["rect"]) => ({
    left: roundedPercent(value.x, surface.width),
    top: roundedPercent(value.y, surface.height),
    width: roundedPercent(value.width, surface.width),
    height: roundedPercent(value.height, surface.height),
  });
  return {
    coordinateSpace: "visible_surface",
    positionLabel: `当前可见画面${vertical}${horizontal}`,
    selectedPercent: percentRect(rect),
    contextPercent: percentRect(contextRect),
    ...(editor ? { editor } : {}),
  };
}

export function visualAnnotationsFromSelection(
  selection: WorkbenchSelectionContext | undefined,
): VisualAnnotationItem[] {
  if (!selection) return [];
  try {
    const payload = JSON.parse(selection.content) as Record<string, unknown>;
    if (payload.kind === "visual_annotation_collection" && Array.isArray(payload.items)) {
      return payload.items.filter(validVisualAnnotation).slice(0, MAX_VISUAL_ANNOTATIONS);
    }
  } catch {
    return [];
  }
  return [];
}

export function visualAnnotationSelection(
  items: VisualAnnotationItem[],
): WorkbenchSelectionContext | undefined {
  const normalized = items.filter(validVisualAnnotation).slice(0, MAX_VISUAL_ANNOTATIONS).map((item) => ({
    ...item,
    id: item.id.slice(0, 200),
    sourceId: item.sourceId.slice(0, 200),
    sourceTitle: item.sourceTitle.slice(0, 200),
    annotation: item.annotation.slice(0, 2_000),
    ...(item.whiteboard ? { whiteboard: { ...item.whiteboard, pageId: item.whiteboard.pageId.slice(0, 200), pageName: item.whiteboard.pageName.slice(0, 200) } } : {}),
    ...(item.contextRect ? { contextRect: item.contextRect } : {}),
    ...(item.location ? {
      location: {
        ...item.location,
        positionLabel: item.location.positionLabel.slice(0, 120),
        ...(item.location.editor ? {
          editor: {
            ...item.location.editor,
            contentKind: item.location.editor.contentKind.slice(0, 100),
            ...(item.location.editor.extension ? { extension: item.location.editor.extension.slice(0, 20) } : {}),
            ...(item.location.editor.sheetName ? { sheetName: item.location.editor.sheetName.slice(0, 200) } : {}),
            ...(item.location.editor.sessionId ? { sessionId: item.location.editor.sessionId.slice(0, 200) } : {}),
            ...(item.location.editor.worktreeId ? { worktreeId: item.location.editor.worktreeId.slice(0, 200) } : {}),
            ...(item.location.editor.unitId ? { unitId: item.location.editor.unitId.slice(0, 200) } : {}),
            ...(item.location.editor.unitKind ? { unitKind: item.location.editor.unitKind.slice(0, 100) } : {}),
          },
        } : {}),
      },
    } : {}),
    visualAttachment: {
      ...item.visualAttachment,
      id: item.visualAttachment.id.slice(0, 200),
      name: item.visualAttachment.name.slice(0, 200),
      imageSource: item.visualAttachment.imageSource.slice(0, 1_000),
      mediaType: item.visualAttachment.mediaType.slice(0, 100),
    },
    ...(item.file ? {
      file: {
        id: item.file.id.slice(0, 200),
        name: item.file.name.slice(0, 200),
        kind: item.file.kind.slice(0, 100),
      },
    } : {}),
    ...(item.page ? {
      page: {
        title: item.page.title.slice(0, 200),
        url: item.page.url.slice(0, 500),
        tabId: item.page.tabId.slice(0, 200),
      },
    } : {}),
  }));
  if (normalized.length === 0) return undefined;
  const latest = normalized.at(-1)!;
  return {
    source: latest.source,
    label: `框选注释 ${normalized.length} 项`,
    itemCount: normalized.length,
    capturedAt: new Date().toISOString(),
    content: JSON.stringify({
      kind: "visual_annotation_collection",
      items: normalized,
      guidance: "每个 visualAttachment 是包含周边内容的上下文截图，紫色框标出用户精确选区。rect 是原始选区，contextRect 是截图范围，location 提供可见画面百分比及文件页码、工作表或编辑器 session/unit 定位。whiteboard 提供白板 pageId、pageName、camera 和画布坐标 bounds。先定位对应文件或白板页面，再结合周边上下文处理紫色框内与注释相关的内容。",
    }),
  };
}

export function replaceWorkbenchSelectionContext(
  selection: WorkbenchSelectionContext | undefined,
): void {
  try {
    if (selection) {
      window.localStorage.setItem(WORKBENCH_SELECTION_STORAGE_KEY, JSON.stringify(selection));
    } else {
      window.localStorage.removeItem(WORKBENCH_SELECTION_STORAGE_KEY);
    }
  } catch {
    // Same-window consumers still receive the event when storage is blocked.
  }
  window.dispatchEvent(
    new CustomEvent<WorkbenchSelectionContext | undefined>(WORKBENCH_SELECTION_EVENT, {
      detail: selection,
    }),
  );
}

export function readWorkbenchSelectionContext(): WorkbenchSelectionContext | undefined {
  try {
    const raw = window.localStorage.getItem(WORKBENCH_SELECTION_STORAGE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as unknown;
    if (!isWorkbenchSelectionContext(parsed) || parsed.itemCount <= 0 || !parsed.content.trim()) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

export function publishWorkbenchSelectionContext(
  selection: Omit<WorkbenchSelectionContext, "capturedAt">,
): void {
  const value: WorkbenchSelectionContext = {
    ...selection,
    content: selection.content.slice(0, 20_000),
    capturedAt: new Date().toISOString(),
  };
  replaceWorkbenchSelectionContext(value);
}

export function clearWorkbenchSelectionContext(
  source: WorkbenchSelectionContext["source"],
): void {
  const current = readWorkbenchSelectionContext();
  if (current && current.source !== source) return;
  replaceWorkbenchSelectionContext(undefined);
}

export function subscribeWorkbenchSelectionContext(
  listener: (selection: WorkbenchSelectionContext | undefined) => void,
): () => void {
  const update = () => listener(readWorkbenchSelectionContext());
  const localUpdate = (event: Event) => {
    const detail = (event as CustomEvent<WorkbenchSelectionContext | undefined>).detail;
    listener(isWorkbenchSelectionContext(detail) ? detail : readWorkbenchSelectionContext());
  };
  const storageUpdate = (event: StorageEvent) => {
    if (event.key === WORKBENCH_SELECTION_STORAGE_KEY) update();
  };
  window.addEventListener(WORKBENCH_SELECTION_EVENT, localUpdate);
  window.addEventListener("storage", storageUpdate);
  return () => {
    window.removeEventListener(WORKBENCH_SELECTION_EVENT, localUpdate);
    window.removeEventListener("storage", storageUpdate);
  };
}

export function readPendingMokiAssistantComposeRequest(options: { consume?: boolean } = {}): MokiAssistantComposeRequest | undefined {
  try {
    const raw = window.localStorage.getItem(MOKI_ASSISTANT_COMPOSE_STORAGE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Partial<MokiAssistantComposeRequest>;
    if (
      typeof parsed.prompt !== "string" ||
      (!parsed.prompt.trim() && parsed.emptyComposer !== true) ||
      typeof parsed.capturedAt !== "string"
    ) return undefined;
    if (options.consume) window.localStorage.removeItem(MOKI_ASSISTANT_COMPOSE_STORAGE_KEY);
    const anchor = parsed.anchor;
    return {
      prompt: parsed.prompt.slice(0, 20_000),
      capturedAt: parsed.capturedAt,
      ...(anchor && Number.isFinite(anchor.x) && Number.isFinite(anchor.y)
        ? { anchor: { x: anchor.x, y: anchor.y } }
        : {}),
      ...(parsed.emptyComposer === true ? { emptyComposer: true } : {}),
      ...(parsed.editorAssist === true ? { editorAssist: true } : {}),
    };
  } catch {
    return undefined;
  }
}

export function requestMokiAssistance(
  selection: Omit<WorkbenchSelectionContext, "capturedAt">,
  prompt: string,
  options: { anchor?: { x: number; y: number }; preferInline?: boolean; prefillPrompt?: boolean; editorAssist?: boolean } = {},
): void {
  publishWorkbenchSelectionContext(selection);
  const emptyComposer = options.prefillPrompt === false;
  const request: MokiAssistantComposeRequest = {
    prompt: emptyComposer ? "" : prompt.slice(0, 20_000),
    capturedAt: new Date().toISOString(),
    ...(options.anchor ? { anchor: options.anchor } : {}),
    ...(emptyComposer ? { emptyComposer: true } : {}),
    ...(options.editorAssist === true ? { editorAssist: true } : {}),
  };
  try {
    window.localStorage.setItem(MOKI_ASSISTANT_COMPOSE_STORAGE_KEY, JSON.stringify(request));
  } catch {
    // Same-window fallback below still works when storage is blocked.
  }
  const desktop = window.mokiDesktop?.assistantWindow;
  if (desktop && !options.preferInline) {
    void desktop.open();
    return;
  }
  window.dispatchEvent(new CustomEvent<MokiAssistantComposeRequest>(MOKI_ASSISTANT_COMPOSE_EVENT, { detail: request }));
}

export function closeMokiEditorAssistance(): void {
  clearWorkbenchSelectionContext("library");
  try {
    window.localStorage.removeItem(MOKI_ASSISTANT_COMPOSE_STORAGE_KEY);
  } catch {
    // The lifecycle event still closes the same-window editor assistant.
  }
  window.dispatchEvent(new CustomEvent(MOKI_ASSISTANT_EDITOR_EXIT_EVENT));
}
