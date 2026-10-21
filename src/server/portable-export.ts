import {createWhiteboardTransferFile,type WhiteboardPortableResource,type WhiteboardPortableResourceSource} from '../vendor/moki/web/lib/whiteboard-transfer-v2.js';
import {readWhiteboardTransferResource} from '../vendor/moki/desktop/whiteboard-transfer-resources.js';
import type {ResourceLibraryItem} from '../vendor/moki/shared/resource-library-contract.js';
import {shapes} from '../core/board.js';
import type {WhiteboardStore} from './store.js';

/** Use the workbench archive writer, including native assets and mapped folders. */
export async function exportBoard(store:WhiteboardStore,boardId:string){
 const board=store.get(boardId);
 const library:ResourceLibraryItem[]=store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='native_library'").get()?store.db.prepare('SELECT item_json FROM native_library').all().map(row=>JSON.parse(String(row.item_json))):[];
 const byId=new Map(library.map(item=>[item.id,item]));
 const virtualSources=(parentId:string,prefix='',seen=new Set<string>()):WhiteboardPortableResourceSource[]=>{
  if(seen.has(parentId))throw new Error('资料夹循环引用');seen.add(parentId);
  return library.filter(item=>item.parentId===parentId).flatMap(item=>item.target?[{source:item.target,name:item.name,...(prefix||item.kind==='local_folder'?{pathPrefix:[prefix,item.kind==='local_folder'?item.name:''].filter(Boolean).join('/')}:{})}]:item.kind==='folder'?virtualSources(item.id,[prefix,item.name].filter(Boolean).join('/'),new Set(seen)):[]);
 };
 const resources:WhiteboardPortableResource[]=shapes(board.snapshot).flatMap(shape=>{
  const localPath=typeof shape.props.localPath==='string'?shape.props.localPath.trim():'';
  const name=String(shape.props.name??shape.props.altText??'白板资料');
  if(localPath)return [{shapeId:shape.id,name,kind:shape.type==='resource'&&['folder','local_folder'].includes(String(shape.props.kind))?'folder' as const:'file' as const,sources:[{source:localPath,name}]}];
  if(shape.type!=='resource')return [];
  const item=byId.get(String(shape.props.libraryItemId??''));
  if(!item)throw new Error('白板映射资料不存在，无法打包：'+name);
  return [{shapeId:shape.id,name:item.name,kind:['folder','local_folder'].includes(item.kind)?'folder' as const:'file' as const,sources:item.target?[{source:item.target,name:item.name}]:item.kind==='folder'?virtualSources(item.id):[]}];
 });
 const fetcher:typeof fetch=async(input,init)=>{
  const value=String(input),url=new URL(value,'http://127.0.0.1');
  const asset=/^\/api\/whiteboard\/assets\/([^/]+)$/.exec(url.pathname);
  if(asset){const row=store.db.prepare('SELECT mime_type,content FROM whiteboard_assets WHERE id=?').get(decodeURIComponent(asset[1]!));return row?new Response(new Uint8Array(row.content as Uint8Array),{headers:{'content-type':String(row.mime_type)}}):new Response(null,{status:404});}
  if(!/^(?:data:|https?:)/i.test(value))throw new Error('不支持的白板资源地址');
  return fetch(input,init);
 };
 return createWhiteboardTransferFile(board.snapshot,{fileName:board.title,boardTitle:board.title,fetcher,resources,readResource:readWhiteboardTransferResource});
}
