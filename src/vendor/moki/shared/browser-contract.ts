import { z } from "zod";

export const BrowserSessionIdSchema = z.string().min(1).max(160).regex(/^[a-zA-Z0-9:_-]+$/u);
export const BrowserKeySchema = z.enum(["Enter", "Tab", "Shift+Tab", "Backspace", "Delete", "Escape", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown", "Control+A", "Control+C"]);
export const BrowserActionSchema = z.object({
  operation: z.enum(["navigate", "click", "type", "press", "select", "back", "forward", "reload", "scroll", "tab", "new_tab", "close_tab"]),
  url: z.string().max(4000).optional(),
  target: z.string().max(500).optional(),
  text: z.string().max(12000).optional(),
  key: BrowserKeySchema.optional(),
  values: z.array(z.string().max(1000)).max(30).optional(),
  tabId: z.string().max(100).optional(),
  deltaY: z.number().min(-2000).max(2000).optional(),
  purpose: z.string().min(1).max(500),
}).strict();
export type BrowserAction = z.infer<typeof BrowserActionSchema>;
const inputTabId = z.string().max(100).optional();
export const BrowserInputSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("click"), tabId: inputTabId, x: z.number().min(0).max(2560), y: z.number().min(0).max(1600) }).strict(),
  z.object({ type: z.literal("text"), tabId: inputTabId, text: z.string().max(12000) }).strict(),
  z.object({ type: z.literal("key"), tabId: inputTabId, key: BrowserKeySchema }).strict(),
  z.object({ type: z.literal("scroll"), tabId: inputTabId, deltaY: z.number().min(-2000).max(2000) }).strict(),
]);
export type BrowserInput = z.infer<typeof BrowserInputSchema>;
export const BrowserViewportSchema = z.object({ width: z.number().int().min(320).max(1920), height: z.number().int().min(240).max(1600), tabId: z.string().min(1).max(100) }).strict();
export type BrowserUserActionRequired = {
  code: "login" | "embedded_oauth" | "verification" | "rate_limited" | "manual";
  reason: string;
  instruction: string;
  resumePrompt: string;
  detectedAt: string;
  tabId?: string;
  url?: string;
};
export type BrowserState = {
  enabled: boolean;
  running: boolean;
  channel?: string;
  error?: string | undefined;
  activeTabId?: string | undefined;
  revision: number;
  tabs: Array<{ id: string; url: string; title: string; nativeTargetId?: string }>;
  downloads: Array<{ id: string; name: string; url: string; mediaType: string }>;
  userActionRequired?: BrowserUserActionRequired;
};
