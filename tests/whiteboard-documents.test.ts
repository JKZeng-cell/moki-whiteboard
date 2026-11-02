import {afterEach,describe,expect,it} from 'vitest';
import {mkdtemp,mkdir,readFile,readdir,realpath,rm,unlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {strFromU8,unzipSync} from 'fflate';
import {WhiteboardStore} from '../src/server/store.js';
import {WhiteboardDocuments} from '../src/desktop/whiteboard-documents.js';
import {exportBoard} from '../src/server/portable-export.js';
import {addElements,createPage,pages} from '../src/core/board.js';
import {createApp} from '../src/server/app.js';

const cleanup:Array<()=>Promise<void>>=[];
afterEach(async()=>{while(cleanup.length)await cleanup.pop()!();});
async function setup(){
 const directory=await mkdtemp(join(tmpdir(),'moki-document-'));
 const store=new WhiteboardStore(join(directory,'test.db'));
 const app=await createApp({store,webRoot:join(directory,'none')});
 cleanup.push(async()=>{await app.close();store.close();await rm(directory,{recursive:true,force:true});});
 const board=store.get();store.mutate(board.id,'test','prepare',{},snapshot=>{addElements(snapshot,pages(snapshot)[0]!.id,[{kind:'note',text:'original'}]);createPage(snapshot,'另一页');});
 const path=join(directory,'我的白板.moki'),original=Buffer.from(await (await exportBoard(store,board.id)).blob.arrayBuffer());
 await writeFile(path,original);
 const documents=new WhiteboardDocuments(store),request=await documents.read(path);
 await documents.bind(request.documentToken!,board.id,store.get(board.id).version);
 const edit=()=>store.mutate(board.id,'mcp-agent','edit',{},snapshot=>{addElements(snapshot,pages(snapshot)[1]!.id,[{kind:'text',text:'latest edit'}]);});
 return {directory,store,app,board,path,original,documents,edit};
}
describe('file-backed whiteboard documents',()=>{
 it('updates the actual archive, all pages and saved version, then reopens the same board',async()=>{
  const {store,board,path,original,documents,edit}=await setup();edit();
  expect(documents.info(board.id)?.dirty).toBe(true);
  const saved=await documents.save(board.id);expect(saved).toMatchObject({path:await realpath(path),dirty:false,savedVersion:store.get(board.id).version});
  const bytes=await readFile(path);expect(bytes.equals(original)).toBe(false);
  const files=unzipSync(bytes),manifest=JSON.parse(strFromU8(files['manifest.json']!));
  expect(manifest.boardTitle).toBe(board.title);
  expect(JSON.stringify(manifest)).toContain('latest edit');expect(JSON.stringify(manifest)).toContain('另一页');
  expect(await documents.read(path)).toEqual({name:'我的白板.moki',boardId:board.id});
  expect(new WhiteboardDocuments(store).info(board.id)).toEqual(saved);
 });
 it('keeps embedded media and mapped folder bytes in the saved file',async()=>{
  const {directory,app,store,board,path,documents}=await setup();
  const folder=join(directory,'资料');await mkdir(folder);await writeFile(join(folder,'keep.txt'),'folder bytes');
  const upload=await app.inject({method:'POST',url:'/api/whiteboard/assets?boardId='+board.id,headers:{'content-type':'application/x-moki-whiteboard-asset','x-moki-asset-mime':'video/mp4','x-moki-asset-name':'video.mp4'},payload:Buffer.from('video bytes')});
  store.mutate(board.id,'test','media',{},snapshot=>{
   const page=pages(snapshot)[0]!.id;
   snapshot.document.store['asset:video']={id:'asset:video',typeName:'asset',type:'media',props:{src:upload.json().src,name:'video.mp4',mimeType:'video/mp4'}};
   snapshot.document.store['shape:video']={id:'shape:video',typeName:'shape',type:'media',parentId:page,index:'a2',x:0,y:0,props:{assetId:'asset:video',w:320,h:180}};
   snapshot.document.store['shape:folder']={id:'shape:folder',typeName:'shape',type:'resource',parentId:page,index:'a3',x:400,y:0,props:{name:'资料',kind:'local_folder',localPath:folder,w:300,h:100}};
  });
  await documents.save(board.id);const files=unzipSync(await readFile(path)),manifest=JSON.parse(strFromU8(files['manifest.json']!));
  expect(strFromU8(files[manifest.assets[0].archivePath]!)).toBe('video bytes');
  expect(strFromU8(files[manifest.resources[0].files[0].archivePath]!)).toBe('folder bytes');
 });
 it('does not rewrite unchanged files and serializes concurrent save requests',async()=>{
  const {documents,board,path,original,edit}=await setup();await documents.save(board.id);expect(await readFile(path)).toEqual(original);
  edit();const result=await Promise.all([documents.save(board.id),documents.save(board.id)]);expect(result[0]).toEqual(result[1]);expect(result[0]?.dirty).toBe(false);
 });
 it('refuses external changes without destroying the original file or the draft',async()=>{
  const {documents,board,path,directory,edit,store}=await setup();edit();await writeFile(path,'external version');
  await expect(documents.save(board.id)).rejects.toThrow('文件已被其他操作修改');
  expect(await readFile(path,'utf8')).toBe('external version');expect(documents.info(board.id)?.dirty).toBe(true);
  expect(JSON.stringify(store.get(board.id).snapshot)).toContain('latest edit');expect((await readdir(directory)).some(name=>name.endsWith('.tmp'))).toBe(false);
 });
 it('keeps unsaved edits when reopening an externally modified source',async()=>{
  const {documents,board,path,edit}=await setup();edit();await writeFile(path,'external');
  expect(await documents.read(path)).toMatchObject({boardId:board.id,warning:expect.stringContaining('保留本机')});
 });
 it('requests a version-checked refresh if the clean source changes on disk',async()=>{
  const {documents,board,path,store}=await setup();await writeFile(path,'new file');
  expect(await documents.save(board.id,true)).toMatchObject({dirty:false});
  expect(await documents.read(path)).toMatchObject({replaceBoardId:board.id,replaceBoardVersion:store.get(board.id).version,documentToken:expect.any(String)});
 });
 it('saves a conflict draft as a separate editable file without overwriting the source',async()=>{
  const {documents,board,path,directory,edit}=await setup();edit();await writeFile(path,'external');const destination=join(directory,'恢复草稿.moki');
  expect(await documents.saveAs(board.id,destination)).toMatchObject({path:join(await realpath(directory),'恢复草稿.moki'),dirty:false});
  expect(await readFile(path,'utf8')).toBe('external');edit();await documents.save(board.id);expect(documents.info(board.id)?.dirty).toBe(false);
 });
 it('does not recreate a deleted source or overwrite a different open document',async()=>{
  const {documents,board,path,edit,store,directory}=await setup();edit();await unlink(path);
  await expect(documents.save(board.id)).rejects.toThrow();
  const destination=join(directory,'another.moki');const other=store.create('Other','test');await documents.saveAs(other.id,destination);const before=await readFile(destination);
  await expect(documents.saveAs(board.id,destination)).rejects.toThrow('另一张白板');expect(await readFile(destination)).toEqual(before);
 });
 it('preserves the source when exporting an unavailable attachment fails',async()=>{
  const {documents,board,path,original,store,directory}=await setup();
  store.mutate(board.id,'test','missing',{},snapshot=>{snapshot.document.store['shape:missing']={id:'shape:missing',typeName:'shape',type:'resource',parentId:pages(snapshot)[0]!.id,props:{name:'missing',localPath:join(directory,'missing.txt'),kind:'file'}};});
  await expect(documents.save(board.id)).rejects.toThrow();expect(await readFile(path)).toEqual(original);expect(documents.info(board.id)?.dirty).toBe(true);
 });
 it('rejects stale import bindings and cannot bind an arbitrary file path',async()=>{
  const {documents,board,path,store,edit}=await setup();const request=await documents.read(path);
  expect(request.documentToken).toBeUndefined();
  await expect(documents.bind(path,board.id,store.get(board.id).version)).rejects.toThrow('过期');
  await writeFile(path,'fresh');const refresh=await documents.read(path),version=store.get(board.id).version;edit();
  await expect(documents.bind(refresh.documentToken!,board.id,version)).rejects.toThrow('导入时已更新');
 });
});
