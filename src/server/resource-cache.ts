import {createHash,randomUUID} from 'node:crypto';
import {copyFileSync,existsSync,lstatSync,mkdirSync,readFileSync,readdirSync,unlinkSync,writeFileSync} from 'node:fs';
import {basename,dirname,isAbsolute,join,parse,relative,resolve,sep} from 'node:path';
import type {WhiteboardStore} from './store.js';

import type {ResourceCacheSettings} from '../shared/resource-cache-contract.js';
export type {ResourceCacheSettings} from '../shared/resource-cache-contract.js';
const key='resource-cache';
export function legacyResourcePath(store:WhiteboardStore){return resolve(store.path===':memory:'?join(process.cwd(),'output','test-library'):join(dirname(store.path),'resources'));}
function within(parent:string,child:string){const suffix=relative(parent,child);return suffix===''||(!suffix.startsWith('..'+sep)&&suffix!=='..'&&!isAbsolute(suffix));}
function hash(content:Buffer){return createHash('sha256').update(content).digest('hex');}
function rewritePaths(value:unknown,from:string,to:string):unknown{
  if(typeof value==='string'&&isAbsolute(value)&&within(from,resolve(value)))return join(to,relative(from,resolve(value)));
  if(Array.isArray(value))return value.map(item=>rewritePaths(item,from,to));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([name,item])=>[name,rewritePaths(item,from,to)]));
  return value;
}
function copyVerified(source:string,target:string){
  if(!existsSync(source))return;
  const metadata=lstatSync(source);
  if(metadata.isSymbolicLink())throw new Error('素材目录含符号链接或目录联接，请先选择普通目录');
  if(metadata.isDirectory()){
    if(existsSync(target)&&(!lstatSync(target).isDirectory()||lstatSync(target).isSymbolicLink()))throw new Error('目标素材路径不是普通目录');
    mkdirSync(target,{recursive:true});
    for(const name of readdirSync(source))copyVerified(join(source,name),join(target,name));
  }else if(metadata.isFile()){
    const content=readFileSync(source);
    if(existsSync(target)){
      if(!lstatSync(target).isFile()||lstatSync(target).isSymbolicLink()||hash(readFileSync(target))!==hash(content))throw new Error(`目标目录存在不同内容的同名文件：${basename(target)}；未覆盖原文件`);
    }else copyFileSync(source,target,1);
    if(hash(readFileSync(target))!==hash(content))throw new Error('素材复制校验失败，原目录已保留');
  }
}

export class ResourceCache {
  error:string|null=null;
  constructor(readonly store:WhiteboardStore,readonly defaultPath=legacyResourcePath(store),readonly installPath?:string){
    store.db.exec('CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY,value_json TEXT NOT NULL)');
  }
  private saved():{path?:string;pendingPath?:string}{const row=this.store.db.prepare('SELECT value_json FROM app_settings WHERE key=?').get(key);return row?JSON.parse(String(row.value_json)):{};}
  get path(){return this.saved().path??legacyResourcePath(this.store);}
  info():ResourceCacheSettings{return {path:this.path,defaultPath:this.defaultPath,pendingPath:this.saved().pendingPath??null,error:this.error};}
  private persist(value:{path:string;pendingPath?:string}){this.store.db.prepare('INSERT OR REPLACE INTO app_settings VALUES (?,?)').run(key,JSON.stringify(value));}
  validate(input:string){
    if(!input.trim()||!isAbsolute(input.trim()))throw new Error('请选择绝对路径的素材目录');
    const target=resolve(input.trim());
    if(target===parse(target).root)throw new Error('不能将磁盘根目录设为素材目录');
    if(this.installPath){
      const install=resolve(this.installPath);
      if(install.endsWith('.app')&&within(install,target))throw new Error('素材目录不能放在 macOS 应用包内');
      if(within(target,install)||['resources','locales'].some(name=>within(join(install,name),target)))throw new Error('素材目录必须与客户端程序文件隔离，不能使用安装根目录或 resources/locales');
    }
    if(target!==this.path&&(within(this.path,target)||within(target,this.path)))throw new Error('新旧素材目录不能相互包含');
    for(let ancestor=target;;ancestor=dirname(ancestor)){
      if(existsSync(ancestor)&&lstatSync(ancestor).isSymbolicLink())throw new Error('素材路径不能包含符号链接或目录联接');
      if(dirname(ancestor)===ancestor)break;
    }
    mkdirSync(target,{recursive:true});
    const probe=join(target,`.moki-write-check-${randomUUID()}`);
    try{writeFileSync(probe,'',{flag:'wx'});unlinkSync(probe);}catch{throw new Error('素材目录不可写，请选择有写入权限的目录');}
    return target;
  }
  schedule(input:string|null){
    const target=this.validate(input??this.defaultPath);
    this.persist({path:this.path,...(target!==this.path?{pendingPath:target}:{})});
    return this.info();
  }
  /** Apply only at client startup: active Office edits and other processes keep the old path until then. */
  activate(){
    const saved=this.saved(),old=this.path,target=this.validate(saved.pendingPath??saved.path??this.defaultPath);
    if(old!==target)copyVerified(old,target);
    this.store.db.exec('BEGIN IMMEDIATE');
    try{
    const tables=this.store.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row=>String(row.name));
    const changes:Array<{table:string;column:string;rowid:number;value:string}>=[];
    if(old!==target)for(const table of tables){
      const column=table==='boards'||/^native_[a-f0-9]+_(?:versions|latest)$/.test(table)?'snapshot_json':table==='native_library'?'item_json':undefined;
      if(!column)continue;
      for(const row of this.store.db.prepare(`SELECT rowid AS _rowid,${column} AS value FROM "${table}"`).all()){
        const value=JSON.stringify(rewritePaths(JSON.parse(String(row.value)),old,target));
        if(value!==row.value)changes.push({table,column,rowid:Number(row._rowid),value});
      }
    }
    // Images remain recoverable from SQLite, while their material cache follows the selected directory.
    if(tables.includes('whiteboard_assets'))for(const row of this.store.db.prepare('SELECT id,content FROM whiteboard_assets').all())this.writeAsset(String(row.id),Buffer.from(row.content as Uint8Array),target);
      for(const change of changes)this.store.db.prepare(`UPDATE "${change.table}" SET ${change.column}=? WHERE rowid=?`).run(change.value,change.rowid);
      this.persist({path:target});
      this.store.db.exec('COMMIT');this.error=null;
    }catch(error){this.store.db.exec('ROLLBACK');throw error;}
    return this.info();
  }
  writeAsset(id:string,content:Buffer,root=this.path){
    if(!/^[a-f0-9]{64}$/.test(id)||hash(content)!==id)throw new Error('素材图片标识或内容校验失败');
    const directory=join(root,'images');mkdirSync(directory,{recursive:true});const path=join(directory,id);
    if(lstatSync(directory).isSymbolicLink())throw new Error('素材图片目录不能为符号链接或目录联接');
    if(existsSync(path)){if(!lstatSync(path).isSymbolicLink()&&lstatSync(path).isFile()&&hash(readFileSync(path))===id)return path;throw new Error('素材图片缓存校验失败，未覆盖已有文件');}
    writeFileSync(path,content,{flag:'wx'});return path;
  }
}
