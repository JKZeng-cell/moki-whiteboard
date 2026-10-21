import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createBoard, normalizeImportedSnapshot } from "../core/board.js";
import type { BoardDocument, WhiteboardSnapshot } from "../core/types.js";

type BoardRow = { id: string; title: string; version: number; updated_at: string; snapshot_json: string };
type AuditRow = { id: number; board_id: string; actor: string; action: string; detail_json: string; created_at: string };
export class BoardNotFoundError extends Error {
  constructor(public readonly boardId:string){super(`白板不存在：${boardId}`);this.name='BoardNotFoundError';}
}
export type ThumbnailInfo={version:number;pageId:string;capturedAt:string;width:number;height:number};

export class VersionConflictError extends Error {
  constructor(public readonly currentVersion: number) {
    super(`白板已更新，当前版本为 ${currentVersion}`);
    this.name = "VersionConflictError";
  }
}

export class WhiteboardStore {
  readonly db: DatabaseSync;

  constructor(public readonly path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    const initialized=!!this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='boards'").get();
    this.db.exec(`
      PRAGMA busy_timeout = 15000;
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS boards (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        version INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        snapshot_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS board_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        board_id TEXT NOT NULL,
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        detail_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_board_audit_board ON board_audit(board_id, id DESC);
      CREATE TABLE IF NOT EXISTS board_thumbnails (
        board_id TEXT PRIMARY KEY,version INTEGER NOT NULL,page_id TEXT NOT NULL,
        captured_at TEXT NOT NULL,width INTEGER NOT NULL,height INTEGER NOT NULL,content BLOB NOT NULL
      );
    `);
    if (!initialized) this.create("我的白板", "system");
  }

  close(): void {
    this.db.close();
  }

  private rowToBoard(row: BoardRow): BoardDocument {
    return {
      id: row.id,
      title: row.title,
      version: row.version,
      updatedAt: row.updated_at,
      snapshot: normalizeImportedSnapshot(JSON.parse(row.snapshot_json)),
    };
  }

  list(): Array<Omit<BoardDocument, "snapshot">> {
    return (this.db.prepare("SELECT id, title, version, updated_at FROM boards ORDER BY updated_at DESC").all() as unknown as Array<Omit<BoardRow, "snapshot_json">>)
      .map((row) => ({ id: row.id, title: row.title, version: row.version, updatedAt: row.updated_at }));
  }

  get(id = "default"): BoardDocument {
    const selectedId = id === "default" ? (this.list()[0]?.id ?? "") : id;
    const row = this.db.prepare("SELECT * FROM boards WHERE id = ?").get(selectedId) as unknown as BoardRow | undefined;
    if (!row) throw new BoardNotFoundError(id);
    return this.rowToBoard(row);
  }

  create(title: string, actor: string, importedSnapshot?: unknown): BoardDocument {
    const board = createBoard(title.trim() || "未命名白板");
    if (importedSnapshot !== undefined) board.snapshot = normalizeImportedSnapshot(importedSnapshot);
    this.db.prepare("INSERT INTO boards(id, title, version, updated_at, snapshot_json) VALUES(?, ?, ?, ?, ?)")
      .run(board.id, board.title, board.version, board.updatedAt, JSON.stringify(board.snapshot));
    this.audit(board.id, actor, "board.create", { title: board.title });
    return board;
  }

  mutate(
    id: string,
    actor: string,
    action: string,
    detail: Record<string, unknown>,
    mutator: (snapshot: WhiteboardSnapshot, board: BoardDocument) => void,
    expectedVersion?: number,
  ): BoardDocument {
    const selectedId = id === "default" ? this.get("default").id : id;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.db.prepare("SELECT * FROM boards WHERE id = ?").get(selectedId) as unknown as BoardRow | undefined;
      if (!row) throw new BoardNotFoundError(id);
      const board = this.rowToBoard(row);
      if (expectedVersion !== undefined && expectedVersion !== board.version) throw new VersionConflictError(board.version);
      const snapshot = structuredClone(board.snapshot);
      mutator(snapshot, board);
      const updatedAt = new Date().toISOString();
      const version = board.version + 1;
      this.db.prepare("UPDATE boards SET title = ?, version = ?, updated_at = ?, snapshot_json = ? WHERE id = ?")
        .run(board.title, version, updatedAt, JSON.stringify(snapshot), selectedId);
      this.audit(selectedId, actor, action, detail);
      this.db.exec("COMMIT");
      return { ...board, version, updatedAt, snapshot };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  replaceSnapshot(id: string, snapshot: unknown, actor: string, expectedVersion?: number): BoardDocument {
    const normalized = normalizeImportedSnapshot(snapshot);
    return this.mutate(id, actor, "snapshot.replace", { pageCount: Object.values(normalized.document.store).filter((item) => item.typeName === "page").length }, (target) => {
      target.document = structuredClone(normalized.document);
      target.session = structuredClone(normalized.session);
    }, expectedVersion);
  }

  rename(id: string, title: string, actor: string,expectedVersion?:number): BoardDocument {
    return this.mutate(id, actor, "board.rename", { title }, (_snapshot, board) => { board.title = title.trim() || board.title; },expectedVersion);
  }

  delete(id: string, actor: string,expectedVersion?:number): void {
    this.db.exec('BEGIN IMMEDIATE');
    try{const board=this.get(id);if(expectedVersion!==undefined&&expectedVersion!==board.version)throw new VersionConflictError(board.version);
      this.audit(board.id,actor,'board.delete',{title:board.title});this.db.prepare('DELETE FROM board_thumbnails WHERE board_id=?').run(board.id);
      if(this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='native_agent_context'").get())this.db.prepare('DELETE FROM native_agent_context WHERE board_id=?').run(board.id);
      this.db.prepare('DELETE FROM boards WHERE id=?').run(board.id);this.db.exec('COMMIT');
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }

  duplicate(id:string,title:string,actor:string,expectedVersion?:number):BoardDocument{
    this.db.exec('BEGIN IMMEDIATE');
    try{const source=this.get(id);if(expectedVersion!==undefined&&source.version!==expectedVersion)throw new VersionConflictError(source.version);
      const board=createBoard(title.trim()||source.title+' 副本');board.snapshot=structuredClone(source.snapshot);
      this.db.prepare('INSERT INTO boards VALUES (?,?,?,?,?)').run(board.id,board.title,board.version,board.updatedAt,JSON.stringify(board.snapshot));
      this.db.prepare('INSERT INTO board_thumbnails SELECT ?,1,page_id,captured_at,width,height,content FROM board_thumbnails WHERE board_id=? AND version=?').run(board.id,source.id,source.version);
      this.audit(board.id,actor,'board.duplicate',{sourceId:source.id,title:board.title});this.db.exec('COMMIT');return board;
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }

  thumbnail(id:string):({info:ThumbnailInfo;content:Buffer})|undefined{
    const row=this.db.prepare('SELECT * FROM board_thumbnails WHERE board_id=?').get(id);if(!row)return undefined;
    return {info:{version:Number(row.version),pageId:String(row.page_id),capturedAt:String(row.captured_at),width:Number(row.width),height:Number(row.height)},content:Buffer.from(row.content as Uint8Array)};
  }
  thumbnailInfo(id:string):ThumbnailInfo|undefined{
    const row=this.db.prepare('SELECT version,page_id,captured_at,width,height FROM board_thumbnails WHERE board_id=?').get(id);
    return row?{version:Number(row.version),pageId:String(row.page_id),capturedAt:String(row.captured_at),width:Number(row.width),height:Number(row.height)}:undefined;
  }
  saveThumbnail(id:string,expectedVersion:number,pageId:string,content:Buffer,width:number,height:number):ThumbnailInfo{
    const capturedAt=new Date().toISOString();
    const result=this.db.prepare('INSERT OR REPLACE INTO board_thumbnails SELECT id,version,?,?,?, ?,? FROM boards WHERE id=? AND version=?').run(pageId,capturedAt,width,height,content,id,expectedVersion);
    if(!result.changes)throw new VersionConflictError(this.get(id).version);
    return {version:expectedVersion,pageId,capturedAt,width,height};
  }

  audit(boardId: string, actor: string, action: string, detail: Record<string, unknown>): void {
    this.db.prepare("INSERT INTO board_audit(board_id, actor, action, detail_json, created_at) VALUES(?, ?, ?, ?, ?)")
      .run(boardId, actor, action, JSON.stringify(detail), new Date().toISOString());
  }

  history(boardId: string, limit = 100) {
    return (this.db.prepare("SELECT * FROM board_audit WHERE board_id = ? ORDER BY id DESC LIMIT ?").all(boardId, Math.max(1, Math.min(limit, 500))) as unknown as AuditRow[])
      .map((row) => ({ id: row.id, boardId: row.board_id, actor: row.actor, action: row.action, detail: JSON.parse(row.detail_json) as unknown, createdAt: row.created_at }));
  }
}
