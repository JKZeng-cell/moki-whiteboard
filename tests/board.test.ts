import { describe, expect, it } from "vitest";
import { addElements, alignElements, createPage, createPageGroup, createSnapshot, deleteElements, deletePageGroup, inspectSnapshot, pageGroups, pages, richTextValue, updateElements, updatePage } from "../src/core/board.js";
import { createPortableWhiteboard, importPortableWhiteboard } from "../src/core/transfer.js";

describe("whiteboard core", () => {
  it("numbers default page names and preserves custom names", () => {
    const snapshot = createSnapshot();
    expect(pages(snapshot)[0]!.name).toBe("页面 1");
    expect(createPage(snapshot).name).toBe("页面 2");
    expect(createPage(snapshot, "   ").name).toBe("页面 3");
    expect(createPage(snapshot, " 项目方案 ").name).toBe("项目方案");
  });
  it("creates MOKI-compatible pages and editable elements", () => {
    const snapshot = createSnapshot();
    const page = pages(snapshot)[0]!;
    const created = addElements(snapshot, page.id, [
      { kind: "note", text: "来自 Agent 的便签", color: "yellow", x: 10, y: 20 },
      { kind: "rectangle", text: "里程碑", width: 300, height: 120 },
    ]);
    expect(created).toHaveLength(2);
    expect(snapshot.engine).toBe("moki-native");
    expect(inspectSnapshot(snapshot)).toMatchObject({ pageCount: 1, shapeCount: 2, typeCounts: { note: 1, rectangle: 1 } });

    updateElements(snapshot, [{ id: created[0]!.id, text: "已更新", x: 80, color: "green" }]);
    expect(richTextValue(created[0]!.props.richText)).toBe("来自 Agent 的便签");
    const current = snapshot.document.store[created[0]!.id]!;
    expect(current).toMatchObject({ x: 80, props: { color: "green" } });
    expect(richTextValue((current as typeof created[number]).props.richText)).toBe("已更新");

    expect(deleteElements(snapshot, [created[1]!.id, "missing"])).toEqual([created[1]!.id]);
    expect(inspectSnapshot(snapshot).shapeCount).toBe(1);
  });

  it("keeps independent pages", () => {
    const snapshot = createSnapshot();
    const second = createPage(snapshot, "方案 B");
    addElements(snapshot, second.id, [{ kind: "text", text: "第二页" }]);
    expect(pages(snapshot).map((page) => page.name)).toEqual(["页面 1", "方案 B"]);
    expect(inspectSnapshot(snapshot, second.id).shapeCount).toBe(1);
  });

  it("creates mind maps and aligns a multi-selection", () => {
    const snapshot = createSnapshot();
    const page = pages(snapshot)[0]!;
    const map = addElements(snapshot, page.id, [{ kind: "mindmap", text: "产品", branches: ["用户", "场景", "价值"] }]);
    expect(map).toHaveLength(7);
    expect(inspectSnapshot(snapshot).typeCounts).toMatchObject({ 'round-rectangle': 4, arrow: 3 });
    const notes = addElements(snapshot, page.id, [{ kind: "note", x: 12, y: 20 }, { kind: "note", x: 300, y: 160 }]);
    alignElements(snapshot, notes.map((item) => item.id), "left");
    expect(snapshot.document.store[notes[1]!.id]).toMatchObject({ x: 12 });
  });

  it("manages page groups without deleting grouped pages", () => {
    const snapshot = createSnapshot();
    const group = createPageGroup(snapshot, "方案");
    const second = createPage(snapshot, "方案 B");
    updatePage(snapshot, second.id, { groupId: group.id, name: "方案 Beta" });
    expect(pageGroups(snapshot)).toHaveLength(1);
    expect(pages(snapshot)[1]).toMatchObject({ name: "方案 Beta", meta: { groupId: group.id } });
    deletePageGroup(snapshot, group.id);
    expect(pages(snapshot)[1]).toMatchObject({ meta: { groupId: null } });
  });

  it("round-trips the MOKI Workbench v2 portable format with assets", () => {
    const snapshot = createSnapshot();
    const page = pages(snapshot)[0]!;
    addElements(snapshot, page.id, [
      { kind: "image", source: "data:image/png;base64,aGVsbG8=", name: "demo.png" },
      { kind: "file", source: "data:text/plain;base64,bW9raQ==", name: "note.txt", mimeType: "text/plain" },
      { kind: "link", url: "https://moki.local", title: "MOKI" },
    ]);
    const exported = createPortableWhiteboard(snapshot, { title: "互导测试", pageId: page.id, pageName: page.name });
    expect(exported.bytes[0]).toBe(0x50);
    const imported = importPortableWhiteboard(exported.bytes);
    expect(imported).toMatchObject({ format: "moki-v2", pageName: "页面 1" });
    expect(inspectSnapshot(imported.snapshot).typeCounts).toMatchObject({ image: 1, file: 1, link: 1 });
  });
});
