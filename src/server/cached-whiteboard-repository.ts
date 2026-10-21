import {createHash} from 'node:crypto';
import {WhiteboardRepository} from '../vendor/moki/server/repositories/whiteboard-repository.js';
import type {WorkbenchDatabase} from '../vendor/moki/server/db/database.js';
import type {ResourceCache} from './resource-cache.js';

export class CachedWhiteboardRepository extends WhiteboardRepository {
  constructor(db:WorkbenchDatabase,private readonly cache:ResourceCache){super(db);}
  override saveAsset(content:Buffer,input:Parameters<WhiteboardRepository['saveAsset']>[1]){
    this.cache.writeAsset(createHash('sha256').update(content).digest('hex'),content);
    return super.saveAsset(content,input);
  }
  override findAsset(id:string){const asset=super.findAsset(id);if(asset)this.cache.writeAsset(id,asset.content);return asset;}
}
