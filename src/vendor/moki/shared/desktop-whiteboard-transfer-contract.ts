export type DesktopWhiteboardTransferFile = {
  relativePath: string;
  bytes: Uint8Array;
};

export type DesktopWhiteboardTransferResource = {
  shapeId: string;
  name: string;
  kind: "file" | "folder";
  files: DesktopWhiteboardTransferFile[];
};

export type DesktopWhiteboardReadResourceResult = {
  name: string;
  kind: "file" | "folder";
  files: DesktopWhiteboardTransferFile[];
};

export type DesktopWhiteboardRestoredResource = {
  shapeId: string;
  name: string;
  kind: "file" | "folder";
  localPath: string;
};

export type DesktopWhiteboardFilesBridge = {
  hasPending(): Promise<boolean>;
  consume(): Promise<{ name: string; bytes?: Uint8Array; error?: string } | null>;
  onPending(listener: () => void): () => void;
  readResource?(input: { source: string; name?: string }): Promise<DesktopWhiteboardReadResourceResult>;
  restoreResources?(resources: DesktopWhiteboardTransferResource[]): Promise<DesktopWhiteboardRestoredResource[]>;
};
