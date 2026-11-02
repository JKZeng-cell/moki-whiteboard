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

export type DesktopWhiteboardDocumentInfo = {path:string;savedVersion:number;dirty:boolean};
export type DesktopWhiteboardOpenRequest = {name:string;bytes?:Uint8Array;error?:string;warning?:string;boardId?:string;replaceBoardId?:string;replaceBoardVersion?:number;documentToken?:string};
export type DesktopWhiteboardFilesBridge = {
  hasPending(): Promise<boolean>;
  consume(): Promise<DesktopWhiteboardOpenRequest | null>;
  readDocument?(path:string):Promise<DesktopWhiteboardOpenRequest>;
  bindDocument?(token:string,boardId:string,expectedVersion:number):Promise<DesktopWhiteboardDocumentInfo>;
  documentInfo?(boardId:string):Promise<DesktopWhiteboardDocumentInfo|null>;
  saveDocument?(boardId:string,onlyIfDirty?:boolean):Promise<DesktopWhiteboardDocumentInfo|null>;
  saveDocumentAs?(boardId:string):Promise<DesktopWhiteboardDocumentInfo|null>;
  onPending(listener: () => void): () => void;
  readResource?(input: { source: string; name?: string }): Promise<DesktopWhiteboardReadResourceResult>;
  restoreResources?(resources: DesktopWhiteboardTransferResource[]): Promise<DesktopWhiteboardRestoredResource[]>;
};
