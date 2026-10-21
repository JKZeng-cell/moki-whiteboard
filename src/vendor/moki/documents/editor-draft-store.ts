import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const queues = new Map<string, Promise<void>>();
export type DraftMetadata = { sourcePath: string; nativeWorktreeId?: string; version?: string; sourceSize?: number; sourceModifiedMs?: number; savedAt: string; file: string };
/** An atomic manifest points at an immutable snapshot. A failed save preserves the last snapshot. */
export class EditorDraftStore {
  constructor(private readonly directory: string) {}
  private key(id: string) { return join(this.directory, createHash('sha256').update(id).digest('hex')); }
  private serial<T>(id: string, operation: () => Promise<T>): Promise<T> {
    const key = this.key(id), result = (queues.get(key) ?? Promise.resolve()).then(operation);
    const settled = result.then(() => undefined, () => undefined); queues.set(key, settled);
    void settled.then(() => { if (queues.get(key) === settled) queues.delete(key); });
    return result;
  }
  get(id: string): Promise<(DraftMetadata & { content: Buffer }) | undefined> {
    return this.serial(id, () => this.readSnapshot(id));
  }
  private async readSnapshot(id: string): Promise<(DraftMetadata & { content: Buffer }) | undefined> {
    try {
      const metadata = JSON.parse(await readFile(this.key(id) + '.json', 'utf8')) as DraftMetadata;
      if (!/^[a-f0-9-]+\.draft$/.test(metadata.file)) throw new Error('草稿记录无效');
      return { ...metadata, content: await readFile(join(this.directory, metadata.file)) };
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  }
  put(id: string, content: Buffer, metadata: Omit<DraftMetadata, 'file' | 'savedAt'>) {
    return this.serial(id, async () => {
      await mkdir(this.directory, { recursive: true });
      const previous = await this.readSnapshot(id), file = randomUUID() + '.draft';
      const record = { ...metadata, file, savedAt: new Date().toISOString() };
      const temporary = this.key(id) + '.' + randomUUID() + '.tmp';
      try {
        await writeFile(join(this.directory, file), content, { flag: 'wx' });
        await writeFile(temporary, JSON.stringify(record), { flag: 'wx' });
        await rename(temporary, this.key(id) + '.json');
      } catch (error) { await rm(join(this.directory, file), { force: true }); throw error; }
      finally { await rm(temporary, { force: true }); }
      if (previous) await rm(join(this.directory, previous.file), { force: true }).catch(() => undefined);
      return { savedAt: record.savedAt };
    });
  }
  remove(id: string) { return this.serial(id, async () => {
    const previous = await this.readSnapshot(id);
    await rm(this.key(id) + '.json', { force: true });
    if (previous) await rm(join(this.directory, previous.file), { force: true });
  }); }
}
