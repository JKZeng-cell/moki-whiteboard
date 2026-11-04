import {createHash} from 'node:crypto';
import {WhiteboardRepository} from '../vendor/moki/server/repositories/whiteboard-repository.js';
import type {WorkbenchDatabase} from '../vendor/moki/server/db/database.js';
import type {ResourceCache} from './resource-cache.js';

export class CachedWhiteboardRepository extends WhiteboardRepository {
  constructor(private readonly assetDB:WorkbenchDatabase,private readonly cache:ResourceCache,private readonly diskThreshold=64*1024*1024){super(assetDB);}
  override saveAsset(content:Buffer,input:Parameters<WhiteboardRepository['saveAsset']>[1]){
    const id=createHash('sha256').update(content).digest('hex');this.cache.writeAsset(id,content);
    if(content.byteLength<this.diskThreshold)return super.saveAsset(content,input);
    // Keep large media out of SQLite's per-BLOB ceiling, with no attachment size cap.
    const existing=Boolean(this.assetDB.prepare('SELECT id FROM whiteboard_assets WHERE id=?').get(id));
    this.assetDB.prepare('INSERT OR IGNORE INTO whiteboard_assets (id,mime_type,file_name,byte_size,width,height,content,created_at) VALUES (?,?,?,?,?,?,?,?)').run(id,input.mimeType,input.fileName?.trim()||'whiteboard-image',content.byteLength,input.width??null,input.height??null,Buffer.alloc(0),input.createdAt??new Date().toISOString());
    const {content:_,...metadata}=super.findAsset(id)!;
    return {...metadata,src:'/api/whiteboard/assets/'+id,deduplicated:existing};
  }
  override findAsset(id:string){const asset=super.findAsset(id);if(asset){asset.content=this.cache.readAsset(id,asset.content,asset.byteSize);if(asset.content.byteLength<this.diskThreshold)this.cache.writeAsset(id,asset.content);}return asset;}
}
