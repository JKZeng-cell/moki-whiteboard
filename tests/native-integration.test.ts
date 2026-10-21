import {afterEach,describe,expect,it} from 'vitest';
import {mkdtemp,readFile,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {createApp} from '../src/server/app.js';
import {WhiteboardStore} from '../src/server/store.js';
import {addElements,createPage,inspectSnapshot,normalizeImportedSnapshot,pages} from '../src/core/board.js';
import {createNativeWhiteboardStore,NativeWhiteboardEditor,loadNativeSnapshot} from '../src/vendor/moki/web/components/native-whiteboard.js';
import {unzipSync,strFromU8} from 'fflate';
import {readAgentContext} from '../src/server/agent-context.js';
const cleanups:Array<()=>Promise<void>>=[];
afterEach(async()=>{while(cleanups.length)await cleanups.pop()!();});
async function setup(){const root=await mkdtemp(join(tmpdir(),'moki-whiteboard-test-'));const store=new WhiteboardStore(join(root,'test.db'));const app=await createApp({store,webRoot:join(root,'no-web')});cleanups.push(async()=>{await app.close();store.close();if(!resolve(root).startsWith(resolve(tmpdir())+sep+'moki-whiteboard-test-'))throw new Error('Unsafe cleanup');await rm(root,{recursive:true,force:true});});return {app,store,root};}
describe('native editor integration',()=>{
 it('uses numbered default names in the native editor and API',async()=>{
  const native=createNativeWhiteboardStore();const editor=new NativeWhiteboardEditor(native);
  expect(editor.getPages()[0]!.name).toBe('页面 1');editor.createPage();editor.createPage();
  expect(editor.getPages().map(page=>page.name)).toEqual(['页面 1','页面 2','页面 3']);
  const {app,store}=await setup();const board=store.get();
  const response=await app.inject({method:'POST',url:'/api/boards/'+board.id+'/pages',payload:{}});
  expect(response.statusCode).toBe(201);expect(pages(store.get(board.id).snapshot).map(page=>page.name)).toEqual(['页面 1','页面 2']);
 });
 it('shares current selection and explicit assistance requests without modifying the document',async()=>{
  const {app,store}=await setup();const board=store.get();const selection={source:'whiteboard',label:'选中便签',content:'shape:note',itemCount:1,capturedAt:new Date().toISOString()};
  expect((await app.inject({method:'PUT',url:'/api/boards/'+board.id+'/agent-context',payload:{selection}})).statusCode).toBe(200);
  expect((await app.inject({method:'PUT',url:'/api/boards/'+board.id+'/agent-context',payload:{request:{prompt:'修改选中内容',capturedAt:new Date().toISOString()}}})).statusCode).toBe(200);
  expect(readAgentContext(store,board.id)).toMatchObject({selection,request:{prompt:'修改选中内容'}});expect(store.get(board.id).version).toBe(board.version);
 });
 it('retains native camera and session-only changes in canonical persistence',async()=>{
  const {app,store}=await setup();const board=store.get(),initial=await app.inject({url:'/api/whiteboard?boardId='+board.id});const snapshot=initial.json().snapshot;snapshot.session.camera={x:123,y:456,zoom:1.5};
  const response=await app.inject({method:'POST',url:'/api/whiteboard/snapshots?boardId='+board.id,headers:{'x-moki-base-board-version':String(board.version)},payload:{snapshot,pageId:pages(board.snapshot)[0]!.id}});
  expect(response.statusCode).toBe(201);expect(store.get(board.id).snapshot.session.camera).toEqual({x:123,y:456,zoom:1.5});
 });
 it('serves new build assets after startup, without treating missing assets as SPA pages',async()=>{
  const {store,root}=await setup();const webRoot=join(root,'web');await mkdir(join(webRoot,'assets'),{recursive:true});await writeFile(join(webRoot,'index.html'),'<main>白板</main>');const app=await createApp({store,webRoot});cleanups.push(()=>app.close());await app.ready();
  await writeFile(join(webRoot,'assets','new-build.js'),'console.log("new-build")');
  const asset=await app.inject({url:'/assets/new-build.js'});expect(asset.statusCode).toBe(200);expect(asset.headers['content-type']).toContain('javascript');expect(asset.body).toContain('new-build');
  expect((await app.inject({url:'/assets/missing.js'})).statusCode).toBe(404);expect((await app.inject({url:'/board/test'})).body).toContain('白板');
 });
 it('exports uploaded media and mapped folders with the original portable archive writer',async()=>{
  const {app,store}=await setup();const board=store.get();
  const upload=await app.inject({method:'POST',url:'/api/whiteboard/assets?boardId='+board.id,headers:{'content-type':'application/x-moki-whiteboard-asset','x-moki-asset-mime':'video/mp4','x-moki-asset-name':'demo.mp4'},payload:Buffer.from('native-media')});
  const restored=await app.inject({method:'POST',url:'/api/library/resources/restore',payload:[{shapeId:'shape:folder',name:'资料',kind:'folder',files:[{relativePath:'子目录/demo.txt',base64:Buffer.from('portable-folder').toString('base64')}]}]});
  const snapshot=board.snapshot,pageId=pages(snapshot)[0]!.id;
  snapshot.document.store['asset:video']={id:'asset:video',typeName:'asset',type:'media',props:{src:upload.json().src,name:'demo.mp4',mimeType:'video/mp4'},meta:{}};
  snapshot.document.store['shape:video']={id:'shape:video',typeName:'shape',type:'media',parentId:pageId,index:'a1',x:0,y:0,rotation:0,isLocked:false,opacity:1,props:{assetId:'asset:video',w:320,h:180},meta:{}};
  snapshot.document.store['shape:folder']={id:'shape:folder',typeName:'shape',type:'resource',parentId:pageId,index:'a2',x:400,y:0,rotation:0,isLocked:false,opacity:1,props:{localPath:restored.json()[0].localPath,kind:'local_folder',name:'资料',w:300,h:100},meta:{}};
  store.replaceSnapshot(board.id,snapshot,'test');
  const exported=await app.inject({url:'/api/boards/'+board.id+'/export'});expect(exported.statusCode).toBe(200);
  const archive=unzipSync(exported.rawPayload),manifest=JSON.parse(strFromU8(archive['manifest.json']!));
  expect(manifest.version).toBe(2);expect(manifest.assets).toHaveLength(1);expect(manifest.resources[0]).toMatchObject({shapeId:'shape:folder',kind:'folder'});
  expect(strFromU8(archive[manifest.assets[0].archivePath]!)).toBe('native-media');
  expect(manifest.resources[0].files[0].relativePath).toBe('子目录/demo.txt');expect(strFromU8(archive[manifest.resources[0].files[0].archivePath]!)).toBe('portable-folder');
 });
 it('saves native page snapshots without losing other pages, and retains page history',async()=>{
  const {app,store}=await setup();const board=store.get(),first=pages(board.snapshot)[0]!,second=createPage(board.snapshot,'第二页');addElements(board.snapshot,first.id,[{kind:'note',text:'第一页'}]);addElements(board.snapshot,second.id,[{kind:'text',text:'第二页内容'}]);store.replaceSnapshot(board.id,board.snapshot,'mcp-agent');
  const initial=await app.inject({url:'/api/whiteboard?boardId='+board.id});expect(initial.statusCode).toBe(200);
  const snapshot=initial.json().snapshot;for(const [id,record] of Object.entries(snapshot.document.store))if((record as {parentId?:string}).parentId===second.id||id===second.id)delete snapshot.document.store[id];snapshot.session.currentPageId=first.id;
  const saved=await app.inject({method:'POST',url:'/api/whiteboard/snapshots?boardId='+board.id,headers:{'x-moki-actor':'native-ui:test','x-moki-base-board-version':String(store.get(board.id).version)},payload:{snapshot,pageId:first.id}});expect(saved.statusCode).toBe(201);expect(inspectSnapshot(store.get(board.id).snapshot,second.id).shapeCount).toBe(1);
  const history=await app.inject({url:'/api/whiteboard/versions?boardId='+board.id+'&pageId='+first.id});expect(history.json()[0]).toMatchObject({pageId:first.id,pageVersion:1});const version=history.json()[0].version;const found=await app.inject({url:'/api/whiteboard/versions/'+version+'?boardId='+board.id});expect(found.json().snapshot.document.store[first.id]).toBeDefined();
 });
 it('keeps whiteboards isolated and rejects an old editor snapshot after an Agent write',async()=>{
  const {app,store}=await setup();const a=store.get(),b=store.create('B','test');const response=await app.inject({url:'/api/whiteboard?boardId='+a.id});const baseline=Number(response.headers['x-moki-board-version']);store.mutate(a.id,'mcp-agent','elements.create',{},snapshot=>{addElements(snapshot,pages(snapshot)[0]!.id,[{kind:'note',text:'不能覆盖的 Agent 内容'}]);});
  const stale=await app.inject({method:'POST',url:'/api/whiteboard/snapshots?boardId='+a.id,headers:{'x-moki-base-board-version':String(baseline)},payload:{snapshot:response.json().snapshot,pageId:pages(a.snapshot)[0]!.id}});expect(stale.statusCode).toBe(409);expect(inspectSnapshot(store.get(a.id).snapshot).shapeCount).toBe(1);const isolated=await app.inject({url:'/api/whiteboard?boardId='+b.id});expect(Object.values(isolated.json().snapshot.document.store).filter((record:any)=>record.typeName==='shape')).toHaveLength(0);
  const update=await app.inject({url:'/api/boards/'+a.id+'/updates'});expect(update.json()).toMatchObject({actor:'mcp-agent',version:baseline+1});
 });
 it('persists uploaded media using the original API and serves byte ranges',async()=>{
  const {app,store}=await setup();const bytes=Buffer.from('0123456789');const uploaded=await app.inject({method:'POST',url:'/api/whiteboard/assets?boardId='+store.get().id,headers:{'content-type':'application/x-moki-whiteboard-asset','x-moki-asset-mime':'video/mp4','x-moki-asset-name':'demo.mp4'},payload:bytes});expect(uploaded.statusCode).toBe(201);const response=await app.inject({url:uploaded.json().src,headers:{range:'bytes=2-5'}});expect(response.statusCode).toBe(206);expect(response.body).toBe('2345');expect(response.headers['content-range']).toBe('bytes 2-5/10');
 });
 it('restores portable folders, preserves bytes, and rejects traversal paths',async()=>{
  const {app}=await setup();const result=await app.inject({method:'POST',url:'/api/library/resources/restore',payload:[{shapeId:'shape:test',name:'资料',kind:'folder',files:[{relativePath:'子目录/demo.txt',base64:Buffer.from('MOKI 白板').toString('base64')}]}]});expect(result.statusCode).toBe(200);const restored=result.json()[0];expect(await readFile(join(restored.localPath,'子目录/demo.txt'),'utf8')).toBe('MOKI 白板');const read=await app.inject({method:'POST',url:'/api/library/resources/read',payload:{source:restored.localPath}});expect(read.json().files[0]).toMatchObject({relativePath:'子目录/demo.txt',base64:Buffer.from('MOKI 白板').toString('base64')});const invalid=await app.inject({method:'POST',url:'/api/library/resources/restore',payload:[{shapeId:'shape:bad',name:'bad',kind:'folder',files:[{relativePath:'../escape.txt',base64:'eA=='}]}]});expect(invalid.statusCode).toBeGreaterThanOrEqual(400);
 });
 it('supports text edits and prevents a second save from overwriting a new version',async()=>{
  const {app}=await setup();const upload=await app.inject({method:'POST',url:'/api/library/upload',headers:{'content-type':'application/x-moki-library-file','x-moki-file-name':'demo.txt'},payload:Buffer.from('old')});const id=upload.json().id;const initial=await app.inject({url:'/api/library/items/'+id+'/content'});const save=()=>app.inject({method:'PUT',url:'/api/library/items/'+id+'/content',payload:{content:'new',expectedVersion:initial.json().version}});const results=await Promise.all([save(),save()]);expect(results.map(result=>result.statusCode).sort()).toEqual([200,409]);expect((await app.inject({url:'/api/library/items/'+id+'/content'})).json().content).toBe('new');
 });
 it('uses real native mind map relationships and retains collapsed state after normalization',()=>{
  const store=new WhiteboardStore(':memory:');try{const board=store.get();const ids=addElements(board.snapshot,pages(board.snapshot)[0]!.id,[{kind:'mindmap',text:'主题',branches:['A','B']}]);const native=createNativeWhiteboardStore();loadNativeSnapshot(native,board.snapshot);const editor=new NativeWhiteboardEditor(native);const root=ids[0]!.id;expect(editor.addMindMapChild(root)).toBeTypeOf('string');expect(editor.toggleMindMapBranch(root)).toBe(true);const normalized=normalizeImportedSnapshot(native.snapshot);expect((normalized.document.store[root] as any).props.mokiMindMapCollapsed).toBe(true);expect(inspectSnapshot(normalized).shapeCount).toBe(7);}finally{store.close();}
 });
});
