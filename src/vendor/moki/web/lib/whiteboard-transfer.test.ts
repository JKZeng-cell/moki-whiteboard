// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import type { WhiteboardSnapshot } from "../../domain/whiteboard.js";
import type { DesktopWhiteboardTransferResource } from "../../shared/desktop-whiteboard-transfer-contract.js";
import {
  createWhiteboardTransferFile,
  importWhiteboardTransferFile,
  isWhiteboardTransferFile,
  WHITEBOARD_TRANSFER_MIME,
} from "./whiteboard-transfer.js";

function snapshot(source = "data:image/png;base64,aGVsbG8="): WhiteboardSnapshot {
  return {
    engine: "moki-native-v1",
    document: {
      schema: { schemaVersion: 1 },
      store: {
        "page:one": { id: "page:one", typeName: "page", name: "第一页" },
        "asset:image": {
          id: "asset:image",
          typeName: "asset",
          type: "image",
          props: { src: source, name: "示意图.png", width: 640, height: 480 },
        },
        "shape:image": {
          id: "shape:image",
          typeName: "shape",
          type: "image",
          parentId: "page:one",
          index: "a1",
          x: 10,
          y: 20,
          props: { assetId: "asset:image", w: 320, h: 240 },
        },
      },
    },
    session: { currentPageId: "page:one" },
  };
}

afterEach(() => vi.restoreAllMocks());

describe("whiteboard transfer files", () => {
  it("exports all snapshot records with embedded image assets", async () => {
    const result = await createWhiteboardTransferFile(snapshot(), {
      exportedAt: "2026-08-19T10:00:00.000Z",
      fileName: "项目/白板",
      boardTitle: "项目白板",
    });

    expect(result.fileName).toBe("项目-白板.moki");
    expect(result.assetCount).toBe(1);
    const archive = unzipSync(new Uint8Array(await result.blob.arrayBuffer()));
    expect(Object.entries(archive).map(([name, value]) => [name, value.byteLength])).toEqual([
      ["assets/00001.bin", 5],
      ["manifest.json", expect.any(Number)],
    ]);
    const payload = JSON.parse(strFromU8(archive["manifest.json"]!)) as Record<string, unknown>;
    expect(payload).toMatchObject({
      format: "moki-whiteboard",
      version: 2,
      exportedAt: "2026-08-19T10:00:00.000Z",
      boardTitle: "项目白板",
    });
    expect(payload.assets).toEqual([
      expect.objectContaining({
        assetId: "asset:image",
        mimeType: "image/png",
        archivePath: "assets/00001.bin",
      }),
    ]);
    expect(new TextDecoder().decode(archive["assets/00001.bin"])).toBe("hello");
  });

  it("downloads local asset URLs into the portable file", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(
      new Blob(["image"], { type: "image/png" }),
      { status: 200, headers: { "content-type": "image/png" } },
    ));
    const result = await createWhiteboardTransferFile(
      snapshot("/api/whiteboard/assets/abc"),
      { fetcher },
    );

    expect(fetcher).toHaveBeenCalledWith(
      "/api/whiteboard/assets/abc",
      { cache: "no-store" },
    );
    expect(result.assetCount).toBe(1);
  });

  it("embeds audio and video asset records as portable binary content", async () => {
    const value = snapshot();
    value.document.store["asset:audio"] = {
      id: "asset:audio",
      typeName: "asset",
      type: "media",
      props: { src: "data:audio/mpeg;base64,aGVsbG8=", name: "访谈.mp3", mediaKind: "audio" },
    };
    value.document.store["shape:audio"] = {
      id: "shape:audio",
      typeName: "shape",
      type: "media",
      parentId: "page:one",
      props: { assetId: "asset:audio", name: "访谈.mp3", mediaKind: "audio" },
    };

    const result = await createWhiteboardTransferFile(value);
    const archive = unzipSync(new Uint8Array(await result.blob.arrayBuffer()));
    const manifest = JSON.parse(strFromU8(archive["manifest.json"]!)) as { assets: Array<Record<string, unknown>> };

    expect(result.assetCount).toBe(2);
    expect(manifest.assets).toEqual(expect.arrayContaining([
      expect.objectContaining({ assetId: "asset:audio", mimeType: "audio/mpeg" }),
    ]));
  });

  it("stores identical embedded and mapped content only once", async () => {
    const result = await createWhiteboardTransferFile(snapshot(), {
      resources: [{
        shapeId: "shape:image",
        name: "示意图.png",
        kind: "file",
        sources: [{ source: "D:\\示意图.png" }],
      }],
      readResource: vi.fn().mockResolvedValue({
        name: "示意图.png",
        kind: "file",
        files: [{ relativePath: "示意图.png", bytes: new TextEncoder().encode("hello") }],
      }),
    });
    const archive = unzipSync(new Uint8Array(await result.blob.arrayBuffer()));
    const manifest = JSON.parse(strFromU8(archive["manifest.json"]!)) as {
      assets: Array<{ archivePath: string }>;
      resources: Array<{ files: Array<{ archivePath: string }> }>;
    };

    expect(Object.keys(archive).filter((name) => name.endsWith(".bin"))).toHaveLength(1);
    expect(manifest.resources[0]?.files[0]?.archivePath).toBe(manifest.assets[0]?.archivePath);
  });

  it("validates imports, restores assets locally and rewrites their URLs", async () => {
    const exported = await createWhiteboardTransferFile(snapshot(), {
      exportedAt: "2026-08-19T10:00:00.000Z",
      boardTitle: "跨端白板",
    });
    const file = new File([exported.blob], "board.moki-board", {
      type: WHITEBOARD_TRANSFER_MIME,
    });
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      src: "/api/whiteboard/assets/local",
      mimeType: "image/png",
      fileSize: 5,
      width: 640,
      height: 480,
    }), { status: 201, headers: { "content-type": "application/json" } }));

    const imported = await importWhiteboardTransferFile(file, { fetcher });

    expect(isWhiteboardTransferFile(file)).toBe(true);
    expect(imported.assetCount).toBe(1);
    expect(imported.boardTitle).toBe("跨端白板");
    expect(fetcher).toHaveBeenCalledWith(
      "/api/whiteboard/assets",
      expect.objectContaining({ method: "POST" }),
    );
    expect(imported.snapshot.document.store["asset:image"]).toMatchObject({
      props: { src: "/api/whiteboard/assets/local" },
    });
  });

  it("imports an earlier exported page file whose store records omitted their ids", async () => {
    const legacy = {
      format: "moki-whiteboard-page",
      version: "1",
      snapshot: {
        engine: "moki-native-v1",
        document: {
          schema: {},
          store: {
            "page:legacy": { typeName: "page", name: "旧页面" },
            "shape:legacy": { typeName: "shape", type: "text", parentId: "page:legacy", props: {} },
          },
        },
      },
    };
    const imported = await importWhiteboardTransferFile(new File(
      [JSON.stringify(legacy)],
      "旧页面.moki-board",
      { type: WHITEBOARD_TRANSFER_MIME },
    ));

    expect(imported.snapshot.document.store["page:legacy"]).toMatchObject({ id: "page:legacy", name: "旧页面" });
    expect(imported.snapshot.document.store["shape:legacy"]).toMatchObject({ id: "shape:legacy", parentId: "page:legacy" });
  });

  it("packages mapped files and restores their local paths on import", async () => {
    const value = snapshot();
    value.document.store["shape:resource"] = {
      id: "shape:resource",
      typeName: "shape",
      type: "resource",
      parentId: "page:one",
      props: { libraryItemId: "library:missing-on-recipient", name: "项目资料", kind: "local_folder" },
    };
    const readResource = vi.fn().mockResolvedValue({
      name: "项目资料",
      kind: "folder",
      files: [
        { relativePath: "需求/说明.txt", bytes: new TextEncoder().encode("portable") },
        { relativePath: "数据.csv", bytes: new TextEncoder().encode("a,b") },
      ],
    });
    const exported = await createWhiteboardTransferFile(value, {
      resources: [{
        shapeId: "shape:resource",
        name: "项目资料",
        kind: "folder",
        sources: [{ source: "D:\\项目资料" }],
      }],
      readResource,
    });
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      src: "/api/whiteboard/assets/local",
      mimeType: "image/png",
      fileSize: 5,
    }), { status: 201, headers: { "content-type": "application/json" } }));
    const restoreResources = vi.fn(async (resources: DesktopWhiteboardTransferResource[]) => {
      expect(resources[0]?.files.map((file) => [file.relativePath, new TextDecoder().decode(file.bytes)])).toEqual([
        ["需求/说明.txt", "portable"],
        ["数据.csv", "a,b"],
      ]);
      return [{ shapeId: "shape:resource", name: "项目资料", kind: "folder" as const, localPath: "C:\\MOKI\\imports\\项目资料" }];
    });

    const imported = await importWhiteboardTransferFile(
      new File([exported.blob], "portable.moki", { type: WHITEBOARD_TRANSFER_MIME }),
      { fetcher, restoreResources },
    );

    expect(exported.resourceCount).toBe(1);
    expect(imported.resourceCount).toBe(1);
    expect(imported.snapshot.document.store["shape:resource"]?.props).toMatchObject({
      localPath: "C:\\MOKI\\imports\\项目资料",
      kind: "local_folder",
    });
    expect(imported.snapshot.document.store["shape:resource"]?.props).not.toHaveProperty("libraryItemId");
  });

  it("rejects unrelated or malformed files", async () => {
    await expect(importWhiteboardTransferFile(
      new File(["{}"], "notes.json", { type: "application/json" }),
    )).rejects.toThrow("请选择 .moki 白板文件");
    await expect(importWhiteboardTransferFile(
      new File(["{}"], "broken.moki-board", { type: WHITEBOARD_TRANSFER_MIME }),
    )).rejects.toThrow("白板文件格式或版本不受支持");
  });
});
