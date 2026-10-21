import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,lstat,readdir} from 'node:fs/promises';
import {basename,dirname,extname,join,resolve} from 'node:path';
import type {FastifyInstance,FastifyRequest} from 'fastify';
import {z} from 'zod';
import {ResourceLibraryCreateSchema,WhiteboardFolderExportSchema,type ResourceLibraryItem} from '../vendor/moki/shared/resource-library-contract.js';
import {readWhiteboardTransferResource,restoreWhiteboardTransferResources} from '../vendor/moki/desktop/whiteboard-transfer-resources.js';
import type {WhiteboardStore} from './store.js';
import {shapes} from '../core/board.js';
import {registerOfficeRoutes} from './office-routes.js';
import {createWhiteboardFolderWriter} from './folder-export.js';
import {legacyResourcePath,type ResourceCache} from './resource-cache.js';

export function registerLibraryRoutes(app:FastifyInstance,store:WhiteboardStore,cache?:ResourceCache){
 const root=cache?.path??legacyResourcePath(store);
 store.db.exec('CREATE TABLE IF NOT EXISTS native_library (id TEXT PRIMARY KEY, item_json TEXT NOT NULL)');
 const list=()=>store.db.prepare('SELECT item_json FROM native_library').all().map(row=>JSON.parse(String(row.item_json)) as ResourceLibraryItem);
 const find=(id:string)=>{const item=list().find(item=>item.id===id);if(!item)throw new Error('资料不存在');return item;};
 const persist=(item:ResourceLibraryItem)=>{store.db.prepare('INSERT OR REPLACE INTO native_library VALUES (?,?)').run(item.id,JSON.stringify(item));return item;};
 registerOfficeRoutes(app,root,find);
 const writeFolder=createWhiteboardFolderWriter({repository:{find:id=>list().find(item=>item.id===id),list},findWhiteboardAsset:id=>{const row=store.db.prepare('SELECT file_name,mime_type,content FROM whiteboard_assets WHERE id=?').get(id);return row?{fileName:String(row.file_name),mimeType:String(row.mime_type),content:Buffer.from(row.content as Uint8Array)}:undefined;}});
 const allowed=(path:string)=>list().some(item=>item.target===path)||store.list().some(board=>shapes(store.get(board.id).snapshot).some(shape=>shape.props.localPath===path));
 async function add(input:z.infer<typeof ResourceLibraryCreateSchema>,parentId:string|null=null,depth=0):Promise<ResourceLibraryItem>{
  if(depth>16||list().length>20000)throw new Error('资料层级或数量超过限制');
  const now=new Date().toISOString();
  const item=persist({id:randomUUID(),parentId:input.parentId??parentId,kind:input.kind,name:input.name,target:input.target??null,tags:input.tags,createdAt:now,updatedAt:now});
  if(input.kind==='local_folder'&&input.target){for(const entry of await readdir(input.target,{withFileTypes:true})){if(entry.isSymbolicLink())continue;await add({kind:entry.isDirectory()?'local_folder':'local_file',name:entry.name,target:join(input.target,entry.name),tags:[]},item.id,depth+1);}}
  return item;
 }
 app.post('/api/library/whiteboard-folders/export',async(request)=>{const input=WhiteboardFolderExportSchema.parse(request.body);const name=input.name.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/[. ]+$/g,'').trim()||'白板资料夹';const parent=input.parentId?find(input.parentId):undefined;const directory=input.mode==='local'?input.destination!:parent?.kind==='local_folder'&&parent.target?parent.target:join(root,'whiteboard-folders');await mkdir(directory,{recursive:true});const path=join(directory,name);const result=await writeFolder(path,input);if(input.mode==='local')return {saved:true,path,...result};const item=await add({kind:'local_folder',name,target:path,tags:[],...(input.parentId?{parentId:input.parentId}:{})});return {saved:true,path,...result,item};});
 app.get('/api/library/items',async()=>list());
 app.get('/api/library/items/:id',async request=>find((request.params as {id:string}).id));
 app.post('/api/library/items',async(request,reply)=>reply.code(201).send(await add(ResourceLibraryCreateSchema.parse(request.body))));
 app.addContentTypeParser('application/x-moki-library-file',{parseAs:'buffer'},(_request,body,done)=>done(null,body));
 app.post('/api/library/upload',{bodyLimit:200*1024*1024},async(request,reply)=>{
  const name=decodeURIComponent(String(request.headers['x-moki-file-name']??'附件')).replace(/[\\/:*?"<>|\x00-\x1f]/g,'-').slice(0,240);
  if(!Buffer.isBuffer(request.body))throw new Error('文件内容无效');
  const directory=join(root,randomUUID());await mkdir(directory,{recursive:true});const target=join(directory,name);await writeFile(target,request.body);
  const parentId=typeof request.headers['x-moki-parent-id']==='string'?request.headers['x-moki-parent-id']:undefined;if(parentId&&!['folder','local_folder'].includes(find(parentId).kind))throw new Error('父级不是文件夹');
  return reply.code(201).send(await add({kind:'local_file',name,target,tags:[],...(parentId?{parentId}:{})}));
 });
 const mime=(name:string)=>({'.pdf':'application/pdf','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.svg':'image/svg+xml','.webp':'image/webp','.mp4':'video/mp4','.mp3':'audio/mpeg','.pptx':'application/vnd.openxmlformats-officedocument.presentationml.presentation','.html':'text/html','.txt':'text/plain','.md':'text/plain'}[extname(name).toLowerCase()]??'application/octet-stream');
 app.get('/api/library/items/:id/attachment',async(request,reply)=>{const item=find((request.params as {id:string}).id);if(item.kind!=='local_file'||!item.target)throw new Error('当前资料不是文件');return reply.type(mime(item.name)).header('content-disposition',`attachment; filename*=UTF-8''${encodeURIComponent(item.name)}`).send(await readFile(item.target));});
 app.post('/api/settings/deepseek-ocr/verify',async()=>({state:'disabled',message:'独立白板尚未配置 DeepSeek OCR 服务；PDF 原生预览及文字提取仍可使用。',maxPages:100}));
 app.get('/api/library/items/:id/preview',async(request,reply)=>{const item=find((request.params as {id:string}).id);if(item.kind!=='local_file'||!item.target)throw new Error('当前资料不是文件');return reply.type(mime(item.name)).header('content-security-policy',"sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'").send(await readFile(item.target));});
 app.get('/api/library/items/:id/content',async request=>{const item=find((request.params as {id:string}).id);if(!item.target||item.kind!=='local_file')throw new Error('当前资料不是文件');const bytes=await readFile(item.target);if(bytes.length>5e6)throw new Error('文本超过5MB');return {content:bytes.toString('utf8'),extension:extname(item.name).slice(1),size:bytes.length,updatedAt:item.updatedAt,version:createHash('sha256').update(bytes).digest('hex')};});
 app.put('/api/library/items/:id/content',async(request)=>{const item=find((request.params as {id:string}).id);if(!item.target||item.kind!=='local_file')throw new Error('当前资料不是文件');const body=z.object({content:z.string().max(5e6),expectedVersion:z.string().optional()}).parse(request.body);const {withFileEdit}=await import('../vendor/moki/documents/file-edit-guard.js');const {replaceFileAtomically}=await import('../vendor/moki/documents/workbench-office-editor.js');return withFileEdit(item.target,body.expectedVersion,async(_original,canonical)=>{await replaceFileAtomically(canonical,Buffer.from(body.content));item.updatedAt=new Date().toISOString();persist(item);return {saved:true,size:Buffer.byteLength(body.content),updatedAt:item.updatedAt,version:createHash('sha256').update(body.content).digest('hex')};});});
 app.post('/api/library/resources/read',async request=>{const body=z.object({source:z.string(),name:z.string().optional()}).parse(request.body);if(!allowed(body.source))throw new Error('只能读取已映射到白板或资料库的资源');const result=await readWhiteboardTransferResource({source:body.source,...(body.name?{name:body.name}:{})});return {...result,files:result.files.map(file=>({relativePath:file.relativePath,base64:Buffer.from(file.bytes).toString('base64')}))};});
 app.post('/api/library/resources/restore',{bodyLimit:360*1024*1024},async request=>{const body=z.array(z.object({shapeId:z.string(),name:z.string(),kind:z.enum(['file','folder']),files:z.array(z.object({relativePath:z.string(),base64:z.string()}))})).max(2000).parse(request.body);const restored=await restoreWhiteboardTransferResources(root,body.map(resource=>({...resource,files:resource.files.map(file=>({relativePath:file.relativePath,bytes:Buffer.from(file.base64,'base64')}))})));for(const item of restored)await add({kind:item.kind==='folder'?'local_folder':'local_file',name:item.name,target:item.localPath,tags:[]});return restored;});
}
