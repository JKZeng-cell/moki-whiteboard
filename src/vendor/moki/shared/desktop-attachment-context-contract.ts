export type DesktopAttachmentContextAction =
  | "open-default"
  | "open-library"
  | "save-as"
  | "reveal";

export type DesktopAttachmentContextRequest = {
  canOpenDefault: boolean;
  canOpenLibrary: boolean;
  canSaveAs: boolean;
  canReveal: boolean;
};
