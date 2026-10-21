import { z } from "zod";
import {
  AssistantMediaSchema,
  AssistantMessageSchema,
  AssistantSessionSchema,
  AssistantSessionSummarySchema,
} from "../domain/assistant.js";

export const ASSISTANT_MAX_ATTACHMENTS = 6;
// Small attachments stay inline for fast previews. Larger files are uploaded in
// bounded local chunks and represented by a server-controlled staging id.
export const ASSISTANT_MAX_ATTACHMENT_BYTES = 32 * 1024 * 1024;
export const ASSISTANT_MAX_TOTAL_ATTACHMENT_BYTES = 32 * 1024 * 1024;
export const NATIVE_MOKI_ROLE_ID = "native-moki";
const ASSISTANT_MAX_ATTACHMENT_DATA_URL_LENGTH =
  Math.ceil(ASSISTANT_MAX_ATTACHMENT_BYTES / 3) * 4 + 200;

export const AssistantAttachmentSchema = z.object({
  id: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(200),
  mediaType: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/iu)
    .max(100),
  dataUrl: z
    .string()
    .trim()
    .refine(
      (value) => /^data:[^;,]+;base64,/iu.test(value),
      "Attachment must be a base64 data URL",
    )
    .max(ASSISTANT_MAX_ATTACHMENT_DATA_URL_LENGTH)
    .optional(),
  stagedUploadId: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]+$/u)
    .max(120)
    .optional(),
  size: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  sourceUrl: z.string().trim().url().max(4_000).optional(),
}).superRefine((value, context) => {
  if (Boolean(value.dataUrl) === Boolean(value.stagedUploadId)) {
    context.addIssue({
      code: "custom",
      message: "Attachment must use either inline data or a staged upload",
      path: ["dataUrl"],
    });
  }
  if (value.dataUrl && value.size > ASSISTANT_MAX_ATTACHMENT_BYTES) {
    context.addIssue({
      code: "custom",
      message: "Inline attachment size must not exceed 32 MB",
      path: ["size"],
    });
  }
});

export const AssistantImageAttachmentSchema = AssistantAttachmentSchema.refine(
  (value) => value.mediaType.startsWith("image/"),
  "Image attachment must use an image media type",
);

export type AssistantAttachment = z.infer<
  typeof AssistantAttachmentSchema
>;

export type AssistantImageAttachment = z.infer<
  typeof AssistantAttachmentSchema
>;

export const AssistantRequestIdSchema = z
  .string()
  .trim()
  .min(8)
  .max(120)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]+$/u);

export const AssistantWorkspaceSelectionSchema = z.object({
  source: z.enum(["whiteboard", "library", "browser"]),
  label: z.string().trim().min(1).max(200),
  content: z.string().trim().min(1).max(20_000),
  itemCount: z.number().int().min(1).max(200),
  capturedAt: z.iso.datetime({ offset: true }),
}).strict();

export type AssistantWorkspaceSelection = z.infer<
  typeof AssistantWorkspaceSelectionSchema
>;

export const AssistantRoleSchema = z.object({
  id: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(60),
  personality: z.string().trim().max(2_000).default(""),
  description: z.string().trim().max(2_000).default(""),
  skills: z.array(z.string().trim().min(1).max(120)).max(30).default([]),
  memory: z.string().trim().max(20_000).default(""),
  builtIn: z.boolean().default(false),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
}).strict();

export const AssistantRoleInputSchema = AssistantRoleSchema.pick({
  name: true,
  personality: true,
  description: true,
  skills: true,
  memory: true,
}).partial({ personality: true, description: true, skills: true, memory: true });

export const AssistantRoleUpdateSchema = AssistantRoleInputSchema.partial();

export const AssistantRoleStateSchema = z.object({
  roles: z.array(AssistantRoleSchema).max(100),
  assignments: z.record(z.string().min(1).max(160), z.string().min(1).max(120)),
  orchestration: z.record(z.string().min(1).max(160), z.boolean()),
}).strict();

export const AssistantSessionRoleSchema = z.object({
  roleId: z.string().trim().min(1).max(120).default(NATIVE_MOKI_ROLE_ID),
  orchestrationEnabled: z.boolean().default(false),
}).strict();

export const AssistantRoleDesignSchema = AssistantRoleInputSchema.extend({
  name: z.string().trim().min(1).max(60),
  designSummary: z.string().trim().max(1_000).optional(),
}).strict();

export type AssistantRole = z.infer<typeof AssistantRoleSchema>;
export type AssistantRoleInput = z.infer<typeof AssistantRoleInputSchema>;
export type AssistantRoleUpdate = z.infer<typeof AssistantRoleUpdateSchema>;
export type AssistantRoleState = z.infer<typeof AssistantRoleStateSchema>;
export type AssistantSessionRole = z.infer<typeof AssistantSessionRoleSchema>;
export type AssistantRoleDesign = z.infer<typeof AssistantRoleDesignSchema>;

export function assistantRequestMessageIds(requestId: string): {
  userMessageId: string;
  assistantMessageId: string;
} {
  const normalized = AssistantRequestIdSchema.parse(requestId);
  return {
    userMessageId: `request:${normalized}:user`,
    assistantMessageId: `request:${normalized}:assistant`,
  };
}

export const AssistantPromptSchema = z
  .object({
    message: z.string().trim().max(8_000).default(""),
    requestId: AssistantRequestIdSchema.optional(),
    queueIfBusy: z.boolean().optional(),
    attachments: z
      .array(AssistantAttachmentSchema)
      .max(ASSISTANT_MAX_ATTACHMENTS)
      .default([]),
    workspaceSelection: AssistantWorkspaceSelectionSchema.optional(),
    roleId: z.string().trim().min(1).max(120).optional(),
    orchestrationEnabled: z.boolean().optional(),
  })
  .refine(
    (value) =>
      value.message.length > 0 || value.attachments.length > 0,
    "Message or attachment is required",
  )
  .refine(
    (value) =>
      value.attachments.reduce(
        (total, attachment) => total + (attachment.dataUrl ? attachment.size : 0),
        0,
      ) <= ASSISTANT_MAX_TOTAL_ATTACHMENT_BYTES,
    {
      message: "Total attachment size must not exceed 32 MB",
      path: ["attachments"],
    },
  );

export const AssistantSkillReferenceSchema = z.object({
  id: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(120),
  skill: z.string().trim().min(1).max(200),
  description: z.string().trim().max(500).optional(),
  source: z.string().trim().max(80).optional(),
  executable: z.boolean().optional(),
});

export const AssistantStatusSchema = z.object({
  enabled: z.boolean(),
  provider: z.enum(["none", "codex", "deepseek", "kimi", "zhipu", "volcark", "custom"]).default("none"),
  state: z.enum([
    "ready",
    "starting",
    "disabled",
    "unavailable",
  ]),
  authenticated: z.boolean(),
  cli: z.string(),
  serviceTier: z.enum(["auto", "fast", "flex"]),
  message: z.string(),
  safety: z.object({
    sandbox: z.literal("restricted-read-only"),
    dynamicToolsOnly: z.literal(true),
    writesRequireConfirmation: z.literal(true),
    fullAuthorization: z.boolean().optional(),
    workbenchFullAccess: z.boolean().optional(),
    platformFullAccess: z.boolean().optional(),
    autonomousScope: z.array(z.string()).optional(),
  }),
  skills: z.array(AssistantSkillReferenceSchema).default([]),
});

export type AssistantStatus = z.infer<
  typeof AssistantStatusSchema
>;

export const AssistantSessionViewSchema = z.object({
  session: AssistantSessionSchema.omit({ codexThreadId: true }),
  messages: z.array(AssistantMessageSchema),
});

export type AssistantSessionView = z.infer<
  typeof AssistantSessionViewSchema
>;

export const AssistantSessionListResultSchema = z.object({
  sessions: z.array(AssistantSessionSummarySchema),
  nextCursor: z.string().min(1).optional(),
});

export type AssistantSessionListResult = z.infer<
  typeof AssistantSessionListResultSchema
>;

export const AssistantSessionListSectionSchema = z.enum([
  "custom",
  "automation",
  "today",
  "recent",
  "earlier",
]);

export type AssistantSessionListSection = z.infer<
  typeof AssistantSessionListSectionSchema
>;

export const AssistantSessionGroupSchema = z.object({
  id: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(40),
}).strict();

export const AssistantSessionGroupingSchema = z.object({
  groups: z.array(AssistantSessionGroupSchema).max(100),
  assignments: z.record(
    z.string().trim().min(1).max(160),
    z.string().trim().min(1).max(120),
  ).refine((value) => Object.keys(value).length <= 5_000, {
    message: "Too many assistant session group assignments",
  }),
}).strict();

export type AssistantSessionGroup = z.infer<typeof AssistantSessionGroupSchema>;
export type AssistantSessionGrouping = z.infer<typeof AssistantSessionGroupingSchema>;

export const AssistantSessionGroupingStateSchema = z.object({
  persisted: z.boolean(),
  grouping: AssistantSessionGroupingSchema,
}).strict();

export type AssistantSessionGroupingState = z.infer<
  typeof AssistantSessionGroupingStateSchema
>;

export function normalizeAssistantSessionGrouping(
  value: unknown,
): AssistantSessionGrouping {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { groups: [], assignments: {} };
  }
  const record = value as Record<string, unknown>;
  const candidates = Array.isArray(record.groups) ? record.groups : [];
  const seen = new Set<string>();
  const groups = candidates.flatMap((candidate) => {
    const parsed = AssistantSessionGroupSchema.safeParse(candidate);
    if (!parsed.success || seen.has(parsed.data.id)) return [];
    seen.add(parsed.data.id);
    return [parsed.data];
  }).slice(0, 100);
  const groupIds = new Set(groups.map((group) => group.id));
  const rawAssignments = record.assignments && typeof record.assignments === "object" && !Array.isArray(record.assignments)
    ? Object.entries(record.assignments as Record<string, unknown>)
    : [];
  return {
    groups,
    assignments: Object.fromEntries(
      rawAssignments.flatMap(([sessionId, groupId]) =>
        sessionId.length > 0 && sessionId.length <= 160 &&
        typeof groupId === "string" && groupId.length > 0 && groupId.length <= 120 &&
        groupIds.has(groupId)
          ? [[sessionId, groupId] as const]
          : [],
      ).slice(0, 5_000),
    ),
  };
}

const ActionPreviewClientDataSchema = z.object({
  kind: z.literal("action_preview"),
  draft: z.record(z.string(), z.unknown()),
  confirmationToken: z.string().min(1),
});

export const AgentPlanClientDataSchema = z.object({
  kind: z.literal("agent_plan"),
  goal: z.string().min(1),
  steps: z.array(
    z.object({
      tool: z.string().min(1),
      purpose: z.string().min(1),
      roleId: z.string().min(1).optional(),
      roleName: z.string().min(1).optional(),
    }),
  ),
});

export type AgentPlanClientData = z.infer<typeof AgentPlanClientDataSchema>;

export const RoleCollaborationClientDataSchema = z.object({
  kind: z.literal("role_collaboration"),
  roleId: z.string().min(1),
  roleName: z.string().min(1),
});

export type RoleCollaborationClientData = z.infer<
  typeof RoleCollaborationClientDataSchema
>;

export const BrowserUserHandoffClientDataSchema = z.object({
  kind: z.literal("browser_user_handoff"),
  reason: z.string().min(1).max(500),
  instruction: z.string().min(1).max(500),
  resumePrompt: z.string().min(1).max(200),
});

export type BrowserUserHandoffClientData = z.infer<
  typeof BrowserUserHandoffClientDataSchema
>;

export const AssistantMediaAttachmentClientDataSchema = z.object({
  kind: z.literal("assistant_media_attachment"),
  media: AssistantMediaSchema,
});

export type AssistantMediaAttachmentClientData = z.infer<
  typeof AssistantMediaAttachmentClientDataSchema
>;

const AssistantToolClientDataSchema = z.union([
  ActionPreviewClientDataSchema,
  AgentPlanClientDataSchema,
  RoleCollaborationClientDataSchema,
  BrowserUserHandoffClientDataSchema,
  AssistantMediaAttachmentClientDataSchema,
]);

export const AssistantEventSchema = z.discriminatedUnion(
  "type",
  [
    z.object({
      sequence: z.number().int().positive(),
      type: z.literal("context.compaction"),
      messageId: z.string(),
      status: z.enum(["started", "completed"]),
    }),
    z.object({
      sequence: z.number().int().positive(),
      type: z.literal("message.created"),
      message: AssistantMessageSchema,
    }),
    z.object({
      sequence: z.number().int().positive(),
      type: z.literal("message.delta"),
      messageId: z.string(),
      delta: z.string(),
    }),
    z.object({
      sequence: z.number().int().positive(),
      type: z.literal("message.completed"),
      message: AssistantMessageSchema,
    }),
    z.object({
      sequence: z.number().int().positive(),
      type: z.literal("message.failed"),
      message: AssistantMessageSchema,
    }),
    z.object({
      sequence: z.number().int().positive(),
      type: z.literal("tool"),
      tool: z.string(),
      callId: z.string().optional(),
      status: z.enum(["started", "completed", "failed"]),
      outcome: z.enum(["succeeded", "blocked", "failed", "cancelled"]).optional(),
      activityKind: z.enum(["query", "action"]).optional(),
      description: z.string().trim().min(1).max(300).optional(),
      error: z.string().optional(),
      clientData: AssistantToolClientDataSchema.optional(),
    }),
  ],
);

export type AssistantEvent = z.infer<
  typeof AssistantEventSchema
>;
