import { z } from "zod";

export const ColorSchema = z.enum([
  "black", "grey", "violet", "light-violet", "blue", "light-blue", "yellow", "orange", "green", "light-green", "red", "light-red",
]);
export type MokiColor = z.infer<typeof ColorSchema>;

export const ElementKindSchema = z.enum(["note", "text", "rectangle", "ellipse", "triangle", "diamond", "cloud", "star", "arrow", "draw", "image", "file", "link", "mindmap"]);
export type ElementKind = z.infer<typeof ElementKindSchema>;

export const AlignmentModeSchema = z.enum(["left", "center-x", "right", "top", "center-y", "bottom", "distribute-horizontal", "distribute-vertical"]);
export type AlignmentMode = z.infer<typeof AlignmentModeSchema>;

export type Point = { x: number; y: number };

export type PageRecord = {
  id: string;
  typeName: "page";
  name: string;
  index: string;
  meta: Record<string, unknown>;
};

export type PageGroupRecord = {
  id: string;
  typeName: "page_group";
  name: string;
  index: string;
  meta: Record<string, unknown>;
};

export type ShapeRecord = {
  id: string;
  typeName: "shape";
  type: "note" | "text" | "geo" | "arrow" | "draw" | "image" | "file" | "link" | "resource" | "media" | "group-folder";
  x: number;
  y: number;
  rotation: number;
  index: string;
  parentId: string;
  opacity: number;
  isLocked: boolean;
  props: Record<string, unknown>;
  meta: Record<string, unknown>;
};

export type BoardRecord = PageRecord | PageGroupRecord | ShapeRecord | { id: string; typeName: string; [key: string]: unknown };

export type WhiteboardSnapshot = {
  engine: "moki-native" | "moki-native@1";
  document: {
    store: Record<string, BoardRecord>;
    schema: Record<string, unknown>;
  };
  session: {
    currentPageId: string;
    camera?: { x: number; y: number; zoom: number };
  };
};

export type BoardDocument = {
  id: string;
  title: string;
  version: number;
  updatedAt: string;
  snapshot: WhiteboardSnapshot;
};

export const ElementInputSchema = z.object({
  kind: ElementKindSchema,
  text: z.string().max(20_000).optional(),
  x: z.number().finite().min(-1_000_000).max(1_000_000).optional(),
  y: z.number().finite().min(-1_000_000).max(1_000_000).optional(),
  width: z.number().finite().min(16).max(20_000).optional(),
  height: z.number().finite().min(16).max(20_000).optional(),
  color: ColorSchema.optional(),
  points: z.array(z.object({ x: z.number().finite(), y: z.number().finite() })).min(2).max(10_000).optional(),
  source: z.string().max(25_000_000).optional(),
  name: z.string().max(500).optional(),
  mimeType: z.string().max(200).optional(),
  url: z.string().url().max(8_000).optional(),
  title: z.string().max(500).optional(),
  branches: z.array(z.string().min(1).max(500)).min(1).max(30).optional(),
  layout: z.enum(["right", "left", "both", "down"]).optional(),
  mode: z.enum(["link", "preview"]).optional(),
  arrowStyle: z.enum(["single", "double", "line", "dashed"]).optional(),
  strokeSize: z.enum(["s", "m", "l", "xl"]).optional(),
});
export type ElementInput = z.infer<typeof ElementInputSchema>;

export const ElementUpdateSchema = z.object({
  id: z.string().min(1),
  text: z.string().max(20_000).optional(),
  x: z.number().finite().min(-1_000_000).max(1_000_000).optional(),
  y: z.number().finite().min(-1_000_000).max(1_000_000).optional(),
  width: z.number().finite().min(16).max(20_000).optional(),
  height: z.number().finite().min(16).max(20_000).optional(),
  color: ColorSchema.optional(),
  rotation: z.number().finite().min(-3600).max(3600).optional(),
  fontSize: z.number().finite().min(8).max(160).optional(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  textAlign: z.enum(["left", "center", "right"]).optional(),
  opacity: z.number().finite().min(0.05).max(1).optional(),
  arrowStyle: z.enum(["single", "double", "line", "dashed"]).optional(),
  strokeSize: z.enum(["s", "m", "l", "xl"]).optional(),
});
export type ElementUpdate = z.infer<typeof ElementUpdateSchema>;
