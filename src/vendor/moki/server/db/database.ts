import type { DatabaseSync } from 'node:sqlite';
export type WorkbenchDatabase = Pick<DatabaseSync, 'prepare' | 'exec'>;
