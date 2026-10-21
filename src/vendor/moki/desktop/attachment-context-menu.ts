import type { MenuItemConstructorOptions } from "electron";
import type {
  DesktopAttachmentContextAction,
  DesktopAttachmentContextRequest,
} from "../shared/desktop-attachment-context-contract.js";

export function buildAttachmentContextMenuTemplate(
  request: DesktopAttachmentContextRequest,
  select: (action: DesktopAttachmentContextAction) => void,
): MenuItemConstructorOptions[] {
  return [
    { label: "使用默认应用打开", enabled: request.canOpenDefault, click: () => select("open-default") },
    { label: "打开资料库位置", enabled: request.canOpenLibrary, click: () => select("open-library") },
    { type: "separator" },
    { label: "另存为", enabled: request.canSaveAs, click: () => select("save-as") },
    { label: "在资源管理器中打开", enabled: request.canReveal, click: () => select("reveal") },
  ];
}
