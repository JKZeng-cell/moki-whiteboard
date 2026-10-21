import { z } from "zod";

export const AssistantSessionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(120),
  titleOrigin: z
    .enum(["automatic", "manual"])
    .default("automatic"),
  kind: z.enum(["conversation", "automation"]).optional(),
  codexThreadId: z.string().min(1).optional(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

export type AssistantSession = z.infer<
  typeof AssistantSessionSchema
>;

export const AssistantSessionSummarySchema =
  AssistantSessionSchema.omit({
    codexThreadId: true,
  }).extend({
    messageCount: z.number().int().nonnegative(),
    hasStreamingMessage: z.boolean(),
    unreadCount: z.number().int().nonnegative().optional(),
  });

export type AssistantSessionSummary = z.infer<
  typeof AssistantSessionSummarySchema
>;

export const AssistantMessageRoleSchema = z.enum([
  "user",
  "assistant",
]);

export const AssistantMessageStatusSchema = z.enum([
  "streaming",
  "completed",
  "failed",
  "interrupted",
]);

export const AssistantMediaSchema = z.object({
  id: z.string().min(1).max(200),
  kind: z.enum(["image", "video", "file"]),
  name: z.string().min(1).max(240),
  mediaType: z.string().min(1).max(120),
  url: z.string().min(1).max(4_000),
  sourceUrl: z.string().min(1).max(4_000).optional(),
  posterUrl: z.string().min(1).max(4_000).optional(),
});

export type AssistantMedia = z.infer<typeof AssistantMediaSchema>;

export const AssistantTokenUsageSchema = z.object({
  provider: z.enum(["codex", "deepseek", "kimi", "zhipu", "volcark", "custom"]),
  model: z.string().min(1).max(160),
  inputTokens: z.number().int().nonnegative(),
  cachedInputTokens: z.number().int().nonnegative().default(0),
  outputTokens: z.number().int().nonnegative(),
  reasoningTokens: z.number().int().nonnegative().default(0),
  totalTokens: z.number().int().nonnegative(),
  contextTokens: z.number().int().nonnegative().optional(),
  contextWindowTokens: z.number().int().positive().optional(),
  contextCompacted: z.boolean().optional(),
  estimatedCost: z.object({
    amount: z.number().nonnegative(),
    currency: z.enum(["CNY", "USD"]),
    basis: z.literal("api-equivalent"),
    pricingAsOf: z.string().date(),
  }).optional(),
});

export type AssistantTokenUsage = z.infer<typeof AssistantTokenUsageSchema>;

export const AssistantMessageSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  role: AssistantMessageRoleSchema,
  status: AssistantMessageStatusSchema,
  content: z.string().max(100_000),
  media: z.array(AssistantMediaSchema).max(12).optional(),
  usage: AssistantTokenUsageSchema.optional(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  errorSummary: z.string().max(500).optional(),
});

export type AssistantMessage = z.infer<
  typeof AssistantMessageSchema
>;
