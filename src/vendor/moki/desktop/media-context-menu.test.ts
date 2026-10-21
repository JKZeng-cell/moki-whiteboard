import { describe, expect, it, vi } from "vitest";
import { buildMediaContextMenuTemplate } from "./media-context-menu.js";

describe("desktop media context menu", () => {
  it("offers frame, path, and system-open actions in a native menu", () => {
    const select = vi.fn();
    const template = buildMediaContextMenuTemplate(
      { canCopyFrame: true, hasPath: true, canOpen: true },
      select,
    );

    expect(template.map((item) => item.label ?? item.type)).toEqual([
      "复制当前帧",
      "复制路径",
      "separator",
      "使用系统默认应用打开",
    ]);
    template[0]?.click?.({} as Electron.MenuItem, undefined, {} as KeyboardEvent);
    template[1]?.click?.({} as Electron.MenuItem, undefined, {} as KeyboardEvent);
    template[3]?.click?.({} as Electron.MenuItem, undefined, {} as KeyboardEvent);
    expect(select.mock.calls.map(([action]) => action)).toEqual([
      "copy-frame",
      "copy-path",
      "open",
    ]);
  });

  it("omits unavailable actions", () => {
    expect(
      buildMediaContextMenuTemplate(
        { canCopyFrame: false, hasPath: true, canOpen: false },
        vi.fn(),
      ).map((item) => item.label ?? item.type),
    ).toEqual(["复制路径"]);
  });
});
