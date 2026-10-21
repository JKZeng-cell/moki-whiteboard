// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { Fragment as MemoryRouter } from 'react';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  extractWhiteboardPageSnapshot,
  mergeWhiteboardPageAsNew,
  resolveAssistantImageMediaType,
  restoreWhiteboardPageSnapshot,
  WhiteboardPage,
} from "./whiteboard-page.js";
import { installModalOutsideDismiss } from "../lib/modal-outside-dismiss.js";

const api = vi.hoisted(() => ({
  getWhiteboard: vi.fn(),
  saveWhiteboard: vi.fn(),
  syncWhiteboardPages: vi.fn(),
  getWhiteboardVersion: vi.fn(),
  getWhiteboardVersions: vi.fn(),
}));

const resourceLibrary = vi.hoisted(() => ({
  getItems: vi.fn(),
  getImageFile: vi.fn(),
  isImage: vi.fn(),
  openItem: vi.fn(),
  previewUrl: vi.fn(),
}));

const libraryAdapter = vi.hoisted(() => ({
  importLocal: vi.fn(),
  uploadFile: vi.fn(),
}));

const tldraw = vi.hoisted(() => {
  type DeletePageMock = ((page: unknown) => void) & {
    mockReset: () => void;
  };
  const state: {
    listener: ((event?: unknown) => void) | undefined;
    imageHandler: ((files: File[], point?: { x: number; y: number }) => void | Promise<void>) | undefined;
    deletePageMock: DeletePageMock;
  } = {
    listener: undefined,
    imageHandler: undefined,
    deletePageMock: vi.fn() as unknown as DeletePageMock,
  };
  const store = {
    listen: vi.fn((listener: (event?: unknown) => void, _filters?: unknown) => {
      state.listener = listener;
      return vi.fn();
    }),
  };
  const editor: {
    store: typeof store;
    getSelectedShapeIds: ReturnType<typeof vi.fn>;
    copySelectedShapes: ReturnType<typeof vi.fn>;
    pasteCopiedShapes: ReturnType<typeof vi.fn>;
    groupSelectedShapes: ReturnType<typeof vi.fn>;
    ungroupSelectedShapes: ReturnType<typeof vi.fn>;
    deleteShapes: ReturnType<typeof vi.fn>;
    createShapes: ReturnType<typeof vi.fn>;
    updateShapes: ReturnType<typeof vi.fn>;
    renameMaterial: ReturnType<typeof vi.fn>;
    select: ReturnType<typeof vi.fn>;
    zoomToSelection: ReturnType<typeof vi.fn>;
    fitCurrentPage: ReturnType<typeof vi.fn>;
    setCurrentTool: ReturnType<typeof vi.fn>;
    setStyleForNextShapes: ReturnType<typeof vi.fn>;
    updateInstanceState: ReturnType<typeof vi.fn>;
    getCurrentPageShapeIds: ReturnType<typeof vi.fn>;
    getCurrentPageId: ReturnType<typeof vi.fn>;
    getCurrentPage: ReturnType<typeof vi.fn>;
    getShapePageBounds: ReturnType<typeof vi.fn>;
    getViewportPageBounds: ReturnType<typeof vi.fn>;
    getShape: ReturnType<typeof vi.fn>;
    getShapeUtil: ReturnType<typeof vi.fn>;
    markHistoryStoppingPoint: ReturnType<typeof vi.fn>;
    undo: ReturnType<typeof vi.fn>;
    redo: ReturnType<typeof vi.fn>;
    preloadImages: ReturnType<typeof vi.fn>;
    putExternalContent: ReturnType<typeof vi.fn>;
    deletePage: (page: unknown) => typeof editor;
  } = {
    store,
    getSelectedShapeIds: vi.fn(() => [] as string[]),
    copySelectedShapes: vi.fn(() => undefined),
    pasteCopiedShapes: vi.fn(() => [] as string[]),
    groupSelectedShapes: vi.fn(),
    ungroupSelectedShapes: vi.fn(),
    deleteShapes: vi.fn(),
    createShapes: vi.fn(),
    updateShapes: vi.fn(),
    renameMaterial: vi.fn(() => true),
    select: vi.fn(),
    zoomToSelection: vi.fn(),
    fitCurrentPage: vi.fn(),
    setCurrentTool: vi.fn(),
    setStyleForNextShapes: vi.fn(),
    updateInstanceState: vi.fn(),
    getCurrentPageShapeIds: vi.fn(() => [] as string[]),
    getCurrentPageId: vi.fn(() => "page:page"),
    getCurrentPage: vi.fn(() => ({
      id: "page:page",
      name: "项目规划",
    })),
    getShapePageBounds: vi.fn(() => undefined),
    getViewportPageBounds: vi.fn(() => ({
      x: 0,
      y: 0,
      w: 1000,
      h: 800,
      center: { x: 500, y: 400 },
    })),
    getShape: vi.fn((id: string) => ({
      id,
      type: "geo",
      x: 0,
      y: 0,
      props: {},
    })),
    getShapeUtil: vi.fn(() => ({
      options: {},
    })),
    markHistoryStoppingPoint: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    preloadImages: vi.fn().mockResolvedValue(undefined),
    putExternalContent: vi.fn().mockResolvedValue(undefined),
    deletePage: (page: unknown) => {
      state.deletePageMock(page);
      return editor;
    },
  };
  return {
    state,
    store,
    editor,
    getSnapshot: vi.fn(() => ({
      document: {
        store: {
          "page:page": {
            id: "page:page",
            typeName: "page",
            name: "项目规划",
          },
        },
        schema: { schemaVersion: 2, sequences: {} },
      },
    })),
    loadSnapshot: vi.fn(),
    createTLStore: vi.fn(() => store),
    exportImage: vi.fn(),
    downloadImage: vi.fn(),
  };
});

vi.mock("../lib/api.js", () => api);
vi.mock("../lib/resource-library-api.js", () => ({
  getResourceLibraryItems: resourceLibrary.getItems,
  getResourceLibraryImageFile: resourceLibrary.getImageFile,
  isResourceLibraryImage: resourceLibrary.isImage,
  openResourceLibraryItem: resourceLibrary.openItem,
  resourceLibraryPreviewUrl: resourceLibrary.previewUrl,
}));
vi.mock("../../../../web/library-adapter.js", () => ({
  importLocalLibrary: libraryAdapter.importLocal,
  uploadLibraryFile: libraryAdapter.uploadFile,
}));
vi.mock("../components/native-whiteboard.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../components/native-whiteboard.js")>();
  return ({
  NativeWhiteboard: (props: {
    onMount?: (editor: typeof tldraw.editor) => void;
    onImageFiles?: (files: File[], point?: { x: number; y: number }) => void | Promise<void>;
  }) => {
    props.onMount?.(tldraw.editor);
    tldraw.state.imageHandler = props.onImageFiles;
    return (
    <button
      type="button"
      onClick={() => tldraw.state.listener?.({ scope: "document" })}
    >
      模拟白板修改
    </button>
    );
  },
  createNativeWhiteboardStore: tldraw.createTLStore,
  createNativeShapeId: vi.fn(() => "shape:quick"),
  normalizeWhiteboardLinkUrl: vi.fn((value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    try {
      return new URL(/^https?:\/\//iu.test(trimmed) ? trimmed : `https://${trimmed}`).toString();
    } catch {
      return undefined;
    }
  }),
  NativeGeoShapeStyle: "geo",
  NATIVE_COLOR_OPTIONS: [
    { value: "black", label: "黑色", hex: "#242838" },
    { value: "red", label: "红色", hex: "#df4e4e" },
  ],
  toNativeRichText: vi.fn((text: string) => ({
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: text ? [{ type: "text", text }] : [],
      },
    ],
  })),
  getNativeSnapshot: tldraw.getSnapshot,
  loadNativeSnapshot: tldraw.loadSnapshot,
  exportNativeWhiteboardImage: tldraw.exportImage,
  downloadNativeWhiteboardImage: tldraw.downloadImage,
  NativeTextFormattingControls: actual.NativeTextFormattingControls,
  nativeGeoPaintStyle: actual.nativeGeoPaintStyle,
  });
});

const savedSnapshot = {
  document: {
    store: {
      "page:page": {
        id: "page:page",
        typeName: "page",
        name: "项目规划",
      },
    },
    schema: {
      schemaVersion: 2,
      sequences: {},
    },
  },
};

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  window.sessionStorage.clear();
  window.localStorage.clear();
  resourceLibrary.getItems.mockReset();
  resourceLibrary.getItems.mockResolvedValue([]);
  resourceLibrary.openItem.mockReset();
  resourceLibrary.previewUrl.mockReset();
  libraryAdapter.importLocal.mockReset();
  libraryAdapter.importLocal.mockResolvedValue([]);
  libraryAdapter.uploadFile.mockReset();
  tldraw.state.listener = undefined;
  tldraw.state.imageHandler = undefined;
  delete (tldraw.store as { snapshot?: unknown }).snapshot;
  tldraw.store.listen.mockClear();
  tldraw.getSnapshot.mockClear();
  tldraw.getSnapshot.mockImplementation(() => ({
    document: {
      store: {
        "page:page": {
          id: "page:page",
          typeName: "page",
          name: "项目规划",
        },
      },
      schema: { schemaVersion: 2, sequences: {} },
    },
  }));
  tldraw.loadSnapshot.mockClear();
  tldraw.exportImage.mockReset();
  tldraw.exportImage.mockResolvedValue({
    blob: new Blob(["png"], { type: "image/png" }),
    fileName: "whiteboard.png",
    width: 100,
    height: 100,
    shapeCount: 1,
  });
  tldraw.downloadImage.mockReset();
  tldraw.editor.getSelectedShapeIds.mockReset();
  tldraw.editor.getSelectedShapeIds.mockReturnValue([]);
  tldraw.editor.copySelectedShapes.mockReset();
  tldraw.editor.groupSelectedShapes.mockReset();
  tldraw.editor.ungroupSelectedShapes.mockReset();
  tldraw.editor.copySelectedShapes.mockReturnValue(undefined);
  tldraw.editor.pasteCopiedShapes.mockReset();
  tldraw.editor.pasteCopiedShapes.mockReturnValue([]);
  tldraw.editor.deleteShapes.mockReset();
  tldraw.editor.createShapes.mockReset();
  tldraw.editor.updateShapes.mockReset();
  tldraw.editor.renameMaterial.mockReset();
  tldraw.editor.renameMaterial.mockReturnValue(true);
  tldraw.editor.select.mockReset();
  tldraw.editor.zoomToSelection.mockReset();
  tldraw.editor.fitCurrentPage.mockReset();
  tldraw.editor.setCurrentTool.mockReset();
  tldraw.editor.setStyleForNextShapes.mockReset();
  tldraw.editor.updateInstanceState.mockReset();
  tldraw.editor.getCurrentPageShapeIds.mockReset();
  tldraw.editor.getCurrentPageShapeIds.mockReturnValue([]);
  tldraw.editor.getCurrentPageId.mockReset();
  tldraw.editor.getCurrentPageId.mockReturnValue("page:page");
  tldraw.editor.getCurrentPage.mockReset();
  tldraw.editor.getCurrentPage.mockReturnValue({
    id: "page:page",
    name: "项目规划",
  });
  tldraw.editor.getShapePageBounds.mockReset();
  tldraw.editor.getShapePageBounds.mockReturnValue(undefined);
  tldraw.editor.getViewportPageBounds.mockReset();
  tldraw.editor.getViewportPageBounds.mockReturnValue({
    x: 0,
    y: 0,
    w: 1000,
    h: 800,
    center: { x: 500, y: 400 },
  });
  tldraw.editor.getShape.mockReset();
  tldraw.editor.getShape.mockImplementation((id: string) => ({
    id,
    type: "geo",
    x: 0,
    y: 0,
    props: {},
  }));
  tldraw.editor.getShapeUtil.mockReset();
  tldraw.editor.getShapeUtil.mockReturnValue({
    options: {},
  });
  tldraw.editor.markHistoryStoppingPoint.mockReset();
  tldraw.editor.undo.mockReset();
  tldraw.editor.redo.mockReset();
  tldraw.editor.preloadImages.mockReset();
  tldraw.editor.preloadImages.mockResolvedValue(undefined);
  tldraw.editor.putExternalContent.mockReset();
  tldraw.editor.putExternalContent.mockResolvedValue(undefined);
  tldraw.state.deletePageMock.mockReset();
  tldraw.editor.deletePage = (page: unknown) => {
    tldraw.state.deletePageMock(page);
    return tldraw.editor;
  };
  api.getWhiteboard.mockReset();
  api.getWhiteboard.mockResolvedValue({
    version: 1,
    snapshot: savedSnapshot,
    createdAt: "2026-07-23T10:00:00.000Z",
  });
  api.saveWhiteboard.mockReset();
  api.saveWhiteboard.mockResolvedValue({
    version: 2,
    pageId: "page:page",
    pageName: "项目规划",
    pageVersion: 2,
    contentDigest: "digest-2",
    createdAt: "2026-07-23T10:02:00.000Z",
    deduplicated: false,
  });
  api.syncWhiteboardPages.mockReset();
  api.syncWhiteboardPages.mockResolvedValue({
    version: 2,
    pageId: "page:page",
    pageName: "项目规划",
    pageVersion: 2,
    contentDigest: "digest-2",
    createdAt: "2026-07-23T10:02:00.000Z",
    deduplicated: false,
    changedPageIds: ["page:page"],
    deletedPageIds: [],
  });
  api.getWhiteboardVersion.mockReset();
  api.getWhiteboardVersions.mockReset();
  api.getWhiteboardVersions.mockResolvedValue([]);
  resourceLibrary.getImageFile.mockReset();
  resourceLibrary.getImageFile.mockImplementation(async (item: { name: string }) => new File(["image"], item.name, { type: "image/gif" }));
  resourceLibrary.isImage.mockReset();
  resourceLibrary.isImage.mockImplementation((item: { name: string }) => /\.(?:png|jpe?g|gif|webp)$/iu.test(item.name));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("WhiteboardPage", () => {
  it("opens direct local file or folder choices without listing library history", async () => {
    const common = {
      parentId: null,
      tags: [],
      sortOrder: 0,
      createdAt: "2026-08-19T10:00:00.000Z",
      updatedAt: "2026-08-19T10:00:00.000Z",
    };
    resourceLibrary.getItems.mockResolvedValue([{
      ...common,
      id: "file:history",
      kind: "local_file",
      name: "历史素材.pdf",
      target: "C:\\files\\历史素材.pdf",
    }]);
    libraryAdapter.importLocal
      .mockResolvedValueOnce([{
        ...common,
        id: "file:new",
        kind: "local_file",
        name: "新图片.gif",
        target: "C:\\files\\新图片.gif",
      }])
      .mockResolvedValueOnce([{
        ...common,
        id: "folder:new",
        kind: "local_folder",
        name: "项目资料",
        target: "C:\\files\\项目资料",
      }]);
    render(<MemoryRouter><WhiteboardPage /></MemoryRouter>);

    fireEvent.click(await screen.findByRole("button", { name: "添加文件" }));
    expect(screen.getByRole("menu", { name: "选择本地文件或文件夹" })).toBeVisible();
    expect(screen.queryByText("历史素材.pdf")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "选择本地文件" }));
    expect(libraryAdapter.importLocal).toHaveBeenCalledWith(false);
    await waitFor(() => expect(tldraw.editor.putExternalContent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "files", files: [expect.any(File)] }),
      { force: true },
    ));
    expect(screen.queryByRole("menu", { name: "选择本地文件或文件夹" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "添加文件" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "选择本地文件夹" }));
    expect(libraryAdapter.importLocal).toHaveBeenCalledWith(true);
    await waitFor(() => expect(tldraw.editor.createShapes).toHaveBeenCalledWith([
      expect.objectContaining({
        type: "resource",
        props: expect.objectContaining({ name: "项目资料", kind: "local_folder" }),
      }),
    ]));
  });

  it("extracts only the requested page and its referenced assets for saving", () => {
    const full = {
      document: {
        store: {
          "page:a": { id: "page:a", typeName: "page", name: "A" },
          "page:b": { id: "page:b", typeName: "page", name: "B" },
          "shape:a": {
            id: "shape:a",
            typeName: "shape",
            parentId: "page:a",
            props: { assetId: "asset:a" },
          },
          "shape:b": {
            id: "shape:b",
            typeName: "shape",
            parentId: "page:b",
          },
          "asset:a": { id: "asset:a", typeName: "asset", props: {} },
        },
        schema: {},
      },
      session: {
        currentPageId: "page:b",
        pageStates: [
          { pageId: "page:a", camera: { x: 1, y: 2, z: 1 } },
          { pageId: "page:b", camera: { x: 3, y: 4, z: 1 } },
        ],
      },
    };

    const page = extractWhiteboardPageSnapshot(
      full as never,
      "page:a",
    ) as unknown as typeof full;

    expect(Object.keys(page.document.store).sort()).toEqual([
      "asset:a",
      "page:a",
      "shape:a",
    ]);
    expect(page.session.currentPageId).toBe("page:a");
    expect(page.session.pageStates).toEqual([
      { pageId: "page:a", camera: { x: 1, y: 2, z: 1 } },
    ]);
  });

  it("prefers the conversation image type when a media server returns a generic content type", () => {
    expect(resolveAssistantImageMediaType({
      url: "https://media.example/generated?id=1",
      name: "Codex 图片",
      mediaType: "image/png",
      kind: "image",
    }, "application/octet-stream")).toBe("image/png");
  });

  it("inserts an assistant image even when its download response is application/octet-stream", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      blob: async () => new Blob(["image"], {
        type: "application/octet-stream",
      }),
    } as Response);
    window.localStorage.setItem("moki.pending-assistant-media", JSON.stringify({
      url: "https://media.example/generated?id=1",
      name: "Codex 图片",
      mediaType: "image/png",
      kind: "image",
    }));
    render(
      <MemoryRouter>
        <WhiteboardPage />
      </MemoryRouter>,
    );
    await screen.findByRole("button", { name: "模拟白板修改" });

    await waitFor(() => expect(tldraw.editor.putExternalContent).toHaveBeenCalled());
    const insertedFile = tldraw.editor.putExternalContent.mock.calls[0]?.[0]?.files?.[0] as File;
    expect(insertedFile.name).toBe("Codex 图片");
    expect(insertedFile.type).toBe("image/png");
    expect(window.localStorage.getItem("moki.pending-assistant-media")).toBeNull();
    expect(screen.queryByText("当前白板只支持插入图片媒体")).not.toBeInTheDocument();
    fetchMock.mockRestore();
  });

  it("consumes a detached assistant image while the whiteboard is already open", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      blob: async () => new Blob(["image"], { type: "image/png" }),
    } as Response);
    render(
      <MemoryRouter>
        <WhiteboardPage />
      </MemoryRouter>,
    );
    await screen.findByRole("button", { name: "模拟白板修改" });
    const pending = JSON.stringify({
      requestId: "media-request-from-detached",
      url: "/api/assistant/media/generated.png",
      name: "浮窗生成图.png",
      mediaType: "image/png",
      kind: "image",
    });
    window.localStorage.setItem("moki.pending-assistant-media", pending);
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", {
        key: "moki.pending-assistant-media",
        newValue: pending,
      }));
    });

    await waitFor(() => expect(tldraw.editor.putExternalContent).toHaveBeenCalledOnce());
    const insertedFile = tldraw.editor.putExternalContent.mock.calls[0]?.[0]?.files?.[0] as File;
    expect(insertedFile.name).toBe("浮窗生成图.png");
    expect(window.localStorage.getItem("moki.pending-assistant-media")).toBeNull();
    fetchMock.mockRestore();
  });

  it("keeps a pending assistant image when the native canvas insertion fails", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      blob: async () => new Blob(["image"], { type: "image/png" }),
    } as Response);
    tldraw.editor.putExternalContent.mockRejectedValueOnce(
      new Error("图片资源写入失败"),
    );
    const pending = {
      requestId: "media-request-failed",
      url: "/api/assistant/media/generated.png",
      name: "生成图.png",
      mediaType: "image/png",
      kind: "image",
    };
    window.localStorage.setItem(
      "moki.pending-assistant-media",
      JSON.stringify(pending),
    );

    render(
      <MemoryRouter>
        <WhiteboardPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("图片资源写入失败")).toBeInTheDocument();
    expect(JSON.parse(
      window.localStorage.getItem("moki.pending-assistant-media") ?? "null",
    )).toEqual(pending);
    fetchMock.mockRestore();
  });

  it("restores only the selected page from a historical version", () => {
    const current = {
      document: {
        store: {
          "page:a": { id: "page:a", typeName: "page", name: "A" },
          "page:b": { id: "page:b", typeName: "page", name: "B" },
          "shape:a-current": {
            id: "shape:a-current",
            typeName: "shape",
            parentId: "page:a",
          },
          "shape:b-current": {
            id: "shape:b-current",
            typeName: "shape",
            parentId: "page:b",
          },
        },
        schema: {},
      },
      session: { currentPageId: "page:b" },
    };
    const historical = {
      document: {
        store: {
          "page:a": { id: "page:a", typeName: "page", name: "A" },
          "page:b": { id: "page:b", typeName: "page", name: "B" },
          "shape:a-old": {
            id: "shape:a-old",
            typeName: "shape",
            parentId: "page:a",
          },
          "shape:b-old": {
            id: "shape:b-old",
            typeName: "shape",
            parentId: "page:b",
          },
        },
        schema: {},
      },
    };

    const restored = restoreWhiteboardPageSnapshot(
      current as never,
      historical as never,
      "page:a",
    ) as unknown as typeof current;
    const restoredStore = restored.document.store as Record<string, unknown>;
    expect(restoredStore["shape:a-current"]).toBeUndefined();
    expect(restoredStore["shape:a-old"]).toBeDefined();
    expect(restoredStore["shape:b-current"]).toBeDefined();
    expect(restoredStore["shape:b-old"]).toBeUndefined();
    expect(restored.session.currentPageId).toBe("page:b");
    expect(restoredStore["page:a"]).toEqual(
      current.document.store["page:a"],
    );
  });

  it("imports a page as a new page without replacing the current page", () => {
    const current = {
      document: {
        store: {
          "page:current": { id: "page:current", typeName: "page", name: "当前页" },
          "shape:current": { id: "shape:current", typeName: "shape", parentId: "page:current", props: {} },
          "page:new": { id: "page:new", typeName: "page", name: "页面 2", index: "a00000002" },
        },
        schema: {},
      },
      session: { currentPageId: "page:new" },
    };
    const imported = {
      document: {
        store: {
          "page:source": { id: "page:source", typeName: "page", name: "导出页" },
          "asset:source": { id: "asset:source", typeName: "asset", type: "image", props: { src: "/image.png" } },
          "shape:source": { id: "shape:source", typeName: "shape", parentId: "page:source", props: { assetId: "asset:source" } },
        },
        schema: {},
      },
      session: { currentPageId: "page:source" },
    };
    let suffix = 0;
    const merged = mergeWhiteboardPageAsNew(
      current as never,
      imported as never,
      "page:source",
      "page:new",
      "导入页",
      (typeName) => `${typeName}:copy-${++suffix}`,
    ) as unknown as typeof current;
    const store = merged.document.store as Record<string, Record<string, unknown>>;
    expect(store["page:current"]?.name).toBe("当前页");
    expect(store["shape:current"]).toBeDefined();
    expect(store["page:new"]?.name).toBe("导入页");
    expect(store["shape:copy-1"]?.parentId).toBe("page:new");
    expect((store["shape:copy-1"]?.props as { assetId?: string }).assetId).toBe("asset:copy-2");
    expect(merged.session.currentPageId).toBe("page:new");
  });

  it("loads the latest snapshot and throttles local saves to two seconds", async () => {
    const view = render(
      <MemoryRouter>
        <WhiteboardPage />
      </MemoryRouter>,
    );

    const change = await screen.findByRole("button", {
      name: "模拟白板修改",
    });
    expect(tldraw.loadSnapshot).toHaveBeenCalledWith(
      tldraw.store,
      savedSnapshot,
    );
    await waitFor(() =>
      expect(tldraw.store.listen).toHaveBeenCalledTimes(1),
    );

    fireEvent.click(change);
    act(() => vi.advanceTimersByTime(1_999));
    expect(api.saveWhiteboard).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    await waitFor(() =>
      expect(api.saveWhiteboard).toHaveBeenCalledTimes(1),
    );
    expect(
      await screen.findByText(/已保存 · 版本 2/),
    ).toBeInTheDocument();

    fireEvent.click(change);
    view.unmount();
    expect(api.saveWhiteboard).toHaveBeenCalledTimes(2);
  });

  it("serializes local saves and coalesces changes while one save is in flight", async () => {
    let resolveFirstSave!: (value: unknown) => void;
    const firstSave = new Promise((resolve) => {
      resolveFirstSave = resolve;
    });
    api.saveWhiteboard.mockReturnValueOnce(firstSave);
    api.saveWhiteboard.mockResolvedValue({
      version: 3,
      pageId: "page:page",
      pageName: "椤圭洰瑙勫垝",
      pageVersion: 3,
      contentDigest: "digest-3",
      createdAt: "2026-07-23T10:03:00.000Z",
      deduplicated: false,
    });

    render(
      <MemoryRouter>
        <WhiteboardPage />
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(tldraw.store.listen).toHaveBeenCalledTimes(1),
    );

    act(() => {
      tldraw.state.listener?.({ scope: "document" });
    });
    act(() => vi.advanceTimersByTime(2_000));
    await waitFor(() =>
      expect(api.saveWhiteboard).toHaveBeenCalledTimes(1),
    );

    act(() => {
      tldraw.state.listener?.({ scope: "document" });
    });
    act(() => vi.advanceTimersByTime(3_000));
    expect(api.saveWhiteboard).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFirstSave({
        version: 2,
        pageId: "page:page",
        pageName: "椤圭洰瑙勫垝",
        pageVersion: 2,
        contentDigest: "digest-2",
        createdAt: "2026-07-23T10:02:00.000Z",
        deduplicated: false,
      });
      await firstSave;
    });
    act(() => vi.advanceTimersByTime(799));
    expect(api.saveWhiteboard).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(1));
    await waitFor(() =>
      expect(api.saveWhiteboard).toHaveBeenCalledTimes(2),
    );
  });

  it("saves and lists versions for the active page only", async () => {
    render(
      <MemoryRouter>
        <WhiteboardPage />
      </MemoryRouter>,
    );
    const change = await screen.findByRole("button", {
      name: "模拟白板修改",
    });
    await waitFor(() => expect(tldraw.store.listen).toHaveBeenCalled());
    tldraw.editor.getCurrentPageId.mockReturnValue("page:other");
    tldraw.editor.getCurrentPage.mockReturnValue({
      id: "page:other",
      name: "页面 B",
    });

    fireEvent.click(change);
    await waitFor(() =>
      expect(api.getWhiteboardVersions).toHaveBeenCalledWith("page:other"),
    );
    act(() => vi.advanceTimersByTime(2_000));
    await waitFor(() =>
      expect(api.saveWhiteboard).toHaveBeenCalledWith(
        expect.any(Object),
        false,
        expect.objectContaining({
          pageId: "page:other",
          pageName: "页面 B",
        }),
      ),
    );
  });

  it("synchronizes saved metadata when switching pages and ignores stale page responses", async () => {
    let resolveOtherVersions!: (value: Array<{
      version: number;
      pageId: string;
      pageName: string;
      pageVersion: number;
      contentDigest: string;
      createdAt: string;
    }>) => void;
    const otherVersions = new Promise<Parameters<typeof resolveOtherVersions>[0]>((resolve) => {
      resolveOtherVersions = resolve;
    });
    api.getWhiteboard.mockResolvedValue({
      version: 52,
      pageId: "page:page",
      pageName: "项目规划",
      pageVersion: 52,
      snapshot: savedSnapshot,
      createdAt: "2026-07-23T10:00:00.000Z",
    });
    api.getWhiteboardVersions.mockImplementation((pageId?: string) => {
      if (pageId === "page:other") return otherVersions;
      if (pageId === "page:third") {
        return Promise.resolve([{
          version: 61,
          pageId,
          pageName: "页面 C",
          pageVersion: 3,
          contentDigest: "digest-third-3",
          createdAt: "2026-07-23T10:03:00.000Z",
        }]);
      }
      return Promise.resolve([{
        version: 52,
        pageId: "page:page",
        pageName: "项目规划",
        pageVersion: 52,
        contentDigest: "digest-page-52",
        createdAt: "2026-07-23T10:00:00.000Z",
      }]);
    });

    render(
      <MemoryRouter>
        <WhiteboardPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/已保存 · 版本 52/)).toBeVisible();
    await waitFor(() => expect(tldraw.store.listen).toHaveBeenCalled());

    tldraw.editor.getCurrentPageId.mockReturnValue("page:other");
    tldraw.editor.getCurrentPage.mockReturnValue({ id: "page:other", name: "页面 B" });
    act(() => tldraw.state.listener?.({ scope: "session" }));
    expect(screen.getByRole("status", { name: "白板保存状态" })).toHaveTextContent("仅保存在本机");

    tldraw.editor.getCurrentPageId.mockReturnValue("page:third");
    tldraw.editor.getCurrentPage.mockReturnValue({ id: "page:third", name: "页面 C" });
    act(() => tldraw.state.listener?.({ scope: "session" }));
    expect(await screen.findByText(/已保存 · 版本 3/)).toBeVisible();

    await act(async () => {
      resolveOtherVersions([{
        version: 60,
        pageId: "page:other",
        pageName: "页面 B",
        pageVersion: 7,
        contentDigest: "digest-other-7",
        createdAt: "2026-07-23T10:02:00.000Z",
      }]);
      await otherVersions;
    });
    expect(screen.getByRole("status", { name: "白板保存状态" })).toHaveTextContent("已保存 · 版本 3");
    expect(screen.queryByText(/已保存 · 版本 7/)).not.toBeInTheDocument();
  });

  it("synchronizes page creation, reorder, rename and deletion to the backend", async () => {
    const initialPages = {
      document: {
        store: {
          "page:page": {
            id: "page:page",
            typeName: "page",
            name: "Page A",
            index: "a1",
          },
          "page:other": {
            id: "page:other",
            typeName: "page",
            name: "Page B",
            index: "a2",
          },
          "page:third": {
            id: "page:third",
            typeName: "page",
            name: "Page C",
            index: "a3",
          },
        },
        schema: { schemaVersion: 2, sequences: {} },
      },
      session: { currentPageId: "page:page" },
    };
    const updatedPages = {
      document: {
        store: {
          "page:third": {
            id: "page:third",
            typeName: "page",
            name: "Page C",
            index: "a1",
          },
          "page:page": {
            id: "page:page",
            typeName: "page",
            name: "Renamed A",
            index: "a2",
          },
          "page:new": {
            id: "page:new",
            typeName: "page",
            name: "Page D",
            index: "a3",
          },
        },
        schema: { schemaVersion: 2, sequences: {} },
      },
      session: { currentPageId: "page:new" },
    };
    api.getWhiteboard.mockResolvedValue({
      version: 3,
      snapshot: initialPages,
      createdAt: "2026-08-14T10:00:00.000Z",
    });
    render(
      <MemoryRouter>
        <WhiteboardPage />
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(tldraw.store.listen).toHaveBeenCalledWith(
        expect.any(Function),
        { source: "all", scope: "all" },
      ),
    );

    tldraw.getSnapshot.mockReturnValue(updatedPages);
    tldraw.editor.getCurrentPageId.mockReturnValue("page:new");
    tldraw.editor.getCurrentPage.mockReturnValue({
      id: "page:new",
      name: "Page D",
    });
    act(() => {
      tldraw.state.listener?.({ scope: "document" });
    });
    act(() => vi.advanceTimersByTime(2_000));

    await waitFor(() =>
      expect(api.syncWhiteboardPages).toHaveBeenCalledWith(updatedPages, false),
    );
    expect(api.saveWhiteboard).not.toHaveBeenCalled();
  });

  it("shows recovery and save failure states without hiding the canvas", async () => {
    api.getWhiteboard.mockResolvedValue({
      version: 1,
      snapshot: savedSnapshot,
      recoveredFromVersion: 2,
      createdAt: "2026-07-23T10:00:00.000Z",
    });
    api.saveWhiteboard.mockRejectedValue(new Error("本地保存失败"));
    render(
      <MemoryRouter>
        <WhiteboardPage />
      </MemoryRouter>,
    );

    const change = await screen.findByRole("button", {
      name: "模拟白板修改",
    });
    expect(
      screen.getByText("版本 2 损坏，已恢复版本 1"),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(tldraw.store.listen).toHaveBeenCalledTimes(1),
    );

    fireEvent.click(change);
    act(() => vi.advanceTimersByTime(2_000));
    expect(
      await screen.findByRole("alert"),
    ).toHaveTextContent("本地保存失败");
    expect(change).toBeInTheDocument();
  });

  it("reports native snapshot serialization failures without writing a version", async () => {
    tldraw.getSnapshot
      .mockImplementationOnce(() => {
        throw new Error("Session state is not ready yet");
      })
      .mockImplementation(() => ({
        document: {
          store: {
            "page:page": {
              id: "page:page",
              typeName: "page",
              name: "项目规划",
            },
          },
          schema: { schemaVersion: 2, sequences: {} },
        },
      }));
    render(
      <MemoryRouter>
        <WhiteboardPage />
      </MemoryRouter>,
    );

    const change = await screen.findByRole("button", {
      name: "模拟白板修改",
    });
    await waitFor(() =>
      expect(tldraw.store.listen).toHaveBeenCalledTimes(1),
    );
    expect(tldraw.store.listen).toHaveBeenCalledWith(
      expect.any(Function),
      { source: "all", scope: "all" },
    );

    fireEvent.click(change);
    act(() => vi.advanceTimersByTime(2_000));
    expect(api.saveWhiteboard).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Session state is not ready yet",
    );
  });

  it("deletes selected shapes with the keyboard and saves the change", async () => {
    tldraw.editor.getSelectedShapeIds.mockReturnValue([
      "shape:one",
    ]);
    render(
      <MemoryRouter>
        <WhiteboardPage />
      </MemoryRouter>,
    );
    await screen.findByRole("button", {
      name: "模拟白板修改",
    });

    fireEvent.keyDown(window, { key: "Delete" });
    expect(tldraw.editor.deleteShapes).toHaveBeenCalledWith([
      "shape:one",
    ]);

    act(() => vi.advanceTimersByTime(2_000));
    await waitFor(() =>
      expect(api.saveWhiteboard).toHaveBeenCalledTimes(1),
    );
  });

  it("keeps native undo and redo keyboard shortcuts", async () => {
    render(
      <MemoryRouter>
        <WhiteboardPage />
      </MemoryRouter>,
    );
    await screen.findByRole("button", {
      name: "模拟白板修改",
    });

    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    fireEvent.keyDown(window, { key: "z", ctrlKey: true, shiftKey: true });
    fireEvent.keyDown(window, { key: "y", ctrlKey: true });

    expect(tldraw.editor.undo).toHaveBeenCalledTimes(1);
    expect(tldraw.editor.redo).toHaveBeenCalledTimes(2);
  });

  it("shows the whiteboard shortcuts including clipboard image paste", async () => {
    render(
      <MemoryRouter>
        <WhiteboardPage />
      </MemoryRouter>,
    );
    await screen.findByRole("button", {
      name: "模拟白板修改",
    });

    fireEvent.click(screen.getByRole("button", { name: "白板快捷键" }));

    expect(screen.getByRole("region", { name: "白板快捷键列表" }))
      .toBeInTheDocument();
    expect(screen.getByText("粘贴图片或元素")).toBeInTheDocument();
    expect(screen.getByText("Ctrl / ⌘ + V")).toBeInTheDocument();
    expect(screen.getByText("编组选中元素")).toBeInTheDocument();
    expect(screen.getByText("Ctrl / ⌘ + G")).toBeInTheDocument();
    expect(screen.getByText("取消选中编组")).toBeInTheDocument();
    expect(screen.getByText("Ctrl / ⌘ + Alt + G")).toBeInTheDocument();
    expect(screen.getByText("按方向对齐选中元素")).toBeInTheDocument();
    expect(screen.getByText("Ctrl / ⌘ + 方向键")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("region", { name: "白板快捷键列表" }))
      .not.toBeInTheDocument();
  });

  it("shows the portable whiteboard import menu in the header after save", async () => {
    render(<MemoryRouter><WhiteboardPage /></MemoryRouter>);
    await screen.findByRole("button", { name: "模拟白板修改" });

    const transfer = screen.getByRole("button", { name: "导入或导出白板文件" });
    const save = screen.getByRole("button", { name: "立即保存白板" });
    expect(save.compareDocumentPosition(transfer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(transfer);
    expect(screen.getByRole("button", { name: "导入白板文件" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "导出白板文件" })).toBeInTheDocument();
  });

  it("accepts video from the image/media add control", async () => {
    const { container } = render(<MemoryRouter><WhiteboardPage /></MemoryRouter>);
    await screen.findByRole("button", { name: "模拟白板修改" });
    const input = container.querySelector('input[type="file"][accept*="video"]') as HTMLInputElement;
    expect(input).toBeInTheDocument();
    const video = new File(["video"], "clip.mp4", { type: "video/mp4" });
    fireEvent.change(input, { target: { files: [video] } });
    await waitFor(() => expect(tldraw.editor.putExternalContent).toHaveBeenCalledWith(
      expect.objectContaining({ files: [video] }),
      { force: true },
    ));
  });

  it("supports selection, duplication, save, fit and tool keyboard shortcuts", async () => {
    tldraw.editor.getCurrentPageShapeIds.mockReturnValue([
      "shape:one",
      "shape:two",
    ]);
    tldraw.editor.copySelectedShapes.mockReturnValue("serialized-shapes");
    tldraw.editor.pasteCopiedShapes.mockReturnValue(["shape:copy"]);
    render(
      <MemoryRouter>
        <WhiteboardPage />
      </MemoryRouter>,
    );
    await screen.findByRole("button", {
      name: "模拟白板修改",
    });

    fireEvent.keyDown(window, { key: "a", ctrlKey: true });
    fireEvent.keyDown(window, { key: "d", ctrlKey: true });
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    fireEvent.keyDown(window, { key: "0", ctrlKey: true });
    fireEvent.keyDown(window, { key: "v" });
    fireEvent.keyDown(window, { key: "h" });
    fireEvent.keyDown(window, { key: "p" });
    fireEvent.keyDown(window, { key: "t" });
    fireEvent.keyDown(window, { key: "r" });

    expect(tldraw.editor.select).toHaveBeenCalledWith(
      "shape:one",
      "shape:two",
    );
    expect(tldraw.editor.pasteCopiedShapes).toHaveBeenCalledWith(
      "serialized-shapes",
      32,
    );
    expect(tldraw.editor.fitCurrentPage).toHaveBeenCalledTimes(1);
    expect(tldraw.editor.setCurrentTool.mock.calls.map(([tool]) => tool))
      .toEqual(expect.arrayContaining(["select", "hand", "draw", "text", "geo"]));
    await waitFor(() => expect(api.saveWhiteboard).toHaveBeenCalled());
  });

  it.each(["ctrlKey", "metaKey"])("groups selected shapes with %s + G and saves the change", async (modifier) => {
    tldraw.editor.groupSelectedShapes.mockReturnValue("group:test");
    render(<MemoryRouter><WhiteboardPage /></MemoryRouter>);
    await screen.findByRole("button", { name: "模拟白板修改" });
    vi.useFakeTimers();

    expect(fireEvent.keyDown(window, { key: "g", [modifier]: true })).toBe(false);
    fireEvent.keyDown(window, { key: "g", [modifier]: true, repeat: true });

    expect(tldraw.editor.groupSelectedShapes).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(api.saveWhiteboard).toHaveBeenCalledTimes(1);
  });

  it.each(["ctrlKey", "metaKey"])("ungroups selected shapes with %s + Alt + G and saves the change", async (modifier) => {
    tldraw.editor.ungroupSelectedShapes.mockReturnValue(true);
    render(<MemoryRouter><WhiteboardPage /></MemoryRouter>);
    await screen.findByRole("button", { name: "模拟白板修改" });
    vi.useFakeTimers();

    expect(
      fireEvent.keyDown(window, {
        key: "g",
        [modifier]: true,
        altKey: true,
      }),
    ).toBe(false);
    fireEvent.keyDown(window, {
      key: "g",
      [modifier]: true,
      altKey: true,
      repeat: true,
    });

    expect(tldraw.editor.ungroupSelectedShapes).toHaveBeenCalledTimes(1);
    expect(tldraw.editor.groupSelectedShapes).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(api.saveWhiteboard).toHaveBeenCalledTimes(1);
  });

  it("does not group while editing text or using other G combinations", async () => {
    render(<MemoryRouter><WhiteboardPage /></MemoryRouter>);
    await screen.findByRole("button", { name: "模拟白板修改" });

    for (const tag of ["input", "textarea", "select", "div"]) {
      const field = document.createElement(tag);
      if (tag === "div") field.setAttribute("contenteditable", "true");
      document.body.appendChild(field);
      expect(fireEvent.keyDown(field, { key: "g", ctrlKey: true })).toBe(true);
      field.remove();
    }
    fireEvent.keyDown(window, { key: "g" });
    fireEvent.keyDown(window, { key: "g", ctrlKey: true, shiftKey: true });
    fireEvent.keyDown(window, { key: "g", ctrlKey: true, altKey: true, shiftKey: true });
    expect(tldraw.editor.groupSelectedShapes).not.toHaveBeenCalled();
    expect(tldraw.editor.ungroupSelectedShapes).not.toHaveBeenCalled();
  });

  it("does not schedule a save when the selection cannot be grouped", async () => {
    render(<MemoryRouter><WhiteboardPage /></MemoryRouter>);
    await screen.findByRole("button", { name: "模拟白板修改" });
    vi.useFakeTimers();
    fireEvent.keyDown(window, { key: "g", ctrlKey: true });
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(tldraw.editor.groupSelectedShapes).toHaveBeenCalledTimes(1);
    expect(api.saveWhiteboard).not.toHaveBeenCalled();
  });

  it("does not schedule a save when the selection cannot be ungrouped", async () => {
    tldraw.editor.ungroupSelectedShapes.mockReturnValue(false);
    render(<MemoryRouter><WhiteboardPage /></MemoryRouter>);
    await screen.findByRole("button", { name: "模拟白板修改" });
    vi.useFakeTimers();
    fireEvent.keyDown(window, { key: "g", ctrlKey: true, altKey: true });
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(tldraw.editor.ungroupSelectedShapes).toHaveBeenCalledTimes(1);
    expect(api.saveWhiteboard).not.toHaveBeenCalled();
  });

  it("limits embedded whiteboard shortcuts to its active workspace surface", async () => {
    const view = render(<MemoryRouter><WhiteboardPage embedded/></MemoryRouter>);
    const surface = await screen.findByRole("button", { name: "模拟白板修改" });
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: "g", ctrlKey: true });
    expect(tldraw.editor.groupSelectedShapes).not.toHaveBeenCalled();
    fireEvent.keyDown(surface, { key: "g", ctrlKey: true });
    expect(tldraw.editor.groupSelectedShapes).toHaveBeenCalledTimes(1);
    view.rerender(<MemoryRouter><WhiteboardPage embedded active={false}/></MemoryRouter>);
    fireEvent.keyDown(surface, { key: "g", ctrlKey: true });
    expect(tldraw.editor.groupSelectedShapes).toHaveBeenCalledTimes(1);
  });

  it("keeps an embedded whiteboard open when its save checkpoint fails", async () => {
    const onCheckpointReady = vi.fn();
    render(<MemoryRouter><WhiteboardPage embedded onCheckpointReady={onCheckpointReady}/></MemoryRouter>);
    const surface = await screen.findByRole("button", { name: "模拟白板修改" });
    await waitFor(() => expect(tldraw.store.listen).toHaveBeenCalledTimes(1));
    api.saveWhiteboard.mockRejectedValue(new Error("磁盘写入失败"));
    fireEvent.click(surface);
    const checkpoint = onCheckpointReady.mock.calls.at(-1)![0] as () => Promise<void>;
    await act(async () => { await expect(checkpoint()).rejects.toThrow("白板尚未保存"); });
    expect(screen.getByText("磁盘写入失败")).toBeInTheDocument();
    api.saveWhiteboard.mockResolvedValue({ version: 2, createdAt: "2026-09-08T00:00:00Z" });
    await act(async () => { await expect(checkpoint()).resolves.toBeUndefined(); });
  });

  it("toggles the canvas window fullscreen state", async () => {
    render(
      <MemoryRouter>
        <WhiteboardPage />
      </MemoryRouter>,
    );
    await screen.findByRole("button", { name: "模拟白板修改" });

    fireEvent.click(screen.getByRole("button", { name: "画布全屏" }));
    expect(screen.getByRole("button", { name: "退出画布全屏" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByRole("button", { name: "画布全屏" })).toHaveAttribute("aria-pressed", "false");
  });

  it("keeps the current-material panel collapsed until expanded", async () => {
    render(<MemoryRouter><WhiteboardPage /></MemoryRouter>);
    await screen.findByRole("button", { name: "模拟白板修改" });
    expect(screen.getByRole("button", { name: "展开素材列表" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "收起素材列表" })).not.toBeInTheDocument();
  });

  it("shows the material count beside the title and filters materials by name or type", async () => {
    (tldraw.store as { snapshot?: unknown }).snapshot = {
      document: {
        store: {
          "page:page": {
            id: "page:page",
            typeName: "page",
            name: "项目规划",
          },
          "shape:report": {
            id: "shape:report",
            typeName: "shape",
            type: "link",
            parentId: "page:page",
            index: "a1",
            x: 20,
            y: 20,
            props: { title: "季度财务报告", url: "https://example.com/report" },
          },
          "shape:poster": {
            id: "shape:poster",
            typeName: "shape",
            type: "image",
            parentId: "page:page",
            index: "a2",
            x: 80,
            y: 80,
            props: { assetId: "asset:poster", altText: "品牌海报.png" },
          },
          "asset:poster": {
            id: "asset:poster",
            typeName: "asset",
            type: "image",
            props: { name: "品牌海报.png", src: "data:image/png;base64,cG5n" },
          },
        },
        schema: { schemaVersion: 2, sequences: {} },
      },
    };
    render(<MemoryRouter><WhiteboardPage /></MemoryRouter>);
    await screen.findByRole("button", { name: "模拟白板修改" });
    fireEvent.click(screen.getByRole("button", { name: "展开素材列表" }));

    const panel = screen.getByRole("complementary", { name: "当前页面素材列表" });
    const title = within(panel).getByText("当前页面素材");
    const count = within(panel).getByText("2 项");
    expect(title.parentElement).toContainElement(count);
    expect(title.parentElement).toHaveClass("items-center");
    expect(title.closest("header")).toHaveClass("h-9", "items-center");
    expect(count).toHaveClass("inline-flex", "items-center", "leading-none");
    expect(within(panel).getByRole("button", { name: "收起素材列表" })).toHaveClass(
      "border-0",
      "bg-transparent",
      "shadow-none",
    );

    const search = within(panel).getByRole("textbox", { name: "搜索当前页面素材" });
    fireEvent.change(search, { target: { value: "财务" } });
    expect(within(panel).getByRole("button", { name: "定位 季度财务报告" })).toBeVisible();
    expect(within(panel).queryByRole("button", { name: "定位 品牌海报.png" })).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: "图片" } });
    expect(within(panel).getByRole("button", { name: "定位 品牌海报.png" })).toBeVisible();
    expect(within(panel).queryByRole("button", { name: "定位 季度财务报告" })).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: "不存在" } });
    expect(within(panel).getByText("没有匹配的素材。")).toBeVisible();
    fireEvent.click(within(panel).getByRole("button", { name: "清除素材搜索" }));
    expect(within(panel).getByRole("button", { name: "定位 季度财务报告" })).toBeVisible();
    expect(within(panel).getByRole("button", { name: "定位 品牌海报.png" })).toBeVisible();

    fireEvent.click(within(panel).getByRole("button", { name: "预览 品牌海报.png" }));
    const preview = screen.getByRole("dialog", { name: "预览 品牌海报.png" });
    expect(preview).toHaveStyle({
      width: "64rem",
      height: "40rem",
      maxWidth: "calc(100% - 2rem)",
      maxHeight: "calc(100% - 2rem)",
    });
    expect(preview.parentElement).toHaveClass("absolute", "place-items-center", "overflow-hidden");
    fireEvent.click(screen.getByRole("button", { name: "关闭素材预览" }));
    expect(screen.queryByRole("dialog", { name: "预览 品牌海报.png" })).not.toBeInTheDocument();

    fireEvent.doubleClick(within(panel).getByText("品牌海报.png"));
    const renameInput = within(panel).getByRole("textbox", { name: "重命名 品牌海报.png" });
    expect(renameInput).toHaveFocus();
    expect(renameInput).toHaveValue("品牌海报.png");
    fireEvent.change(renameInput, { target: { value: "新版品牌海报.png" } });
    fireEvent.keyDown(renameInput, { key: "Enter" });
    expect(tldraw.editor.renameMaterial).toHaveBeenCalledWith("shape:poster", "新版品牌海报.png");

    fireEvent.doubleClick(within(panel).getByText("季度财务报告"));
    const cancelledInput = within(panel).getByRole("textbox", { name: "重命名 季度财务报告" });
    fireEvent.change(cancelledInput, { target: { value: "不应保存" } });
    fireEvent.keyDown(cancelledInput, { key: "Escape" });
    expect(tldraw.editor.renameMaterial).toHaveBeenCalledTimes(1);
  });

  it("keeps the version panel above canvas action buttons", async () => {
    render(
      <MemoryRouter>
        <WhiteboardPage />
      </MemoryRouter>,
    );
    await screen.findByRole("button", { name: "模拟白板修改" });

    fireEvent.click(screen.getByRole("button", { name: "查看白板版本" }));

    expect(screen.getByRole("complementary", { name: "白板版本记录" }))
      .toHaveClass("z-50");
  });

  it("removes the standalone color tool from the main toolbar", async () => {
    render(
      <MemoryRouter>
        <WhiteboardPage />
      </MemoryRouter>,
    );
    await screen.findByRole("button", { name: "模拟白板修改" });
    expect(screen.queryByRole("button", { name: "设置颜色" })).not.toBeInTheDocument();
  });

  it("opens the whiteboard page remembered by the assistant conversation", async () => {
    const onActivePageChange = vi.fn();
    api.getWhiteboard.mockResolvedValue({
      version: 2,
      snapshot: {
        document: {
          store: {
            "page:page": { id: "page:page", typeName: "page", name: "项目规划" },
            "page:review": { id: "page:review", typeName: "page", name: "评审记录" },
          },
          schema: { schemaVersion: 2, sequences: {} },
        },
        session: { currentPageId: "page:page" },
      },
      createdAt: "2026-07-23T10:00:00.000Z",
    });

    render(
      <MemoryRouter>
        <WhiteboardPage
          embedded
          initialPageId="page:review"
          onActivePageChange={onActivePageChange}
        />
      </MemoryRouter>,
    );

    await waitFor(() => expect(tldraw.loadSnapshot).toHaveBeenCalledWith(
      tldraw.store,
      expect.objectContaining({ session: expect.objectContaining({ currentPageId: "page:review" }) }),
    ));
    await waitFor(() => expect(onActivePageChange).toHaveBeenLastCalledWith({
      pageId: "page:review",
      pageName: "评审记录",
    }));
  });

  it("passes pasted or dropped images to the native editor at the requested point", async () => {
    render(
      <MemoryRouter>
        <WhiteboardPage />
      </MemoryRouter>,
    );
    await screen.findByRole("button", { name: "模拟白板修改" });
    const image = new File(["image"], "drop.png", { type: "image/png" });

    await act(async () => {
      await tldraw.state.imageHandler?.([image], { x: 320, y: 240 });
    });

    expect(tldraw.editor.putExternalContent).toHaveBeenCalledWith(
      {
        type: "files",
        files: [image],
        point: { x: 320, y: 240 },
      },
      { force: true },
    );
  });

  it("activates text entry without opening a toolbar formatting menu", async () => {
    render(
      <MemoryRouter>
        <WhiteboardPage />
      </MemoryRouter>,
    );
    await screen.findByRole("button", { name: "模拟白板修改" });

    const textButton = screen.getByRole("button", { name: "文字" });
    fireEvent.click(textButton);

    expect(tldraw.editor.setCurrentTool).toHaveBeenLastCalledWith("text");
    expect(textButton).not.toHaveAttribute("aria-expanded");
    expect(screen.queryByLabelText("文字样式")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "文字加粗" })).not.toBeInTheDocument();
  });

  it("toggles arrow and draw menus by clicking their active tool again", async () => {
    const uninstallOutsideDismiss = installModalOutsideDismiss();
    try {
      render(
        <MemoryRouter>
          <WhiteboardPage />
        </MemoryRouter>,
      );
      await screen.findByRole("button", { name: "模拟白板修改" });

      const arrowButton = screen.getByRole("button", { name: "箭头" });
      fireEvent.pointerDown(arrowButton);
      fireEvent.click(arrowButton);
      expect(arrowButton).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByRole("menu", { name: "箭头样式" })).toBeInTheDocument();
      fireEvent.pointerDown(arrowButton);
      fireEvent.click(arrowButton);
      expect(arrowButton).toHaveAttribute("aria-expanded", "false");
      expect(screen.queryByRole("menu", { name: "箭头样式" })).not.toBeInTheDocument();
      fireEvent.pointerDown(arrowButton);
      fireEvent.click(arrowButton);
      expect(arrowButton).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByRole("menu", { name: "箭头样式" })).toBeInTheDocument();

      const drawButton = screen.getByRole("button", { name: "画笔" });
      fireEvent.click(drawButton);
      expect(drawButton).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByLabelText("画笔粗细")).toBeInTheDocument();
      expect(screen.getByLabelText("画笔颜色")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "画笔颜色 黑色" })).toHaveAttribute("aria-pressed", "true");
      fireEvent.click(screen.getByRole("button", { name: "画笔颜色 红色" }));
      expect(screen.getByRole("button", { name: "画笔颜色 红色" })).toHaveAttribute("aria-pressed", "true");
      fireEvent.click(drawButton);
      expect(drawButton).toHaveAttribute("aria-expanded", "false");
      expect(screen.queryByLabelText("画笔粗细")).not.toBeInTheDocument();

    } finally {
      uninstallOutsideDismiss();
    }
  });

  it("uses dark-mode cursors and contains toolbar pointer events", async () => {
    const view = render(
      <MemoryRouter>
        <WhiteboardPage />
      </MemoryRouter>,
    );
    await screen.findByRole("button", { name: "模拟白板修改" });
    const canvas = view.container.querySelector<HTMLElement>(".whiteboard-canvas");
    expect(canvas).not.toBeNull();
    const pointerDown = vi.fn();
    window.addEventListener("pointerdown", pointerDown);

    try {
      for (const [label, tool] of [
        ["橡皮", "eraser"],
        ["箭头", "arrow"],
        ["画笔", "draw"],
      ] as const) {
        const button = screen.getByRole("button", { name: label });
        expect(fireEvent.pointerDown(button)).toBe(false);
        fireEvent.click(button);
        expect(canvas).toHaveAttribute("data-active-tool", tool);
        expect(canvas?.style.getPropertyValue("--whiteboard-tool-cursor-light")).toContain("%23171b2c");
        expect(canvas?.style.getPropertyValue("--whiteboard-tool-cursor-dark")).toContain("%23f4f2ff");
      }
      expect(pointerDown).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("pointerdown", pointerDown);
    }
  });

  it("applies the chosen brush color to a selected pen stroke", async () => {
    tldraw.editor.getSelectedShapeIds.mockReturnValue(["shape:draw"]);
    tldraw.editor.getShape.mockReturnValue({
      id: "shape:draw",
      type: "draw",
      x: 0,
      y: 0,
      props: { color: "black", size: "m" },
    });
    render(
      <MemoryRouter>
        <WhiteboardPage />
      </MemoryRouter>,
    );
    await screen.findByRole("button", { name: "模拟白板修改" });

    fireEvent.click(screen.getByRole("button", { name: "画笔" }));
    fireEvent.click(screen.getByRole("button", { name: "画笔颜色 红色" }));

    expect(tldraw.editor.updateShapes).toHaveBeenCalledWith([
      { id: "shape:draw", props: { color: "red" } },
    ]);
  });

  it("offers arrow styles and applies the chosen style to a selected arrow", async () => {
    tldraw.editor.getSelectedShapeIds.mockReturnValue(["shape:arrow"]);
    tldraw.editor.getShape.mockReturnValue({
      id: "shape:arrow",
      type: "arrow",
      x: 0,
      y: 0,
      props: {},
    });
    render(
      <MemoryRouter>
        <WhiteboardPage />
      </MemoryRouter>,
    );
    await screen.findByRole("button", { name: "模拟白板修改" });

    fireEvent.click(screen.getByRole("button", { name: "箭头" }));
    expect(screen.getByRole("menu", { name: "箭头样式" })).toBeVisible();
    fireEvent.click(screen.getByRole("menuitemradio", { name: "箭头样式 双向箭头" }));

    expect(tldraw.editor.updateShapes).toHaveBeenCalledWith([
      { id: "shape:arrow", props: { arrowStyle: "double" } },
    ]);
    expect(tldraw.editor.setCurrentTool).toHaveBeenLastCalledWith("arrow");
  });

  it("adds quick insert shapes at the current canvas scale", async () => {
    tldraw.editor.getCurrentPageShapeIds.mockReturnValue([
      "shape:existing",
    ]);
    tldraw.editor.getShapePageBounds.mockReturnValue({
      x: 20,
      y: 30,
      w: 360,
      h: 260,
    });
    render(
      <MemoryRouter>
        <WhiteboardPage />
      </MemoryRouter>,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "便签" }),
    );

    expect(tldraw.editor.createShapes).toHaveBeenCalledWith([
      expect.objectContaining({
        id: "shape:quick",
        type: "note",
        props: expect.objectContaining({
          size: "l",
        }),
      }),
    ]);
    expect(tldraw.editor.select).toHaveBeenCalledWith("shape:quick");
    act(() => vi.advanceTimersByTime(2_000));
    await waitFor(() =>
      expect(api.saveWhiteboard).toHaveBeenCalledTimes(1),
    );
  });

  it("inserts an editable mind-map template with nodes and connecting arrows", async () => {
    render(
      <MemoryRouter>
        <WhiteboardPage />
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "插入思维导图" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "使用向右展开模板" }));
    const shapes = tldraw.editor.createShapes.mock.calls.at(-1)?.[0] as Array<{
      type: string;
      props: Record<string, unknown>;
    }>;
    expect(shapes).toHaveLength(9);
    expect(shapes.filter((shape) => shape.type === "arrow")).toHaveLength(4);
    expect(shapes.filter((shape) => shape.props.mokiMindMapNode === true)).toHaveLength(5);
    expect(tldraw.editor.zoomToSelection).toHaveBeenCalled();
  });

  it("places a new mind-map template outside existing canvas content", async () => {
    tldraw.editor.getCurrentPageShapeIds.mockReturnValue(["shape:existing"]);
    tldraw.editor.getShapePageBounds.mockImplementation((id: string) => (
      id === "shape:existing"
        ? { x: 0, y: 0, w: 1_000, h: 800, center: { x: 500, y: 400 } }
        : undefined
    ));
    render(
      <MemoryRouter>
        <WhiteboardPage />
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "插入思维导图" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "使用向右展开模板" }));
    const shapes = tldraw.editor.createShapes.mock.calls.at(-1)?.[0] as Array<{
      type: string;
      x: number;
      props: Record<string, unknown>;
    }>;
    const nodes = shapes.filter((shape) => shape.props.mokiMindMapNode === true);
    const left = Math.min(...nodes.map((shape) => shape.x));
    expect(left).toBeGreaterThanOrEqual(1_072);
  });

  it("inserts a normalized link in interactive preview mode", async () => {
    render(
      <MemoryRouter>
        <WhiteboardPage />
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "链接" }));
    fireEvent.change(screen.getByRole("textbox", { name: "链接地址" }), {
      target: { value: "example.com/dashboard" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "链接标题" }), {
      target: { value: "项目仪表盘" },
    });
    fireEvent.click(screen.getByRole("button", { name: "网页预览" }));
    fireEvent.click(screen.getByRole("button", { name: "插入链接" }));

    expect(tldraw.editor.createShapes).toHaveBeenCalledWith([
      expect.objectContaining({
        id: "shape:quick",
        type: "link",
        props: expect.objectContaining({
          url: "https://example.com/dashboard",
          title: "项目仪表盘",
          mode: "preview",
          w: 360,
          h: 300,
        }),
      }),
    ]);
  });

  it("marks a hostname fallback for automatic webpage-title replacement", async () => {
    render(
      <MemoryRouter>
        <WhiteboardPage />
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "链接" }));
    fireEvent.change(screen.getByRole("textbox", { name: "链接地址" }), {
      target: { value: "https://example.com/guide" },
    });
    fireEvent.click(screen.getByRole("button", { name: "插入链接" }));

    expect(tldraw.editor.createShapes).toHaveBeenCalledWith([
      expect.objectContaining({
        type: "link",
        props: expect.objectContaining({
          title: "example.com",
          titleAuto: true,
        }),
      }),
    ]);
  });

  it.each([false, true])("collapses alignment tools by default in embedded=%s mode", async (embedded) => {
    render(<MemoryRouter><WhiteboardPage embedded={embedded}/></MemoryRouter>);
    const toggle = await screen.findByRole("button", { name: "对齐工具" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "左对齐" })).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    for (const name of ["左对齐", "水平居中", "右对齐", "顶部对齐", "垂直居中", "底部对齐"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
    fireEvent.click(toggle);
    expect(screen.queryByRole("button", { name: "左对齐" })).not.toBeInTheDocument();
    fireEvent.click(toggle);
    fireEvent.keyDown(toggle, { key: "Escape" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("aligns selected shapes and persists the result", async () => {
    tldraw.editor.getSelectedShapeIds.mockReturnValue([
      "shape:a",
      "shape:b",
    ]);
    tldraw.editor.getShape.mockImplementation((id: string) => ({
      id,
      type: "geo",
      x: id === "shape:a" ? 10 : 80,
      y: id === "shape:a" ? 20 : 60,
      props: {},
    }));
    tldraw.editor.getShapePageBounds.mockImplementation((id: string) =>
      id === "shape:a"
        ? { x: 10, y: 20, w: 50, h: 30 }
        : { x: 80, y: 60, w: 40, h: 20 },
    );
    render(
      <MemoryRouter>
        <WhiteboardPage />
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "对齐工具" }));

    fireEvent.click(
      await screen.findByRole("button", { name: "左对齐" }),
    );

    expect(tldraw.editor.updateShapes).toHaveBeenCalledWith([
      expect.objectContaining({ id: "shape:a", x: 10, y: 20 }),
      expect.objectContaining({ id: "shape:b", x: 10, y: 60 }),
    ]);
    act(() => vi.advanceTimersByTime(2_000));
    await waitFor(() =>
      expect(api.saveWhiteboard).toHaveBeenCalledTimes(1),
    );
  });

  it("aligns a group as one unit without rearranging its members", async () => {
    const bounds = {
      "shape:group-a": { x: 10, y: 20, w: 40, h: 30 },
      "shape:group-b": { x: 70, y: 25, w: 30, h: 20 },
      "shape:single": { x: 0, y: 100, w: 40, h: 30 },
    } as const;
    tldraw.editor.getSelectedShapeIds.mockReturnValue(["shape:group-a", "shape:single"]);
    tldraw.editor.getCurrentPageShapeIds.mockReturnValue(Object.keys(bounds));
    tldraw.editor.getShape.mockImplementation((id: keyof typeof bounds) => ({
      id,
      type: "geo",
      x: bounds[id].x,
      y: bounds[id].y,
      props: id.startsWith("shape:group-") ? { mokiGroupId: "group:one" } : {},
    }));
    tldraw.editor.getShapePageBounds.mockImplementation((id: keyof typeof bounds) => bounds[id]);
    render(
      <MemoryRouter>
        <WhiteboardPage />
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "对齐工具" }));

    fireEvent.click(await screen.findByRole("button", { name: "左对齐" }));

    expect(tldraw.editor.updateShapes).toHaveBeenCalledWith([
      expect.objectContaining({ id: "shape:group-a", x: 0, y: 20 }),
      expect.objectContaining({ id: "shape:group-b", x: 60, y: 25 }),
      expect.objectContaining({ id: "shape:single", x: 0, y: 100 }),
    ]);
  });

  it("aligns selected shapes with Ctrl plus an arrow key outside text inputs", async () => {
    tldraw.editor.getSelectedShapeIds.mockReturnValue([
      "shape:a",
      "shape:b",
    ]);
    const bounds = {
      "shape:a": { x: 10, y: 20, w: 50, h: 30 },
      "shape:b": { x: 80, y: 60, w: 40, h: 20 },
    } as const;
    tldraw.editor.getShape.mockImplementation((id: keyof typeof bounds) => ({
      id,
      type: "geo",
      x: bounds[id].x,
      y: bounds[id].y,
      props: {},
    }));
    tldraw.editor.getShapePageBounds.mockImplementation(
      (id: keyof typeof bounds) => bounds[id],
    );
    render(
      <MemoryRouter>
        <WhiteboardPage />
      </MemoryRouter>,
    );
    await screen.findByRole("button", { name: "模拟白板修改" });

    const cases = [
      {
        key: "ArrowLeft",
        updates: [
          { id: "shape:a", x: 10, y: 20 },
          { id: "shape:b", x: 10, y: 60 },
        ],
      },
      {
        key: "ArrowRight",
        updates: [
          { id: "shape:a", x: 70, y: 20 },
          { id: "shape:b", x: 80, y: 60 },
        ],
      },
      {
        key: "ArrowUp",
        updates: [
          { id: "shape:a", x: 10, y: 20 },
          { id: "shape:b", x: 80, y: 20 },
        ],
      },
      {
        key: "ArrowDown",
        updates: [
          { id: "shape:a", x: 10, y: 50 },
          { id: "shape:b", x: 80, y: 60 },
        ],
      },
    ];

    for (const testCase of cases) {
      tldraw.editor.updateShapes.mockClear();
      fireEvent.keyDown(window, { key: testCase.key, ctrlKey: true });
      expect(tldraw.editor.updateShapes).toHaveBeenCalledWith(
        testCase.updates.map((update) => expect.objectContaining(update)),
      );
    }

    tldraw.editor.updateShapes.mockClear();
    const input = document.createElement("input");
    document.body.append(input);
    fireEvent.keyDown(input, { key: "ArrowLeft", ctrlKey: true });
    expect(tldraw.editor.updateShapes).not.toHaveBeenCalled();
    input.remove();
  });

  it("uses conventional edge and center alignment when shapes do not overlap", async () => {
    tldraw.editor.getSelectedShapeIds.mockReturnValue([
      "shape:a",
      "shape:b",
    ]);
    const bounds = {
      "shape:a": { x: 10, y: 20, w: 50, h: 30 },
      "shape:b": { x: 80, y: 60, w: 40, h: 20 },
    } as const;
    tldraw.editor.getShape.mockImplementation((id: keyof typeof bounds) => ({
      id,
      type: "geo",
      x: bounds[id].x,
      y: bounds[id].y,
      props: {},
    }));
    tldraw.editor.getShapePageBounds.mockImplementation(
      (id: keyof typeof bounds) => bounds[id],
    );
    render(
      <MemoryRouter>
        <WhiteboardPage />
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "对齐工具" }));

    const cases = [
      {
        button: "左对齐",
        updates: [
          { id: "shape:a", x: 10, y: 20 },
          { id: "shape:b", x: 10, y: 60 },
        ],
      },
      {
        button: "水平居中",
        updates: [
          { id: "shape:a", x: 40, y: 20 },
          { id: "shape:b", x: 45, y: 60 },
        ],
      },
      {
        button: "右对齐",
        updates: [
          { id: "shape:a", x: 70, y: 20 },
          { id: "shape:b", x: 80, y: 60 },
        ],
      },
      {
        button: "顶部对齐",
        updates: [
          { id: "shape:a", x: 10, y: 20 },
          { id: "shape:b", x: 80, y: 20 },
        ],
      },
      {
        button: "垂直居中",
        updates: [
          { id: "shape:a", x: 10, y: 35 },
          { id: "shape:b", x: 80, y: 40 },
        ],
      },
      {
        button: "底部对齐",
        updates: [
          { id: "shape:a", x: 10, y: 50 },
          { id: "shape:b", x: 80, y: 60 },
        ],
      },
    ];

    for (const testCase of cases) {
      tldraw.editor.updateShapes.mockClear();
      fireEvent.click(await screen.findByRole("button", { name: testCase.button }));
      expect(tldraw.editor.updateShapes).toHaveBeenCalledWith(
        testCase.updates.map((update) => expect.objectContaining(update)),
      );
    }
  });

  it("stagger-aligns when conventional edge alignment would create overlap", async () => {
    tldraw.editor.getSelectedShapeIds.mockReturnValue([
      "shape:a",
      "shape:b",
    ]);
    let bounds = {
      "shape:a": { x: 10, y: 20, w: 50, h: 30 },
      "shape:b": { x: 80, y: 30, w: 40, h: 20 },
    };
    tldraw.editor.getShape.mockImplementation((id: keyof typeof bounds) => ({
      id,
      type: "geo",
      x: bounds[id].x,
      y: bounds[id].y,
      props: {},
    }));
    tldraw.editor.getShapePageBounds.mockImplementation(
      (id: keyof typeof bounds) => bounds[id],
    );
    render(
      <MemoryRouter>
        <WhiteboardPage />
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "对齐工具" }));

    fireEvent.click(await screen.findByRole("button", { name: "左对齐" }));
    expect(tldraw.editor.updateShapes).toHaveBeenCalledWith([
      expect.objectContaining({ id: "shape:a", x: 10, y: 20 }),
      expect.objectContaining({ id: "shape:b", x: 70, y: 30 }),
    ]);

    bounds = {
      "shape:a": { x: 10, y: 20, w: 50, h: 30 },
      "shape:b": { x: 30, y: 100, w: 40, h: 20 },
    };
    tldraw.editor.updateShapes.mockClear();
    fireEvent.click(await screen.findByRole("button", { name: "顶部对齐" }));
    expect(tldraw.editor.updateShapes).toHaveBeenCalledWith([
      expect.objectContaining({ id: "shape:a", x: 10, y: 20 }),
      expect.objectContaining({ id: "shape:b", x: 30, y: 60 }),
    ]);
  });

  it("keeps each visual row intact during top and bottom stagger alignment", async () => {
    tldraw.editor.getSelectedShapeIds.mockReturnValue([
      "shape:a",
      "shape:b",
      "shape:c",
      "shape:d",
    ]);
    const bounds = {
      "shape:a": { x: 10, y: 20, w: 40, h: 30 },
      "shape:b": { x: 80, y: 25, w: 30, h: 20 },
      "shape:c": { x: 15, y: 120, w: 50, h: 30 },
      "shape:d": { x: 100, y: 125, w: 20, h: 20 },
    } as const;
    tldraw.editor.getShape.mockImplementation((id: keyof typeof bounds) => ({
      id,
      type: "geo",
      x: bounds[id].x,
      y: bounds[id].y,
      props: {},
    }));
    tldraw.editor.getShapePageBounds.mockImplementation(
      (id: keyof typeof bounds) => bounds[id],
    );
    render(
      <MemoryRouter>
        <WhiteboardPage />
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "对齐工具" }));

    fireEvent.click(await screen.findByRole("button", { name: "左对齐" }));
    expect(tldraw.editor.updateShapes).toHaveBeenCalledWith([
      expect.objectContaining({ id: "shape:a", x: 10, y: 20 }),
      expect.objectContaining({ id: "shape:b", x: 60, y: 25 }),
      expect.objectContaining({ id: "shape:c", x: 10, y: 120 }),
      expect.objectContaining({ id: "shape:d", x: 70, y: 125 }),
    ]);

    tldraw.editor.updateShapes.mockClear();
    fireEvent.click(await screen.findByRole("button", { name: "顶部对齐" }));
    expect(tldraw.editor.updateShapes).toHaveBeenCalledWith([
      expect.objectContaining({ id: "shape:a", x: 10, y: 20 }),
      expect.objectContaining({ id: "shape:b", x: 80, y: 25 }),
      expect.objectContaining({ id: "shape:c", x: 15, y: 60 }),
      expect.objectContaining({ id: "shape:d", x: 100, y: 65 }),
    ]);

    tldraw.editor.updateShapes.mockClear();
    fireEvent.click(await screen.findByRole("button", { name: "垂直居中" }));
    expect(tldraw.editor.updateShapes).toHaveBeenCalledWith([
      expect.objectContaining({ id: "shape:a", x: 10, y: 50 }),
      expect.objectContaining({ id: "shape:b", x: 80, y: 55 }),
      expect.objectContaining({ id: "shape:c", x: 15, y: 90 }),
      expect.objectContaining({ id: "shape:d", x: 100, y: 95 }),
    ]);

    tldraw.editor.updateShapes.mockClear();
    fireEvent.click(await screen.findByRole("button", { name: "底部对齐" }));
    expect(tldraw.editor.updateShapes).toHaveBeenCalledWith([
      expect.objectContaining({ id: "shape:a", x: 10, y: 80 }),
      expect.objectContaining({ id: "shape:b", x: 80, y: 85 }),
      expect.objectContaining({ id: "shape:c", x: 15, y: 120 }),
      expect.objectContaining({ id: "shape:d", x: 100, y: 125 }),
    ]);
  });

  it("packs edge alignment in its direction and keeps center alignment staggered", async () => {
    tldraw.editor.getSelectedShapeIds.mockReturnValue([
      "shape:b",
      "shape:c",
      "shape:a",
    ]);
    const bounds = {
      "shape:a": { x: 10, y: 20, w: 50, h: 30 },
      "shape:b": { x: 25, y: 35, w: 40, h: 20 },
      "shape:c": { x: 18, y: 45, w: 30, h: 40 },
    } as const;
    tldraw.editor.getShape.mockImplementation((id: keyof typeof bounds) => ({
      id,
      type: "geo",
      x: bounds[id].x,
      y: bounds[id].y,
      props: {},
    }));
    tldraw.editor.getShapePageBounds.mockImplementation(
      (id: keyof typeof bounds) => bounds[id],
    );
    render(
      <MemoryRouter>
        <WhiteboardPage />
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "对齐工具" }));

    const cases = [
      {
        button: "左对齐",
        updates: [
          { id: "shape:a", x: 10, y: 20 },
          { id: "shape:c", x: 70, y: 45 },
          { id: "shape:b", x: 110, y: 35 },
        ],
      },
      {
        button: "水平居中",
        updates: [
          { id: "shape:a", x: 12.5, y: 20 },
          { id: "shape:b", x: 17.5, y: 60 },
          { id: "shape:c", x: 22.5, y: 90 },
        ],
      },
      {
        button: "右对齐",
        updates: [
          { id: "shape:b", x: 25, y: 35 },
          { id: "shape:a", x: -35, y: 20 },
          { id: "shape:c", x: -75, y: 45 },
        ],
      },
      {
        button: "顶部对齐",
        updates: [
          { id: "shape:a", x: 10, y: 20 },
          { id: "shape:b", x: 25, y: 60 },
          { id: "shape:c", x: 18, y: 90 },
        ],
      },
      {
        button: "垂直居中",
        updates: [
          { id: "shape:a", x: 10, y: 37.5 },
          { id: "shape:c", x: 70, y: 32.5 },
          { id: "shape:b", x: 110, y: 42.5 },
        ],
      },
      {
        button: "底部对齐",
        updates: [
          { id: "shape:c", x: 18, y: 45 },
          { id: "shape:b", x: 25, y: 15 },
          { id: "shape:a", x: 10, y: -25 },
        ],
      },
    ];

    for (const testCase of cases) {
      tldraw.editor.updateShapes.mockClear();
      fireEvent.click(await screen.findByRole("button", { name: testCase.button }));
      expect(tldraw.editor.updateShapes).toHaveBeenCalledWith(
        testCase.updates.map((update) => expect.objectContaining(update)),
      );
    }
  });

  it("reloads a clean canvas after an assistant whiteboard update", async () => {
    const assistantSnapshot = {
      ...savedSnapshot,
      document: {
        ...savedSnapshot.document,
        store: {
          ...savedSnapshot.document.store,
          "shape:assistant": {
            id: "shape:assistant",
            typeName: "shape",
            type: "note",
            parentId: "page:page",
            index: "a2",
            x: 1_600,
            y: 1_200,
            props: {},
          },
        },
      },
    };
    api.getWhiteboard
      .mockResolvedValueOnce({
        version: 1,
        snapshot: savedSnapshot,
        createdAt: "2026-07-23T10:00:00.000Z",
      })
      .mockResolvedValueOnce({
        version: 2,
        snapshot: assistantSnapshot,
        createdAt: "2026-07-23T10:03:00.000Z",
      });
    render(
      <MemoryRouter>
        <WhiteboardPage />
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(tldraw.loadSnapshot).toHaveBeenCalledWith(
        tldraw.store,
        savedSnapshot,
      ),
    );
    await waitFor(() => expect(tldraw.store.listen).toHaveBeenCalled());

    window.dispatchEvent(
      new CustomEvent("workbench:data-updated", {
        detail: {
          origin: "assistant",
          resource: "whiteboard",
          operation: "updated",
          actionId: "action:whiteboard-refresh",
          changedShapeIds: ["shape:assistant"],
        },
      }),
    );

    await waitFor(() =>
      expect(tldraw.loadSnapshot).toHaveBeenLastCalledWith(
        tldraw.store,
        expect.objectContaining({
          document: expect.objectContaining({
            store: expect.objectContaining({
            "shape:assistant": expect.objectContaining({ x: 1_600, y: 1_200 }),
            }),
          }),
        }),
      ),
    );
    await waitFor(() =>
      expect(tldraw.editor.select).toHaveBeenCalledWith(
        "shape:assistant",
      ),
    );
    await waitFor(() => expect(tldraw.editor.zoomToSelection).toHaveBeenCalledWith({
      animation: { duration: 220 },
    }));
    const focusedSnapshot = tldraw.loadSnapshot.mock.calls.at(-1)?.[1] as {
      document: { store: Record<string, { x?: number; y?: number }> };
    };
    expect(focusedSnapshot.document.store["shape:assistant"]).toMatchObject({
      x: 1_600,
      y: 1_200,
    });
    act(() => vi.advanceTimersByTime(2_000));
    expect(api.saveWhiteboard).not.toHaveBeenCalled();

    window.dispatchEvent(
      new CustomEvent("workbench:data-updated", {
        detail: {
          origin: "assistant",
          resource: "whiteboard",
          operation: "updated",
          actionId: "action:whiteboard-refresh",
          changedShapeIds: ["shape:assistant"],
        },
      }),
    );
    await act(async () => Promise.resolve());
    expect(api.getWhiteboard).toHaveBeenCalledTimes(2);
  });

  it("waits for the saved assistant version instead of deduplicating a stale refresh", async () => {
    const assistantSnapshot = {
      ...savedSnapshot,
      document: {
        ...savedSnapshot.document,
        store: {
          ...savedSnapshot.document.store,
          "shape:delayed-assistant": {
            id: "shape:delayed-assistant",
            typeName: "shape",
            type: "note",
            parentId: "page:page",
            props: {},
          },
        },
      },
    };
    api.getWhiteboard
      .mockResolvedValueOnce({ version: 1, snapshot: savedSnapshot })
      .mockResolvedValueOnce({ version: 1, snapshot: savedSnapshot })
      .mockResolvedValueOnce({ version: 2, snapshot: assistantSnapshot });
    render(
      <MemoryRouter>
        <WhiteboardPage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(tldraw.store.listen).toHaveBeenCalled());

    window.dispatchEvent(new CustomEvent("workbench:data-updated", {
      detail: {
        origin: "assistant",
        resource: "whiteboard",
        operation: "updated",
        actionId: "action:delayed-whiteboard",
        version: 2,
        pageId: "page:page",
        changedShapeIds: ["shape:delayed-assistant"],
      },
    }));

    await waitFor(() => expect(tldraw.loadSnapshot).toHaveBeenLastCalledWith(
      tldraw.store,
      expect.objectContaining({
        document: expect.objectContaining({
          store: expect.objectContaining({
            "shape:delayed-assistant": expect.objectContaining({
              id: "shape:delayed-assistant",
            }),
          }),
        }),
      }),
    ));
    expect(api.getWhiteboard).toHaveBeenCalledTimes(3);
  });

  it("does not let a late initial load overwrite a newer assistant refresh", async () => {
    let resolveInitial: ((value: unknown) => void) | undefined;
    const initialRequest = new Promise((resolve) => {
      resolveInitial = resolve;
    });
    const assistantSnapshot = {
      ...savedSnapshot,
      document: {
        ...savedSnapshot.document,
        store: {
          ...savedSnapshot.document.store,
          "shape:newer-assistant": {
            id: "shape:newer-assistant",
            typeName: "shape",
            type: "note",
            parentId: "page:page",
            props: {},
          },
        },
      },
    };
    api.getWhiteboard
      .mockReturnValueOnce(initialRequest)
      .mockResolvedValueOnce({ version: 2, snapshot: assistantSnapshot });
    render(
      <MemoryRouter>
        <WhiteboardPage />
      </MemoryRouter>,
    );
    await act(async () => Promise.resolve());

    window.dispatchEvent(new CustomEvent("workbench:data-updated", {
      detail: {
        origin: "assistant",
        resource: "whiteboard",
        operation: "updated",
        actionId: "action:newer-than-initial",
        version: 2,
        pageId: "page:page",
        changedShapeIds: ["shape:newer-assistant"],
      },
    }));
    await waitFor(() => expect(tldraw.loadSnapshot).toHaveBeenLastCalledWith(
      tldraw.store,
      expect.objectContaining({
        document: expect.objectContaining({
          store: expect.objectContaining({
            "shape:newer-assistant": expect.any(Object),
          }),
        }),
      }),
    ));

    await act(async () => {
      resolveInitial?.({ version: 1, snapshot: savedSnapshot });
      await Promise.resolve();
    });
    const finalSnapshot = tldraw.loadSnapshot.mock.calls.at(-1)?.[1] as typeof assistantSnapshot;
    expect(finalSnapshot.document.store).toHaveProperty("shape:newer-assistant");
    expect(screen.getByRole("button", { name: "模拟白板修改" })).toBeInTheDocument();
  });

  it("merges an assistant insertion with unsaved local canvas content and displays both", async () => {
    const localSnapshot = {
      ...savedSnapshot,
      document: {
        ...savedSnapshot.document,
        store: {
          ...savedSnapshot.document.store,
          "shape:local-pending": {
            id: "shape:local-pending",
            typeName: "shape",
            type: "text",
            parentId: "page:page",
            props: {},
          },
        },
      },
    };
    const assistantSnapshot = {
      ...savedSnapshot,
      document: {
        ...savedSnapshot.document,
        store: {
          ...savedSnapshot.document.store,
          "shape:assistant-inserted": {
            id: "shape:assistant-inserted",
            typeName: "shape",
            type: "image",
            parentId: "page:page",
            props: { assetId: "asset:assistant-inserted" },
          },
          "asset:assistant-inserted": {
            id: "asset:assistant-inserted",
            typeName: "asset",
            type: "image",
            props: { src: "/api/whiteboard/assets/example" },
          },
        },
      },
    };
    api.getWhiteboard
      .mockResolvedValueOnce({ version: 1, snapshot: savedSnapshot })
      .mockResolvedValueOnce({ version: 2, snapshot: assistantSnapshot });
    render(
      <MemoryRouter>
        <WhiteboardPage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(tldraw.store.listen).toHaveBeenCalled());
    tldraw.getSnapshot.mockReturnValue(localSnapshot);
    fireEvent.click(screen.getByRole("button", { name: "模拟白板修改" }));

    window.dispatchEvent(new CustomEvent("workbench:data-updated", {
      detail: {
        origin: "assistant",
        resource: "whiteboard",
        operation: "updated",
        actionId: "action:merge-whiteboard",
        version: 2,
        pageId: "page:page",
        changedShapeIds: ["shape:assistant-inserted"],
      },
    }));

    await waitFor(() => {
      const loaded = tldraw.loadSnapshot.mock.calls.at(-1)?.[1] as typeof localSnapshot;
      expect(loaded.document.store).toHaveProperty("shape:local-pending");
      expect(loaded.document.store).toHaveProperty("shape:assistant-inserted");
      expect(loaded.document.store).toHaveProperty("asset:assistant-inserted");
    });
    expect(tldraw.editor.preloadImages).toHaveBeenCalledWith(
      ["/api/whiteboard/assets/example"],
      700,
    );
    expect(screen.queryByText(/还有未保存修改/u)).not.toBeInTheDocument();
  });

  it("enters an assistant-created page and downloads a requested canvas export", async () => {
    const newPageSnapshot = {
      ...savedSnapshot,
      document: {
        ...savedSnapshot.document,
        store: {
          ...savedSnapshot.document.store,
          "page:new": {
            id: "page:new",
            typeName: "page",
            name: "AI 新页面",
          },
        },
      },
      session: { currentPageId: "page:new" },
    };
    api.getWhiteboard
      .mockResolvedValueOnce({ version: 1, snapshot: savedSnapshot })
      .mockResolvedValueOnce({ version: 2, snapshot: newPageSnapshot });
    render(
      <MemoryRouter>
        <WhiteboardPage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(tldraw.store.listen).toHaveBeenCalled());

    window.dispatchEvent(new CustomEvent("workbench:data-updated", {
      detail: {
        origin: "assistant",
        resource: "whiteboard",
        operation: "updated",
        pageId: "page:new",
        exportRequests: [{
          pageId: "page:new",
          scope: "canvas",
          shapeIds: [],
          padding: 72,
        }],
      },
    }));

    await waitFor(() => expect(api.getWhiteboardVersions).toHaveBeenCalledWith("page:new"));
    await waitFor(() => expect(tldraw.exportImage).toHaveBeenCalledWith(
      newPageSnapshot,
      expect.objectContaining({ pageId: "page:new", scope: "canvas", padding: 72 }),
    ));
    expect(tldraw.downloadImage).toHaveBeenCalled();
  });
});
