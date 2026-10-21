import type { MenuItemConstructorOptions } from "electron";
import type {
  DesktopMediaContextAction,
  DesktopMediaContextRequest,
} from "../shared/desktop-media-context-contract.js";

export function buildMediaContextMenuTemplate(
  request: DesktopMediaContextRequest,
  select: (action: DesktopMediaContextAction) => void,
): MenuItemConstructorOptions[] {
  const template: MenuItemConstructorOptions[] = [];
  if (request.canCopyFrame) {
    template.push({
      label: "复制当前帧",
      click: () => select("copy-frame"),
    });
  }
  if (request.hasPath) {
    template.push({
      label: "复制路径",
      click: () => select("copy-path"),
    });
  }
  if (request.canOpen) {
    if (template.length > 0) template.push({ type: "separator" });
    template.push({
      label: "使用系统默认应用打开",
      click: () => select("open"),
    });
  }
  return template;
}
