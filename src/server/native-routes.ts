import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {registerWhiteboardRoutes} from '../vendor/moki/server/routes/whiteboard-routes.js';
import { WhiteboardRepository } from '../vendor/moki/server/repositories/whiteboard-repository.js';
import { WhiteboardSnapshotSchema } from '../vendor/moki/domain/whiteboard.js';
import type { WhiteboardStore } from './store.js';
import {VersionConflictError} from './store.js';
import {CachedWhiteboardRepository} from './cached-whiteboard-repository.js';
import type {ResourceCache} from './resource-cache.js';

// Original page-aware repository, isolated by board; media is content-addressed and shared.
export async function registerNativeRoutes(app: FastifyInstance, store: WhiteboardStore,cache?:ResourceCache) {
  store.db.exec(`CREATE TABLE IF NOT EXISTS whiteboard_assets (id TEXT PRIMARY KEY, mime_type TEXT NOT NULL, file_name TEXT NOT NULL, byte_size INTEGER NOT NULL, width INTEGER, height INTEGER, content BLOB NOT NULL, created_at TEXT NOT NULL);`);
  const repositories = new Map<string, {repo: WhiteboardRepository; mirroredVersion: number}>();
  function repository(request: FastifyRequest) {
    const query = request.query as {boardId?: string};
    const board = store.get(query.boardId ?? 'default');
    const expected=Number(request.headers['x-moki-base-board-version']);
    if((request.url.split('?')[0]==='/api/whiteboard/snapshots'||request.url.split('?')[0]==='/api/whiteboard/pages')&&request.method!=='GET'&&Number.isInteger(expected)&&expected>0&&expected!==board.version)throw new VersionConflictError(board.version);
    let entry = repositories.get(board.id);
    if (!entry) {
      const prefix = 'native_' + createHash('sha256').update(board.id).digest('hex').slice(0,24);
      const rewrite = (sql: string) => sql.replace(/whiteboard_versions/g, prefix+'_versions').replace(/whiteboard_latest_state/g,prefix+'_latest');
      store.db.exec(rewrite(`CREATE TABLE IF NOT EXISTS whiteboard_versions (version INTEGER PRIMARY KEY AUTOINCREMENT, snapshot_json TEXT NOT NULL, content_digest TEXT NOT NULL UNIQUE, page_id TEXT NOT NULL, page_name TEXT NOT NULL, page_version INTEGER NOT NULL, created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS whiteboard_latest_state (singleton INTEGER PRIMARY KEY CHECK(singleton=1), version INTEGER NOT NULL, snapshot_json TEXT NOT NULL, content_digest TEXT NOT NULL, page_id TEXT NOT NULL, page_name TEXT NOT NULL, page_version INTEGER NOT NULL, updated_at TEXT NOT NULL);`));
      const database={prepare:(sql:string)=>store.db.prepare(rewrite(sql)),exec:(sql:string)=>store.db.exec(rewrite(sql))};
      const repo = cache?new CachedWhiteboardRepository(database,cache):new WhiteboardRepository(database);
      entry = {repo, mirroredVersion: 0}; repositories.set(board.id, entry);
    }
    if (entry.mirroredVersion !== board.version) {
      entry.repo.syncPages(WhiteboardSnapshotSchema.parse(board.snapshot), board.updatedAt);
      entry.mirroredVersion = board.version;
    }
    return {entry,board};
  }
  app.addHook('onSend',async(request,reply,payload)=>{if(request.url.startsWith('/api/whiteboard')){const query=request.query as {boardId?:string};try{reply.header('x-moki-board-version',store.get(query.boardId??'default').version);}catch{}}return payload;});
  await registerWhiteboardRoutes(app,{repository:request=>{
    const {entry,board}=repository(request);
    return new Proxy(entry.repo,{get(target,key){
      const value=Reflect.get(target,key);
      if(typeof value!=='function')return value;
      if(key!=='save'&&key!=='syncPages')return value.bind(target);
      return (...args:unknown[])=>{
        const result=value.apply(target,args);
        const latest=target.latest().snapshot;
        const current=store.get(board.id);
        if(latest&&JSON.stringify(latest)!==JSON.stringify(current.snapshot)) entry.mirroredVersion=store.replaceSnapshot(board.id,latest,String(request.headers['x-moki-actor']??'native-ui'),current.version).version;
        return result;
      };
    }});
  }});
}
