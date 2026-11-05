import {randomBytes} from 'node:crypto';
import {networkInterfaces} from 'node:os';
import {isIP} from 'node:net';
import {createReadStream,existsSync} from 'node:fs';
import {lstat,readFile} from 'node:fs/promises';
import {join,resolve,extname} from 'node:path';
import Fastify,{type FastifyInstance,type FastifyRequest,type FastifyReply} from 'fastify';
import fastifyStatic from '@fastify/static';
import {z} from 'zod';
import type {WhiteboardStore} from './store.js';
import type {BoardDocument} from '../core/types.js';
import type {LanSharingState,SharedAttachment} from '../shared/lan-sharing-contract.js';
import {ResourceCache} from './resource-cache.js';

export function isPrivateAddress(raw:string){
 const address=raw.replace(/^::ffff:/u,'');
 if(address==='::1')return true;
 if(isIP(address)!==4)return false;
 const parts=address.split('.').map(Number);
 if(parts.length!==4||parts.some(value=>!Number.isInteger(value)||value<0||value>255))return false;
 return parts[0]===127||parts[0]===10||(parts[0]===192&&parts[1]===168)||(parts[0]===172&&parts[1]!>=16&&parts[1]!<=31)||(parts[0]===169&&parts[1]===254);
}
function localAddress(value:string){return value==='localhost'||value==='::1'||value==='[::1]'||isIP(value)===4&&value.startsWith('127.');}
function hostname(value:string){try{return new URL(value.includes('://')?value:'http://'+value).hostname;}catch{return '';}}
export function lanAddresses(){
 return Object.entries(networkInterfaces()).flatMap(([name,list])=>(list??[]).filter(item=>item.family==='IPv4'&&!item.internal&&isPrivateAddress(item.address)).map(item=>({name,address:item.address}))).sort((a,b)=>Number(/virtual|vethernet|docker|wsl|vmware/iu.test(a.name))-Number(/virtual|vethernet|docker|wsl|vmware/iu.test(b.name))||Number(!a.address.startsWith('192.168.'))-Number(!b.address.startsWith('192.168.')));
}
type LinkRow={token:string;board_id:string;created_at:string};
const denied=()=>Object.assign(new Error('分享链接不存在或已停止共享'),{statusCode:404});
const sourceAssetId=(value:unknown)=>{try{return /^\/api\/whiteboard\/assets\/([^/]+)$/u.exec(new URL(String(value),'http://local').pathname)?.[1];}catch{return;}};
const attachmentMime=(path:string)=>({'.pdf':'application/pdf','.txt':'text/plain','.md':'text/plain','.csv':'text/plain','.json':'text/plain','.log':'text/plain','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.svg':'image/svg+xml','.avif':'image/avif','.mp4':'video/mp4','.m4v':'video/mp4','.webm':'video/webm','.mov':'video/quicktime','.mp3':'audio/mpeg','.m4a':'audio/mp4','.wav':'audio/wav','.ogg':'audio/ogg'}[extname(path).toLowerCase()]??'application/octet-stream');
function byteRange(value:string,size:number){const match=/^bytes=(\d*)-(\d*)$/u.exec(value);if(!match||!size||(!match[1]&&!match[2]))return;const start=match[1]?Number(match[1]):Math.max(0,size-Number(match[2])),end=match[1]&&match[2]?Math.min(Number(match[2]),size-1):size-1;if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>end||start>=size)return;return {start,end};}
async function serveAttachment(request:FastifyRequest,reply:FastifyReply,path:string,name:string){
 const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink())throw denied();
 const mime=attachmentMime(path),preview=(request.query as {preview?:string}).preview==='1'&&mime!=='application/octet-stream';
 reply.type(mime).header('content-security-policy',"sandbox; default-src 'none'; style-src 'unsafe-inline'").header('accept-ranges','bytes').header('content-disposition',`${preview?'inline':'attachment'}; filename*=UTF-8''${encodeURIComponent(name)}`);
 if(request.headers.range){const range=byteRange(request.headers.range,info.size);if(!range)return reply.code(416).header('content-range',`bytes */${info.size}`).send();return reply.code(206).header('content-range',`bytes ${range.start}-${range.end}/${info.size}`).header('content-length',range.end-range.start+1).send(createReadStream(path,range));}
 return reply.header('content-length',info.size).send(createReadStream(path));
}

/** A separate listener exposes only token-scoped reads, never the owner API or MCP. */
export class LanSharing {
 private listener:FastifyInstance|undefined;
 private currentPort:number|null=null;
 private operations:Promise<unknown>=Promise.resolve();
 constructor(private readonly store:WhiteboardStore,private readonly webRoot:string,private readonly options:{port?:number;addresses?:typeof lanAddresses}={}){
  store.db.exec(`CREATE TABLE IF NOT EXISTS lan_sharing_settings (id INTEGER PRIMARY KEY CHECK(id=1),enabled INTEGER NOT NULL,port INTEGER,preference_set INTEGER NOT NULL DEFAULT 0);
   CREATE TABLE IF NOT EXISTS lan_shared_boards (token TEXT PRIMARY KEY,board_id TEXT UNIQUE NOT NULL,created_at TEXT NOT NULL);`);
  if(!store.db.prepare('PRAGMA table_info(lan_sharing_settings)').all().some(column=>column.name==='preference_set')){
   store.db.exec('ALTER TABLE lan_sharing_settings ADD COLUMN preference_set INTEGER NOT NULL DEFAULT 0');
   // Legacy UI users could only turn sharing off after enabling it, which saved a port.
   store.db.exec('UPDATE lan_sharing_settings SET preference_set=1 WHERE port IS NOT NULL OR enabled=1');
  }
  store.db.exec(`INSERT OR IGNORE INTO lan_sharing_settings (id,enabled,port,preference_set) VALUES(1,1,NULL,0);
   UPDATE lan_sharing_settings SET enabled=1 WHERE preference_set=0 AND port IS NULL;`);
 }
 private enabled(){return Boolean(this.store.db.prepare('SELECT enabled FROM lan_sharing_settings WHERE id=1').get()?.enabled);}
 state():LanSharingState{
  const addresses=(this.options.addresses??lanAddresses)();
  const links=(this.store.db.prepare('SELECT s.*,b.title FROM lan_shared_boards s JOIN boards b ON b.id=s.board_id ORDER BY s.created_at DESC').all() as unknown as Array<LinkRow&{title:string}>).map(row=>({boardId:row.board_id,title:row.title,createdAt:row.created_at,urls:this.currentPort&&this.enabled()?addresses.map(item=>`http://${item.address}:${this.currentPort}/share/${row.token}`):[]}));
  return {enabled:this.enabled()&&Boolean(this.listener),port:this.currentPort,addresses,links};
 }
 async restore(){if(this.enabled())try{await this.start();}catch(error){this.store.db.prepare('UPDATE lan_sharing_settings SET enabled=0 WHERE id=1').run();console.error('局域网共享未能启动：',String(error));}}
 set(enabled:boolean):Promise<LanSharingState>{
  const next=this.operations.catch(()=>{}).then(async()=>{
   if(enabled){await this.start();this.store.db.prepare('UPDATE lan_sharing_settings SET enabled=1,port=?,preference_set=1 WHERE id=1').run(this.currentPort);}
   else {this.store.db.prepare('UPDATE lan_sharing_settings SET enabled=0,preference_set=1 WHERE id=1').run();this.store.db.prepare('DELETE FROM lan_shared_boards').run();await this.close();}
   return this.state();
  });this.operations=next;return next;
 }
 create(boardId:string){
  this.store.get(boardId);if(!this.listener||!this.enabled())throw new Error('请先开启局域网共享');
  this.store.db.prepare('INSERT OR IGNORE INTO lan_shared_boards VALUES (?,?,?)').run(randomBytes(24).toString('base64url'),boardId,new Date().toISOString());return this.state();
 }
 revoke(boardId:string){this.store.db.prepare('DELETE FROM lan_shared_boards WHERE board_id=?').run(boardId);return this.state();}
 private board(token:string){
  if(!this.enabled())throw denied();
  const row=this.store.db.prepare('SELECT * FROM lan_shared_boards WHERE token=?').get(token) as LinkRow|undefined;
  if(!row)throw denied();try{return this.store.get(row.board_id);}catch{throw denied();}
 }
 private async start(){
  if(this.listener)return;
  const shared=Fastify({logger:false,bodyLimit:1024,forceCloseConnections:true,requestTimeout:15000});
  shared.setErrorHandler((error,_request,reply)=>reply.code(error instanceof Error&&'statusCode' in error?Number(error.statusCode):404).send({error:'分享链接不可用或内容暂时无法读取'}));
  shared.addHook('onRequest',async(request,reply)=>{
   reply.header('referrer-policy','no-referrer').header('cache-control','no-store').header('x-content-type-options','nosniff').header('content-security-policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: http: https:; media-src 'self' blob: data: http: https:; connect-src 'self'; worker-src 'self' blob:; frame-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
   if(!isPrivateAddress(request.ip)||!isPrivateAddress(hostname(request.headers.host??''))&&hostname(request.headers.host??'')!=='localhost')return reply.code(403).send({error:'仅支持局域网访问'});
   if(request.method!=='GET'&&request.method!=='HEAD')return reply.code(405).send({error:'此链接仅供查看'});
   if(request.headers.origin&&request.headers.origin!==`http://${request.headers.host}`)return reply.code(403).send({error:'无效来源'});
  });
  const assets=join(this.webRoot,'assets');if(existsSync(assets))await shared.register(fastifyStatic,{root:resolve(assets),prefix:'/assets/',index:false,decorateReply:false});
  const fonts=join(this.webRoot,'fonts');if(existsSync(fonts))await shared.register(fastifyStatic,{root:resolve(fonts),prefix:'/fonts/',index:false,decorateReply:false});
  // The public shell can explain revoked links; every data request still validates the token.
  shared.get('/share/:token',async(_request,reply)=>reply.type('text/html').send(await readFile(join(this.webRoot,'index.html'))));
  shared.get('/favicon.ico',async(_request,reply)=>reply.type('image/x-icon').send(await readFile(join(this.webRoot,'favicon.ico'))));
  shared.get('/moki-whiteboard-icon.png',async(_request,reply)=>reply.type('image/png').send(await readFile(join(this.webRoot,'moki-whiteboard-icon.png'))));
  shared.get('/share-api/:token/board',async request=>{
   const token=(request.params as {token:string}).token,board=this.board(token),snapshot=structuredClone(board.snapshot),attachments:SharedAttachment[]=[];
   for(const record of Object.values(snapshot.document.store)){
    const props=('props' in record?record.props:undefined) as Record<string,unknown>|undefined;
    if(!props)continue;
    if(record.typeName==='asset'){
     const id=sourceAssetId(props.src);
     if(id)props.src=`/share-api/${token}/asset/${encodeURIComponent(id)}`;
     else if(typeof props.src==='string'&&!/^(?:data:|https?:\/\/)/iu.test(props.src))props.src='';
    }
   }
   for(const record of Object.values(snapshot.document.store)){
    if(record.typeName!=='shape'||!['image','media','resource','link'].includes(String(record.type)))continue;
    const props=record.props as Record<string,unknown>,asset=snapshot.document.store[String(props.assetId??'')],assetProps=(asset&&'props' in asset?asset.props:{}) as Record<string,unknown>;
    const target=record.type==='resource'||!assetProps.src?this.fileTarget(board,record.id):undefined,fileUrl=`/share-api/${token}/file/${encodeURIComponent(record.id)}`;
    let url=String(assetProps.src??''),mimeType=String(assetProps.mimeType??'application/octet-stream'),kind=String(record.type) as SharedAttachment['kind'];
    if(target){url=fileUrl;mimeType=attachmentMime(target);kind=mimeType.startsWith('image/')?'image':/^(audio|video)\//u.test(mimeType)?'media':'resource';}
    if(record.type==='link'){try{const link=new URL(String(props.url??''));url=['http:','https:'].includes(link.protocol)?link.href:'';}catch{url='';}}
    const previewUrl=target?(mimeType!=='application/octet-stream'?fileUrl+'?preview=1':undefined):kind==='link'?undefined:url||undefined;
    attachments.push({id:record.id,pageId:String(record.parentId??''),name:String(props.name??props.altText??props.title??assetProps.name??'附件'),url,mimeType,kind,...(previewUrl?{previewUrl}:{}),...(kind==='media'?{mediaKind:mimeType.startsWith('audio/')||props.mediaKind==='audio'?'audio' as const:'video' as const}:{})});
   }
   // Do not disclose local filesystem paths, library identifiers or private session data.
   const scrub=(value:unknown):unknown=>Array.isArray(value)?value.map(scrub):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([key])=>!['localPath','target','libraryItemId','sourcePath'].includes(key)).map(([key,item])=>[key,scrub(item)])):value;
   const clean=scrub(snapshot) as typeof snapshot;clean.session={currentPageId:snapshot.session?.currentPageId};
   return {title:board.title,version:board.version,snapshot:clean,attachments};
  });
  shared.get('/share-api/:token/asset/:id',async(request,reply)=>{
   const {token,id}=request.params as {token:string;id:string};const board=this.board(token);
   if(!Object.values(board.snapshot.document.store).some(record=>record.typeName==='asset'&&sourceAssetId((('props' in record?record.props:undefined) as Record<string,unknown>|undefined)?.src)===id))throw denied();
   const row=this.store.db.prepare('SELECT content,mime_type,byte_size FROM whiteboard_assets WHERE id=?').get(id);if(!row)throw denied();
   const bytes=new ResourceCache(this.store).readAsset(id,row.content as Uint8Array,Number(row.byte_size));reply.type(String(row.mime_type)).header('content-security-policy',"sandbox; default-src 'none'").header('accept-ranges','bytes');
   if(request.headers.range){const range=byteRange(request.headers.range,bytes.length);if(!range)return reply.code(416).header('content-range',`bytes */${bytes.length}`).send();return reply.code(206).header('content-range',`bytes ${range.start}-${range.end}/${bytes.length}`).send(bytes.subarray(range.start,range.end+1));}
   return reply.send(bytes);
  });
  shared.get('/share-api/:token/file/:id',async(request,reply)=>{
   const {token,id}=request.params as {token:string;id:string};const board=this.board(token),path=this.fileTarget(board,id);if(!path)throw denied();
   const record=board.snapshot.document.store[id];const props=(record&&'props' in record?record.props:undefined) as Record<string,unknown>|undefined;
   return serveAttachment(request,reply,path,String(props?.name??'白板附件'));
  });
  let port=this.options.port??Number(this.store.db.prepare('SELECT port FROM lan_sharing_settings WHERE id=1').get()?.port??process.env.MOKI_WHITEBOARD_SHARE_PORT??4323);
  try{await shared.listen({host:'0.0.0.0',port});}catch(error){if((error as NodeJS.ErrnoException).code!=='EADDRINUSE'){await shared.close();throw error;}port=0;await shared.listen({host:'0.0.0.0',port});}
  this.listener=shared;this.currentPort=(shared.server.address() as {port:number}).port;
 }
 private fileTarget(board:BoardDocument,shapeId:string):string|undefined{
  const record=board.snapshot.document.store[shapeId];if(record?.typeName!=='shape'||!['resource','image','media'].includes(String(record.type)))return;
  const props=record.props as Record<string,unknown>|undefined;if(!props)return;
  if(typeof props.localPath==='string'&&!['folder','local_folder'].includes(String(props.kind)))return props.localPath;
  if(typeof props.libraryItemId==='string'&&this.store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='native_library'").get()){
   const row=this.store.db.prepare('SELECT item_json FROM native_library WHERE id=?').get(props.libraryItemId);if(!row)return;
   const item=JSON.parse(String(row.item_json));if(item.kind==='local_file'&&typeof item.target==='string')return item.target;
  }
 }
 async close(){const listener=this.listener;this.listener=undefined;this.currentPort=null;if(listener)await listener.close();}
}
export async function registerLanSharing(app:FastifyInstance,store:WhiteboardStore,webRoot:string){
 const sharing=new LanSharing(store,webRoot);await sharing.restore();
 const owner=(request:FastifyRequest)=>{if(!localAddress(request.ip.replace(/^::ffff:/u,''))||!localAddress(hostname(request.headers.host??''))||request.headers.origin&&!localAddress(hostname(request.headers.origin)))throw Object.assign(new Error('仅本机可管理共享设置'),{statusCode:403});};
 app.get('/api/sharing',async request=>{owner(request);return sharing.state();});
 app.put('/api/sharing',async request=>{owner(request);return sharing.set(z.object({enabled:z.boolean()}).parse(request.body).enabled);});
 app.post('/api/sharing/boards/:id',async request=>{owner(request);return sharing.create(z.object({id:z.string().min(1)}).parse(request.params).id);});
 app.delete('/api/sharing/boards/:id',async request=>{owner(request);return sharing.revoke(z.object({id:z.string().min(1)}).parse(request.params).id);});
 app.addHook('onClose',async()=>sharing.close());
 return sharing;
}
