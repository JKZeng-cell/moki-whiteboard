// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clipboardImageFiles,
  drawNativeImagePlaceholder,
  exportNativeWhiteboardImage,
  NATIVE_WHITEBOARD_CLIPBOARD_TEXT_PREFIX,
  NATIVE_WHITEBOARD_CLIPBOARD_TYPE,
  NativeWhiteboard,
  NativeWhiteboardEditor,
  NativeWhiteboardStore,
  isAnimatedNativeImageAsset,
  nativeAutoTextBoxSize,
  nativeExpandedGroupCollapseButtonBounds,
  nativeFloatingPalettePlacement,
  nativeSelectionPalettePosition,
  nativeCanvasTextStartY,
  nativeCanvasSelectionPalette,
  nativeCanvasThemePalette,
  nativeGeoPaintStyle,
  nativeGroupFolderToggleButtonBounds,
  nativeGroupFolderVisualScale,
  nativeNoteBackgroundColor,
  nativeOverlayBounds,
  nativeStarPoints,
  normalizeWhiteboardLinkUrl,
  normalizePastedWhiteboardImageUrl,
  optimizeImage,
  wrapNativeCanvasText,
} from "./native-whiteboard.js";
import { buildMindMapTemplate } from "../../whiteboard/mind-map.js";
import { nativeShapeBounds, type NativeBezierAnchor } from "../../whiteboard/native-whiteboard-model.js";
import { installModalOutsideDismiss } from "../lib/modal-outside-dismiss.js";
import { visualAnnotationSelection, replaceWorkbenchSelectionContext, readWorkbenchSelectionContext } from "../lib/workbench-selection-context.js";

describe("native whiteboard clipboard", () => {
  it("falls back to the clipboard image when a large native payload cannot be pasted", async () => {
    mockCanvas();
    const onImageFiles = vi.fn().mockResolvedValue(undefined);
    const image = new File(["image"], "large.png", { type: "image/png" });
    render(createElement(NativeWhiteboard, { store: new NativeWhiteboardStore(), onImageFiles }));

    fireEvent.paste(window, { clipboardData: {
      types: [NATIVE_WHITEBOARD_CLIPBOARD_TYPE, "image/png"],
      getData: (type: string) => type === NATIVE_WHITEBOARD_CLIPBOARD_TYPE
        ? JSON.stringify({ version: 1, shapes: [] }) : "",
      files: [image],
      items: [],
    } });

    await waitFor(() => expect(onImageFiles).toHaveBeenCalledWith([image], expect.any(Object)));
  });

  it("uses one clipboard file view so Ctrl+V inserts an image once", () => {
    const direct = new File(["same image"], "clipboard.png", { type: "image/png" });
    const itemView = new File(["same image"], "clipboard.png", { type: "image/png" });

    expect(clipboardImageFiles([direct], [itemView])).toEqual([direct]);
    expect(clipboardImageFiles([], [itemView])).toEqual([itemView]);
  });

  it("recognizes direct and HTML network images without treating ordinary links as images", () => {
    expect(normalizePastedWhiteboardImageUrl("https://cdn.example.com/cover.png?size=2x"))
      .toBe("https://cdn.example.com/cover.png?size=2x");
    expect(normalizePastedWhiteboardImageUrl("", '<p><img src="https://cdn.example.com/render?id=9"></p>'))
      .toBe("https://cdn.example.com/render?id=9");
    expect(normalizePastedWhiteboardImageUrl("https://example.com/article"))
      .toBeUndefined();
  });
});

describe("native whiteboard image import", () => {
  it("uses image element decoding and downsampling when createImageBitmap rejects a large image", async () => {
    const context = mockCanvas();
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => callback(new Blob(["compressed"], { type: "image/webp" })));
    vi.stubGlobal("createImageBitmap", vi.fn().mockRejectedValue(new Error("The source image could not be decoded.")));
    class FallbackImage {
      naturalWidth = 8_000;
      naturalHeight = 4_000;
      decoding = "";
      onload?: () => void;
      onerror?: () => void;
      set src(_value: string) { queueMicrotask(() => this.onload?.()); }
    }
    vi.stubGlobal("Image", FallbackImage);
    const oldCreate = URL.createObjectURL;
    const oldRevoke = URL.revokeObjectURL;
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:large-image") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    try {
      const result = await optimizeImage(new File(["image"], "large.png", { type: "image/png" }));
      expect(result).toMatchObject({ width: 4_096, height: 2_048, optimized: true });
      expect(context.get("drawImage")).toHaveBeenCalledOnce();
    } finally {
      if (oldCreate) Object.defineProperty(URL, "createObjectURL", { configurable: true, value: oldCreate });
      else Reflect.deleteProperty(URL, "createObjectURL");
      if (oldRevoke) Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: oldRevoke });
      else Reflect.deleteProperty(URL, "revokeObjectURL");
    }
  });
});

afterEach(() => {
  cleanup();
  delete window.mokiDesktop;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mockCanvas() {
  const methods = new Map<PropertyKey, unknown>([
    ["measureText", () => ({ width: 40 })],
  ]);
  const context = new Proxy({}, {
    get(_target, property) {
      if (!methods.has(property)) methods.set(property, vi.fn());
      return methods.get(property);
    },
    set(_target, property, value) {
      methods.set(property, value);
      return true;
    },
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 800,
    bottom: 600,
    width: 800,
    height: 600,
    toJSON: () => ({}),
  });
  Object.defineProperty(HTMLCanvasElement.prototype, "setPointerCapture", {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperties(HTMLElement.prototype, {
    setPointerCapture: { configurable: true, value: vi.fn() },
    hasPointerCapture: { configurable: true, value: vi.fn(() => true) },
    releasePointerCapture: { configurable: true, value: vi.fn() },
  });
  return methods;
}

describe("native whiteboard geometry", () => {
  it("uses the visible cubic curve for pen path bounds", () => {
    const shape = {
      id: "shape:bezier-bounds",
      typeName: "shape" as const,
      type: "bezier",
      x: 10,
      y: 20,
      parentId: "page:moki",
      index: "a1",
      props: {
        anchors: [
          { x: 0, y: 0, in: { x: 0, y: 0 }, out: { x: 0, y: 100 } },
          { x: 100, y: 0, in: { x: 100, y: 100 }, out: { x: 100, y: 0 } },
        ],
      },
    };
    expect(nativeShapeBounds(shape)).toMatchObject({ x: 10, y: 20, w: 100, h: 75 });
  });

  it("opens floating palettes away from the selected content", () => {
    expect(nativeFloatingPalettePlacement({
      selectionTop: 180,
      selectionBottom: 320,
      viewportHeight: 800,
      paletteHeight: 300,
    })).toEqual({ anchorTop: 330, toolbarBelow: true, menuSide: "bottom" });
    expect(nativeFloatingPalettePlacement({
      selectionTop: 520,
      selectionBottom: 660,
      viewportHeight: 800,
      paletteHeight: 300,
    })).toEqual({ anchorTop: 510, toolbarBelow: false, menuSide: "top" });
    expect(nativeSelectionPalettePosition({
      selectionLeft: 600,
      selectionTop: 50,
      selectionRight: 700,
      selectionBottom: 180,
      viewportWidth: 1116,
      viewportHeight: 506,
      paletteWidth: 288,
      paletteHeight: 322,
    })).toEqual({ side: "right", left: 712, top: 8 });
  });

  it("uses a dark canvas surface and readable ink in dark mode", () => {
    expect(nativeCanvasThemePalette(true)).toEqual({
      background: "#151a28",
      grid: "rgba(151,160,194,.2)",
      ink: "#e8eaf4",
      minimapBackground: "rgba(28,33,49,.97)",
    });
    expect(nativeCanvasThemePalette(false).background).toBe("#fafbfe");
    expect(nativeCanvasSelectionPalette(true)).toEqual({
      stroke: "#aaa4ff",
      handleFill: "#242a3c",
      marqueeFill: "rgba(170,164,255,.16)",
    });
    expect(nativeCanvasSelectionPalette(false).handleFill).toBe("#ffffff");
  });

  it("sizes text boxes from their content and wraps only after the maximum width", () => {
    const measure = (value: string) => Array.from(value).length * 10;
    expect(nativeAutoTextBoxSize("短文", 18, measure)).toEqual({ width: 80, height: 56.3 });
    const multiline = nativeAutoTextBoxSize("第一行\n第二行", 18, measure);
    expect(multiline.width).toBe(80);
    expect(multiline.height).toBeCloseTo(80.6, 4);
    const long = nativeAutoTextBoxSize("字".repeat(140), 18, measure);
    expect(long.width).toBe(640);
    expect(long.height).toBeGreaterThan(multiline.height);
  });

  it("redraws the canvas background when the application theme changes", async () => {
    const fills: unknown[] = [];
    const methods = mockCanvas();
    methods.set("fillRect", vi.fn(() => fills.push(methods.get("fillStyle"))));
    document.documentElement.dataset.colorScheme = "dark";
    const store = new NativeWhiteboardStore();

    render(createElement(NativeWhiteboard, { store }));
    await waitFor(() => expect(fills).toContain("#151a28"));

    document.documentElement.dataset.colorScheme = "light";
    await waitFor(() => expect(fills).toContain("#fafbfe"));
    document.documentElement.removeAttribute("data-color-scheme");
  });

  it("compensates DOM media overlays for application font scaling", () => {
    expect(nativeOverlayBounds(
      {
        x: 140,
        y: 90,
        w: 320,
        h: 180,
        width: 320,
        height: 180,
        center: { x: 300, y: 180 },
      },
      { x: 40, y: 30, zoom: 1.5 },
      1.25,
    )).toEqual({
      left: 120,
      top: 72,
      width: 384,
      height: 216,
    });
  });

  it("maps star vertices to every edge of its selection bounds", () => {
    const bounds = {
      x: 120,
      y: 80,
      w: 240,
      h: 150,
      width: 240,
      height: 150,
      center: { x: 240, y: 155 },
    };
    const points = nativeStarPoints(bounds);

    expect(Math.min(...points.map((point) => point.x))).toBeCloseTo(bounds.x, 8);
    expect(Math.max(...points.map((point) => point.x))).toBeCloseTo(bounds.x + bounds.w, 8);
    expect(Math.min(...points.map((point) => point.y))).toBeCloseTo(bounds.y, 8);
    expect(Math.max(...points.map((point) => point.y))).toBeCloseTo(bounds.y + bounds.h, 8);
  });

  it("scales collapsed folder text and controls proportionally", () => {
    const base = {
      x: 20,
      y: 30,
      w: 240,
      h: 180,
      width: 240,
      height: 180,
      center: { x: 140, y: 120 },
    };
    const doubled = {
      x: 20,
      y: 30,
      w: 480,
      h: 360,
      width: 480,
      height: 360,
      center: { x: 260, y: 210 },
    };

    expect(nativeGroupFolderVisualScale(base)).toBe(1);
    expect(nativeGroupFolderVisualScale(doubled)).toBe(2);
    expect(nativeGroupFolderToggleButtonBounds(doubled).w)
      .toBeCloseTo(nativeGroupFolderToggleButtonBounds(base).w * 2);
  });
});

describe("native whiteboard history", () => {
  it("edits a mind map through the native editor and hides collapsed descendants", () => {
    const store = new NativeWhiteboardStore();
    const editor = new NativeWhiteboardEditor(store);
    const map = buildMindMapTemplate({
      template: "mind-right",
      center: { x: 600, y: 420 },
      color: "black",
    });
    editor.createShapes(map.shapes);

    expect(editor.getCurrentPageShapeIds().size).toBe(9);
    const addedId = editor.addMindMapChild(map.rootId);
    expect(addedId).toMatch(/^shape:/u);
    expect(editor.getCurrentPageShapeIds().size).toBe(11);
    expect(editor.getSelectedShapeIds()).toEqual([addedId]);

    expect(editor.toggleMindMapBranch(map.rootId)).toBe(true);
    expect([...editor.getCurrentPageShapeIds()]).toEqual([map.rootId]);
    expect(editor.toggleMindMapBranch(map.rootId)).toBe(true);
    expect(editor.getCurrentPageShapeIds().size).toBe(11);
  });

  it("reparents mind-map nodes only through explicit connection handles and hides node actions while editing text", async () => {
    mockCanvas();
    const store = new NativeWhiteboardStore();
    const map = buildMindMapTemplate({
      template: "mind-right",
      center: { x: 600, y: 420 },
      color: "black",
    });
    const seed = new NativeWhiteboardEditor(store);
    seed.createShapes(map.shapes);
    const children = map.shapes.filter((shape) => shape.props?.mokiMindMapParentId === map.rootId);
    const sourceId = children[0]!.id!;
    const targetId = children[1]!.id!;
    let editor: NativeWhiteboardEditor | undefined;
    render(createElement(NativeWhiteboard, {
      store,
      onMount: (value) => { editor = value; },
    }));
    await waitFor(() => expect(editor).toBeDefined());
    await waitFor(() => expect(editor!.getViewportPageBounds().w).toBeCloseTo(800));
    editor!.select(sourceId);

    const childHandle = await screen.findByRole("button", { name: "拖拽连接子节点" });
    expect(screen.getByRole("button", { name: "拖拽连接新的父节点" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "提升节点层级" })).not.toBeInTheDocument();

    const viewport = editor!.getViewportPageBounds();
    const zoom = 800 / viewport.w;
    const target = editor!.getShapePageBounds(targetId)!.center;
    const targetScreen = {
      clientX: (target.x - viewport.x) * zoom,
      clientY: (target.y - viewport.y) * zoom,
    };
    fireEvent.pointerDown(childHandle, { pointerId: 51, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(childHandle, { pointerId: 51, ...targetScreen });
    fireEvent.pointerUp(childHandle, { pointerId: 51, ...targetScreen });
    expect(editor!.getShape(targetId)?.props.mokiMindMapParentId).toBe(sourceId);

    const sourceBounds = editor!.getShapePageBounds(sourceId)!;
    const sourceScreen = {
      clientX: (sourceBounds.center.x - viewport.x) * zoom,
      clientY: (sourceBounds.center.y - viewport.y) * zoom,
    };
    fireEvent.doubleClick(document.querySelector(".native-whiteboard-canvas")!, sourceScreen);
    expect(await screen.findByRole("textbox", { name: "输入白板文字" })).toBeInTheDocument();
    expect(screen.queryByLabelText("思维导图节点操作")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "拖拽连接子节点" })).not.toBeInTheDocument();
  });

  it("creates a connected child at the blank drop point of an output handle", async () => {
    mockCanvas();
    const store = new NativeWhiteboardStore();
    const map = buildMindMapTemplate({
      template: "mind-right",
      center: { x: 600, y: 420 },
      color: "black",
    });
    const seed = new NativeWhiteboardEditor(store);
    seed.createShapes(map.shapes);
    let editor: NativeWhiteboardEditor | undefined;
    render(createElement(NativeWhiteboard, {
      store,
      onMount: (value) => { editor = value; },
    }));
    await waitFor(() => expect(editor).toBeDefined());
    await waitFor(() => expect(editor!.getViewportPageBounds().w).toBeCloseTo(800));
    editor!.select(map.rootId);
    const handle = await screen.findByRole("button", { name: "拖拽连接子节点" });
    const viewport = editor!.getViewportPageBounds();
    const zoom = 800 / viewport.w;
    const dropScreen = { clientX: 760, clientY: 560 };
    const dropPoint = {
      x: viewport.x + dropScreen.clientX / zoom,
      y: viewport.y + dropScreen.clientY / zoom,
    };

    fireEvent.pointerDown(handle, { pointerId: 52, clientX: 400, clientY: 300 });
    fireEvent.pointerMove(handle, { pointerId: 52, ...dropScreen });
    fireEvent.pointerUp(handle, { pointerId: 52, ...dropScreen });

    expect(editor!.getCurrentPageShapeIds().size).toBe(11);
    const createdId = editor!.getSelectedShapeIds()[0]!;
    expect(editor!.getShape(createdId)?.props).toMatchObject({
      mokiMindMapParentId: map.rootId,
      mokiMindMapAutoManaged: false,
    });
    expect(editor!.getShapePageBounds(createdId)?.center.x).toBeCloseTo(dropPoint.x);
    expect(editor!.getShapePageBounds(createdId)?.center.y).toBeCloseTo(dropPoint.y);
  });

  it("groups, selects, collapses, expands, and ungroups shapes as one unit", () => {
    const editor = new NativeWhiteboardEditor(new NativeWhiteboardStore());
    editor.createShapes([
      { id: "shape:group-a", type: "geo", x: 10, y: 20, props: { w: 80, h: 60 } },
      { id: "shape:group-b", type: "note", x: 140, y: 50, props: { w: 100, h: 80 } },
    ]);
    editor.select("shape:group-a", "shape:group-b");

    const groupId = editor.groupSelectedShapes();
    expect(groupId).toMatch(/^group:/u);
    expect(editor.getShape("shape:group-a")?.props.mokiGroupId).toBe(groupId);
    expect(editor.getShape("shape:group-b")?.props.mokiGroupId).toBe(groupId);

    editor.select("shape:group-a");
    expect(editor.getSelectedShapeIds()).toEqual(expect.arrayContaining(["shape:group-a", "shape:group-b"]));

    const folderId = editor.collapseSelectedGroup();
    expect(folderId).toMatch(/^shape:/u);
    expect(editor.getShape(folderId!)?.type).toBe("group-folder");
    expect(editor.getShape(folderId!)?.props).toMatchObject({
      w: 240,
      h: 180,
      groupLabel: "新空间",
      groupDescription: "把相关想法放在一起",
    });
    expect(editor.getShape("shape:group-a")?.props.mokiGroupCollapsed).toBe(true);

    expect(editor.expandGroupFolder(folderId!)).toEqual(expect.arrayContaining(["shape:group-a", "shape:group-b"]));
    expect(editor.getShape(folderId!)).toBeUndefined();
    expect(editor.getShape("shape:group-b")?.props.mokiGroupCollapsed).toBe(false);

    expect(editor.ungroupSelectedShapes()).toBe(true);
    expect(editor.getShape("shape:group-a")?.props.mokiGroupId).toBeUndefined();
    expect(editor.getShape("shape:group-b")?.props.mokiGroupId).toBeUndefined();
  });

  it("double-clicks a grouped member for independent text editing and resizing", async () => {
    mockCanvas();
    const store = new NativeWhiteboardStore();
    const seed = new NativeWhiteboardEditor(store);
    seed.createShapes([
      {
        id: "shape:group-text",
        type: "text",
        x: 120,
        y: 100,
        props: { w: 180, richText: "原文字", scale: 1 },
      },
      {
        id: "shape:group-geo",
        type: "geo",
        x: 380,
        y: 100,
        props: { w: 120, h: 90, richText: "", scale: 1 },
      },
    ]);
    seed.select("shape:group-text", "shape:group-geo");
    seed.groupSelectedShapes();
    let editor: NativeWhiteboardEditor | undefined;
    render(createElement(NativeWhiteboard, {
      store,
      onMount: (value) => { editor = value; },
    }));
    editor!.setCurrentTool("select");
    const canvas = document.querySelector(".native-whiteboard-canvas") as HTMLCanvasElement;
    await waitFor(() => expect(editor!.getViewportPageBounds().w).toBeCloseTo(800));
    const viewport = editor!.getViewportPageBounds();
    const zoom = 800 / viewport.w;
    const screenPoint = (point: { x: number; y: number }) => ({
      clientX: (point.x - viewport.x) * zoom,
      clientY: (point.y - viewport.y) * zoom,
    });

    editor!.select("shape:group-text");
    expect(editor!.getSelectedShapeIds()).toEqual(expect.arrayContaining([
      "shape:group-text",
      "shape:group-geo",
    ]));
    fireEvent.doubleClick(canvas, screenPoint(editor!.getShapePageBounds("shape:group-text")!.center));
    expect(editor!.getSelectedShapeIds()).toEqual(["shape:group-text"]);
    const textInput = await screen.findByRole("textbox", { name: "输入白板文字" });
    fireEvent.change(textInput, { target: { value: "组内单独修改" } });
    fireEvent.blur(textInput);
    await waitFor(() => expect(JSON.stringify(editor!.getShape("shape:group-text")?.props.richText)).toContain("组内单独修改"));
    expect(editor!.getSelectedShapeIds()).toEqual(["shape:group-text"]);

    const geoBefore = editor!.getShapePageBounds("shape:group-geo")!;
    fireEvent.doubleClick(canvas, screenPoint(geoBefore.center));
    expect(editor!.getSelectedShapeIds()).toEqual(["shape:group-geo"]);
    fireEvent.blur(await screen.findByRole("textbox", { name: "输入白板文字" }));
    const resizeStart = { x: geoBefore.x + geoBefore.w, y: geoBefore.y + geoBefore.h };
    const resizeEnd = { x: resizeStart.x + 60, y: resizeStart.y + 45 };
    fireEvent.pointerDown(canvas, { button: 0, pointerId: 44, ...screenPoint(resizeStart) });
    fireEvent.pointerMove(canvas, { button: 0, pointerId: 44, ...screenPoint(resizeEnd) });
    fireEvent.pointerUp(canvas, { button: 0, pointerId: 44, ...screenPoint(resizeEnd) });

    expect(Number(editor!.getShape("shape:group-geo")?.props.scale)).toBeGreaterThan(1);
    expect(editor!.getShape("shape:group-text")?.props.scale).toBe(1);
  });

  it("drags, edits, expands, and collapses a group folder with canvas controls", async () => {
    mockCanvas();
    const store = new NativeWhiteboardStore();
    const seed = new NativeWhiteboardEditor(store);
    seed.createShapes([
      { id: "shape:folder-a", type: "geo", x: 100, y: 100, props: { w: 80, h: 60 } },
      { id: "shape:folder-b", type: "note", x: 220, y: 150, props: { w: 100, h: 80 } },
    ]);
    seed.select("shape:folder-a", "shape:folder-b");
    seed.groupSelectedShapes();
    const folderId = seed.collapseSelectedGroup()!;
    let editor: NativeWhiteboardEditor | undefined;
    const onGroupFolderExport = vi.fn();
    render(createElement(NativeWhiteboard, {
      store,
      onMount: (value) => { editor = value; },
      onGroupFolderExport,
    }));
    editor!.setCurrentTool("select");
    const canvas = document.querySelector(".native-whiteboard-canvas") as HTMLCanvasElement;
    await waitFor(() => expect(editor!.getViewportPageBounds().w).toBeCloseTo(800));
    const viewport = editor!.getViewportPageBounds();
    const zoom = 800 / viewport.w;
    const screenPoint = (point: { x: number; y: number }) => ({
      clientX: (point.x - viewport.x) * zoom,
      clientY: (point.y - viewport.y) * zoom,
    });
    const before = editor!.getShapePageBounds(folderId)!;
    const start = before.center;
    const end = { x: start.x + 60, y: start.y + 40 };

    fireEvent.pointerMove(canvas, screenPoint(start));
    expect(canvas.style.cursor).toBe("move");
    fireEvent.pointerDown(canvas, { button: 0, pointerId: 41, ...screenPoint(start) });
    fireEvent.pointerMove(canvas, { button: 0, pointerId: 41, ...screenPoint(end) });
    fireEvent.pointerUp(canvas, { button: 0, pointerId: 41, ...screenPoint(end) });

    expect(editor!.getShape(folderId)).toMatchObject({
      x: before.x + 60,
      y: before.y + 40,
      type: "group-folder",
    });
    expect(editor!.getShape("shape:folder-a")?.props.mokiGroupCollapsed).toBe(true);

    fireEvent.contextMenu(canvas, screenPoint(end));
    expect(screen.getByRole("menu", { name: "白板右键菜单" })).toBeInTheDocument();
    expect(screen.queryByRole("menu", { name: "资料夹颜色" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "资料夹颜色" }));
    expect(screen.getByRole("menu", { name: "资料夹颜色" })).toBeInTheDocument();
    expect(screen.getByRole("menuitemradio", { name: "资料夹颜色 #776bd8" }))
      .toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("menuitemradio", { name: "资料夹颜色 #36a391" }));
    expect(editor!.getShape(folderId)?.props.groupColor).toBe("#36a391");
    fireEvent.contextMenu(canvas, screenPoint(end));
    fireEvent.click(screen.getByRole("menuitem", { name: "重命名资料夹" }));
    let nameInput = screen.getByRole("textbox", { name: "资料夹名称" });
    expect(nameInput).toHaveValue("新空间");
    fireEvent.change(nameInput, { target: { value: "不保存的名称" } });
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(editor!.getShape(folderId)?.props.groupLabel).toBe("新空间");

    fireEvent.click(screen.getByRole("menuitem", { name: "重命名资料夹" }));
    nameInput = screen.getByRole("textbox", { name: "资料夹名称" });
    fireEvent.change(nameInput, { target: { value: "项目资料" } });
    fireEvent.submit(screen.getByRole("form", { name: "重命名资料夹" }));
    expect(editor!.getShape(folderId)?.props.groupLabel).toBe("项目资料");
    expect(screen.queryByRole("menu", { name: "白板右键菜单" })).not.toBeInTheDocument();

    fireEvent.contextMenu(canvas, screenPoint(end));
    fireEvent.click(screen.getByRole("menuitem", { name: "编辑资料夹描述" }));
    let descriptionInput = screen.getByRole("textbox", { name: "资料夹描述" });
    expect(descriptionInput).toHaveValue("把相关想法放在一起");
    fireEvent.change(descriptionInput, { target: { value: "不保存的描述" } });
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(editor!.getShape(folderId)?.props.groupDescription).toBe("把相关想法放在一起");

    fireEvent.click(screen.getByRole("menuitem", { name: "编辑资料夹描述" }));
    descriptionInput = screen.getByRole("textbox", { name: "资料夹描述" });
    fireEvent.change(descriptionInput, { target: { value: "集中管理项目视觉参考" } });
    fireEvent.submit(screen.getByRole("form", { name: "编辑资料夹描述" }));
    expect(editor!.getShape(folderId)?.props.groupDescription).toBe("集中管理项目视觉参考");
    expect(screen.queryByRole("menu", { name: "白板右键菜单" })).not.toBeInTheDocument();

    fireEvent.contextMenu(canvas, screenPoint(end));
    fireEvent.click(screen.getByRole("menuitem", { name: "另存为本地文件夹" }));
    expect(onGroupFolderExport).toHaveBeenCalledWith(expect.objectContaining({
      folderId,
      name: "项目资料",
      description: "集中管理项目视觉参考",
      payload: expect.objectContaining({ version: 1, shapes: expect.arrayContaining([expect.objectContaining({ id: "shape:folder-a" })]) }),
    }), "local");

    const folderBeforeResize = editor!.getShapePageBounds(folderId)!;
    const resizeStart = {
      x: folderBeforeResize.x + folderBeforeResize.w,
      y: folderBeforeResize.y + folderBeforeResize.h,
    };
    const resizeEnd = {
      x: resizeStart.x + folderBeforeResize.w / 2,
      y: resizeStart.y + folderBeforeResize.h / 2,
    };
    fireEvent.pointerDown(canvas, { button: 0, pointerId: 45, ...screenPoint(resizeStart) });
    fireEvent.pointerMove(canvas, { button: 0, pointerId: 45, ...screenPoint(resizeEnd) });
    fireEvent.pointerUp(canvas, { button: 0, pointerId: 45, ...screenPoint(resizeEnd) });
    const resizedFolderBounds = editor!.getShapePageBounds(folderId)!;
    expect(editor!.getShape(folderId)?.props.scale).toBeCloseTo(1.5);
    expect(nativeGroupFolderVisualScale(resizedFolderBounds)).toBeCloseTo(1.5);

    const expandButton = nativeGroupFolderToggleButtonBounds(resizedFolderBounds);
    fireEvent.pointerMove(canvas, screenPoint(expandButton.center));
    expect(canvas.style.cursor).toBe("pointer");
    fireEvent.pointerDown(canvas, { button: 0, pointerId: 42, ...screenPoint(expandButton.center) });
    fireEvent.pointerUp(canvas, { button: 0, pointerId: 42, ...screenPoint(expandButton.center) });
    expect(editor!.getShape(folderId)).toBeUndefined();
    expect(editor!.getShape("shape:folder-a")).toMatchObject({
      x: 160,
      y: 140,
      props: {
        mokiGroupCollapsed: false,
        mokiGroupLabel: "项目资料",
        mokiGroupDescription: "集中管理项目视觉参考",
      },
    });

    const memberBounds = ["shape:folder-a", "shape:folder-b"].map((id) => editor!.getShapePageBounds(id)!);
    const left = Math.min(...memberBounds.map((bounds) => bounds.x));
    const top = Math.min(...memberBounds.map((bounds) => bounds.y));
    const right = Math.max(...memberBounds.map((bounds) => bounds.x + bounds.w));
    const bottom = Math.max(...memberBounds.map((bounds) => bounds.y + bounds.h));
    const collapseButton = nativeExpandedGroupCollapseButtonBounds({
      center: { x: (left + right) / 2, y: (top + bottom) / 2 },
      w: right - left,
      h: bottom - top,
      rotation: 0,
    }, zoom);
    fireEvent.pointerMove(canvas, screenPoint(collapseButton.center));
    expect(canvas.style.cursor).toBe("pointer");
    fireEvent.pointerDown(canvas, { button: 0, pointerId: 43, ...screenPoint(collapseButton.center) });
    fireEvent.pointerUp(canvas, { button: 0, pointerId: 43, ...screenPoint(collapseButton.center) });

    const collapsedAgainId = editor!.getSelectedShapeIds()[0]!;
    expect(editor!.getShape(collapsedAgainId)).toMatchObject({
      type: "group-folder",
      props: {
        groupLabel: "项目资料",
        groupDescription: "集中管理项目视觉参考",
      },
    });
  });

  it("recognizes GIF assets as animated playback content", () => {
    expect(isAnimatedNativeImageAsset({
      id: "asset:gif",
      typeName: "asset",
      type: "image",
      props: { src: "/api/whiteboard/assets/demo", mimeType: "image/gif" },
      meta: {},
    })).toBe(true);
    expect(isAnimatedNativeImageAsset({
      id: "asset:png",
      typeName: "asset",
      type: "image",
      props: { src: "data:image/png;base64,AA==", mimeType: "image/png" },
      meta: {},
    })).toBe(false);
  });

  it("wraps sticky-note text by measured width and truncates overflow", () => {
    const context = {
      measureText: (value: string) => ({ width: Array.from(value).length * 10 }),
    } as Pick<CanvasRenderingContext2D, "measureText">;
    expect(wrapNativeCanvasText(context, "这是一个需要自动换行的便签", 50, 2)).toEqual([
      "这是一个需",
      "要自动换…",
    ]);
  });

  it("centers mind-map text blocks vertically while keeping ordinary text top aligned", () => {
    const bounds = { x: 100, y: 200, w: 240, h: 80, width: 240, height: 80, center: { x: 220, y: 240 } };
    expect(nativeCanvasTextStartY(bounds, 18, 24, 1, true)).toBe(231);
    expect(nativeCanvasTextStartY(bounds, 18, 24, 2, true)).toBe(219);
    expect(nativeCanvasTextStartY(bounds, 18, 24, 1, false)).toBe(216);
  });

  it("normalizes web links and blocks active-content protocols", () => {
    expect(normalizeWhiteboardLinkUrl("example.com/docs")).toBe("https://example.com/docs");
    expect(normalizeWhiteboardLinkUrl("javascript:alert(1)")).toBeUndefined();
    expect(normalizeWhiteboardLinkUrl("data:text/html,test")).toBeUndefined();
  });

  it("keeps legacy geo appearance compatible and reads independent paint settings", () => {
    const base = {
      id: "shape:geo",
      typeName: "shape" as const,
      type: "geo",
      x: 0,
      y: 0,
      parentId: "page:moki",
      index: "a1",
    };
    expect(nativeGeoPaintStyle({ ...base, props: { color: "blue", fill: "none" } })).toMatchObject({
      strokeEnabled: true,
      strokeColor: "blue",
      fillEnabled: true,
    });
    expect(nativeGeoPaintStyle({
      ...base,
      props: {
        strokeEnabled: false,
        strokeColor: "red",
        strokeOpacity: 0.35,
        fillEnabled: true,
        fillColor: "green",
        fillOpacity: 0.6,
      },
    })).toEqual({
      strokeEnabled: false,
      strokeColor: "red",
      strokeOpacity: 0.35,
      fillEnabled: true,
      fillColor: "green",
      fillOpacity: 0.6,
    });
  });

  it("zooms the canvas in and out with visible controls", () => {
    mockCanvas();
    const store = new NativeWhiteboardStore();
    render(createElement(NativeWhiteboard, { store }));

    expect(screen.getByText("100% · MOKI白板")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "放大白板" }));
    expect(screen.getByText("120% · MOKI白板")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "缩小白板" }));
    expect(screen.getByText("100% · MOKI白板")).toBeInTheDocument();
  });

  it("renders an interactive iframe only for a selected preview link and opens browsing externally", async () => {
    mockCanvas();
    const openExternalUrl = vi.fn().mockResolvedValue(true);
    window.mokiDesktop = {
      captureWhiteboardLinkPreview: vi.fn().mockResolvedValue(null),
      openExternalUrl,
    };
    const store = new NativeWhiteboardStore();
    const seed = new NativeWhiteboardEditor(store);
    seed.createShapes([{
      id: "shape:link",
      type: "link",
      x: 40,
      y: 50,
      props: { url: "https://example.com/", title: "示例", mode: "preview", w: 360, h: 300 },
    }]);
    let editor: NativeWhiteboardEditor | undefined;
    render(createElement(NativeWhiteboard, {
      store,
      onMount: (value) => { editor = value; },
    }));

    expect(screen.queryByTitle("示例 网页预览")).not.toBeInTheDocument();
    editor!.select("shape:link");
    const frame = await screen.findByTitle("示例 网页预览");
    expect(frame).toHaveAttribute("src", "https://example.com/");
    expect(frame).toHaveAttribute("sandbox", "allow-forms allow-same-origin allow-scripts allow-popups allow-popups-to-escape-sandbox");
    fireEvent.click(screen.getByRole("button", { name: "在系统浏览器中打开网页" }));
    await waitFor(() => expect(openExternalUrl).toHaveBeenCalledWith("https://example.com/"));
    fireEvent.click(screen.getByRole("button", { name: "切换为链接模式" }));
    await waitFor(() => expect(screen.queryByTitle("示例 网页预览")).not.toBeInTheDocument());
    expect(editor!.getShape("shape:link")?.props).toMatchObject({ mode: "link", h: 82 });
  });

  it("replaces an automatic hostname label with fetched webpage metadata", async () => {
    mockCanvas();
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      url: "https://example.com/docs",
      title: "产品文档",
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const store = new NativeWhiteboardStore();
    const editor = new NativeWhiteboardEditor(store);
    editor.createShapes([{
      id: "shape:auto-title",
      type: "link",
      x: 40,
      y: 50,
      props: { url: "https://example.com/docs", title: "example.com", titleAuto: true, mode: "link", w: 360, h: 82 },
    }]);

    render(createElement(NativeWhiteboard, { store }));

    await waitFor(() => expect(editor.getShape("shape:auto-title")?.props).toMatchObject({
      title: "产品文档",
      titleAuto: false,
    }));
    expect(fetchMock).toHaveBeenCalledWith("/api/whiteboard/links/metadata", expect.objectContaining({
      method: "POST",
    }));
  });

  it("opens a stored preview link directly on selection without an enter-page button", async () => {
    mockCanvas();
    const store = new NativeWhiteboardStore();
    const seed = new NativeWhiteboardEditor(store);
    seed.createShapes([{
      id: "shape:thumbnail-fallback",
      type: "link",
      x: 40,
      y: 50,
      props: {
        url: "https://example.com/docs",
        title: "产品文档",
        mode: "preview",
        w: 360,
        h: 300,
        thumbnailUrl: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E",
      },
    }]);
    let editor: NativeWhiteboardEditor | undefined;
    render(createElement(NativeWhiteboard, {
      store,
      onMount: (value) => { editor = value; },
    }));

    expect(screen.queryByTitle("产品文档 网页预览")).not.toBeInTheDocument();
    editor!.select("shape:thumbnail-fallback");
    const frame = await screen.findByTitle("产品文档 网页预览");
    expect(frame).toHaveAttribute("src", "https://example.com/docs");
    expect(frame).toHaveClass("opacity-100", "pointer-events-auto");
    expect(screen.queryByAltText("产品文档 网页缩略预览")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "进入网页交互" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "显示网页缩略预览" })).not.toBeInTheDocument();

    editor!.select();
    await waitFor(() => expect(screen.queryByTitle("产品文档 网页预览")).not.toBeInTheDocument());
    expect(editor!.getShape("shape:thumbnail-fallback")?.props.thumbnailUrl).toBe(
      "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E",
    );
    editor!.select("shape:thumbnail-fallback");
    expect(await screen.findByTitle("产品文档 网页预览")).toHaveClass("opacity-100", "pointer-events-auto");
  });

  it("scales compact link cards proportionally", () => {
    const editor = new NativeWhiteboardEditor(new NativeWhiteboardStore());
    editor.createShapes([{
      id: "shape:scaled-link",
      type: "link",
      x: 10,
      y: 20,
      props: { url: "https://example.com", mode: "link", w: 360, h: 82, scale: 2 },
    }]);
    const bounds = nativeShapeBounds(editor.getShape("shape:scaled-link")!);

    expect(bounds).toMatchObject({ x: 10, y: 20, w: 720, h: 164 });
  });

  it("scales the selected link action area with the canvas zoom", async () => {
    mockCanvas();
    const store = new NativeWhiteboardStore();
    const seed = new NativeWhiteboardEditor(store);
    seed.createShapes([{
      id: "shape:zoomed-link",
      type: "link",
      x: 40,
      y: 50,
      props: { url: "https://example.com", title: "示例", mode: "link", w: 360, h: 82 },
    }]);
    let editor: NativeWhiteboardEditor | undefined;
    render(createElement(NativeWhiteboard, {
      store,
      onMount: (value) => { editor = value; },
    }));

    editor!.select("shape:zoomed-link");
    await screen.findByRole("button", { name: "切换为链接模式" });
    const content = document.querySelector<HTMLElement>("[data-whiteboard-link-content]");
    expect(content).toHaveStyle({ width: "360px", height: "82px", transform: "scale(1)" });

    fireEvent.click(screen.getByRole("button", { name: "缩小白板" }));
    await waitFor(() => expect(content).toHaveStyle({ transform: `scale(${1 / 1.2})` }));
    expect(document.querySelector("[data-whiteboard-link-actions]")).toBeInTheDocument();
  });

  it("hides per-card link actions while an expanded group is selected", () => {
    mockCanvas();
    const store = new NativeWhiteboardStore();
    const seed = new NativeWhiteboardEditor(store);
    seed.createShapes([
      { id: "shape:group-link-a", type: "link", x: 20, y: 20, props: { url: "https://example.com/a", title: "链接 A", mode: "link", w: 360, h: 82 } },
      { id: "shape:group-link-b", type: "link", x: 20, y: 120, props: { url: "https://example.com/b", title: "链接 B", mode: "link", w: 360, h: 82 } },
    ]);
    seed.select("shape:group-link-a", "shape:group-link-b");
    seed.groupSelectedShapes();

    let editor: NativeWhiteboardEditor | undefined;
    render(createElement(NativeWhiteboard, {
      store,
      onMount: (value) => { editor = value; },
    }));
    editor!.select("shape:group-link-a");

    expect(editor!.getSelectedShapeIds()).toEqual(expect.arrayContaining(["shape:group-link-a", "shape:group-link-b"]));
    expect(document.querySelectorAll("[data-whiteboard-link]")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "切换为链接模式" })).not.toBeInTheDocument();
  });

  it("gives an expanded mixed group's collapse control priority over link actions", () => {
    mockCanvas();
    const store = new NativeWhiteboardStore();
    const seed = new NativeWhiteboardEditor(store);
    seed.createShapes([
      { id: "shape:mixed-link", type: "link", x: 20, y: 20, props: { url: "https://example.com", title: "链接", mode: "link", w: 360, h: 82 } },
      { id: "shape:mixed-card", type: "geo", x: 20, y: 120, props: { w: 180, h: 100 } },
    ]);
    seed.select("shape:mixed-link", "shape:mixed-card");
    seed.groupSelectedShapes();

    let editor: NativeWhiteboardEditor | undefined;
    render(createElement(NativeWhiteboard, {
      store,
      onMount: (value) => { editor = value; },
    }));
    editor!.select("shape:mixed-link");

    expect(editor!.getSelectedShapeIds()).toEqual(expect.arrayContaining(["shape:mixed-link", "shape:mixed-card"]));
    expect(document.querySelector("[data-whiteboard-link]")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "切换为链接模式" })).not.toBeInTheDocument();
  });

  it("moves the last selected shape to the top while preserving earlier layer order", () => {
    const store = new NativeWhiteboardStore();
    const editor = new NativeWhiteboardEditor(store);
    editor.createShapes([
      { id: "shape:first", type: "geo", props: { w: 100, h: 100 } },
      { id: "shape:second", type: "geo", props: { w: 100, h: 100 } },
      { id: "shape:third", type: "geo", props: { w: 100, h: 100 } },
    ]);

    editor.select("shape:first");
    editor.select("shape:second");

    const firstIndex = editor.getShape("shape:first")!.index;
    const secondIndex = editor.getShape("shape:second")!.index;
    const thirdIndex = editor.getShape("shape:third")!.index;
    expect(thirdIndex.localeCompare(firstIndex)).toBeLessThan(0);
    expect(firstIndex.localeCompare(secondIndex)).toBeLessThan(0);

    editor.createShapes([{ id: "shape:fourth", type: "geo", props: { w: 100, h: 100 } }]);
    expect(secondIndex.localeCompare(editor.getShape("shape:fourth")!.index)).toBeLessThan(0);
    expect(editor.canUndo()).toBe(true);
  });

  it("stores the last loaded preview thumbnail and keeps it visible after deselection", async () => {
    mockCanvas();
    const store = new NativeWhiteboardStore();
    const seed = new NativeWhiteboardEditor(store);
    seed.createShapes([{
      id: "shape:preview-thumb",
      type: "link",
      x: 40,
      y: 50,
      props: { url: "https://example.com/docs", title: "文档", mode: "preview", w: 360, h: 300 },
    }]);
    store.replace(store.snapshot);
    let editor: NativeWhiteboardEditor | undefined;
    render(createElement(NativeWhiteboard, {
      store,
      onMount: (value) => { editor = value; },
    }));

    editor!.select("shape:preview-thumb");
    const frame = await screen.findByTitle("文档 网页预览");
    fireEvent.load(frame);
    expect(editor!.getShape("shape:preview-thumb")?.props.thumbnailUrl).toBeUndefined();
    editor!.select();

    await waitFor(() => {
      expect(editor!.getShape("shape:preview-thumb")?.props).toMatchObject({
        thumbnailUrl: expect.stringMatching(/^data:image\/svg\+xml/),
        thumbnailUpdatedAt: expect.any(String),
      });
    });
    expect(editor!.canUndo()).toBe(false);

    expect(document.querySelector('[data-whiteboard-link="shape:preview-thumb"]')).toBeNull();
    expect(screen.queryByTitle("文档 网页预览")).not.toBeInTheDocument();
  });

  it("captures the rendered desktop preview and reuses it while the link is inactive", async () => {
    mockCanvas();
    const captureWhiteboardLinkPreview = vi.fn().mockResolvedValue(
      "data:image/jpeg;base64,desktop-preview",
    );
    window.mokiDesktop = { captureWhiteboardLinkPreview };
    const store = new NativeWhiteboardStore();
    const seed = new NativeWhiteboardEditor(store);
    seed.createShapes([{
      id: "shape:desktop-preview",
      type: "link",
      x: 40,
      y: 50,
      props: { url: "https://example.com/live", title: "实时页面", mode: "preview", w: 360, h: 300 },
    }]);
    store.replace(store.snapshot);
    let editor: NativeWhiteboardEditor | undefined;
    render(createElement(NativeWhiteboard, {
      store,
      onMount: (value) => { editor = value; },
    }));

    editor!.select("shape:desktop-preview");
    const frame = await screen.findByTitle("实时页面 网页预览");
    vi.spyOn(frame, "getBoundingClientRect").mockReturnValue({
      x: 52,
      y: 108,
      left: 52,
      top: 108,
      right: 388,
      bottom: 338,
      width: 336,
      height: 230,
      toJSON: () => ({}),
    });
    fireEvent.load(frame);

    await waitFor(() => expect(captureWhiteboardLinkPreview).toHaveBeenCalledWith({
      x: 52,
      y: 108,
      width: 336,
      height: 230,
    }));
    expect(editor!.getShape("shape:desktop-preview")?.props.thumbnailUrl).toBeUndefined();
    editor!.select();
    await waitFor(() => expect(editor!.getShape("shape:desktop-preview")?.props).toMatchObject({
      thumbnailUrl: "data:image/jpeg;base64,desktop-preview",
      thumbnailUpdatedAt: expect.any(String),
    }));

    expect(document.querySelector('[data-whiteboard-link="shape:desktop-preview"]')).toBeNull();
    expect(screen.queryByTitle("实时页面 网页预览")).not.toBeInTheDocument();

    const canvas = document.querySelector("canvas.native-whiteboard-canvas");
    expect(canvas).not.toBeNull();
    fireEvent.pointerDown(canvas!, {
      pointerId: 1,
      button: 0,
      clientX: 250,
      clientY: 180,
    });
    expect(await screen.findByTitle("实时页面 网页预览")).toHaveAttribute(
      "src",
      "https://example.com/live",
    );
    expect(screen.getByTitle("实时页面 网页预览")).toHaveClass("opacity-100", "pointer-events-auto");
    expect(screen.queryByRole("button", { name: "进入网页交互" })).not.toBeInTheDocument();
  });

  it("keeps light blue and pink note backgrounds distinct from yellow", () => {
    expect(nativeNoteBackgroundColor("light-blue")).toBe("#dceeff");
    expect(nativeNoteBackgroundColor("light-red")).toBe("#ffdce7");
    expect(nativeNoteBackgroundColor("light-blue")).not.toBe(
      nativeNoteBackgroundColor("yellow"),
    );
    expect(nativeNoteBackgroundColor("light-red")).not.toBe(
      nativeNoteBackgroundColor("yellow"),
    );
  });

  it("undoes and redoes document changes without recording camera state", () => {
    const store = new NativeWhiteboardStore();
    const editor = new NativeWhiteboardEditor(store);
    const listener = vi.fn();
    store.listen(listener);

    editor.createShapes([{ type: "text", props: { richText: "first" } }]);
    expect(editor.getCurrentPageShapeIds()).toHaveLength(1);
    expect(editor.undo()).toBe(true);
    expect(editor.getCurrentPageShapeIds()).toHaveLength(0);
    expect(editor.redo()).toBe(true);
    expect(editor.getCurrentPageShapeIds()).toHaveLength(1);

    store.mutate((snapshot) => {
      snapshot.session = { currentPageId: editor.getCurrentPageId(), camera: { x: 10, y: 20, zoom: 2 } };
    }, "session");
    expect(editor.redo()).toBe(false);
    expect(listener).toHaveBeenCalledWith({ scope: "session" });
  });

  it("exposes undo and redo controls beside the page menu", async () => {
    mockCanvas();
    const store = new NativeWhiteboardStore();
    let editor: NativeWhiteboardEditor | undefined;
    render(createElement(NativeWhiteboard, {
      store,
      onMount: (value) => { editor = value; },
    }));
    const undo = screen.getByRole("button", { name: "撤回" });
    const redo = screen.getByRole("button", { name: "重做" });
    expect(undo).toBeDisabled();
    expect(redo).toBeDisabled();

    editor!.createShapes([{ type: "geo", props: { w: 100, h: 80 } }]);
    await waitFor(() => expect(undo).toBeEnabled());
    fireEvent.click(undo);
    expect(editor!.getCurrentPageShapeIds()).toHaveLength(0);
    expect(redo).toBeEnabled();

    fireEvent.click(redo);
    expect(editor!.getCurrentPageShapeIds()).toHaveLength(1);
    expect(redo).toBeDisabled();
  });

  it("groups a pointer drag into one history entry", () => {
    const store = new NativeWhiteboardStore();
    const editor = new NativeWhiteboardEditor(store);
    editor.createShapes([{ id: "shape:moving", type: "geo", x: 0, y: 0, props: { w: 100, h: 80 } }]);

    store.mutate((snapshot) => {
      snapshot.document.store["shape:moving"]!.x = 50;
    }, "document", false);
    store.mutate((snapshot) => {
      snapshot.document.store["shape:moving"]!.x = 100;
    }, "document", false);
    store.touch("document");

    expect(editor.getShape("shape:moving")?.x).toBe(100);
    expect(editor.undo()).toBe(true);
    expect(editor.getShape("shape:moving")?.x).toBe(0);
  });

  it("carries referenced image assets with copied elements", () => {
    const sourceStore = new NativeWhiteboardStore();
    const source = new NativeWhiteboardEditor(sourceStore);
    sourceStore.mutate((snapshot) => {
      snapshot.document.store["asset:copy-image"] = {
        id: "asset:copy-image",
        typeName: "asset",
        type: "image",
        props: {
          src: "/api/whiteboard/assets/copied-image",
          w: 640,
          h: 360,
          mimeType: "image/png",
        },
        meta: {},
      };
    });
    source.createShapes([{
      id: "shape:copy-image",
      type: "image",
      x: 40,
      y: 60,
      props: { w: 320, h: 180, assetId: "asset:copy-image" },
    }]);
    source.select("shape:copy-image");
    const serialized = source.copySelectedShapes();
    expect(serialized).toBeTruthy();

    const targetStore = new NativeWhiteboardStore();
    const target = new NativeWhiteboardEditor(targetStore);
    const pastedIds = target.pasteCopiedShapes(serialized!, 24);
    expect(pastedIds).toHaveLength(1);
    expect(target.getShape(pastedIds[0]!)).toMatchObject({
      type: "image",
      x: 64,
      y: 84,
      props: expect.objectContaining({ assetId: "asset:copy-image" }),
    });
    expect(targetStore.snapshot.document.store["asset:copy-image"]).toMatchObject({
      typeName: "asset",
      props: expect.objectContaining({ src: "/api/whiteboard/assets/copied-image" }),
    });
    expect(target.undo()).toBe(true);
    expect(targetStore.snapshot.document.store["asset:copy-image"]).toBeUndefined();
  });

  it("rejects malformed copied shapes without changing pages or saved elements", () => {
    const store = new NativeWhiteboardStore();
    const editor = new NativeWhiteboardEditor(store);
    const pageId = editor.getCurrentPageId();
    editor.createShapes([{ id: "shape:existing", type: "note", x: 1, y: 2, props: { text: "保留" } }]);
    const before = structuredClone(store.snapshot);
    const malformed = JSON.stringify({
      version: 1,
      shapes: [{
        id: "shape:bad",
        typeName: "shape",
        type: "note",
        x: 1e999,
        y: 2,
        parentId: pageId,
        index: "a1",
        props: {},
      }],
      assets: [],
    });

    expect(editor.pasteCopiedShapes(malformed)).toEqual([]);
    expect(store.snapshot).toEqual(before);
    expect(editor.getShape("shape:existing")?.props.text).toBe("保留");
  });

  it("creates text only after the user enters content", async () => {
    mockCanvas();
    const store = new NativeWhiteboardStore();
    let editor: NativeWhiteboardEditor | undefined;
    render(createElement(NativeWhiteboard, {
      store,
      color: "red",
      textStyle: { size: "xl", bold: true, italic: true, underline: true, textAlign: "middle" },
      onMount: (value) => { editor = value; },
    }));
    editor!.setCurrentTool("text");
    const canvas = document.querySelector("canvas")!;

    fireEvent.pointerDown(canvas, { button: 0, clientX: 100, clientY: 120, pointerId: 1 });
    fireEvent.blur(screen.getByRole("textbox", { name: "输入白板文字" }));
    expect(editor!.getCurrentPageShapeIds()).toHaveLength(0);

    fireEvent.pointerDown(canvas, { button: 0, clientX: 140, clientY: 160, pointerId: 2 });
    const input = screen.getByRole("textbox", { name: "输入白板文字" });
    fireEvent.change(input, { target: { value: "原生文字" } });
    fireEvent.pointerDown(canvas, { button: 0, clientX: 500, clientY: 420, pointerId: 3 });

    await waitFor(() => expect(editor!.getCurrentPageShapeIds()).toHaveLength(1));
    const shape = editor!.getShape([...editor!.getCurrentPageShapeIds()][0]!);
    expect(shape?.props).toMatchObject({
      color: "red",
      size: "xl",
      bold: true,
      italic: true,
      underline: true,
      textAlign: "middle",
    });
  });

  it("keeps the text formatting toolbar and color menu away from the inline editor", () => {
    mockCanvas();
    const store = new NativeWhiteboardStore();
    let editor: NativeWhiteboardEditor | undefined;
    render(createElement(NativeWhiteboard, {
      store,
      onMount: (value) => { editor = value; },
    }));
    editor!.setCurrentTool("text");
    const canvas = document.querySelector(".native-whiteboard-canvas") as HTMLCanvasElement;

    fireEvent.pointerDown(canvas, { button: 0, clientX: 260, clientY: 120, pointerId: 71 });
    let input = screen.getByRole("textbox", { name: "输入白板文字" });
    let toolbar = screen.getByLabelText("编辑文字字号");
    expect(input).toHaveStyle({ top: "120px" });
    expect(toolbar).toHaveStyle({ top: "112px", transform: "translate(-50%, -100%)" });
    fireEvent.click(screen.getByRole("button", { name: "编辑文字颜色" }));
    expect(screen.getByRole("button", { name: "编辑文字颜色 黑色" }).closest(".moki-menu-surface"))
      .toHaveClass("bottom-full", "mb-2");

    fireEvent.keyDown(input, { key: "Escape" });
    fireEvent.pointerDown(canvas, { button: 0, clientX: 260, clientY: 20, pointerId: 72 });
    input = screen.getByRole("textbox", { name: "输入白板文字" });
    toolbar = screen.getByLabelText("编辑文字字号");
    expect(input).toHaveStyle({ top: "20px" });
    expect(Number.parseFloat(toolbar.style.top)).toBeCloseTo(84.3, 4);
    expect(toolbar).toHaveStyle({ transform: "translate(-50%, 0)" });
    fireEvent.click(screen.getByRole("button", { name: "编辑文字颜色" }));
    expect(screen.getByRole("button", { name: "编辑文字颜色 黑色" }).closest(".moki-menu-surface"))
      .toHaveClass("top-full", "mt-2");
  });

  it("changes font size while entering text and for a selected note", async () => {
    mockCanvas();
    const store = new NativeWhiteboardStore();
    let editor: NativeWhiteboardEditor | undefined;
    render(createElement(NativeWhiteboard, {
      store,
      onMount: (value) => { editor = value; },
    }));
    editor!.setCurrentTool("text");
    const canvas = document.querySelector(".native-whiteboard-canvas") as HTMLCanvasElement;
    fireEvent.pointerDown(canvas, { button: 0, clientX: 120, clientY: 120, pointerId: 1 });
    fireEvent.click(screen.getByRole("button", { name: "编辑字号 XL" }));
    const input = screen.getByRole("textbox", { name: "输入白板文字" });
    fireEvent.change(input, { target: { value: "大标题" } });
    fireEvent.blur(input);

    await waitFor(() => expect(editor!.getCurrentPageShapeIds()).toHaveLength(1));
    const textId = [...editor!.getCurrentPageShapeIds()][0]!;
    expect(editor!.getShape(textId)?.props.size).toBe("xl");

    editor!.createShapes([{
      id: "shape:note-size",
      type: "note",
      x: 300,
      y: 180,
      props: { richText: "便签", size: "m", scale: 1 },
    }]);
    editor!.select("shape:note-size");
    fireEvent.click(await screen.findByRole("button", { name: "选中字号 L" }));
    expect(editor!.getShape("shape:note-size")?.props.size).toBe("l");
    fireEvent.click(screen.getByRole("button", { name: "选中文字居中" }));
    expect(editor!.getShape("shape:note-size")?.props.textAlign).toBe("middle");
    fireEvent.click(screen.getByRole("button", { name: "选中文字颜色" }));
    fireEvent.click(screen.getByRole("button", { name: "选中文字颜色 红色" }));
    expect(editor!.getShape("shape:note-size")?.props).toMatchObject({
      labelColor: "red",
    });
    expect(editor!.getShape("shape:note-size")?.props.color).not.toBe("red");
  });

  it("applies italic styling visibly and persists it for whiteboard text", async () => {
    const canvasMethods = mockCanvas();
    const store = new NativeWhiteboardStore();
    let editor: NativeWhiteboardEditor | undefined;
    render(createElement(NativeWhiteboard, {
      store,
      onMount: (value) => { editor = value; },
    }));
    editor!.setCurrentTool("text");
    const canvas = document.querySelector(".native-whiteboard-canvas") as HTMLCanvasElement;
    fireEvent.pointerDown(canvas, { button: 0, clientX: 120, clientY: 120, pointerId: 1 });

    const input = screen.getByRole("textbox", { name: "输入白板文字" });
    const italicButton = screen.getByRole("button", { name: "编辑文字倾斜" });
    expect(italicButton).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(italicButton);
    expect(italicButton).toHaveAttribute("aria-pressed", "true");
    expect(input).toHaveStyle({ fontStyle: "italic", fontSynthesis: "style" });

    fireEvent.change(input, { target: { value: "斜体文字" } });
    fireEvent.blur(input);
    await waitFor(() => expect(editor!.getCurrentPageShapeIds()).toHaveLength(1));
    const textId = [...editor!.getCurrentPageShapeIds()][0]!;
    expect(editor!.getShape(textId)?.props.italic).toBe(true);
    await waitFor(() => expect(canvasMethods.get("transform"))
      .toHaveBeenCalledWith(1, 0, -0.2, 1, 0, 0));

    editor!.select(textId);
    fireEvent.click(await screen.findByRole("button", { name: "选中文字倾斜" }));
    expect(editor!.getShape(textId)?.props.italic).toBe(false);
  });

  it("expands and persists the inline text editor from its browser-measured content size", async () => {
    mockCanvas();
    vi.spyOn(HTMLTextAreaElement.prototype, "scrollHeight", "get").mockReturnValue(180);
    vi.spyOn(HTMLTextAreaElement.prototype, "scrollWidth", "get").mockReturnValue(420);
    const store = new NativeWhiteboardStore();
    let editor: NativeWhiteboardEditor | undefined;
    render(createElement(NativeWhiteboard, {
      store,
      onMount: (value) => { editor = value; },
    }));
    editor!.setCurrentTool("text");
    const canvas = document.querySelector(".native-whiteboard-canvas") as HTMLCanvasElement;
    fireEvent.pointerDown(canvas, { button: 0, clientX: 120, clientY: 120, pointerId: 2 });

    const input = screen.getByRole("textbox", { name: "输入白板文字" });
    fireEvent.change(input, { target: { value: "第一行\n第二行\n第三行" } });

    await waitFor(() => {
      expect(Number.parseFloat(input.style.width)).toBeGreaterThanOrEqual(420);
      expect(Number.parseFloat(input.style.height)).toBeGreaterThanOrEqual(180);
    });
    expect(input).toHaveAttribute("wrap", "off");
    fireEvent.blur(input);
    await waitFor(() => expect(editor!.getCurrentPageShapeIds()).toHaveLength(1));
    const shape = editor!.getShape([...editor!.getCurrentPageShapeIds()][0]!);
    expect(Number(shape?.props.w)).toBeGreaterThanOrEqual(420);
    expect(Number(shape?.props.h)).toBeGreaterThanOrEqual(180);
  });

  it("stores the selected pen thickness on new strokes", async () => {
    mockCanvas();
    const store = new NativeWhiteboardStore();
    let editor: NativeWhiteboardEditor | undefined;
    render(createElement(NativeWhiteboard, {
      store,
      color: "black",
      drawColor: "red",
      drawSize: "xl",
      onMount: (value) => { editor = value; },
    }));
    editor!.setCurrentTool("draw");
    const canvas = document.querySelector(".native-whiteboard-canvas") as HTMLCanvasElement;
    fireEvent.pointerDown(canvas, { button: 0, clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(canvas, { button: 0, clientX: 180, clientY: 160, pointerId: 1 });
    fireEvent.pointerUp(canvas, { button: 0, clientX: 180, clientY: 160, pointerId: 1 });

    await waitFor(() => expect(editor!.getCurrentPageShapeIds()).toHaveLength(1));
    const stroke = editor!.getShape([...editor!.getCurrentPageShapeIds()][0]!);
    expect(stroke?.props).toMatchObject({ color: "red", size: "xl" });
  });

  it("creates a saved Bezier path from dragged pen anchors and renders its control points", async () => {
    const canvasMethods = mockCanvas();
    const store = new NativeWhiteboardStore();
    let editor: NativeWhiteboardEditor | undefined;
    render(createElement(NativeWhiteboard, {
      store,
      drawColor: "red",
      drawSize: "l",
      onMount: (value) => { editor = value; },
    }));
    editor!.setCurrentTool("pen");
    const canvas = document.querySelector(".native-whiteboard-canvas") as HTMLCanvasElement;
    fireEvent.pointerDown(canvas, { button: 0, clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(canvas, { button: 0, clientX: 130, clientY: 100, pointerId: 1 });
    fireEvent.pointerUp(canvas, { button: 0, clientX: 130, clientY: 100, pointerId: 1 });
    fireEvent.pointerDown(canvas, { button: 0, clientX: 220, clientY: 170, pointerId: 2 });
    fireEvent.pointerMove(canvas, { button: 0, clientX: 245, clientY: 190, pointerId: 2 });
    fireEvent.pointerUp(canvas, { button: 0, clientX: 245, clientY: 190, pointerId: 2 });
    fireEvent.keyDown(window, { key: "Enter" });

    await waitFor(() => expect(editor!.getCurrentPageShapeIds()).toHaveLength(1));
    const shape = editor!.getShape([...editor!.getCurrentPageShapeIds()][0]!);
    expect(shape?.type).toBe("bezier");
    expect(shape?.props).toMatchObject({ color: "red", size: "l", isClosed: false });
    const anchors = shape?.props.anchors as Array<{ x: number; y: number; in: { x: number; y: number }; out: { x: number; y: number } }>;
    expect(anchors).toHaveLength(2);
    expect(anchors[0]!.out.x).toBeGreaterThan(anchors[0]!.x);
    expect(anchors[1]!.in.x).toBeLessThan(anchors[1]!.x);
    expect(nativeShapeBounds(shape!).w).toBeGreaterThan(100);
    await waitFor(() => expect(canvasMethods.get("bezierCurveTo")).toHaveBeenCalled());
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => {
      callback(new Blob(["pen-path"], { type: "image/png" }));
    });
    const curve = canvasMethods.get("bezierCurveTo") as ReturnType<typeof vi.fn>;
    const beforeExport = curve.mock.calls.length;
    const exported = await exportNativeWhiteboardImage(store.snapshot, {
      scope: "selection",
      shapeIds: [shape!.id],
    });
    expect(exported.shapeCount).toBe(1);
    expect(curve.mock.calls.length).toBeGreaterThan(beforeExport);
  });

  it("closes a pen path when the first anchor is clicked again", async () => {
    mockCanvas();
    const store = new NativeWhiteboardStore();
    let editor: NativeWhiteboardEditor | undefined;
    render(createElement(NativeWhiteboard, { store, onMount: (value) => { editor = value; } }));
    editor!.setCurrentTool("pen");
    const canvas = document.querySelector(".native-whiteboard-canvas") as HTMLCanvasElement;
    for (const [index, x, y] of [[1, 100, 100], [2, 220, 100], [3, 220, 220]] as const) {
      fireEvent.pointerDown(canvas, { button: 0, clientX: x, clientY: y, pointerId: index });
      fireEvent.pointerUp(canvas, { button: 0, clientX: x, clientY: y, pointerId: index });
    }
    fireEvent.pointerDown(canvas, { button: 0, clientX: 100, clientY: 100, pointerId: 4 });
    await waitFor(() => expect(editor!.getCurrentPageShapeIds()).toHaveLength(1));
    expect(editor!.getShape([...editor!.getCurrentPageShapeIds()][0]!)?.props.isClosed).toBe(true);
  });

  it("edits saved pen anchors and control handles with one undo step per drag", async () => {
    mockCanvas();
    const store = new NativeWhiteboardStore();
    const seed = new NativeWhiteboardEditor(store);
    seed.createShapes([{
      id: "shape:editable-bezier",
      type: "bezier",
      x: 100,
      y: 100,
      props: {
        anchors: [
          { x: 0, y: 0, in: { x: 0, y: 0 }, out: { x: 20, y: 0 } },
          { x: 100, y: 0, in: { x: 80, y: 0 }, out: { x: 120, y: 0 } },
        ],
        color: "red", size: "m", scale: 1,
      },
    }]);
    let editor: NativeWhiteboardEditor | undefined;
    render(createElement(NativeWhiteboard, { store, onMount: (value) => { editor = value; } }));
    editor!.setCurrentTool("select");
    editor!.select("shape:editable-bezier");
    const canvas = document.querySelector(".native-whiteboard-canvas") as HTMLCanvasElement;
    await waitFor(() => expect(editor!.getViewportPageBounds().w).toBeCloseTo(800));
    const viewport = editor!.getViewportPageBounds();
    const zoom = 800 / viewport.w;
    const screenPoint = (x: number, y: number) => ({ clientX: (x - viewport.x) * zoom, clientY: (y - viewport.y) * zoom });
    const anchors = () => editor!.getShape("shape:editable-bezier")!.props.anchors as Array<{
      x: number; y: number; in: { x: number; y: number }; out: { x: number; y: number };
    }>;

    fireEvent.pointerDown(canvas, { button: 0, pointerId: 41, ...screenPoint(200, 100) });
    fireEvent.pointerMove(canvas, { button: 0, pointerId: 41, ...screenPoint(210, 130) });
    fireEvent.pointerUp(canvas, { button: 0, pointerId: 41, ...screenPoint(210, 130) });
    expect(anchors()[1]).toMatchObject({ x: 110, y: 30, in: { x: 90, y: 30 }, out: { x: 130, y: 30 } });
    expect(editor!.getShape("shape:editable-bezier")?.props.color).toBe("red");
    expect(editor!.undo()).toBe(true);
    expect(anchors()[1]).toMatchObject({ x: 100, y: 0 });
    expect(editor!.redo()).toBe(true);
    editor!.select("shape:editable-bezier");

    fireEvent.pointerDown(canvas, { button: 0, pointerId: 42, ...screenPoint(190, 130) });
    fireEvent.pointerMove(canvas, { button: 0, pointerId: 42, ...screenPoint(190, 150) });
    fireEvent.pointerUp(canvas, { button: 0, pointerId: 42, ...screenPoint(190, 150) });
    expect(anchors()[1]!.in).toMatchObject({ x: 90, y: 50 });
    expect(anchors()[1]!.out.y).toBeCloseTo(30 - 20 / Math.sqrt(2));
  });

  it("inserts an anchor on a selected pen segment and removes it with Alt-click", async () => {
    mockCanvas();
    const store = new NativeWhiteboardStore();
    const seed = new NativeWhiteboardEditor(store);
    seed.createShapes([{
      id: "shape:split-bezier", type: "bezier", x: 100, y: 100,
      props: { anchors: [
        { x: 0, y: 0, in: { x: 0, y: 0 }, out: { x: 0, y: 0 } },
        { x: 100, y: 0, in: { x: 100, y: 0 }, out: { x: 100, y: 0 } },
      ] },
    }]);
    let editor: NativeWhiteboardEditor | undefined;
    render(createElement(NativeWhiteboard, { store, onMount: (value) => { editor = value; } }));
    editor!.setCurrentTool("select");
    editor!.select("shape:split-bezier");
    const canvas = document.querySelector(".native-whiteboard-canvas") as HTMLCanvasElement;
    await waitFor(() => expect(editor!.getViewportPageBounds().w).toBeCloseTo(800));
    const viewport = editor!.getViewportPageBounds();
    const zoom = 800 / viewport.w;
    const screenPoint = (x: number, y: number) => ({ clientX: (x - viewport.x) * zoom, clientY: (y - viewport.y) * zoom });
    const anchors = () => editor!.getShape("shape:split-bezier")!.props.anchors as NativeBezierAnchor[];
    fireEvent.doubleClick(canvas, screenPoint(150, 100));
    expect(anchors()).toHaveLength(3);
    expect(anchors()[1]!.x).toBeCloseTo(50, 0);
    fireEvent.pointerDown(canvas, { button: 0, altKey: true, pointerId: 43, ...screenPoint(150, 100) });
    fireEvent.pointerUp(canvas, { button: 0, altKey: true, pointerId: 43, ...screenPoint(150, 100) });
    expect(anchors()).toHaveLength(2);
  });

  it("resizes selected elements from a corner handle as one history step", async () => {
    mockCanvas();
    const store = new NativeWhiteboardStore();
    const seed = new NativeWhiteboardEditor(store);
    seed.createShapes([{
      id: "shape:resize",
      type: "geo",
      x: 100,
      y: 100,
      props: { w: 100, h: 80, scale: 1 },
    }]);
    let editor: NativeWhiteboardEditor | undefined;
    render(createElement(NativeWhiteboard, {
      store,
      onMount: (value) => { editor = value; },
    }));
    editor!.setCurrentTool("select");
    editor!.select("shape:resize");
    const canvas = document.querySelector(".native-whiteboard-canvas") as HTMLCanvasElement;
    await waitFor(() => expect(editor!.getViewportPageBounds().w).toBeCloseTo(800));
    const viewport = editor!.getViewportPageBounds();
    const zoom = 800 / viewport.w;
    const screen = (point: { x: number; y: number }) => ({
      clientX: (point.x - viewport.x) * zoom,
      clientY: (point.y - viewport.y) * zoom,
    });

    fireEvent.pointerDown(canvas, { button: 0, pointerId: 4, ...screen({ x: 200, y: 180 }) });
    fireEvent.pointerMove(canvas, { button: 0, pointerId: 4, ...screen({ x: 250, y: 220 }) });
    fireEvent.pointerUp(canvas, { button: 0, pointerId: 4, ...screen({ x: 250, y: 220 }) });

    expect(editor!.getShape("shape:resize")?.props.scale).toBeCloseTo(1.5, 4);
    expect(editor!.undo()).toBe(true);
    expect(editor!.getShape("shape:resize")?.props.scale).toBe(1);
  });

  it("stretches selected elements from a single edge without changing the other axis", async () => {
    mockCanvas();
    const store = new NativeWhiteboardStore();
    const seed = new NativeWhiteboardEditor(store);
    seed.createShapes([{
      id: "shape:stretch",
      type: "geo",
      x: 100,
      y: 100,
      props: { w: 100, h: 80, scale: 1 },
    }]);
    let editor: NativeWhiteboardEditor | undefined;
    render(createElement(NativeWhiteboard, {
      store,
      onMount: (value) => { editor = value; },
    }));
    editor!.setCurrentTool("select");
    editor!.select("shape:stretch");
    const canvas = document.querySelector(".native-whiteboard-canvas") as HTMLCanvasElement;
    await waitFor(() => expect(editor!.getViewportPageBounds().w).toBeCloseTo(800));
    const viewport = editor!.getViewportPageBounds();
    const zoom = 800 / viewport.w;
    const screen = (point: { x: number; y: number }) => ({
      clientX: (point.x - viewport.x) * zoom,
      clientY: (point.y - viewport.y) * zoom,
    });

    fireEvent.pointerDown(canvas, { button: 0, pointerId: 7, ...screen({ x: 200, y: 140 }) });
    fireEvent.pointerMove(canvas, { button: 0, pointerId: 7, ...screen({ x: 250, y: 140 }) });
    fireEvent.pointerUp(canvas, { button: 0, pointerId: 7, ...screen({ x: 250, y: 140 }) });

    expect(editor!.getShape("shape:stretch")).toMatchObject({
      x: 100,
      y: 100,
      props: { scale: 1, scaleX: 1.5 },
    });
    expect(editor!.getShapePageBounds("shape:stretch")).toMatchObject({
      width: 150,
      height: 80,
    });
    expect(editor!.undo()).toBe(true);
    expect(editor!.getShapePageBounds("shape:stretch")).toMatchObject({
      width: 100,
      height: 80,
    });

    editor!.select("shape:stretch");
    fireEvent.pointerDown(canvas, { button: 0, pointerId: 8, ...screen({ x: 150, y: 180 }) });
    fireEvent.pointerMove(canvas, { button: 0, pointerId: 8, ...screen({ x: 150, y: 220 }) });
    fireEvent.pointerUp(canvas, { button: 0, pointerId: 8, ...screen({ x: 150, y: 220 }) });
    expect(editor!.getShapePageBounds("shape:stretch")).toMatchObject({
      width: 100,
      height: 120,
    });
  });

  it("rotates freely and snaps to 90 degrees while Shift is held", async () => {
    const methods = mockCanvas();
    const store = new NativeWhiteboardStore();
    const seed = new NativeWhiteboardEditor(store);
    seed.createShapes([{
      id: "shape:rotate",
      type: "geo",
      x: 100,
      y: 100,
      props: { w: 100, h: 80, scale: 1 },
    }]);
    let editor: NativeWhiteboardEditor | undefined;
    render(createElement(NativeWhiteboard, {
      store,
      onMount: (value) => { editor = value; },
    }));
    editor!.setCurrentTool("select");
    editor!.select("shape:rotate");
    const canvas = document.querySelector(".native-whiteboard-canvas") as HTMLCanvasElement;
    await waitFor(() => expect(editor!.getViewportPageBounds().w).toBeCloseTo(800));
    const viewport = editor!.getViewportPageBounds();
    const zoom = 800 / viewport.w;
    const toScreen = (point: { x: number; y: number }) => ({
      clientX: (point.x - viewport.x) * zoom,
      clientY: (point.y - viewport.y) * zoom,
    });
    const center = { x: 150, y: 140 };
    const rotationStart = { x: 215, y: 195 };
    const radius = Math.hypot(
      rotationStart.x - center.x,
      rotationStart.y - center.y,
    );
    const startAngle = Math.atan2(
      rotationStart.y - center.y,
      rotationStart.x - center.x,
    );
    const rotationEnd = {
      x: center.x + Math.cos(startAngle + Math.PI / 4) * radius,
      y: center.y + Math.sin(startAngle + Math.PI / 4) * radius,
    };

    fireEvent.pointerMove(canvas, { button: 0, pointerId: 5, ...toScreen(rotationStart) });
    expect(canvas.style.cursor).toContain("data:image/svg+xml");
    fireEvent.pointerDown(canvas, { button: 0, pointerId: 5, ...toScreen(rotationStart) });
    fireEvent.pointerMove(canvas, { button: 0, pointerId: 5, ...toScreen(rotationEnd) });
    fireEvent.pointerUp(canvas, { button: 0, pointerId: 5, ...toScreen(rotationEnd) });
    expect(editor!.getShape("shape:rotate")?.rotation).toBeCloseTo(45, 4);

    expect(editor!.undo()).toBe(true);
    editor!.select("shape:rotate");
    fireEvent.pointerDown(canvas, { button: 0, pointerId: 6, ...toScreen(rotationStart) });
    fireEvent.pointerMove(canvas, { button: 0, pointerId: 6, shiftKey: true, ...toScreen(rotationEnd) });
    fireEvent.pointerUp(canvas, { button: 0, pointerId: 6, shiftKey: true, ...toScreen(rotationEnd) });
    expect(editor!.getShape("shape:rotate")?.rotation).toBe(90);
    await waitFor(() => {
      const rotate = methods.get("rotate") as ReturnType<typeof vi.fn>;
      const quarterTurns = rotate.mock.calls.filter(([angle]) => (
        Math.abs(Number(angle) - Math.PI / 2) < 0.0001
      ));
      expect(quarterTurns).toHaveLength(2);
    });
  });

  it("renames the current page without changing its id", () => {
    const store = new NativeWhiteboardStore();
    const editor = new NativeWhiteboardEditor(store);
    const pageId = editor.getCurrentPageId();

    expect(editor.renamePage(pageId, "创意方案")).toBe(true);
    expect(editor.getCurrentPage()).toEqual({ id: pageId, name: "创意方案" });
  });

  it("opens a newly created page directly in its focused naming field", async () => {
    mockCanvas();
    const store = new NativeWhiteboardStore();
    let editor: NativeWhiteboardEditor | undefined;
    render(createElement(NativeWhiteboard, {
      store,
      onMount: (value) => { editor = value; },
    }));

    fireEvent.click(screen.getByRole("button", { name: "新建白板页面" }));

    const input = await screen.findByRole("textbox", { name: "重命名白板页面 页面 2" });
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute("placeholder", "请输入页面名称");
    fireEvent.change(input, { target: { value: "发布计划" } });
    fireEvent.blur(input);

    await waitFor(() => expect(editor!.getCurrentPage().name).toBe("发布计划"));
    expect(screen.getByRole("button", { name: "切换到页面 发布计划" }))
      .toHaveTextContent("刚刚编辑");
  });

  it("moves text and geometry from their edges while their creation tools stay active", async () => {
    mockCanvas();
    const store = new NativeWhiteboardStore();
    const seed = new NativeWhiteboardEditor(store);
    seed.createShapes([
      {
        id: "shape:text-edge",
        type: "text",
        x: 100,
        y: 100,
        props: { w: 200, richText: { type: "doc", content: [] } },
      },
      {
        id: "shape:geo-edge",
        type: "geo",
        x: 380,
        y: 100,
        props: { w: 120, h: 100, geo: "rectangle" },
      },
    ]);
    let editor: NativeWhiteboardEditor | undefined;
    render(createElement(NativeWhiteboard, {
      store,
      onMount: (value) => { editor = value; },
    }));
    const canvas = document.querySelector(".native-whiteboard-canvas") as HTMLCanvasElement;
    await waitFor(() => expect(editor!.getViewportPageBounds().w).toBeCloseTo(800));
    const viewport = editor!.getViewportPageBounds();
    const zoom = 800 / viewport.w;
    const screenPoint = (x: number, y: number) => ({
      clientX: (x - viewport.x) * zoom,
      clientY: (y - viewport.y) * zoom,
    });

    editor!.setCurrentTool("text");
    fireEvent.pointerMove(canvas, screenPoint(100, 120));
    expect(canvas.style.cursor).toBe("move");
    fireEvent.pointerDown(canvas, { button: 0, pointerId: 21, ...screenPoint(100, 120) });
    fireEvent.pointerMove(canvas, { button: 0, pointerId: 21, ...screenPoint(150, 150) });
    fireEvent.pointerUp(canvas, { button: 0, pointerId: 21, ...screenPoint(150, 150) });
    expect(editor!.getShape("shape:text-edge")).toMatchObject({ x: 150, y: 130 });

    editor!.setCurrentTool("geo");
    fireEvent.pointerMove(canvas, screenPoint(380, 130));
    expect(canvas.style.cursor).toBe("move");
    fireEvent.pointerDown(canvas, { button: 0, pointerId: 22, ...screenPoint(380, 130) });
    fireEvent.pointerMove(canvas, { button: 0, pointerId: 22, ...screenPoint(410, 170) });
    fireEvent.pointerUp(canvas, { button: 0, pointerId: 22, ...screenPoint(410, 170) });
    expect(editor!.getShape("shape:geo-edge")).toMatchObject({ x: 410, y: 140 });
  });

  it("draws geometry from the pressed top-left point and resizes it while the shape tool remains active", async () => {
    mockCanvas();
    const store = new NativeWhiteboardStore();
    let editor: NativeWhiteboardEditor | undefined;
    render(createElement(NativeWhiteboard, {
      store,
      onMount: (value) => { editor = value; },
    }));
    const canvas = document.querySelector(".native-whiteboard-canvas") as HTMLCanvasElement;
    await waitFor(() => expect(editor!.getViewportPageBounds().w).toBeCloseTo(800));
    const viewport = editor!.getViewportPageBounds();
    const zoom = 800 / viewport.w;
    const screenPoint = (x: number, y: number) => ({
      clientX: (x - viewport.x) * zoom,
      clientY: (y - viewport.y) * zoom,
    });

    editor!.setCurrentTool("geo");
    fireEvent.pointerDown(canvas, { button: 0, pointerId: 59, ...screenPoint(90, 90) });
    fireEvent.pointerUp(canvas, { button: 0, pointerId: 59, ...screenPoint(90, 90) });
    expect(editor!.getCurrentPageShapeIds()).toHaveLength(0);
    editor!.setCurrentTool("arrow");
    fireEvent.pointerDown(canvas, { button: 0, pointerId: 60, ...screenPoint(110, 90) });
    fireEvent.pointerUp(canvas, { button: 0, pointerId: 60, ...screenPoint(110, 90) });
    expect(editor!.getCurrentPageShapeIds()).toHaveLength(0);

    editor!.setCurrentTool("geo");
    fireEvent.pointerDown(canvas, { button: 0, pointerId: 61, ...screenPoint(140, 120) });
    fireEvent.pointerMove(canvas, { button: 0, pointerId: 61, ...screenPoint(300, 250) });
    fireEvent.pointerUp(canvas, { button: 0, pointerId: 61, ...screenPoint(300, 250) });

    const shapeId = editor!.getSelectedShapeIds()[0]!;
    expect(editor!.getShape(shapeId)).toMatchObject({
      x: 140,
      y: 120,
      props: { w: 160, h: 130 },
    });

    fireEvent.pointerMove(canvas, screenPoint(300, 185));
    expect(canvas.style.cursor).toBe("ew-resize");
    fireEvent.pointerDown(canvas, { button: 0, pointerId: 62, ...screenPoint(300, 185) });
    fireEvent.pointerMove(canvas, { button: 0, pointerId: 62, ...screenPoint(360, 185) });
    fireEvent.pointerUp(canvas, { button: 0, pointerId: 62, ...screenPoint(360, 185) });
    expect(Number(editor!.getShape(shapeId)?.props.scaleX)).toBeGreaterThan(1);

    fireEvent.pointerDown(canvas, { button: 0, pointerId: 63, ...screenPoint(520, 420) });
    fireEvent.pointerMove(canvas, { button: 0, pointerId: 63, ...screenPoint(440, 340) });
    fireEvent.pointerUp(canvas, { button: 0, pointerId: 63, ...screenPoint(440, 340) });
    const reverseShape = editor!.getShape(editor!.getSelectedShapeIds()[0]!);
    expect(reverseShape).toMatchObject({ x: 520, y: 420, props: { w: 80, h: 60 } });
  });

  it("shows color and thickness controls only for selected paintable content", async () => {
    mockCanvas();
    const store = new NativeWhiteboardStore();
    const seed = new NativeWhiteboardEditor(store);
    seed.createShapes([{
      id: "shape:styled-geo",
      type: "geo",
      x: 120,
      y: 120,
      props: { w: 180, h: 120, geo: "rectangle", size: "m" },
    }]);
    let editor: NativeWhiteboardEditor | undefined;
    render(createElement(NativeWhiteboard, {
      store,
      onMount: (value) => { editor = value; },
    }));

    expect(screen.queryByRole("button", { name: "选中内容颜色" })).not.toBeInTheDocument();
    editor!.select("shape:styled-geo");
    expect(await screen.findByRole("button", { name: "选中内容颜色" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "选中内容粗细 XL" }));
    fireEvent.click(screen.getByRole("button", { name: "选中内容颜色" }));
    expect(screen.getByLabelText("选中图形描边和填充").closest("[data-whiteboard-color-menu]"))
      .toHaveClass("moki-menu-surface");
    fireEvent.click(screen.getByRole("button", { name: "关闭选中图形填充" }));
    const redStroke = screen.getByRole("button", { name: "选中图形描边颜色 红色" });
    expect(redStroke).toHaveClass("native-whiteboard-color-swatch", "size-7", "min-h-0", "min-w-7", "rounded-full");
    expect(redStroke).toHaveStyle({ width: "28px", height: "28px", minHeight: "28px", borderRadius: "50%" });
    fireEvent.click(redStroke);
    const strokeOpacity = screen.getByRole("slider", { name: "选中图形描边透明度" });
    expect(strokeOpacity).toHaveClass("native-whiteboard-opacity-slider");
    expect(fireEvent.pointerDown(strokeOpacity, { pointerId: 67, clientX: 40, clientY: 10 })).toBe(true);
    fireEvent.change(strokeOpacity, { target: { value: "35" } });

    expect(editor!.getShape("shape:styled-geo")?.props).toMatchObject({
      size: "xl",
      color: "red",
      strokeColor: "red",
      strokeOpacity: 0.35,
      fillEnabled: false,
    });

    const colorTrigger = screen.getByRole("button", { name: "选中内容颜色" });
    const colorMenu = screen.getByRole("dialog", { name: "选中内容调色盘" });
    expect(colorTrigger).toHaveAttribute("aria-controls", colorMenu.id);
    colorTrigger.focus();
    fireEvent.keyDown(colorTrigger, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "选中内容调色盘" })).not.toBeInTheDocument();
    expect(colorTrigger).toHaveFocus();

    fireEvent.click(colorTrigger);
    const uninstallOutsideDismiss = installModalOutsideDismiss();
    try {
      fireEvent.pointerDown(document.body);
      expect(screen.queryByRole("dialog", { name: "选中内容调色盘" })).not.toBeInTheDocument();
    } finally {
      uninstallOutsideDismiss();
    }
  });

  it("selects and edits an existing arrow while the arrow tool remains active", async () => {
    mockCanvas();
    const store = new NativeWhiteboardStore();
    const seed = new NativeWhiteboardEditor(store);
    seed.createShapes([{
      id: "shape:existing-arrow",
      type: "arrow",
      x: 100,
      y: 100,
      props: { start: { x: 0, y: 0 }, end: { x: 140, y: 60 }, size: "m" },
    }]);
    let editor: NativeWhiteboardEditor | undefined;
    render(createElement(NativeWhiteboard, {
      store,
      onMount: (value) => { editor = value; },
    }));
    editor!.setCurrentTool("arrow");
    const canvas = document.querySelector(".native-whiteboard-canvas") as HTMLCanvasElement;
    await waitFor(() => expect(editor!.getViewportPageBounds().w).toBeCloseTo(800));
    const viewport = editor!.getViewportPageBounds();
    const zoom = 800 / viewport.w;
    const screenPoint = (x: number, y: number) => ({
      clientX: (x - viewport.x) * zoom,
      clientY: (y - viewport.y) * zoom,
    });

    fireEvent.pointerMove(canvas, screenPoint(170, 130));
    expect(canvas.style.cursor).toBe("move");
    fireEvent.pointerDown(canvas, { button: 0, pointerId: 64, ...screenPoint(170, 130) });
    fireEvent.pointerUp(canvas, { button: 0, pointerId: 64, ...screenPoint(170, 130) });

    expect(editor!.getCurrentPageShapeIds()).toHaveLength(1);
    expect(editor!.getSelectedShapeIds()).toEqual(["shape:existing-arrow"]);
    expect(await screen.findByLabelText("选中内容样式")).toBeInTheDocument();

    fireEvent.pointerDown(canvas, { button: 0, pointerId: 65, ...screenPoint(170, 130) });
    fireEvent.pointerMove(canvas, { button: 0, pointerId: 65, ...screenPoint(210, 160) });
    fireEvent.pointerUp(canvas, { button: 0, pointerId: 65, ...screenPoint(210, 160) });
    expect(editor!.getShape("shape:existing-arrow")).toMatchObject({ x: 140, y: 130 });

    editor!.select();
    fireEvent.pointerMove(canvas, screenPoint(280, 190));
    expect(canvas.style.cursor).toBe("grab");
    fireEvent.pointerDown(canvas, { button: 0, pointerId: 66, ...screenPoint(280, 190) });
    fireEvent.pointerMove(canvas, { button: 0, pointerId: 66, ...screenPoint(330, 230) });
    fireEvent.pointerUp(canvas, { button: 0, pointerId: 66, ...screenPoint(330, 230) });

    expect(editor!.getCurrentPageShapeIds()).toHaveLength(1);
    expect(editor!.getSelectedShapeIds()).toEqual(["shape:existing-arrow"]);
    expect(editor!.getShape("shape:existing-arrow")).toMatchObject({
      x: 140,
      y: 130,
      props: { end: { x: 190, y: 100 } },
    });
  });

  it("creates styled arrows and adjusts either endpoint directly", async () => {
    mockCanvas();
    const store = new NativeWhiteboardStore();
    let editor: NativeWhiteboardEditor | undefined;
    render(createElement(NativeWhiteboard, {
      store,
      arrowStyle: "double",
      onMount: (value) => { editor = value; },
    }));
    editor!.setCurrentTool("arrow");
    const canvas = document.querySelector(".native-whiteboard-canvas") as HTMLCanvasElement;
    await waitFor(() => expect(editor!.getViewportPageBounds().w).toBeCloseTo(800));
    const viewport = editor!.getViewportPageBounds();
    const zoom = 800 / viewport.w;
    const screenPoint = (x: number, y: number) => ({
      clientX: (x - viewport.x) * zoom,
      clientY: (y - viewport.y) * zoom,
    });

    fireEvent.pointerDown(canvas, { button: 0, pointerId: 31, ...screenPoint(100, 100) });
    fireEvent.pointerMove(canvas, { button: 0, pointerId: 31, ...screenPoint(240, 160) });
    fireEvent.pointerUp(canvas, { button: 0, pointerId: 31, ...screenPoint(240, 160) });
    const arrowId = editor!.getSelectedShapeIds()[0]!;
    expect(editor!.getShape(arrowId)?.props).toMatchObject({
      arrowStyle: "double",
      end: { x: 140, y: 60 },
    });

    fireEvent.pointerMove(canvas, screenPoint(240, 160));
    expect(canvas.style.cursor).toBe("grab");
    fireEvent.pointerDown(canvas, { button: 0, pointerId: 32, ...screenPoint(240, 160) });
    fireEvent.pointerMove(canvas, { button: 0, pointerId: 32, ...screenPoint(300, 220) });
    fireEvent.pointerUp(canvas, { button: 0, pointerId: 32, ...screenPoint(300, 220) });
    expect(editor!.getShape(arrowId)).toMatchObject({
      x: 100,
      y: 100,
      props: { end: { x: 200, y: 120 }, scale: 1, scaleX: 1, scaleY: 1 },
    });
  });

  it("renames a page from the inline page control", async () => {
    mockCanvas();
    const store = new NativeWhiteboardStore();
    let editor: NativeWhiteboardEditor | undefined;
    render(createElement(NativeWhiteboard, {
      store,
      onMount: (value) => { editor = value; },
    }));

    fireEvent.click(screen.getByRole("button", { name: "打开白板页面菜单" }));
    fireEvent.click(screen.getByRole("button", { name: "重命名页面 页面 1" }));
    const input = screen.getByRole("textbox", { name: "重命名白板页面 页面 1" });
    fireEvent.change(input, { target: { value: "执行方案" } });
    fireEvent.blur(input);

    await waitFor(() => expect(editor!.getCurrentPage().name).toBe("执行方案"));
    expect(screen.getByRole("button", { name: "打开白板页面菜单" })).toHaveTextContent("执行方案");
  });

  it("renames a page by double-clicking its name in the page list", async () => {
    mockCanvas();
    const store = new NativeWhiteboardStore();
    let editor: NativeWhiteboardEditor | undefined;
    render(createElement(NativeWhiteboard, {
      store,
      onMount: (value) => { editor = value; },
    }));

    fireEvent.click(screen.getByRole("button", { name: "打开白板页面菜单" }));
    const pageButton = screen.getByRole("button", { name: "切换到页面 页面 1" });
    fireEvent.click(pageButton, { detail: 1 });
    fireEvent.click(pageButton, { detail: 2 });
    fireEvent.doubleClick(pageButton, { detail: 2 });

    const input = screen.getByRole("textbox", { name: "重命名白板页面 页面 1" });
    fireEvent.change(input, { target: { value: "分镜排版" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(editor!.getCurrentPage().name).toBe("分镜排版"));
    expect(screen.getByRole("button", { name: "切换到页面 分镜排版" })).toBeInTheDocument();
  });

  it("requires confirmation before permanently deleting a page", async () => {
    mockCanvas();
    const store = new NativeWhiteboardStore();
    const seed = new NativeWhiteboardEditor(store);
    const firstId = seed.getCurrentPageId();
    const firstName = seed.getCurrentPage().name;
    const secondId = seed.createPage();
    render(createElement(NativeWhiteboard, { store }));

    fireEvent.click(screen.getByRole("button", { name: "打开白板页面菜单" }));
    fireEvent.click(screen.getByRole("button", { name: `删除页面 ${firstName}` }));
    expect(screen.getByRole("alertdialog", { name: `删除“${firstName}”？` }))
      .toHaveTextContent("删除后无法恢复");
    expect(seed.getPages()).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(seed.getPages()).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "打开白板页面菜单" }));
    fireEvent.click(screen.getByRole("button", { name: `删除页面 ${firstName}` }));
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));

    await waitFor(() => expect(seed.getPages().map((page) => page.id)).toEqual([secondId]));
    expect(seed.getPages().some((page) => page.id === firstId)).toBe(false);
  });

  it("searches pages and persists their drag order", async () => {
    mockCanvas();
    const store = new NativeWhiteboardStore();
    const seed = new NativeWhiteboardEditor(store);
    const firstId = seed.getCurrentPageId();
    seed.renamePage(firstId, "概念方案");
    const secondId = seed.createPage();
    seed.renamePage(secondId, "执行页面");
    const thirdId = seed.createPage();
    seed.renamePage(thirdId, "交付页面");
    let editor: NativeWhiteboardEditor | undefined;
    render(createElement(NativeWhiteboard, {
      store,
      onMount: (value) => { editor = value; },
    }));

    fireEvent.click(screen.getByRole("button", { name: "打开白板页面菜单" }));
    const search = screen.getByRole("searchbox", { name: "搜索白板页面" });
    fireEvent.change(search, { target: { value: "执行" } });
    expect(screen.getByRole("button", { name: "切换到页面 执行页面" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "切换到页面 概念方案" })).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: "" } });
    const source = screen.getByRole("button", { name: "切换到页面 交付页面" }).closest("li")!;
    const target = screen.getByRole("button", { name: "切换到页面 概念方案" }).closest("li")!;
    vi.spyOn(target, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 100,
      left: 0,
      top: 100,
      right: 280,
      bottom: 140,
      width: 280,
      height: 40,
      toJSON: () => ({}),
    });
    const dataTransfer = {
      effectAllowed: "none",
      setData: vi.fn(),
      getData: vi.fn(() => thirdId),
    };
    fireEvent.dragStart(source, { dataTransfer });
    fireEvent.dragOver(target, { dataTransfer, clientY: 105 });
    fireEvent.drop(target, { dataTransfer, clientY: 105 });

    await waitFor(() => expect(editor!.getPages().map((page) => page.id)).toEqual([
      firstId,
      thirdId,
      secondId,
    ]));
    expect(editor!.movePage(thirdId, firstId, "before")).toBe(true);
    expect(editor!.getPages().map((page) => page.id)).toEqual([thirdId, firstId, secondId]);
  });

  it("creates page groups and moves pages into and out of them", async () => {
    mockCanvas();
    const store = new NativeWhiteboardStore();
    const seed = new NativeWhiteboardEditor(store);
    const firstId = seed.getCurrentPageId();
    seed.renamePage(firstId, "需求梳理");
    const secondId = seed.createPage();
    seed.renamePage(secondId, "交付清单");
    let editor: NativeWhiteboardEditor | undefined;
    render(createElement(NativeWhiteboard, {
      store,
      onMount: (value) => { editor = value; },
    }));

    fireEvent.click(screen.getByRole("button", { name: "打开白板页面菜单" }));
    const addGroup = screen.getByRole("button", { name: "新建页面分组" });
    expect(addGroup).toHaveTextContent("");
    fireEvent.click(addGroup);
    const groupInput = screen.getByRole("textbox", { name: "重命名页面分组 新分组" });
    fireEvent.change(groupInput, { target: { value: "项目推进" } });
    fireEvent.blur(groupInput);

    await waitFor(() => expect(editor!.getPageGroups()).toEqual([
      { id: expect.stringMatching(/^page-group:/u), name: "项目推进", pageIds: [secondId] },
    ]));
    fireEvent.click(screen.getByRole("button", { name: "新建页面分组" }));
    const secondGroupInput = screen.getByRole("textbox", { name: "重命名页面分组 新分组" });
    fireEvent.change(secondGroupInput, { target: { value: "后续复盘" } });
    fireEvent.blur(secondGroupInput);
    await waitFor(() => expect(editor!.getPageGroups()).toEqual([
      { id: expect.stringMatching(/^page-group:/u), name: "项目推进", pageIds: [secondId] },
      { id: expect.stringMatching(/^page-group:/u), name: "后续复盘", pageIds: [] },
    ]));
    const groupAccents = Array.from(document.querySelectorAll("[data-page-group-accent]"));
    expect(groupAccents).toHaveLength(2);
    expect(groupAccents[0]).toHaveAttribute("data-page-group-accent", "violet");
    expect(groupAccents[1]).toHaveAttribute("data-page-group-accent", "teal");

    const pageSearch = screen.getByRole("searchbox", { name: "搜索白板页面" });
    expect(pageSearch).toHaveAttribute("placeholder", "搜索页面或分组");
    fireEvent.change(pageSearch, { target: { value: "项目推进" } });
    expect(screen.getByRole("button", { name: "切换到页面 交付清单" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "切换到页面 需求梳理" })).not.toBeInTheDocument();
    fireEvent.change(pageSearch, { target: { value: "" } });

    const collapseGroup = screen.getByRole("button", { name: "收起页面分组 项目推进" });
    expect(collapseGroup).toHaveClass("border-0", "bg-transparent", "hover:bg-transparent");
    fireEvent.click(collapseGroup);
    expect(screen.queryByRole("button", { name: "切换到页面 交付清单" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "展开页面分组 项目推进" }));
    expect(screen.getByRole("button", { name: "切换到页面 交付清单" })).toBeInTheDocument();

    const emptyGroup = editor!.getPageGroups().find((group) => group.name === "后续复盘");
    expect(emptyGroup).toBeDefined();
    editor!.deletePageGroup(emptyGroup!.id);
    fireEvent.doubleClick(screen.getByText("项目推进"));
    const renameGroup = screen.getByRole("textbox", { name: "重命名页面分组 项目推进" });
    fireEvent.change(renameGroup, { target: { value: "客户项目" } });
    fireEvent.blur(renameGroup);
    await waitFor(() => expect(editor!.getPageGroups()[0]?.name).toBe("客户项目"));
    const source = screen.getByRole("button", { name: "切换到页面 需求梳理" }).closest("li")!;
    const groupTarget = screen.getByText("客户项目").closest("div")!;
    const dataTransfer = {
      effectAllowed: "none",
      setData: vi.fn(),
      getData: vi.fn(() => firstId),
    };
    fireEvent.dragStart(source, { dataTransfer });
    fireEvent.dragOver(groupTarget, { dataTransfer });
    fireEvent.drop(groupTarget, { dataTransfer });

    await waitFor(() => expect(editor!.getPageGroups()[0]?.pageIds).toEqual([firstId, secondId]));
    const groupedPage = screen.getByRole("button", { name: "切换到页面 交付清单" }).closest("li")!;
    const ungroupedTarget = screen.getByRole("list", { name: "未分组页面" }).closest("li")!;
    fireEvent.dragStart(groupedPage, { dataTransfer: { ...dataTransfer, getData: vi.fn(() => secondId) } });
    fireEvent.dragOver(ungroupedTarget, { dataTransfer });
    fireEvent.drop(ungroupedTarget, { dataTransfer: { ...dataTransfer, getData: vi.fn(() => secondId) } });

    await waitFor(() => {
      expect(editor!.getPageGroups()[0]?.pageIds).toEqual([firstId]);
      expect(screen.getByRole("list", { name: "未分组页面" }))
        .toContainElement(screen.getByRole("button", { name: "切换到页面 交付清单" }));
    });
  });

  it("persists group order, including empty and legacy groups, without changing pages", () => {
    const store = new NativeWhiteboardStore();
    const editor = new NativeWhiteboardEditor(store);
    const pageId = editor.getCurrentPageId();
    const first = editor.createPageGroup(pageId, "需求")!;
    const second = editor.createPageGroup(pageId, "执行")!;
    const third = editor.createPageGroup(pageId, "复盘")!;
    const pageBefore = structuredClone(store.snapshot.document.store[pageId]);
    // Older snapshots can express a group only through page metadata.
    store.mutate(snapshot => { delete snapshot.document.store[first]; });
    const initialOrder = editor.getPageGroups().map(group => group.id);
    expect(editor.movePageGroup(first, second, "before")).toBe(true);
    expect(editor.getPageGroups().map(group => group.id)).toEqual([first, second, third]);
    expect(editor.movePageGroup(first, third, "after")).toBe(true);
    expect(editor.getPageGroups().map(group => group.id)).toEqual([second, third, first]);
    expect(store.snapshot.document.store[pageId]).toEqual(pageBefore);
    expect(editor.getCurrentPageId()).toBe(pageId);
    const restored = new NativeWhiteboardStore();
    restored.replace(JSON.parse(JSON.stringify(store.snapshot)));
    expect(new NativeWhiteboardEditor(restored).getPageGroups()).toEqual(editor.getPageGroups());
    expect(editor.movePageGroup(first, first)).toBe(false);
    expect(editor.movePageGroup("missing", second)).toBe(false);
    expect(editor.movePageGroup(first, "missing")).toBe(false);
    expect(editor.movePageGroup(first, third, "after")).toBe(false);
    editor.undo();
    expect(editor.getPageGroups().map(group => group.id)).toEqual([first, second, third]);
    editor.undo();
    expect(editor.getPageGroups().map(group => group.id)).toEqual(initialOrder);
  });

  it("drags collapsed group headers before and after other groups while searching", async () => {
    mockCanvas();
    const store = new NativeWhiteboardStore();
    const editor = new NativeWhiteboardEditor(store);
    const pageId = editor.getCurrentPageId();
    const first = editor.createPageGroup(pageId, "项目需求")!;
    const hidden = editor.createPageGroup(pageId, "隐藏分组")!;
    const last = editor.createPageGroup(pageId, "项目交付")!;
    render(createElement(NativeWhiteboard, { store }));
    fireEvent.click(screen.getByRole("button", { name: "打开白板页面菜单" }));
    fireEvent.click(screen.getByRole("button", { name: "收起页面分组 项目交付" }));
    const drag = (sourceName: string, targetName: string, clientY: number) => {
      const source = screen.getByText(sourceName).closest("div")!;
      const target = screen.getByText(targetName).closest("div")!;
      const list = screen.getByRole("list", { name: "白板页面列表" });
      vi.spyOn(list, "getBoundingClientRect").mockReturnValue({ top: 0, bottom: 600, left: 0, right: 300 } as DOMRect);
      const headers = [...list.querySelectorAll<HTMLElement>("[data-page-group-header]")];
      const targetIndex = headers.indexOf(target);
      headers.forEach((header, index) => vi.spyOn(header, "getBoundingClientRect").mockReturnValue({ top: 100 + (index - targetIndex) * 60, height: 40 } as DOMRect));
      for (const type of ["pointerdown", "pointermove", "pointerup"]) {
        const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: 20, clientY: type === "pointerdown" ? source.getBoundingClientRect().top + 20 : clientY });
        Object.defineProperty(event, "pointerId", { value: 1 });
        fireEvent(source, event);
      }
    };
    drag("项目交付", "项目需求", 105);
    await waitFor(() => expect(editor.getPageGroups().map(group => group.id)).toEqual([last, first, hidden]));
    expect(screen.getByRole("button", { name: "展开页面分组 项目交付" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox", { name: "搜索白板页面" }), { target: { value: "项目" } });
    drag("项目交付", "项目需求", 135);
    await waitFor(() => expect(editor.getPageGroups().map(group => group.id)).toEqual([first, last, hidden]));
    expect(editor.getPageGroups().find(group => group.id === first)?.pageIds).toEqual([pageId]);
    expect(editor.getPageGroups().find(group => group.id === last)?.pageIds).toEqual([]);
  });

  it("keeps the current page selected when deleting another page", () => {
    const store = new NativeWhiteboardStore();
    const editor = new NativeWhiteboardEditor(store);
    const firstId = editor.getCurrentPageId();
    const secondId = editor.createPage();

    editor.deletePage(firstId);

    expect(editor.getCurrentPageId()).toBe(secondId);
    expect(editor.getPages().map((page) => page.id)).toEqual([secondId]);
  });

  it("renames whiteboard materials and their embedded asset metadata", () => {
    const store = new NativeWhiteboardStore();
    const editor = new NativeWhiteboardEditor(store);
    const pageId = editor.getCurrentPageId();
    store.mutate((snapshot) => {
      snapshot.document.store["asset:image"] = {
        id: "asset:image",
        typeName: "asset",
        type: "image",
        props: { name: "image.png", src: "data:image/png;base64,cG5n" },
        meta: {},
      };
      snapshot.document.store["shape:image"] = {
        id: "shape:image",
        typeName: "shape",
        type: "image",
        parentId: pageId,
        index: "a1",
        x: 0,
        y: 0,
        rotation: 0,
        opacity: 1,
        props: { assetId: "asset:image", altText: "image.png" },
        meta: {},
      };
      snapshot.document.store["shape:link"] = {
        id: "shape:link",
        typeName: "shape",
        type: "link",
        parentId: pageId,
        index: "a2",
        x: 100,
        y: 0,
        rotation: 0,
        opacity: 1,
        props: { title: "旧链接", url: "https://example.com" },
        meta: {},
      };
      snapshot.document.store["shape:resource"] = {
        id: "shape:resource",
        typeName: "shape",
        type: "resource",
        parentId: pageId,
        index: "a3",
        x: 200,
        y: 0,
        rotation: 0,
        opacity: 1,
        props: { name: "旧资料", libraryItemId: "library:file" },
        meta: {},
      };
    });

    expect(editor.renameMaterial("shape:image", "  新图片.png  ")).toBe(true);
    expect(editor.renameMaterial("shape:link", "新链接")).toBe(true);
    expect(editor.renameMaterial("shape:resource", "白板内资料名")).toBe(true);
    expect(editor.renameMaterial("shape:resource", "   ")).toBe(false);

    expect(editor.getShape("shape:image")?.props.altText).toBe("新图片.png");
    expect((store.snapshot.document.store["asset:image"]?.props as { name?: string })?.name).toBe("新图片.png");
    expect(editor.getShape("shape:link")?.props.title).toBe("新链接");
    expect(editor.getShape("shape:resource")?.props.name).toBe("白板内资料名");
  });

  it("edits existing text inline after a double click in pointer mode", async () => {
    const methods = mockCanvas();
    methods.set("measureText", vi.fn((value: string) => ({ width: Array.from(value).length * 10 })));
    const store = new NativeWhiteboardStore();
    const seed = new NativeWhiteboardEditor(store);
    seed.createShapes([{
      id: "shape:text-edit",
      type: "text",
      x: 120,
      y: 100,
      props: { w: 220, richText: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "原文字" }] }] } },
    }]);
    let editor: NativeWhiteboardEditor | undefined;
    render(createElement(NativeWhiteboard, {
      store,
      onMount: (value) => { editor = value; },
    }));
    editor!.setCurrentTool("select");
    const canvas = document.querySelector(".native-whiteboard-canvas") as HTMLCanvasElement;
    await waitFor(() => expect(editor!.getViewportPageBounds().w).toBeCloseTo(800));
    const viewport = editor!.getViewportPageBounds();
    const bounds = editor!.getShapePageBounds("shape:text-edit")!;
    const zoom = 800 / viewport.w;
    fireEvent.doubleClick(canvas, {
      clientX: (140 - viewport.x) * zoom,
      clientY: (120 - viewport.y) * zoom,
    });

    const input = await screen.findByRole("textbox", { name: "输入白板文字" });
    expect(input).toHaveValue("原文字");
    expect(input).toHaveAttribute("data-whiteboard-inline-text-editor", "shape:text-edit");
    expect(input).toHaveAttribute("data-auto-size", "true");
    expect(input).toHaveClass("bg-transparent", "shadow-none");
    expect(Number.parseFloat(input.style.left)).toBeCloseTo((bounds.x - viewport.x) * zoom, 4);
    expect(Number.parseFloat(input.style.top)).toBeCloseTo((bounds.y - viewport.y) * zoom, 4);
    const initialWidth = Number.parseFloat(input.style.width);
    const initialHeight = Number.parseFloat(input.style.height);
    expect(initialWidth).toBeLessThan(bounds.w * zoom);
    fireEvent.change(input, { target: { value: "这是一段明显更长的修改后文字" } });
    await waitFor(() => expect(Number.parseFloat(input.style.width)).toBeGreaterThan(initialWidth));
    fireEvent.change(input, { target: { value: "修改后的文字\n第二行" } });
    await waitFor(() => expect(Number.parseFloat(input.style.height)).toBeGreaterThan(initialHeight));
    fireEvent.pointerDown(canvas, { button: 0, clientX: 700, clientY: 500, pointerId: 9 });

    await waitFor(() => expect(JSON.stringify(editor!.getShape("shape:text-edit")?.props.richText)).toContain("修改后的文字"));
    expect(Number(editor!.getShape("shape:text-edit")?.props.w)).toBeLessThan(220);
    expect(Number(editor!.getShape("shape:text-edit")?.props.h)).toBeGreaterThan(initialHeight);
  });

  it("uses the complete note area as the inline text editor", async () => {
    mockCanvas();
    const store = new NativeWhiteboardStore();
    const seed = new NativeWhiteboardEditor(store);
    seed.createShapes([{
      id: "shape:note-edit",
      type: "note",
      x: 120,
      y: 100,
      props: { richText: "便签文字", size: "m", scale: 1.25 },
    }]);
    let editor: NativeWhiteboardEditor | undefined;
    render(createElement(NativeWhiteboard, {
      store,
      onMount: (value) => { editor = value; },
    }));
    editor!.setCurrentTool("select");
    const canvas = document.querySelector(".native-whiteboard-canvas") as HTMLCanvasElement;
    await waitFor(() => expect(editor!.getViewportPageBounds().w).toBeCloseTo(800));
    const viewport = editor!.getViewportPageBounds();
    const bounds = editor!.getShapePageBounds("shape:note-edit")!;
    const zoom = 800 / viewport.w;
    fireEvent.doubleClick(canvas, {
      clientX: (bounds.center.x - viewport.x) * zoom,
      clientY: (bounds.center.y - viewport.y) * zoom,
    });

    const input = await screen.findByRole("textbox", { name: "输入白板文字" });
    expect(Number.parseFloat(input.style.width)).toBeCloseTo(bounds.w * zoom, 4);
    expect(Number.parseFloat(input.style.height)).toBeCloseTo(bounds.h * zoom, 4);
  });

  it("opens a mapped local file or folder through the desktop bridge on double click", async () => {
    mockCanvas();
    const onLocalPathOpen = vi.fn().mockResolvedValue(undefined);
    const store = new NativeWhiteboardStore();
    const seed = new NativeWhiteboardEditor(store);
    seed.createShapes([{
      id: "shape:local-folder",
      type: "resource",
      x: 120,
      y: 100,
      props: {
        name: "项目素材",
        kind: "local_folder",
        localPath: "E:\\项目\\素材",
        w: 330,
        h: 82,
      },
    }]);
    let editor: NativeWhiteboardEditor | undefined;
    render(createElement(NativeWhiteboard, {
      store,
      onMount: (value) => { editor = value; },
      onLocalPathOpen,
    }));
    const canvas = document.querySelector(".native-whiteboard-canvas") as HTMLCanvasElement;
    await waitFor(() => expect(editor!.getViewportPageBounds().w).toBeGreaterThan(0));
    const viewport = editor!.getViewportPageBounds();
    const zoom = 800 / viewport.w;
    fireEvent.doubleClick(canvas, {
      clientX: (180 - viewport.x) * zoom,
      clientY: (130 - viewport.y) * zoom,
    });

    await waitFor(() => expect(onLocalPathOpen).toHaveBeenCalledWith("E:\\项目\\素材"));
  });

  it("opens a mapped resource after it has been grouped", async () => {
    mockCanvas();
    const onResourceOpen = vi.fn().mockResolvedValue(undefined);
    const store = new NativeWhiteboardStore();
    const seed = new NativeWhiteboardEditor(store);
    seed.createShapes([
      {
        id: "shape:grouped-resource",
        type: "resource",
        x: 120,
        y: 100,
        props: {
          name: "项目文档.docx",
          kind: "local_file",
          libraryItemId: "library:project-document",
          w: 330,
          h: 82,
        },
      },
      {
        id: "shape:grouped-note",
        type: "note",
        x: 500,
        y: 100,
        props: { richText: "项目说明", w: 180, h: 120 },
      },
    ]);
    seed.select("shape:grouped-resource", "shape:grouped-note");
    seed.groupSelectedShapes();
    let editor: NativeWhiteboardEditor | undefined;
    render(createElement(NativeWhiteboard, {
      store,
      onMount: (value) => { editor = value; },
      onResourceOpen,
    }));
    const canvas = document.querySelector(".native-whiteboard-canvas") as HTMLCanvasElement;
    await waitFor(() => expect(editor!.getViewportPageBounds().w).toBeGreaterThan(0));
    const viewport = editor!.getViewportPageBounds();
    const bounds = editor!.getShapePageBounds("shape:grouped-resource")!;
    const zoom = 800 / viewport.w;

    fireEvent.doubleClick(canvas, {
      clientX: (bounds.center.x - viewport.x) * zoom,
      clientY: (bounds.center.y - viewport.y) * zoom,
    });

    await waitFor(() => expect(onResourceOpen).toHaveBeenCalledWith("library:project-document"));
    expect(editor!.getSelectedShapeIds()).toEqual(["shape:grouped-resource"]);
  });

  it("accepts pasted and dropped image files at the expected canvas point", async () => {
    mockCanvas();
    const onImageFiles = vi.fn().mockResolvedValue(undefined);
    const store = new NativeWhiteboardStore();
    render(createElement(NativeWhiteboard, { store, onImageFiles }));
    const canvas = document.querySelector(".native-whiteboard-canvas") as HTMLCanvasElement;
    const image = new File(["image"], "clipboard.png", { type: "image/png" });

    fireEvent.paste(window, { clipboardData: { files: [image] } });
    await waitFor(() => expect(onImageFiles).toHaveBeenCalledWith([image], expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) })));

    fireEvent.paste(window, {
      clipboardData: {
        files: [],
        items: [{
          type: "image/png",
          getAsFile: () => image,
        }],
      },
    });
    await waitFor(() => expect(onImageFiles).toHaveBeenCalledTimes(2));

    fireEvent.drop(canvas, {
      clientX: 240,
      clientY: 180,
      dataTransfer: {
        files: [image],
        items: [{ type: "image/png" }],
      },
    });
    await waitFor(() => expect(onImageFiles).toHaveBeenLastCalledWith([image], expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) })));
  });

  it("routes dropped portable whiteboard files to the import handler", async () => {
    mockCanvas();
    const onImageFiles = vi.fn();
    const onWhiteboardFiles = vi.fn().mockResolvedValue(undefined);
    const store = new NativeWhiteboardStore();
    render(createElement(NativeWhiteboard, { store, onImageFiles, onWhiteboardFiles }));
    const canvas = document.querySelector(".native-whiteboard-canvas") as HTMLCanvasElement;
    const board = new File(["{}"], "project.moki-board", {
      type: "application/vnd.moki.whiteboard+json",
    });

    fireEvent.dragEnter(canvas, {
      dataTransfer: { files: [board], items: [{ kind: "file", type: board.type }] },
    });
    expect(screen.getByText("松开鼠标，添加本地文件或文件夹")).toBeInTheDocument();
    fireEvent.drop(canvas, {
      dataTransfer: { files: [board], items: [{ kind: "file", type: board.type }] },
    });

    await waitFor(() => expect(onWhiteboardFiles).toHaveBeenCalledWith([board]));
    expect(onImageFiles).not.toHaveBeenCalled();
  });

  it("passes arbitrary local files and folders to the mapped drop handler", async () => {
    mockCanvas();
    const onLocalFiles = vi.fn().mockResolvedValue(undefined);
    const store = new NativeWhiteboardStore();
    window.mokiDesktop = {
      getPathForFile: (file: File) => `D:\\资料\\${file.name}`,
    } as unknown as NonNullable<Window["mokiDesktop"]>;
    render(createElement(NativeWhiteboard, { store, onLocalFiles }));
    const canvas = document.querySelector(".native-whiteboard-canvas") as HTMLCanvasElement;
    const documentFile = new File(["document"], "方案.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    const folder = new File([], "项目素材");

    fireEvent.drop(canvas, {
      clientX: 320,
      clientY: 220,
      dataTransfer: {
        files: [documentFile, folder],
        items: [
          { kind: "file", webkitGetAsEntry: () => ({ isDirectory: false }) },
          { kind: "file", webkitGetAsEntry: () => ({ isDirectory: true }) },
        ],
      },
    });

    await waitFor(() => expect(onLocalFiles).toHaveBeenCalledWith([
      expect.objectContaining({ file: documentFile, path: "D:\\资料\\方案.docx", isDirectory: false }),
      expect.objectContaining({ file: folder, path: "D:\\资料\\项目素材", isDirectory: true }),
    ], expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) })));
  });

  it("creates a link shape when a webpage URL is pasted as plain text", async () => {
    mockCanvas();
    const store = new NativeWhiteboardStore();
    let editor: NativeWhiteboardEditor | undefined;
    render(createElement(NativeWhiteboard, {
      store,
      onMount: (value) => { editor = value; },
    }));

    const clipboardData = {
      files: [],
      items: [],
      types: ["text/plain"],
      getData: vi.fn((type: string) =>
        type === "text/plain" ? "www.example.com/path" : "",
      ),
    };
    fireEvent.paste(window, { clipboardData });

    await waitFor(() => expect(editor!.getCurrentPageShapeIds()).toHaveLength(1));
    const pastedId = editor!.getSelectedShapeIds()[0]!;
    expect(editor!.getShape(pastedId)).toMatchObject({
      type: "link",
      props: expect.objectContaining({
        url: "https://www.example.com/path",
        title: "www.example.com",
        mode: "link",
      }),
    });
    expect(screen.getByRole("status")).toHaveTextContent("已粘贴为超链接");
  });

  it("does not convert arbitrary pasted text into a link shape", async () => {
    mockCanvas();
    const store = new NativeWhiteboardStore();
    let editor: NativeWhiteboardEditor | undefined;
    render(createElement(NativeWhiteboard, {
      store,
      onMount: (value) => { editor = value; },
    }));

    fireEvent.paste(window, {
      clipboardData: {
        files: [],
        items: [],
        types: ["text/plain"],
        getData: vi.fn((type: string) =>
          type === "text/plain" ? "这是一段普通文本" : "",
        ),
      },
    });

    expect(editor!.getCurrentPageShapeIds()).toHaveLength(0);
  });

  it("shows an animated image loading state instead of a static gray frame", () => {
    const methods = mockCanvas();
    const context = document.createElement("canvas").getContext("2d")!;
    const bounds = {
      x: 20,
      y: 30,
      w: 320,
      h: 180,
      width: 320,
      height: 180,
      center: { x: 180, y: 120 },
    };

    drawNativeImagePlaceholder(context, bounds, "loading", 325);

    expect(methods.get("arc")).toHaveBeenCalledTimes(2);
    expect(methods.get("fillText")).toHaveBeenCalledWith(
      "图片加载中…",
      180,
      expect.any(Number),
    );
  });

  it("repaints a loading image as soon as decoding completes", async () => {
    const methods = mockCanvas();
    const images: Array<{
      complete: boolean;
      naturalWidth: number;
      naturalHeight: number;
      onload?: () => void;
      onerror?: () => void;
      src: string;
      decoding: string;
    }> = [];
    class MockImage {
      complete = false;
      naturalWidth = 0;
      naturalHeight = 0;
      onload?: () => void;
      onerror?: () => void;
      src = "";
      decoding = "";
      constructor() {
        images.push(this);
      }
    }
    vi.stubGlobal("Image", MockImage);
    const store = new NativeWhiteboardStore();
    const seed = new NativeWhiteboardEditor(store);
    store.mutate((snapshot) => {
      snapshot.document.store["asset:loading"] = {
        id: "asset:loading",
        typeName: "asset",
        type: "image",
        props: { src: "/api/whiteboard/assets/loading" },
        meta: {},
      };
    });
    seed.createShapes([{
      id: "shape:loading",
      type: "image",
      x: 40,
      y: 50,
      props: { w: 320, h: 180, assetId: "asset:loading" },
    }]);

    render(createElement(NativeWhiteboard, { store }));
    await waitFor(() => expect(images).toHaveLength(1));
    expect(methods.get("fillText")).toHaveBeenCalledWith(
      "图片加载中…",
      expect.any(Number),
      expect.any(Number),
    );

    images[0]!.complete = true;
    images[0]!.naturalWidth = 1280;
    images[0]!.naturalHeight = 720;
    images[0]!.onload?.();

    await waitFor(() => expect(methods.get("drawImage")).toHaveBeenCalled());
  });

  it("keeps the in-memory preview element out of the persisted snapshot", async () => {
    class LoadedImage {
      complete = true;
      naturalWidth = 640;
      naturalHeight = 360;
      onload?: () => void;
      onerror?: () => void;
      decoding = "";
      private value = "";
      get src() { return this.value; }
      set src(value: string) {
        this.value = value;
        queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal("Image", LoadedImage);
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue({
      width: 640,
      height: 360,
      close: vi.fn(),
    }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        src: "/api/whiteboard/assets/serializable-image",
        mimeType: "image/png",
        fileSize: 5,
      }),
    }));
    const store = new NativeWhiteboardStore();
    const editor = new NativeWhiteboardEditor(store);
    const cachePreview = vi.fn();
    editor.attachImageHandlers(async () => undefined, cachePreview);

    await editor.putExternalContent({
      type: "files",
      files: [new File(["image"], "serializable.png", { type: "image/png" })],
      point: { x: 320, y: 240 },
    });

    expect(cachePreview).toHaveBeenCalledWith(
      "/api/whiteboard/assets/serializable-image",
      expect.any(LoadedImage),
    );
    expect(() => structuredClone(store.snapshot)).not.toThrow();
    const asset = Object.values(store.snapshot.document.store).find(
      (record) => record.typeName === "asset",
    );
    expect(asset?.props).not.toHaveProperty("previewImage");
  });

  it("stores dropped video as a playable media shape with its original path", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        src: "/api/whiteboard/assets/video-hash",
        mimeType: "video/mp4",
        fileSize: 5,
      }),
    }));
    const store = new NativeWhiteboardStore();
    const editor = new NativeWhiteboardEditor(store);
    await editor.putExternalContent({
      type: "files",
      files: [new File(["video"], "演示.mp4")],
      localPaths: ["D:\\素材\\演示.mp4"],
      point: { x: 400, y: 300 },
    });

    const shape = Object.values(store.snapshot.document.store).find(
      (record) => record.typeName === "shape" && record.type === "media",
    );
    expect(shape?.props).toMatchObject({
      mediaKind: "video",
      name: "演示.mp4",
      localPath: "D:\\素材\\演示.mp4",
    });
    const asset = Object.values(store.snapshot.document.store).find(
      (record) => record.typeName === "asset" && record.type === "media",
    );
    expect(asset?.props).toMatchObject({
      src: "/api/whiteboard/assets/video-hash",
      mimeType: "video/mp4",
    });
  });

  it("copies selected canvas elements and pastes independent offset copies", async () => {
    mockCanvas();
    const store = new NativeWhiteboardStore();
    const seed = new NativeWhiteboardEditor(store);
    seed.createShapes([{
      id: "shape:copy-source",
      type: "note",
      x: 80,
      y: 120,
      props: { richText: "复制内容", color: "yellow", size: "m" },
    }]);
    let editor: NativeWhiteboardEditor | undefined;
    render(createElement(NativeWhiteboard, {
      store,
      onMount: (value) => { editor = value; },
    }));
    editor!.select("shape:copy-source");

    const values = new Map<string, string>();
    const types: string[] = [];
    const clipboardData = {
      files: [],
      items: [],
      types,
      setData: vi.fn((type: string, value: string) => {
        values.set(type, value);
        if (!types.includes(type)) types.push(type);
      }),
      getData: vi.fn((type: string) => values.get(type) ?? ""),
    };

    fireEvent.copy(window, { clipboardData });
    expect(clipboardData.setData).toHaveBeenCalledWith(
      NATIVE_WHITEBOARD_CLIPBOARD_TYPE,
      expect.any(String),
    );
    expect(clipboardData.setData).toHaveBeenCalledWith(
      "text/plain",
      expect.stringContaining(NATIVE_WHITEBOARD_CLIPBOARD_TEXT_PREFIX),
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "已复制 1 个元素",
    );
    fireEvent.paste(window, { clipboardData });

    await waitFor(() => expect(editor!.getCurrentPageShapeIds()).toHaveLength(2));
    const pastedId = editor!.getSelectedShapeIds()[0]!;
    const pasted = editor!.getShape(pastedId);
    expect(pastedId).not.toBe("shape:copy-source");
    expect(pasted).toMatchObject({
      type: "note",
      x: 112,
      y: 152,
      props: expect.objectContaining({ richText: "复制内容" }),
    });

    const plainTextClipboard = {
      files: [],
      items: [],
      types: ["text/plain"],
      getData: vi.fn((type: string) =>
        type === "text/plain" ? values.get("text/plain") ?? "" : ""
      ),
    };
    fireEvent.paste(window, { clipboardData: plainTextClipboard });
    await waitFor(() => expect(editor!.getCurrentPageShapeIds()).toHaveLength(3));
  });

  it("writes selected images to the system clipboard as PNG while retaining MOKI elements", async () => {
    mockCanvas();
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => {
      callback(new Blob(["png"], { type: "image/png" }));
    });
    class MockImage {
      decoding = "";
      naturalWidth = 640;
      naturalHeight = 360;
      complete = true;
      onload?: () => void;
      onerror?: () => void;
      private value = "";
      set src(value: string) {
        this.value = value;
        queueMicrotask(() => this.onload?.());
      }
      get src() {
        return this.value;
      }
    }
    class MockClipboardItem {
      constructor(readonly items: Record<string, Blob | Promise<Blob>>) {}
    }
    vi.stubGlobal("Image", MockImage);
    vi.stubGlobal("ClipboardItem", MockClipboardItem);
    const write = vi.fn().mockResolvedValue(undefined);
    const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { write },
    });
    const store = new NativeWhiteboardStore();
    const seed = new NativeWhiteboardEditor(store);
    store.mutate((snapshot) => {
      snapshot.document.store["asset:system-copy"] = {
        id: "asset:system-copy",
        typeName: "asset",
        type: "image",
        props: { src: "/api/whiteboard/assets/system-copy" },
        meta: {},
      };
    });
    seed.createShapes([{
      id: "shape:system-copy",
      type: "image",
      x: 40,
      y: 60,
      props: { w: 320, h: 180, assetId: "asset:system-copy" },
    }]);
    let editor: NativeWhiteboardEditor | undefined;

    try {
      render(createElement(NativeWhiteboard, {
        store,
        onMount: (value) => { editor = value; },
      }));
      editor!.select("shape:system-copy");
      const values = new Map<string, string>();
      fireEvent.copy(window, {
        clipboardData: {
          files: [],
          items: [],
          types: [],
          setData: (type: string, value: string) => values.set(type, value),
          getData: (type: string) => values.get(type) ?? "",
        },
      });

      await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
      const item = write.mock.calls[0]?.[0]?.[0] as MockClipboardItem;
      expect(await item.items["image/png"]).toBeInstanceOf(Blob);
      const marker = await item.items["text/plain"]!;
      expect(await marker.text()).toContain(
        NATIVE_WHITEBOARD_CLIPBOARD_TEXT_PREFIX,
      );
      expect(screen.getByRole("status")).toHaveTextContent("PNG 图片");
    } finally {
      if (originalClipboard) {
        Object.defineProperty(navigator, "clipboard", originalClipboard);
      } else {
        Reflect.deleteProperty(navigator, "clipboard");
      }
    }
  });

  it("zooms around the pointer with Alt plus mouse wheel", async () => {
    mockCanvas();
    const store = new NativeWhiteboardStore();
    render(createElement(NativeWhiteboard, { store }));
    const canvas = document.querySelector(".native-whiteboard-canvas") as HTMLCanvasElement;
    const initial = Number(screen.getByText(/% · MOKI白板/u).textContent?.match(/\d+/u)?.[0]);

    fireEvent.wheel(canvas, { altKey: true, deltaY: -180, clientX: 400, clientY: 300 });
    await waitFor(() => {
      const current = Number(screen.getByText(/% · MOKI白板/u).textContent?.match(/\d+/u)?.[0]);
      expect(current).toBeGreaterThan(initial);
    });
  });

  it("continues wheel and toolbar zoom beyond the old 10–400 percent limits", () => {
    mockCanvas();
    render(createElement(NativeWhiteboard, { store: new NativeWhiteboardStore() }));
    const canvas = document.querySelector(".native-whiteboard-canvas") as HTMLCanvasElement;
    const percentage = () => Number(
      screen.getByText(/% · MOKI白板/u).textContent!.split("%")[0]!.replaceAll(",", ""),
    );

    fireEvent.wheel(canvas, { ctrlKey: true, deltaY: -1_000, clientX: 321, clientY: 223 });
    const high = percentage();
    expect(high).toBeGreaterThan(400);
    fireEvent.click(screen.getByRole("button", { name: "放大白板" }));
    expect(percentage()).toBeGreaterThan(high);

    for (let index = 0; index < 4; index += 1) {
      fireEvent.wheel(canvas, { altKey: true, deltaY: 1_000, clientX: 321, clientY: 223 });
    }
    const low = percentage();
    expect(low).toBeLessThan(10);
    expect(low).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "缩小白板" }));
    expect(percentage()).toBeLessThan(low);
  });

  it("fits a large page below the former minimum zoom without changing shapes", () => {
    const store = new NativeWhiteboardStore();
    const editor = new NativeWhiteboardEditor(store);
    editor.createShapes([{
      id: "shape:large-board",
      type: "geo",
      x: 0,
      y: 0,
      props: { w: 20_000, h: 12_000 },
    }]);
    const before = structuredClone(store.snapshot);

    editor.setViewport({ width: 800, height: 600 });
    editor.fitCurrentPage();

    const bounds = editor.getViewportPageBounds();
    expect(bounds.w).toBeGreaterThan(20_000);
    expect(bounds.h).toBeGreaterThan(12_000);
    expect(store.snapshot).toEqual(before);
  });

  it("uses marquee selection and exposes the grabbing interaction state", async () => {
    mockCanvas();
    const store = new NativeWhiteboardStore();
    const seed = new NativeWhiteboardEditor(store);
    seed.createShapes([
      { id: "shape:first", type: "geo", x: 100, y: 100, props: { w: 100, h: 80 } },
      { id: "shape:second", type: "geo", x: 360, y: 260, props: { w: 120, h: 90 } },
    ]);
    let editor: NativeWhiteboardEditor | undefined;
    render(createElement(NativeWhiteboard, {
      store,
      onMount: (value) => { editor = value; },
    }));
    const canvas = document.querySelector("canvas")!;

    editor!.setCurrentTool("select");
    fireEvent.pointerDown(canvas, { button: 0, clientX: 1, clientY: 1, pointerId: 1 });
    fireEvent.pointerMove(canvas, { button: 0, clientX: 799, clientY: 599, pointerId: 1 });
    fireEvent.pointerUp(canvas, { button: 0, clientX: 799, clientY: 599, pointerId: 1 });
    await waitFor(() => expect(editor!.getSelectedShapeIds()).toHaveLength(2));

    editor!.setCurrentTool("hand");
    fireEvent.pointerDown(canvas, { button: 0, clientX: 200, clientY: 200, pointerId: 2 });
    expect(canvas.dataset.panning).toBe("true");
    expect(canvas.style.cursor).toBe("grabbing");
    fireEvent.pointerUp(canvas, { button: 0, clientX: 220, clientY: 220, pointerId: 2 });
    expect(canvas.dataset.panning).toBeUndefined();
    editor!.setCurrentTool("select");
    fireEvent.pointerDown(canvas, { button: 1, clientX: 200, clientY: 200, pointerId: 3 });
    expect(canvas.style.cursor).toBe("grabbing");
    fireEvent.pointerUp(canvas, { button: 1, clientX: 220, clientY: 220, pointerId: 3 });
  });

  it("locks Shift dragging to one axis and offers creation on blank canvas", async () => {
    mockCanvas();
    const store = new NativeWhiteboardStore();
    const seed = new NativeWhiteboardEditor(store);
    seed.createShapes([{ id: "shape:axis", type: "geo", x: 100, y: 100, props: { w: 100, h: 80 } }]);
    let editor: NativeWhiteboardEditor | undefined;
    render(createElement(NativeWhiteboard, { store, onMount: (value) => { editor = value; } }));
    editor!.setCurrentTool("select");
    const canvas = document.querySelector(".native-whiteboard-canvas") as HTMLCanvasElement;
    await waitFor(() => expect(editor!.getViewportPageBounds().w).toBeCloseTo(800));
    const viewport = editor!.getViewportPageBounds();
    const scale = 800 / viewport.w;
    const screenPoint = (x: number, y: number) => ({
      clientX: (x - viewport.x) * scale,
      clientY: (y - viewport.y) * scale,
    });

    fireEvent.pointerDown(canvas, { button: 0, pointerId: 91, ...screenPoint(140, 130) });
    fireEvent.pointerMove(canvas, { button: 0, pointerId: 91, shiftKey: true, ...screenPoint(220, 150) });
    fireEvent.pointerUp(canvas, { button: 0, pointerId: 91, ...screenPoint(220, 150) });
    expect(editor!.getShape("shape:axis")).toMatchObject({ x: 180, y: 100 });

    fireEvent.contextMenu(canvas, screenPoint(600, 500));
    expect(screen.getByRole("menuitem", { name: "添加便签" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "添加便签" }));
    expect([...editor!.getCurrentPageShapeIds()]).toHaveLength(2);
  });

  it("lets a multi-video selection drag through its overlay and equalizes material size", async () => {
    mockCanvas();
    const store = new NativeWhiteboardStore();
    const seed = new NativeWhiteboardEditor(store);
    seed.createShapes([
      { id: "shape:video-a", type: "media", x: 100, y: 100, props: { w: 200, h: 110, mediaKind: "video", name: "A", assetId: "asset:a" } },
      { id: "shape:video-b", type: "media", x: 400, y: 130, props: { w: 120, h: 90, mediaKind: "video", name: "B", assetId: "asset:b" } },
    ]);
    store.mutate((snapshot) => {
      snapshot.document.store["asset:a"] = { id: "asset:a", typeName: "asset", type: "media", props: { src: "data:video/mp4;base64,AA==", mimeType: "video/mp4" }, meta: {} };
      snapshot.document.store["asset:b"] = { id: "asset:b", typeName: "asset", type: "media", props: { src: "data:video/mp4;base64,AA==", mimeType: "video/mp4" }, meta: {} };
    });
    let editor: NativeWhiteboardEditor | undefined;
    render(createElement(NativeWhiteboard, { store, onMount: (value) => { editor = value; } }));
    editor!.setCurrentTool("select");
    editor!.setSelection(["shape:video-a", "shape:video-b"]);
    const canvas = document.querySelector(".native-whiteboard-canvas") as HTMLCanvasElement;
    await waitFor(() => expect(editor!.getViewportPageBounds().w).toBeCloseTo(800));
    const viewport = editor!.getViewportPageBounds();
    const scale = 800 / viewport.w;
    const screenPoint = (x: number, y: number) => ({
      clientX: (x - viewport.x) * scale,
      clientY: (y - viewport.y) * scale,
    });

    expect(screen.getByLabelText("视频预览 A")).toHaveClass("pointer-events-none");
    expect(screen.getByLabelText("视频预览 B")).toHaveClass("pointer-events-none");
    fireEvent.contextMenu(canvas, screenPoint(450, 170));
    fireEvent.click(screen.getByRole("menuitem", { name: "等宽缩放" }));
    expect(nativeShapeBounds(editor!.getShape("shape:video-b")!).w)
      .toBeCloseTo(nativeShapeBounds(editor!.getShape("shape:video-a")!).w);
    fireEvent.contextMenu(canvas, screenPoint(450, 170));
    fireEvent.click(screen.getByRole("menuitem", { name: "等高缩放" }));
    expect(nativeShapeBounds(editor!.getShape("shape:video-b")!).h)
      .toBeCloseTo(nativeShapeBounds(editor!.getShape("shape:video-a")!).h);

    const secondBeforeDrag = editor!.getShape("shape:video-b")!.x;
    fireEvent.pointerDown(canvas, { button: 0, pointerId: 92, ...screenPoint(450, 170) });
    fireEvent.pointerMove(canvas, { button: 0, pointerId: 92, ...screenPoint(480, 185) });
    fireEvent.pointerUp(canvas, { button: 0, pointerId: 92, ...screenPoint(480, 185) });
    expect(editor!.getShape("shape:video-a")?.x).toBe(130);
    expect(editor!.getShape("shape:video-b")?.x).toBe(secondBeforeDrag + 30);
  });

  it("shows a navigable minimap and previews a shape before pointer release", async () => {
    const methods = mockCanvas();
    const store = new NativeWhiteboardStore();
    let editor: NativeWhiteboardEditor | undefined;
    render(createElement(NativeWhiteboard, {
      store,
      onMount: (value) => { editor = value; },
    }));
    const minimap = screen.getByLabelText("画布导航缩略图");
    const zoomToolbar = screen.getByLabelText("白板缩放工具");
    expect(minimap).toBeTruthy();
    expect(minimap.parentElement).toBe(zoomToolbar.parentElement);
    expect(minimap.parentElement).toHaveAttribute("data-whiteboard-navigation");
    expect(minimap.parentElement).toHaveClass("flex-col", "gap-2", "w-44");
    expect(minimap).toHaveClass("w-full");
    expect(zoomToolbar).toHaveClass("w-full");
    const canvas = document.querySelector(".native-whiteboard-canvas") as HTMLCanvasElement;
    editor!.setStyleForNextShapes("geo", "ellipse");
    editor!.setCurrentTool("geo");
    fireEvent.pointerDown(canvas, { button: 0, clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(canvas, { button: 0, clientX: 260, clientY: 220, pointerId: 1 });

    await waitFor(() => expect(methods.get("ellipse")).toHaveBeenCalled());
    expect(editor!.getCurrentPageShapeIds()).toHaveLength(0);
    fireEvent.pointerUp(canvas, { button: 0, clientX: 260, clientY: 220, pointerId: 1 });
    expect(editor!.getCurrentPageShapeIds()).toHaveLength(1);
  });

  it("exports selected native content with exact output padding", async () => {
    mockCanvas();
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => {
      callback(new Blob(["png"], { type: "image/png" }));
    });
    const store = new NativeWhiteboardStore();
    const editor = new NativeWhiteboardEditor(store);
    editor.createShapes([{
      id: "shape:export",
      type: "geo",
      x: 100,
      y: 80,
      props: { w: 200, h: 120, geo: "rectangle", color: "blue", fill: "none" },
    }]);

    const result = await exportNativeWhiteboardImage(store.snapshot, {
      scope: "selection",
      shapeIds: ["shape:export"],
      padding: 20,
      fileName: "方案预览",
    });
    expect(result).toMatchObject({
      width: 240,
      height: 160,
      shapeCount: 1,
      fileName: "方案预览.png",
    });
  });

  it("publishes mixed selected elements as one rendered assistant image", async () => {
    mockCanvas();
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => {
      callback(new Blob(["selection-png"], { type: "image/png" }));
    });
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/whiteboard/assets") {
        return new Response(JSON.stringify({
          src: "/api/whiteboard/assets/selection-hash",
          mimeType: "image/png",
          fileSize: 13,
          width: 304,
          height: 184,
        }), { status: 201, headers: { "content-type": "application/json" } });
      }
      throw new Error(`unexpected request ${String(input)}`);
    });
    vi.stubGlobal("fetch", fetcher);
    localStorage.clear();
    const store = new NativeWhiteboardStore();
    let editor: NativeWhiteboardEditor | undefined;
    render(createElement(NativeWhiteboard, {
      store,
      onMount: (value) => { editor = value; },
    }));
    editor!.createShapes([
      { id: "shape:draw-selection", type: "draw", x: 40, y: 60, props: { points: [{ x: 0, y: 0 }, { x: 120, y: 80 }], color: "blue", size: "m" } },
      { id: "shape:text-selection", type: "text", x: 180, y: 80, props: { w: 120, h: 48, richText: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "关键结论" }] }] } } },
    ]);
    editor!.setSelection(["shape:draw-selection", "shape:text-selection"]);
    await waitFor(() => {
      const value = JSON.parse(localStorage.getItem("moki.current-workbench-selection") || "{}") as { content?: string };
      const content = value.content ? JSON.parse(value.content) as { visualAttachments?: Array<{ imageSource: string }>; selectedShapes?: unknown[] } : {};
      expect(content.selectedShapes).toHaveLength(2);
      expect(content.visualAttachments?.[0]?.imageSource).toBe("/api/whiteboard/assets/selection-hash");
    }, { timeout: 2_000 });
    expect(fetcher).toHaveBeenCalledWith("/api/whiteboard/assets", expect.objectContaining({ method: "POST" }));
    localStorage.clear();
  });

  it("keeps saved whiteboard annotations when an unselected canvas mounts", () => {
    mockCanvas();
    const selection = visualAnnotationSelection([{ id: "annotation-1", source: "whiteboard", sourceId: "whiteboard", sourceTitle: "规划", annotation: "调整这里", rect: { x: 0, y: 0, width: 100, height: 100 }, surface: { width: 800, height: 600 }, visualAttachment: { id: "image", name: "选区.jpg", imageSource: "/api/whiteboard/assets/image", mediaType: "image/jpeg", size: 20 }, capturedAt: new Date().toISOString(), whiteboard: { pageId: "page:plan", pageName: "规划", camera: { x: 0, y: 0, zoom: 1 }, bounds: { x: 0, y: 0, width: 100, height: 100 } } }])!;
    replaceWorkbenchSelectionContext(selection);
    render(createElement(NativeWhiteboard, { store: new NativeWhiteboardStore() }));
    expect(readWorkbenchSelectionContext()).toEqual(selection);
    localStorage.clear();
  });
});
