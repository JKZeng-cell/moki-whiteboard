import type {
  WhiteboardLatest,
  WhiteboardPageSyncResult,
  WhiteboardSaveResult,
  WhiteboardSnapshot,
  WhiteboardVersion,
  WhiteboardVersionSummary,
} from "../domain/whiteboard.js";

export type WhiteboardSnapshotRequest = {
  snapshot: WhiteboardSnapshot;
  pageId?: string;
  pageName?: string;
};

export type {
  WhiteboardLatest,
  WhiteboardPageSyncResult,
  WhiteboardSaveResult,
  WhiteboardSnapshot,
  WhiteboardVersion,
  WhiteboardVersionSummary,
};
