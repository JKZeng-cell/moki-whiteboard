export type DesktopMediaContextAction =
  | "copy-frame"
  | "copy-path"
  | "open";

export type DesktopMediaContextRequest = {
  canCopyFrame: boolean;
  hasPath: boolean;
  canOpen: boolean;
};
