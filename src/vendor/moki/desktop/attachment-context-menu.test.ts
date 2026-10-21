import { describe, expect, it, vi } from "vitest";
import { buildAttachmentContextMenuTemplate } from "./attachment-context-menu.js";

describe("desktop attachment context menu", () => {
  it("keeps the four attachment actions visible and disables unavailable destinations", () => {
    const select = vi.fn();
    const template = buildAttachmentContextMenuTemplate({
      canOpenDefault: true,
      canOpenLibrary: false,
      canSaveAs: true,
      canReveal: true,
    }, select);
    expect(template.map((item) => item.label ?? item.type)).toEqual([
      "使用默认应用打开",
      "打开资料库位置",
      "separator",
      "另存为",
      "在资源管理器中打开",
    ]);
    expect(template[1]?.enabled).toBe(false);
    template[0]?.click?.({} as Electron.MenuItem, undefined, {} as KeyboardEvent);
    template[3]?.click?.({} as Electron.MenuItem, undefined, {} as KeyboardEvent);
    template[4]?.click?.({} as Electron.MenuItem, undefined, {} as KeyboardEvent);
    expect(select.mock.calls.map(([action]) => action)).toEqual(["open-default", "save-as", "reveal"]);
  });
});
