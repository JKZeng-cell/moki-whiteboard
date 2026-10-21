import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";

const queues = new Map<string, Promise<void>>();

export function fileContentVersion(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

export class FileEditConflict extends Error {
  constructor() {
    super("文件已被其他操作修改，当前草稿未覆盖原文件。请重新读取最新内容后编辑，或将当前草稿另存为。");
  }
}

// Share the same queue across structured Office writes and text/HTML saves.
// Resolve aliases before queuing so two library entries cannot race on one file.
export async function withFileEdit<T>(path: string, expectedVersion: string | undefined,
  operation: (original: Buffer, canonicalPath: string) => Promise<T>): Promise<T> {
  const canonical = realpathSync(path);
  const key = process.platform === "win32" ? canonical.toLowerCase() : canonical;
  const previous = queues.get(key) ?? Promise.resolve();
  const result = previous.then(async () => {
    const original = await readFile(canonical);
    if (expectedVersion !== undefined && fileContentVersion(original) !== expectedVersion) throw new FileEditConflict();
    return operation(original, canonical);
  });
  const settled = result.then(() => undefined, () => undefined);
  queues.set(key, settled);
  void settled.then(() => { if (queues.get(key) === settled) queues.delete(key); });
  return result;
}
