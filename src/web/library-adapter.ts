import {apiFetch} from '../vendor/moki/web/lib/api-fetch.js';
import type {DesktopWhiteboardTransferResource,DesktopWhiteboardRestoredResource,DesktopWhiteboardReadResourceResult} from '../vendor/moki/shared/desktop-whiteboard-transfer-contract.js';
import type {ResourceLibraryItem} from '../vendor/moki/shared/resource-library-contract.js';
import {RESOURCE_TRANSFER_MIME,resourceTransferParts,readResourceTransfer} from '../shared/resource-transfer-binary.js';
export async function uploadLibraryFile(file:File,parentId?:string){const response=await apiFetch('/api/library/upload',{method:'POST',headers:{'content-type':'application/x-moki-library-file','x-moki-file-name':encodeURIComponent(file.name),...(parentId?{'x-moki-parent-id':parentId}:{})},body:file});const item=await response.json();if(!response.ok)throw new Error(item.error);return item as ResourceLibraryItem;}
export async function importLocalLibrary(folder=false):Promise<ResourceLibraryItem[]>{
 const selected=folder?await window.mokiDesktop?.selectLocalFolder?.():await window.mokiDesktop?.selectLocalFile?.();
 if(selected){const response=await apiFetch('/api/library/items',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({kind:folder?'local_folder':'local_file',name:selected.split(/[\\/]/).pop(),target:selected,tags:[]})});const item=await response.json();if(!response.ok)throw new Error(item.error);return [item as ResourceLibraryItem];}
 if(window.mokiDesktop?.selectLocalFile)return [];
 const input=document.createElement('input');input.type='file';input.multiple=true;if(folder)input.setAttribute('webkitdirectory','');
 const files=await new Promise<File[]>((resolve)=>{input.onchange=()=>resolve(Array.from(input.files??[]));input.oncancel=()=>resolve([]);input.click();});
 const folders=new Map<string,ResourceLibraryItem>(),created:ResourceLibraryItem[]=[],roots:ResourceLibraryItem[]=[];
 for(const file of files){let parentId:string|undefined;const path=folder?file.webkitRelativePath.split('/').slice(0,-1):[];let prefix='';for(const part of path){prefix+='/'+part;if(!folders.has(prefix)){const response=await apiFetch('/api/library/items',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({kind:'folder',name:part,parentId:parentId??null,tags:[]})});const item=await response.json() as ResourceLibraryItem;if(!response.ok)throw new Error((item as unknown as {error:string}).error);folders.set(prefix,item);if(!parentId)roots.push(item);}parentId=folders.get(prefix)?.id;}const item=await uploadLibraryFile(file,parentId);created.push(item);}
 return folder?roots:created;
}
export function installBrowserResourceBridge(){
 if(window.mokiDesktop)return;
 window.mokiDesktop={captureWhiteboardLinkPreview:async()=>null,openExternalUrl:async url=>{window.open(url,'_blank','noopener');return true;},copyText:async text=>{await navigator.clipboard.writeText(text);return true;},whiteboardFiles:{
  hasPending:async()=>false,consume:async()=>null,onPending:()=>()=>{},
  readResource:async input=>{
   const response=await apiFetch('/api/library/resources/read',{method:'POST',headers:{'content-type':'application/json',accept:RESOURCE_TRANSFER_MIME},body:JSON.stringify(input)});
   if(!response.ok)throw new Error((await response.json()).error);
   const result=readResourceTransfer(new Uint8Array(await response.arrayBuffer()))[0];if(!result)throw new Error('附件传输为空');return result as DesktopWhiteboardReadResourceResult;
  },
  restoreResources:async(resources:DesktopWhiteboardTransferResource[])=>{
   const response=await apiFetch('/api/library/resources/restore',{method:'POST',headers:{'content-type':RESOURCE_TRANSFER_MIME},body:new Blob(resourceTransferParts(resources) as Uint8Array<ArrayBuffer>[])});
   const result=await response.json();if(!response.ok)throw new Error(result.error);return result as DesktopWhiteboardRestoredResource[];
  },
 }};
 window.mokiDesktop.openLocalPath=async source=>{
   if(/^https?:\/\//i.test(source)){window.open(source,'_blank','noopener');return true;}
   const response=await apiFetch('/api/library/items');const items=await response.json() as ResourceLibraryItem[];
   const item=items.find(item=>item.target===source);
   if(item?.kind==='local_file'){window.open('/api/library/items/'+encodeURIComponent(item.id)+'/preview','_blank','noopener');return true;}
   const read=await window.mokiDesktop!.whiteboardFiles!.readResource!({source,name:item?.name??'白板附件'});
   if(read.kind!=='file'||!read.files[0])return false;
   const file=read.files[0],blob=new Blob([file.bytes.slice().buffer as ArrayBuffer]),url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=read.name;link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);return true;
 };

}
