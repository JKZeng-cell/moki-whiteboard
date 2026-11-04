import {randomUUID} from 'node:crypto';
import {open,readFile,realpath,rename,stat,unlink} from 'node:fs/promises';
import {basename,dirname,join} from 'node:path';
import type {WhiteboardStore} from '../server/store.js';
import {exportBoard} from '../server/portable-export.js';
import {fileContentVersion,FileEditConflict,withFileEdit} from '../vendor/moki/documents/file-edit-guard.js';
import {isWhiteboardPath} from './whiteboard-open.js';
import type {DesktopWhiteboardDocumentInfo,DesktopWhiteboardOpenRequest} from '../vendor/moki/shared/desktop-whiteboard-transfer-contract.js';

type Binding={board_id:string;path:string;path_key:string;file_version:string;saved_board_version:number};
const key=(path:string)=>process.platform==='win32'?path.toLowerCase():path;

/** Only files actually opened by the desktop can be bound as overwrite targets. */
export class WhiteboardDocuments {
 private readonly tickets=new Map<string,{path:string;hash:string;boardId?:string}>();
 private readonly writes=new Map<string,Promise<unknown>>();
 constructor(private readonly store:WhiteboardStore){
  store.db.exec(`CREATE TABLE IF NOT EXISTS whiteboard_documents (
   board_id TEXT PRIMARY KEY,path TEXT NOT NULL,path_key TEXT NOT NULL UNIQUE,
   file_version TEXT NOT NULL,saved_board_version INTEGER NOT NULL)`);
 }
 info(boardId:string):DesktopWhiteboardDocumentInfo|null{
  const row=this.binding(boardId);if(!row)return null;
  return {path:row.path,savedVersion:row.saved_board_version,dirty:this.store.get(boardId).version!==row.saved_board_version};
 }
 private binding(boardId:string){return this.store.db.prepare('SELECT * FROM whiteboard_documents WHERE board_id=?').get(boardId) as Binding|undefined;}
 async read(path:string):Promise<DesktopWhiteboardOpenRequest>{
  if(!isWhiteboardPath(path))throw new Error('请选择 MOKI 白板文件');
  const canonical=await realpath(path),info=await stat(canonical);
  if(!info.isFile())throw new Error('请选择 MOKI 白板文件');
  const bytes=await readFile(canonical),hash=fileContentVersion(bytes);
  let bound=this.store.db.prepare('SELECT * FROM whiteboard_documents WHERE path_key=?').get(key(canonical)) as Binding|undefined;
  let replaceBoardVersion:number|undefined;
  if(bound){
   try{
    const board=this.store.get(bound.board_id);
    if(hash===bound.file_version)return {name:basename(path),boardId:board.id};
    if(board.version!==bound.saved_board_version)return {name:basename(path),boardId:board.id,warning:'原文件已被其他操作修改，已保留本机未写回的编辑。请另存为后再打开原文件。'};
    replaceBoardVersion=board.version;
   }catch(error){if(!(error instanceof Error)||error.name!=='BoardNotFoundError')throw error;this.store.db.prepare('DELETE FROM whiteboard_documents WHERE board_id=?').run(bound.board_id);bound=undefined;}
  }
  const token=randomUUID();
  // Tickets are short-lived capabilities; bound paths are never accepted from HTTP.
  this.tickets.set(token,{path:canonical,hash,...(bound?{boardId:bound.board_id}:{})});
  if(this.tickets.size>100)this.tickets.delete(this.tickets.keys().next().value!);
  return {name:basename(path),bytes,documentToken:token,...(bound&&replaceBoardVersion!==undefined?{replaceBoardId:bound.board_id,replaceBoardVersion}: {})};
 }
 async bind(token:string,boardId:string,expectedVersion:number){
  const ticket=this.tickets.get(token);if(!ticket)throw new Error('文件打开请求已过期，请重新打开');
  if(ticket.boardId&&ticket.boardId!==boardId)throw new Error('文件对应白板不一致');
  const board=this.store.get(boardId);
  if(board.version!==expectedVersion)throw new Error('白板在导入时已更新，未将未写入文件的内容标记为已保存');
  if(fileContentVersion(await readFile(ticket.path))!==ticket.hash)throw new FileEditConflict();
  this.remember(boardId,ticket.path,ticket.hash,board.version);this.tickets.delete(token);
  return this.info(boardId)!;
 }
 private remember(boardId:string,path:string,hash:string,version:number){
  const other=this.store.db.prepare('SELECT board_id FROM whiteboard_documents WHERE path_key=?').get(key(path));
  if(other&&other.board_id!==boardId)throw new Error('此文件已由另一张白板打开，请选择其他文件名');
  this.store.db.prepare('INSERT OR REPLACE INTO whiteboard_documents VALUES (?,?,?,?,?)').run(boardId,path,key(path),hash,version);
 }
 private serial<T>(boardId:string,operation:()=>Promise<T>):Promise<T>{
  const next=(this.writes.get(boardId)??Promise.resolve()).catch(()=>{}).then(operation);
  this.writes.set(boardId,next);void next.finally(()=>{if(this.writes.get(boardId)===next)this.writes.delete(boardId);}).catch(()=>{});
  return next;
 }
 save(boardId:string,onlyIfDirty=false){return this.serial(boardId,async()=>{
  const binding=this.binding(boardId);if(!binding)return null;
  const board=this.store.get(boardId);
  if(onlyIfDirty&&board.version===binding.saved_board_version)return this.info(boardId);
  const localResources=Object.values(board.snapshot.document.store).some(record=>record.typeName==='shape'&&(record.type==='resource'||(record.props as Record<string,unknown>|undefined)?.localPath));
  if(board.version===binding.saved_board_version&&!localResources){
   if(fileContentVersion(await readFile(binding.path))!==binding.file_version)throw new FileEditConflict();
   return this.info(boardId);
  }
  return withFileEdit(binding.path,binding.file_version,async(_original,path)=>{
   const result=await exportBoard(this.store,boardId),bytes=Buffer.from(await result.blob.arrayBuffer());
   await this.replace(path,bytes,binding.file_version);
   this.remember(boardId,path,fileContentVersion(bytes),result.boardVersion);return this.info(boardId);
  });
 });}
 saveAs(boardId:string,destination:string){return this.serial(boardId,async()=>{
  if(!isWhiteboardPath(destination))throw new Error('请使用 .moki 白板文件扩展名');
  let path=join(await realpath(dirname(destination)),basename(destination)),expected:string|undefined;
  try{path=await realpath(destination);expected=fileContentVersion(await readFile(path));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  const other=this.store.db.prepare('SELECT board_id FROM whiteboard_documents WHERE path_key=?').get(key(path));
  if(other&&other.board_id!==boardId)throw new Error('此文件已由另一张白板打开，请选择其他文件名');
  const result=await exportBoard(this.store,boardId),bytes=Buffer.from(await result.blob.arrayBuffer());
  if(expected!==undefined)await withFileEdit(path,expected,async()=>this.replace(path,bytes,expected));
  else {const handle=await open(path,'wx');try{await handle.writeFile(bytes);await handle.sync();}catch(error){await handle.close();await unlink(path).catch(()=>{});throw error;}await handle.close();}
  this.remember(boardId,path,fileContentVersion(bytes),result.boardVersion);return this.info(boardId)!;
 });}
 private async replace(path:string,bytes:Buffer,expected:string){
  const temporary=join(dirname(path),`.${basename(path)}.${randomUUID()}.tmp`);
  try{
   const mode=(await stat(path)).mode;
   if((mode&0o222)===0)throw new Error('原文件为只读文件，请另存为到可写位置');
   const handle=await open(temporary,'wx',mode);try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
   if(fileContentVersion(await readFile(path))!==expected)throw new FileEditConflict();
   await rename(temporary,path);
  }finally{await unlink(temporary).catch(error=>{if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;});}
 }
}
