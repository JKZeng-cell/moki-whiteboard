import {afterEach,describe,expect,it} from 'vitest';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {request as httpRequest} from 'node:http';
import {WhiteboardStore} from '../src/server/store.js';
import {createApp} from '../src/server/app.js';
import {LanSharing,isPrivateAddress} from '../src/server/lan-sharing.js';
import {addElements,pages} from '../src/core/board.js';
const cleanup:Array<()=>Promise<void>>=[];
afterEach(async()=>{while(cleanup.length)await cleanup.pop()!();});
async function setup(){
 const root=await mkdtemp(join(tmpdir(),'moki-lan-test-')),web=join(root,'web');await mkdir(join(web,'assets'),{recursive:true});await mkdir(join(web,'fonts'));await writeFile(join(web,'index.html'),'<div id="root"></div>');await writeFile(join(web,'assets','app.js'),'console.log("viewer")');await writeFile(join(web,'fonts','test.woff2'),'font');
 const store=new WhiteboardStore(join(root,'test.db')),app=await createApp({store,webRoot:web}),sharing=new LanSharing(store,web,{port:0,addresses:()=>[{name:'Wi-Fi',address:'192.168.1.2'}]});
 cleanup.push(async()=>{await sharing.close();await app.close();store.close();await rm(root,{recursive:true,force:true});});
 const board=store.get(),other=store.create('private','test');await sharing.set(true);const state=sharing.create(board.id),token=state.links[0]!.urls[0]!.split('/').at(-1)!,base='http://127.0.0.1:'+state.port;
 return {root,web,store,app,sharing,board,other,token,base};
}
describe('LAN read-only sharing',()=>{
 it('starts enabled for new data without automatically sharing any board, and remembers manual off across restart',async()=>{
  const root=await mkdtemp(join(tmpdir(),'moki-lan-default-')),store=new WhiteboardStore(join(root,'test.db'));
  let sharing=new LanSharing(store,root,{port:0,addresses:()=>[]});cleanup.push(async()=>{await sharing.close();store.close();await rm(root,{recursive:true,force:true});});
  await sharing.restore();expect(sharing.state()).toMatchObject({enabled:true,links:[]});expect(sharing.state().port).toBeGreaterThan(0);
  await sharing.set(false);sharing=new LanSharing(store,root,{port:0,addresses:()=>[]});await sharing.restore();expect(sharing.state()).toMatchObject({enabled:false,port:null,links:[]});
 });
 it.each([{port:null,enabled:true},{port:4323,enabled:false}])('migrates legacy defaults while preserving a previously disabled preference (port=$port)',async({port,enabled})=>{
  const root=await mkdtemp(join(tmpdir(),'moki-lan-legacy-')),store=new WhiteboardStore(join(root,'test.db'));
  store.db.exec('CREATE TABLE lan_sharing_settings (id INTEGER PRIMARY KEY,enabled INTEGER NOT NULL,port INTEGER)');store.db.prepare('INSERT INTO lan_sharing_settings VALUES(1,0,?)').run(port);
  const sharing=new LanSharing(store,root,{port:0,addresses:()=>[]});cleanup.push(async()=>{await sharing.close();store.close();await rm(root,{recursive:true,force:true});});
  await sharing.restore();expect(sharing.state().enabled).toBe(enabled);expect(sharing.state().links).toEqual([]);
 });
 it('allows LAN and loopback addresses while excluding public addresses',()=>{
  for(const address of ['127.0.0.1','::ffff:192.168.1.3','10.1.2.3','172.16.0.1','172.31.255.2','169.254.1.2'])expect(isPrivateAddress(address)).toBe(true);
  for(const address of ['8.8.8.8','172.32.0.1','192.167.1.1','198.18.0.1','999.1.2.3','127.0.0.1.evil.example'])expect(isPrivateAddress(address)).toBe(false);
 });
 it('serves just the shared board and viewer assets, never the owner API or MCP',async()=>{
  const {base,token,board}=await setup();
  const value=await (await fetch(base+'/share-api/'+token+'/board')).json();expect(value.title).toBe(board.title);
  expect((await fetch(base+'/share/'+token)).status).toBe(200);expect((await fetch(base+'/assets/app.js')).status).toBe(200);expect((await fetch(base+'/fonts/test.woff2')).status).toBe(200);
  for(const path of ['/api/config','/api/boards','/mcp','/share-api/not-a-token/board'])expect((await fetch(base+path)).status).toBe(404);
  for(const method of ['POST','PUT','PATCH','DELETE'])expect((await fetch(base+'/share-api/'+token+'/board',{method})).status).toBe(405);
 });
 it('filters local paths, scopes media and file access, and supports media ranges',async()=>{
  const {store,app,board,other,root,base,token}=await setup();
  const upload=async(id:string,text:string)=>{const response=await app.inject({method:'POST',url:'/api/whiteboard/assets?boardId='+id,headers:{'content-type':'application/x-moki-whiteboard-asset','x-moki-asset-mime':'video/mp4','x-moki-asset-name':'video.mp4'},payload:Buffer.from(text)});return response.json();};
  const own=await upload(board.id,'0123456789'),privateAsset=await upload(other.id,'private video');const file=join(root,'notes.txt');await writeFile(file,'shared file');
  store.mutate(board.id,'test','fixture',{},snapshot=>{const parentId=pages(snapshot)[0]!.id;snapshot.document.store['asset:own']={id:'asset:own',typeName:'asset',type:'media',props:{src:own.src,mimeType:'video/mp4',localPath:file}};snapshot.document.store['shape:video']={id:'shape:video',typeName:'shape',type:'media',parentId,props:{assetId:'asset:own',localPath:join(root,'stale.mp4'),name:'portable.mp4',mediaKind:'video'}};snapshot.document.store['shape:file']={id:'shape:file',typeName:'shape',type:'resource',parentId,props:{localPath:file,name:'notes.txt',kind:'file'}};});
  const response=await fetch(base+'/share-api/'+token+'/board'),text=await response.text(),value=JSON.parse(text);
  expect(text).not.toContain(root);expect(text).not.toContain('localPath');expect(value.snapshot.document.store['asset:own'].props.src).toContain('/share-api/'+token+'/asset/');
  expect(value.attachments).toEqual(expect.arrayContaining([expect.objectContaining({id:'shape:video',name:'portable.mp4',pageId:pages(board.snapshot)[0]!.id,kind:'media',mediaKind:'video',mimeType:'video/mp4',previewUrl:value.snapshot.document.store['asset:own'].props.src}),expect.objectContaining({id:'shape:file',kind:'resource',mimeType:'text/plain',previewUrl:'/share-api/'+token+'/file/shape%3Afile?preview=1'})]));
  const asset=await fetch(base+value.snapshot.document.store['asset:own'].props.src,{headers:{range:'bytes=2-5'}});expect(asset.status).toBe(206);expect(await asset.text()).toBe('2345');
  expect((await fetch(base+'/share-api/'+token+'/asset/'+privateAsset.src.split('/').at(-1))).status).toBe(404);
  const download=await fetch(base+'/share-api/'+token+'/file/shape%3Afile');expect(await download.text()).toBe('shared file');expect(download.headers.get('content-disposition')).toContain('attachment');
  const preview=await fetch(base+'/share-api/'+token+'/file/shape%3Afile?preview=1');expect(preview.headers.get('content-type')).toContain('text/plain');expect(preview.headers.get('content-disposition')).toContain('inline');expect(await preview.text()).toBe('shared file');
  const suffix=await fetch(base+value.attachments[0].previewUrl,{headers:{range:'bytes=-3'}});expect(suffix.status).toBe(206);expect(await suffix.text()).toBe('789');
  const invalid=await fetch(base+value.attachments[0].previewUrl,{headers:{range:'bytes=999-'}});expect(invalid.status).toBe(416);expect(invalid.headers.get('content-range')).toBe('bytes */10');
  expect((await fetch(base+'/share-api/'+token+'/file/unknown?path='+encodeURIComponent(file))).status).toBe(404);
 });
 it('streams referenced local videos with MIME, ranges and HEAD without exposing unrelated files',async()=>{
  const {root,store,board,base,token}=await setup();const path=join(root,'clip.mp4');await writeFile(path,'0123456789');
  store.mutate(board.id,'test','fixture',{},snapshot=>{snapshot.document.store['shape:local-video']={id:'shape:local-video',typeName:'shape',type:'resource',parentId:pages(snapshot)[0]!.id,props:{name:'clip.mp4',kind:'file',localPath:path}};});
  const value=await (await fetch(base+'/share-api/'+token+'/board')).json();expect(value.attachments[0]).toMatchObject({kind:'media',mediaKind:'video',mimeType:'video/mp4'});
  const head=await fetch(base+value.attachments[0].previewUrl,{method:'HEAD'});expect(head.headers.get('content-length')).toBe('10');expect(await head.text()).toBe('');
  const response=await fetch(base+value.attachments[0].previewUrl,{headers:{range:'bytes=5-'}});expect(response.status).toBe(206);expect(response.headers.get('content-type')).toContain('video/mp4');expect(response.headers.get('content-range')).toBe('bytes 5-9/10');expect(await response.text()).toBe('56789');
 });
 it('updates shared content live without enabling remote writes',async()=>{
  const {base,token,store,board}=await setup();const before=await (await fetch(base+'/share-api/'+token+'/board')).json();
  store.mutate(board.id,'local','edit',{},snapshot=>{addElements(snapshot,pages(snapshot)[0]!.id,[{kind:'text',text:'latest shared content'}]);});
  const after=await (await fetch(base+'/share-api/'+token+'/board')).json();expect(after.version).toBeGreaterThan(before.version);expect(JSON.stringify(after.snapshot)).toContain('latest shared content');
 });
 it('revokes individual links and invalidates all old links when sharing is disabled',async()=>{
  const {base,token,sharing,board}=await setup();sharing.revoke(board.id);expect((await fetch(base+'/share-api/'+token+'/board')).status).toBe(404);expect((await fetch(base+'/share/'+token)).status).toBe(200);
  const next=sharing.create(board.id).links[0]!.urls[0]!.split('/').at(-1)!;expect(next).not.toBe(token);
  await sharing.set(false);expect(sharing.state()).toMatchObject({enabled:false,port:null,links:[]});
  await expect(fetch(base+'/share-api/'+next+'/board')).rejects.toThrow();await sharing.set(true);expect(sharing.state().links).toEqual([]);
 });
 it('rejects cross-origin and remote management, including forged owner host headers',async()=>{
  const {base,token,app}=await setup();
  expect((await fetch(base+'/share-api/'+token+'/board',{headers:{origin:'https://evil.example'}})).status).toBe(403);
  const forged=await new Promise<number>((resolve,reject)=>{const request=httpRequest(base+'/share-api/'+token+'/board',{headers:{host:'evil.example'}},response=>{response.resume();resolve(response.statusCode!);});request.on('error',reject);request.end();});expect(forged).toBe(403);
  for(const request of [{headers:{origin:'https://evil.example'}},{headers:{host:'192.168.1.2'}},{remoteAddress:'192.168.1.5'},{headers:{host:'127.0.0.1.evil.example',origin:'http://127.0.0.1.evil.example'}}])expect((await app.inject({url:'/api/sharing',...request})).statusCode).toBe(403);
 });
});
