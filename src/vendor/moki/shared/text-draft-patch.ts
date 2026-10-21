export type TextDraftPatch = { before: string; after: string; expectedCount?: number | undefined };

/** Match every edit against the same original draft, then apply once. Never guess. */
export function applyTextDraftPatches(source: string, patches: readonly TextDraftPatch[]): string {
  if (!patches.length || patches.length > 100) throw new Error('局部修改需要 1–100 个替换项');
  const edits: Array<{ start: number; end: number; text: string }> = [];
  for (const [index, patch] of patches.entries()) {
    const expected = patch.expectedCount ?? 1;
    if (!patch.before || !Number.isSafeInteger(expected) || expected < 1 || expected > 1000) throw new Error(`第 ${index + 1} 项匹配参数无效`);
    const matches: number[] = [];
    for (let at = source.indexOf(patch.before); at !== -1; at = source.indexOf(patch.before, at + patch.before.length)) {
      matches.push(at);
      if (matches.length > expected) break;
    }
    if (matches.length !== expected) throw new Error(`第 ${index + 1} 项匹配数量不是预期的 ${expected} 处，草稿未修改；请读取最新草稿并提供更精确的上下文`);
    for (const start of matches) edits.push({ start, end: start + patch.before.length, text: patch.after });
  }
  edits.sort((a, b) => a.start - b.start);
  for (let i = 1; i < edits.length; i++) if (edits[i]!.start < edits[i - 1]!.end) throw new Error('替换范围重叠，草稿未修改；请合并重叠修改后重试');
  let result = '', cursor = 0;
  for (const edit of edits) { result += source.slice(cursor, edit.start) + edit.text; cursor = edit.end; }
  result += source.slice(cursor);
  if (result.length > 5_000_000) throw new Error('修改后的文本超过编辑器容量，草稿未修改');
  return result;
}
