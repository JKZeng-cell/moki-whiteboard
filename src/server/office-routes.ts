/// <reference path="../vendor/moki/types/dsh-univer-office.d.ts" />
import {randomUUID} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {extname,join} from 'node:path';
import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import type {ResourceLibraryItem} from '../vendor/moki/shared/resource-library-contract.js';
import {ResourceLibraryOfficeContentUpdateSchema} from '../vendor/moki/shared/resource-library-contract.js';
import {EditorDraftStore} from '../vendor/moki/documents/editor-draft-store.js';
import type {UniverOfficeRuntime} from '../vendor/moki/documents/univer-office-runtime.js';

export function registerOfficeRoutes(app:FastifyInstance,root:string,find:(id:string)=>ResourceLibraryItem){
 let runtime:Promise<UniverOfficeRuntime>|undefined;
 const getRuntime=()=>runtime??=(async()=>{const {UniverOfficeRuntime}=await import('../vendor/moki/documents/univer-office-runtime.js');return new UniverOfficeRuntime(join(root,'office-runtime'),{gatewayPort:Number(process.env.MOKI_WHITEBOARD_OFFICE_PORT??9092)});})();
 const file=(id:string)=>{const item=find(id);if(item.kind!=='local_file'||!item.target)throw new Error('只有本地文件支持编辑');return item as ResourceLibraryItem & {target:string};};
 const drafts=new EditorDraftStore(join(root,'text-drafts'));
 app.addHook('onClose',async()=>{if(runtime)await (await runtime).close();});
 app.get('/api/library/items/:id/structured-preview',async(request,reply)=>{const item=file((request.params as {id:string}).id);const bytes=await readFile(item.target);if(bytes.length>32*1024*1024)return reply.code(413).send({error:'预览文件不能超过32MB'});const {parseOfficePreview,parsePdfPreview}=await import('../vendor/moki/documents/workbench-file-preview.js');return extname(item.target)==='.pdf'?parsePdfPreview(bytes):parseOfficePreview(bytes,extname(item.target));});
 app.put('/api/library/items/:id/office-content',async request=>{const item=file((request.params as {id:string}).id);const body=ResourceLibraryOfficeContentUpdateSchema.parse(request.body);const {saveOfficeContentUpdate}=await import('../vendor/moki/documents/workbench-office-editor.js');return {saved:true,...await saveOfficeContentUpdate(item.target,body)};});
 app.get('/api/library/items/:id/draft',async request=>{const item=file((request.params as {id:string}).id);const draft=await drafts.get(item.id);return draft?.sourcePath===item.target?{draft:{content:draft.content.toString('utf8'),version:draft.version,savedAt:draft.savedAt}}:{draft:null};});
 app.put('/api/library/items/:id/draft',async request=>{const item=file((request.params as {id:string}).id);const body=z.object({content:z.string().max(5e6),version:z.string().optional()}).parse(request.body);return drafts.put(item.id,Buffer.from(body.content),{sourcePath:item.target,...(body.version?{version:body.version}:{})});});
 app.delete('/api/library/items/:id/draft',async request=>{const item=file((request.params as {id:string}).id);await drafts.remove(item.id);return {removed:true};});
 app.post('/api/library/items/:id/content/save-as',async(request,reply)=>{const item=file((request.params as {id:string}).id);const body=z.object({content:z.string().max(5e6),destination:z.string().optional()}).parse(request.body);if(!body.destination)return reply.header('content-disposition',`attachment; filename*=UTF-8''${encodeURIComponent(item.name)}`).type('application/octet-stream').send(Buffer.from(body.content));await writeFile(body.destination,body.content,{flag:'wx'});return {saved:true,path:body.destination};});
 app.post('/api/library/items/:id/export',async(request,reply)=>{const item=file((request.params as {id:string}).id);return reply.header('content-disposition',`attachment; filename*=UTF-8''${encodeURIComponent(item.name)}`).type('application/octet-stream').send(await readFile(item.target));});
 app.post('/api/library/items/:id/univer-session',async request=>{const item=file((request.params as {id:string}).id);return {session:await (await getRuntime()).open(item.id,item.target,item.name)};});
 app.post('/api/library/items/:id/univer-session/:sessionId/save',async request=>{const p=request.params as {id:string;sessionId:string};file(p.id);return {saved:true,...await (await getRuntime()).save(p.sessionId,p.id)};});
 app.post('/api/library/items/:id/univer-session/:sessionId/discard',async request=>{const p=request.params as {id:string;sessionId:string};file(p.id);await (await getRuntime()).discard(p.sessionId,p.id);return {discarded:true};});
 app.post('/api/library/items/:id/univer-session/:sessionId/checkpoint',async request=>{const p=request.params as {id:string;sessionId:string};file(p.id);return (await getRuntime()).checkpoint(p.sessionId,p.id);});
 app.post('/api/library/items/:id/univer-session/:sessionId/images',async request=>{const p=request.params as {id:string;sessionId:string};file(p.id);const body=z.object({imageId:z.string(),unitId:z.string().optional(),slideId:z.string().optional(),sheetId:z.string().optional(),left:z.number().optional(),top:z.number().optional(),width:z.number().optional(),height:z.number().optional(),row:z.number().optional(),column:z.number().optional(),startOffset:z.number().optional(),endOffset:z.number().optional(),segmentId:z.string().optional()}).parse(request.body);const image=file(body.imageId);return (await getRuntime()).insertLibraryImage(p.sessionId,p.id,image.target,body as Parameters<UniverOfficeRuntime['insertLibraryImage']>[3]);});
 app.post('/api/library/items/:id/univer-session/:sessionId/save-as',async(request,reply)=>{const p=request.params as {id:string;sessionId:string};const item=file(p.id);const body=z.object({destination:z.string().optional()}).parse(request.body??{});const directory=join(root,'office-downloads');await mkdir(directory,{recursive:true});const destination=body.destination??join(directory,randomUUID()+extname(item.target));const saved=await (await getRuntime()).saveAs(p.sessionId,destination,p.id);if(body.destination)return {saved:true,...saved};return reply.header('content-disposition',`attachment; filename*=UTF-8''${encodeURIComponent(item.name)}`).type('application/octet-stream').send(await readFile(saved.path));});
}
