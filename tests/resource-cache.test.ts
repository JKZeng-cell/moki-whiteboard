import {afterEach,describe,expect,it} from 'vitest';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,parse} from 'node:path';
import {ResourceCache,legacyResourcePath} from '../src/server/resource-cache.js';
import {WhiteboardStore} from '../src/server/store.js';
import {createApp} from '../src/server/app.js';
import {shapes} from '../src/core/board.js';

const runs:Array<{root:string;store:WhiteboardStore}>=[];
function setup(){const root=mkdtempSync(join(tmpdir(),'moki-cache-test-'));const store=new WhiteboardStore(join(root,'profile','whiteboard.db'));runs.push({root,store});const install=join(root,'install');mkdirSync(install);return {root,store,install,cache:new ResourceCache(store,join(install,'whiteboard-materials'),install)};}
afterEach(()=>{for(const {root,store} of runs.splice(0)){store.close();rmSync(root,{recursive:true,force:true});}});
describe('material cache settings',()=>{
 it('migrates default material files and references without deleting old files or changing external mappings',async()=>{
  const {root,store,install,cache}=setup();const old=legacyResourcePath(store);mkdirSync(old,{recursive:true});const file=join(old,'note.txt');writeFileSync(file,'material');
  store.db.exec('CREATE TABLE native_library (id TEXT PRIMARY KEY,item_json TEXT NOT NULL)');
  store.db.prepare('INSERT INTO native_library VALUES (?,?)').run('owned',JSON.stringify({target:file}));const external=join(root,'external.txt');writeFileSync(external,'external');store.db.prepare('INSERT INTO native_library VALUES (?,?)').run('external',JSON.stringify({target:external}));
  const board=store.get();board.snapshot.document.store['shape:file']={id:'shape:file',typeName:'shape',type:'resource',x:0,y:0,parentId:board.snapshot.session.currentPageId,index:'a1',props:{localPath:file}};store.replaceSnapshot(board.id,board.snapshot,'test');
  const result=cache.activate();expect(result.path).toBe(join(install,'whiteboard-materials'));expect(readFileSync(join(result.path,'note.txt'),'utf8')).toBe('material');expect(readFileSync(file,'utf8')).toBe('material');
  expect(shapes(store.get().snapshot).find(shape=>shape.id==='shape:file')?.props.localPath).toBe(join(result.path,'note.txt'));
  expect(JSON.parse(String(store.db.prepare('SELECT item_json FROM native_library WHERE id=?').get('external')?.item_json)).target).toBe(external);
  const app=await createApp({store,resourceCache:cache});try{expect((await app.inject('/api/config')).json().resourceCache.path).toBe(result.path);}finally{await app.close();}
 });
 it('persists pending paths, keeps active writes in the old cache, and applies on next startup',()=>{
  const {root,store,install,cache}=setup();cache.activate();const active=cache.path;writeFileSync(join(active,'saved.txt'),'keep');const target=join(root,'custom-cache');
  expect(cache.schedule(target)).toMatchObject({path:active,pendingPath:target});expect(new ResourceCache(store).path).toBe(active);
  const restarted=new ResourceCache(store,join(install,'whiteboard-materials'),install);expect(restarted.activate()).toMatchObject({path:target,pendingPath:null});expect(readFileSync(join(target,'saved.txt'),'utf8')).toBe('keep');expect(readFileSync(join(active,'saved.txt'),'utf8')).toBe('keep');
  expect(restarted.schedule(null).pendingPath).toBe(join(install,'whiteboard-materials'));expect(restarted.activate().path).toBe(join(install,'whiteboard-materials'));
 });
 it('rejects roots, relative paths, program directories, and nested cache paths',()=>{
  const {cache,install}=setup();cache.activate();for(const path of [parse(install).root,'relative',install,join(install,'resources'),join(install,'locales','cache'),join(cache.path,'nested')])expect(()=>cache.schedule(path)).toThrow();
 });
 it('does not overwrite destination collisions or change the active setting on failed migration',()=>{
  const {cache,root}=setup();cache.activate();const active=cache.path;writeFileSync(join(active,'same.txt'),'original');const target=join(root,'collision');mkdirSync(target);writeFileSync(join(target,'same.txt'),'other');cache.schedule(target);expect(()=>cache.activate()).toThrow('同名文件');expect(cache.info()).toMatchObject({path:active,pendingPath:target});expect(readFileSync(join(active,'same.txt'),'utf8')).toBe('original');expect(readFileSync(join(target,'same.txt'),'utf8')).toBe('other');
 });
 it('caches image uploads in the chosen directory while retaining SQLite recovery bytes and HTTP Range',async()=>{
  const {store,cache}=setup();cache.activate();const app=await createApp({store,resourceCache:cache});
  try{const bytes=Buffer.from('image-media-bytes');const id=createHash('sha256').update(bytes).digest('hex');const response=await app.inject({method:'POST',url:'/api/whiteboard/assets',headers:{'content-type':'application/x-moki-whiteboard-asset','x-moki-asset-mime':'image/png','x-moki-asset-name':'test.png'},payload:bytes});expect(response.statusCode).toBe(201);expect(readFileSync(join(cache.path,'images',id))).toEqual(bytes);expect(Buffer.from(store.db.prepare('SELECT content FROM whiteboard_assets WHERE id=?').get(id)?.content as Uint8Array)).toEqual(bytes);
   const range=await app.inject({url:'/api/whiteboard/assets/'+id,headers:{range:'bytes=0-4'}});expect(range.statusCode).toBe(206);expect(range.rawPayload).toEqual(bytes.subarray(0,5));
  }finally{await app.close();}
 });
});
