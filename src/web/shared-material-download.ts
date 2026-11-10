import type {SharedAttachment} from '../shared/lan-sharing-contract.js';
import type {WhiteboardSnapshot} from '../core/types.js';
import {sharedSelectionWithContents} from './shared-view-state.js';

export type SharedMaterialDownload={name:string;url:string;remote:boolean};

export function selectedSharedDownloads(snapshot:WhiteboardSnapshot,ids:readonly string[],attachments:readonly SharedAttachment[],token:string,base:string):SharedMaterialDownload[]{
 const selected=new Set(sharedSelectionWithContents(snapshot,ids).map(shape=>shape.id)),origin=new URL(base).origin;
 const prefix='/share-api/'+encodeURIComponent(token)+'/';
 return attachments.flatMap(item=>{
  if(!selected.has(item.id)||item.kind==='link'||!item.url)return [];
  try{
   const url=new URL(item.url,base),remote=url.origin!==origin&&/^https?:$/u.test(url.protocol);
   if(url.origin===origin){
    if(!url.pathname.startsWith(prefix)||!/^(asset|file)\/[^/]+$/u.test(url.pathname.slice(prefix.length)))return [];
    url.searchParams.delete('preview');url.searchParams.set('download','1');
   }else if(!remote&&!/^data:(image|audio|video)\//iu.test(url.href))return [];
   return [{name:(item.name||'白板附件').replace(/[\\/\u0000-\u001f\u007f]/gu,'_'),url:url.href,remote}];
  }catch{return [];}
 });
}

function saveFile(url:string,name:string){
 const anchor=document.createElement('a');anchor.href=url;anchor.download=name;anchor.rel='noopener';
 document.body.append(anchor);anchor.click();anchor.remove();
}

/** Local media goes directly to the browser's downloader, without buffering videos in JS. */
export async function downloadSharedMaterials(files:readonly SharedMaterialDownload[]):Promise<number>{
 let count=0;
 for(const file of files){
  try{
   if(file.remote){
    const response=await fetch(file.url,{mode:'cors',credentials:'omit'});
    if(!response.ok)throw new Error('读取失败');
    const url=URL.createObjectURL(await response.blob());
    try{saveFile(url,file.name);}finally{setTimeout(()=>URL.revokeObjectURL(url),30_000);}
   }else saveFile(file.url,file.name);
   count++;
  }catch{throw new Error(`“${file.name}”下载失败，请确认共享仍有效、素材可访问。${count?`已发起 ${count} 个素材下载。`:''}`);}
 }
 return count;
}
