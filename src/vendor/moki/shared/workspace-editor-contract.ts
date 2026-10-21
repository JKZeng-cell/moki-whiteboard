import { z } from 'zod';

export const WorkspaceEditorOperationSchema = z.enum(['activate', 'edit', 'read_text', 'replace_text', 'patch_text', 'undo', 'redo', 'discard', 'save', 'save_as']);
export const WorkspaceEditorStateSchema = z.object({
  editorId: z.string().uuid(),
  id: z.string().min(1),
  name: z.string().max(240),
  active: z.boolean().optional(),
  activeTabId: z.string().optional(),
  tabs: z.array(z.object({id:z.string(),title:z.string(),kind:z.enum(['file','browser','whiteboard']),resourceId:z.string().optional()})).optional(),
  mode: z.enum(['preview', 'text', 'office', 'workspace']),
  sessionId: z.string().optional(),
  dirty: z.boolean(),
  revision: z.number().int().nonnegative(),
  operations: z.array(WorkspaceEditorOperationSchema),
});
export const WorkspaceEditorActionSchema = z.object({
  editorId: z.string().uuid(),
  id: z.string().min(1),
  operation: WorkspaceEditorOperationSchema,
  tabId: z.string().optional(),
  content: z.string().max(900_000).optional(),
  patches: z.array(z.object({before:z.string().min(1).max(900_000),after:z.string().max(900_000),expectedCount:z.number().int().min(1).max(1000).optional()})).min(1).max(100).optional(),
  destination: z.string().min(1).max(4096).optional(),
  revision: z.number().int().nonnegative().optional(),
}).superRefine((value, ctx) => {
  if (value.operation === 'activate' && !value.tabId) ctx.addIssue({code:'custom',message:'切换标签需要 tabId'});
  if (value.operation === 'replace_text' && value.content === undefined) ctx.addIssue({ code: 'custom', message: '修改文本草稿需要完整 content' });
  if (value.operation === 'patch_text' && !value.patches) ctx.addIssue({code:'custom',message:'局部修改需要 patches'});
  if (value.operation !== 'patch_text' && value.patches) ctx.addIssue({code:'custom',message:'仅局部修改支持 patches'});
  if (value.operation !== 'replace_text' && value.content !== undefined) ctx.addIssue({ code: 'custom', message: '此操作不接受 content' });
  if (value.operation !== 'save_as' && value.destination !== undefined) ctx.addIssue({ code: 'custom', message: '仅另存为支持 destination' });
});
export const WorkspaceEditorResultSchema = z.object({
  status: z.enum(['completed', 'cancelled', 'failed']),
  message: z.string().max(1000),
  sessionId: z.string().optional(),
  path: z.string().max(4096).optional(),
  content: z.string().max(5_000_000).optional(),
});
export type WorkspaceEditorState = z.infer<typeof WorkspaceEditorStateSchema>;
export type WorkspaceEditorAction = z.infer<typeof WorkspaceEditorActionSchema>;
export type WorkspaceEditorResult = z.infer<typeof WorkspaceEditorResultSchema>;
export type WorkspaceEditorCommand = WorkspaceEditorAction & { requestId: string; expiresAt: number };
