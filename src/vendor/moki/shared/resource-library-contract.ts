import { z } from "zod";

export const ResourceLibraryItemKindSchema = z.enum([
  "folder",
  "local_file",
  "local_folder",
  "url",
]);

export const ResourceLibraryTagsSchema = z
  .array(z.string().trim().min(1).max(40))
  .max(20)
  .transform((tags) => [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))]);

export const ResourceLibraryItemSchema = z.object({
  id: z.string().min(1),
  parentId: z.string().min(1).nullable(),
  kind: ResourceLibraryItemKindSchema,
  name: z.string().min(1).max(240),
  target: z.string().max(4_096).nullable(),
  tags: ResourceLibraryTagsSchema,
  sortOrder: z.number().int().nonnegative().optional(),
  fileCreatedAt: z.iso.datetime({ offset: true }).nullable().optional(),
  fileModifiedAt: z.iso.datetime({ offset: true }).nullable().optional(),
  thumbnailDataUrl: z.string().max(262_144).nullable().optional(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});

export const ResourceLibraryMoveSchema = z.object({
  parentId: z.string().trim().min(1).nullable(),
  beforeId: z.string().trim().min(1).nullable().optional(),
});

export const ResourceLibraryContentUpdateSchema = z.object({
  expectedVersion: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  content: z.string().max(5_000_000),
}).strict();

export const ResourceLibraryExportSchema = z.object({
  destination: z.string().trim().min(1).max(4_096),
  mode: z.enum(["file", "folder"]),
}).strict();

export const AssistantMediaSaveSchema = z.object({
  sourceUrl: z.string().trim().min(1).max(4_000),
  name: z.string().trim().min(1).max(240),
  mode: z.enum(["local", "library"]),
  destination: z.string().trim().min(1).max(4_096).optional(),
  parentId: z.string().uuid().nullable().optional(),
}).strict().superRefine((value, context) => {
  if (value.mode === "local" && !value.destination) {
    context.addIssue({
      code: "custom",
      path: ["destination"],
      message: "请选择本地保存路径",
    });
  }
});

export const WhiteboardFolderExportSchema = z.object({
  mode: z.enum(["local", "library"]),
  destination: z.string().trim().min(1).max(4_096).optional(),
  parentId: z.string().trim().min(1).nullable().optional(),
  name: z.string().trim().min(1).max(120),
  description: z.string().max(500).default(""),
  payload: z.object({
    version: z.literal(1),
    shapes: z.array(z.record(z.string(), z.unknown())).max(2_000),
    assets: z.array(z.record(z.string(), z.unknown())).max(2_000),
  }).strict(),
}).strict().superRefine((value, context) => {
  if (value.mode === "local" && !value.destination) {
    context.addIssue({ code: "custom", path: ["destination"], message: "请选择本地保存位置" });
  }
});

export const ResourceLibraryCreateSchema = z
  .object({
    parentId: z.string().trim().min(1).nullable().optional(),
    kind: ResourceLibraryItemKindSchema,
    name: z.string().trim().min(1).max(240),
    target: z.string().trim().max(4_096).nullable().optional(),
    tags: ResourceLibraryTagsSchema.default([]),
  })
  .superRefine((value, context) => {
    if (value.kind !== "folder" && !value.target) {
      context.addIssue({
        code: "custom",
        path: ["target"],
        message: "映射资料必须提供本地路径或在线链接",
      });
    }
    if (value.kind === "url" && value.target) {
      try {
        const url = new URL(value.target);
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
      } catch {
        context.addIssue({ code: "custom", path: ["target"], message: "在线文件必须使用 http 或 https 链接" });
      }
    }
  });

export const ResourceLibraryUpdateSchema = z
  .object({
    parentId: z.string().trim().min(1).nullable().optional(),
    name: z.string().trim().min(1).max(240).optional(),
    target: z.string().trim().max(4_096).nullable().optional(),
    tags: ResourceLibraryTagsSchema.optional(),
    thumbnailDataUrl: z.string().max(262_144).nullable().optional(),
  })
  .strict();

export const ResourceLibraryManageSchema = z.union([
  z.object({
    operation: z.literal("create"),
    parentId: z.string().trim().min(1).nullable().optional(),
    kind: ResourceLibraryItemKindSchema,
    name: z.string().trim().min(1).max(240),
    target: z.string().trim().max(4_096).nullable().optional(),
    tags: ResourceLibraryTagsSchema.default([]),
  }).superRefine((value, context) => {
    if (value.kind !== "folder" && !value.target) {
      context.addIssue({ code: "custom", path: ["target"], message: "映射资料必须提供本地路径或在线链接" });
    }
    if (value.kind === "url" && value.target) {
      try {
        const url = new URL(value.target);
        if (!["http:", "https:"].includes(url.protocol)) throw new Error();
      } catch {
        context.addIssue({ code: "custom", path: ["target"], message: "在线文件必须使用 http 或 https 链接" });
      }
    }
  }),
  z.object({
    operation: z.literal("update"),
    id: z.string().trim().min(1),
    parentId: z.string().trim().min(1).nullable().optional(),
    name: z.string().trim().min(1).max(240).optional(),
    target: z.string().trim().max(4_096).nullable().optional(),
    tags: ResourceLibraryTagsSchema.optional(),
    thumbnailDataUrl: z.string().max(262_144).nullable().optional(),
  }).strict(),
  z.object({ operation: z.literal("delete"), id: z.string().trim().min(1) }),
]);

const ResourceLibraryCellSchema = z.union([
  z.string().max(20_000),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

export const ResourceLibraryOfficeDocumentSchema = z.object({
  kind: z.literal("document"),
  paragraphs: z.array(z.string().max(50_000)).max(10_000),
  html: z.string().max(5_000_000).optional(),
}).strict();

export const ResourceLibraryOfficeSpreadsheetSchema = z.object({
  kind: z.literal("spreadsheet"),
  sheets: z.array(z.object({
    name: z.string().trim().min(1).max(120),
    rows: z.array(z.array(ResourceLibraryCellSchema).max(200)).max(5_000),
  }).strict()).min(1).max(20),
}).strict();

export const ResourceLibraryOfficePresentationSchema = z.object({
  kind: z.literal("presentation"),
  slides: z.array(z.object({
    number: z.number().int().positive(),
    paragraphs: z.array(z.string().max(20_000)).max(500),
  }).strict()).min(1).max(500),
}).strict();

export const ResourceLibraryOfficeContentUpdateSchema = z.discriminatedUnion("kind", [
  ResourceLibraryOfficeDocumentSchema,
  ResourceLibraryOfficeSpreadsheetSchema,
  ResourceLibraryOfficePresentationSchema,
]);

export const ResourceLibraryFileEditSchema = z.discriminatedUnion("kind", [
  ResourceLibraryOfficeDocumentSchema.extend({ id: z.string().trim().min(1) }),
  ResourceLibraryOfficeSpreadsheetSchema.extend({ id: z.string().trim().min(1) }),
  ResourceLibraryOfficePresentationSchema.extend({ id: z.string().trim().min(1) }),
]);

export const ResourceLibraryUniverEditSchema = z.object({
  id: z.string().trim().min(1),
  sessionId: z.string().uuid(),
  summary: z.string().trim().min(1).max(500),
  operation: z.enum(["execute", "compile-svg", "unit-create", "unit-remove", "insert-library-image"]).default("execute"),
  unitId: z.string().trim().min(1).optional(),
  imageId: z.string().uuid().optional(),
  slideId: z.string().trim().min(1).optional(),
  left: z.number().finite().min(0).max(100_000).optional(),
  top: z.number().finite().min(0).max(100_000).optional(),
  width: z.number().finite().positive().max(100_000).optional(),
  height: z.number().finite().positive().max(100_000).optional(),
  unitKind: z.enum(["sheet", "doc", "slide", "base", "board"]).optional(),
  unitName: z.string().trim().min(1).max(240).optional(),
  code: z.string().min(1).max(300_000).optional(),
  svg: z.string().min(1).max(2_000_000).optional(),
  page: z.number().int().min(1).max(10_000).optional(),
  mode: z.enum(["replace", "add"]).optional(),
}).strict().superRefine((value, context) => {
  if (value.operation === "execute" && !value.code) {
    context.addIssue({ code: "custom", path: ["code"], message: "执行 Univer 代码需要 code" });
  }
  if (value.operation === "compile-svg") {
    if (!value.svg) context.addIssue({ code: "custom", path: ["svg"], message: "编译幻灯片需要 svg" });
    if (!value.page) context.addIssue({ code: "custom", path: ["page"], message: "编译幻灯片需要 page" });
  }
  if (value.operation === "unit-create") {
    if (!value.unitKind) context.addIssue({ code: "custom", path: ["unitKind"], message: "创建 Unit 需要 unitKind" });
    if (!value.unitName) context.addIssue({ code: "custom", path: ["unitName"], message: "创建 Unit 需要 unitName" });
  }
  if (value.operation === "unit-remove" && !value.unitId) {
    context.addIssue({ code: "custom", path: ["unitId"], message: "删除 Unit 需要 unitId" });
  }
  if (value.operation === "insert-library-image" && !value.imageId) {
    context.addIssue({ code: "custom", path: ["imageId"], message: "插入资料库图片需要 imageId" });
  }
});

export const ResourceLibraryFileCreateSchema = z.object({
  parentId: z.string().trim().min(1).nullable().optional(),
  name: z.string().trim().min(1).max(240),
  format: z.enum(["markdown", "html", "csv", "docx", "xlsx", "pptx", "univer"]),
  unitKind: z.enum(["sheet", "doc", "slide", "base", "board"]).optional(),
  content: z.string().max(900_000).default(""),
  columns: z.array(z.string().trim().min(1).max(200)).max(100).optional(),
  rows: z.array(z.array(ResourceLibraryCellSchema).max(100)).max(5_000).optional(),
  slides: z.array(z.object({
    title: z.string().max(500).default(""),
    paragraphs: z.array(z.string().max(20_000)).max(100).default([]),
  }).strict()).max(200).optional(),
  tags: ResourceLibraryTagsSchema.default([]),
}).strict();

export const ResourceLibraryTextFileEditSchema = z.object({
  id: z.string().trim().min(1),
  content: z.string().max(5_000_000),
}).strict();

export type ResourceLibraryItem = z.infer<typeof ResourceLibraryItemSchema>;
export type ResourceLibraryCreate = z.infer<typeof ResourceLibraryCreateSchema>;
export type ResourceLibraryUpdate = z.infer<typeof ResourceLibraryUpdateSchema>;
export type ResourceLibraryMove = z.infer<typeof ResourceLibraryMoveSchema>;
export type ResourceLibraryContentUpdate = z.infer<typeof ResourceLibraryContentUpdateSchema>;
export type ResourceLibraryExport = z.infer<typeof ResourceLibraryExportSchema>;
export type AssistantMediaSave = z.infer<typeof AssistantMediaSaveSchema>;
export type WhiteboardFolderExport = z.infer<typeof WhiteboardFolderExportSchema>;
export type ResourceLibraryManage = z.infer<typeof ResourceLibraryManageSchema>;
export type ResourceLibraryFileCreate = z.infer<typeof ResourceLibraryFileCreateSchema>;
export type ResourceLibraryOfficeContentUpdate = z.infer<typeof ResourceLibraryOfficeContentUpdateSchema>;
export type ResourceLibraryFileEdit = z.infer<typeof ResourceLibraryFileEditSchema>;
export type ResourceLibraryUniverEdit = z.infer<typeof ResourceLibraryUniverEditSchema>;
export type ResourceLibraryTextFileEdit = z.infer<typeof ResourceLibraryTextFileEditSchema>;
