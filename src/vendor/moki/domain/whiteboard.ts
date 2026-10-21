import { z } from "zod";

// Keep enough headroom to import historical snapshots that embedded images.
// Native snapshots store new images as deduplicated asset URLs instead.
export const MAX_WHITEBOARD_SNAPSHOT_BYTES = 90 * 1024 * 1024;

const WhiteboardRecordSchema = z
  .object({
    id: z.string().min(1),
    typeName: z.string().min(1),
  })
  .passthrough();

const WhiteboardDocumentSchema = z
  .object({
    store: z.record(z.string(), WhiteboardRecordSchema),
    schema: z.object({}).passthrough(),
  })
  .passthrough();

export const WhiteboardSnapshotSchema = z
  .object({
    engine: z.string().optional(),
    document: WhiteboardDocumentSchema,
    session: z.unknown().optional(),
  })
  .passthrough();

export const WhiteboardVersionSchema = z.object({
  version: z.number().int().positive(),
  pageId: z.string().min(1),
  pageName: z.string().min(1),
  pageVersion: z.number().int().positive(),
  contentDigest: z.string().min(1),
  createdAt: z.iso.datetime({ offset: true }),
  snapshot: WhiteboardSnapshotSchema,
});

export type WhiteboardSnapshot = z.infer<
  typeof WhiteboardSnapshotSchema
>;

export type WhiteboardVersion = z.infer<
  typeof WhiteboardVersionSchema
>;

export type WhiteboardVersionSummary = Omit<
  WhiteboardVersion,
  "snapshot"
>;

export type WhiteboardLatest = {
  version: number | null;
  pageId?: string;
  pageName?: string;
  pageVersion?: number;
  snapshot: WhiteboardSnapshot | null;
  contentDigest?: string;
  createdAt?: string;
  recoveredFromVersion?: number;
};

export type WhiteboardSaveResult = WhiteboardVersionSummary & {
  deduplicated: boolean;
};

export type WhiteboardPageSyncResult = WhiteboardSaveResult & {
  changedPageIds: string[];
  deletedPageIds: string[];
};
