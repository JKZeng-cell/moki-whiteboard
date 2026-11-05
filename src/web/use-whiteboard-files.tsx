import {useCallback,useEffect,useRef,useState} from 'react';
import {FolderOpen} from 'lucide-react';
import {importWhiteboardTransferFile,isWhiteboardTransferFile} from '../vendor/moki/web/lib/whiteboard-transfer.js';
import {apiFetch} from '../vendor/moki/web/lib/api-fetch.js';
import type {DesktopWhiteboardOpenRequest} from '../vendor/moki/shared/desktop-whiteboard-transfer-contract.js';

type Options={checkpoint:()=>Promise<void>;open:(id:string)=>void|Promise<void>;error:(message:string)=>void};
export function useWhiteboardFiles(options:Options){
 const latest=useRef(options);latest.current=options;
 const input=useRef<HTMLInputElement>(null),queue=useRef(Promise.resolve());
 const [busy,setBusy]=useState(false);
 const enqueue=useRef<((files:Array<File|DesktopWhiteboardOpenRequest>)=>void)>(()=>{});
 enqueue.current=(files:Array<File|DesktopWhiteboardOpenRequest>)=>{
  queue.current=queue.current.then(async()=>{
   setBusy(true);
   try{
    if(files.some(file=>file instanceof File&&!isWhiteboardTransferFile(file)))throw new Error('请选择 MOKI 白板文件（.moki / .moki-board / .moki.json）。');
    for(const file of files){
     try{
      await latest.current.checkpoint();
      const bridge=window.mokiDesktop?.whiteboardFiles;
      const path=file instanceof File?window.mokiDesktop?.getPathForFile?.(file):undefined;
      const request=file instanceof File?(path&&bridge?.readDocument?await bridge.readDocument(path):undefined):file;
      if(request?.error)throw new Error(request.error);
      if(request?.boardId){if(request.warning)latest.current.error(request.warning);await latest.current.open(request.boardId);continue;}
      const source=request?.bytes?new File([Uint8Array.from(request.bytes).buffer],request.name):file instanceof File?file:undefined;
      if(!source)throw new Error('无法读取白板文件');
      const imported=await importWhiteboardTransferFile(source,bridge?.restoreResources?{restoreResources:resources=>bridge.restoreResources!(resources)}:{});
      const title=(imported.boardTitle||file.name.replace(/\.moki(?:-board)?(?:\.json)?$/iu,'').trim()||imported.pageName||'导入白板').slice(0,120);
      const response=await apiFetch(request?.replaceBoardId?'/api/boards/'+encodeURIComponent(request.replaceBoardId)+'/snapshot':'/api/boards',{method:request?.replaceBoardId?'PUT':'POST',headers:{'content-type':'application/json'},body:JSON.stringify(request?.replaceBoardId?{snapshot:imported.snapshot,expectedVersion:request.replaceBoardVersion}:{title,snapshot:imported.snapshot})});
      const body=await response.json();
      if(!response.ok)throw new Error(body.error??'导入失败');
      if(request?.documentToken){if(!bridge?.bindDocument)throw new Error('客户端不支持直接文件编辑');await bridge.bindDocument(request.documentToken,body.id,body.version);}
      await latest.current.open(body.id);
     }catch(error){latest.current.error(`${file.name}：${error instanceof Error?error.message:String(error)}`);}
    }
   }catch(error){latest.current.error(error instanceof Error?error.message:String(error));}
   finally{setBusy(false);}
  });
 };
 useEffect(()=>{
  const drop=(event:DragEvent)=>{
   const files=Array.from(event.dataTransfer?.files??[]);
   if(!files.length)return;
   if(files.some(isWhiteboardTransferFile)){
    event.preventDefault();event.stopImmediatePropagation();enqueue.current(files);
   }else if(!location.pathname.startsWith('/board/')){
    event.preventDefault();event.stopImmediatePropagation();latest.current.error('请拖入 MOKI 白板文件（.moki）。');
   }
  };
  const over=(event:DragEvent)=>{if(Array.from(event.dataTransfer?.types??[]).includes('Files'))event.preventDefault();};
  window.addEventListener('drop',drop,true);window.addEventListener('dragover',over,true);
  const bridge=window.mokiDesktop?.whiteboardFiles;
  let disposed=false,draining=false,requested=false;
  const drain=async()=>{
   if(!bridge||disposed)return;
   if(draining){requested=true;return;}
   draining=true;requested=false;
   try{
    while(!disposed&&await bridge.hasPending()){
     if(disposed)break;
     const request=await bridge.consume();if(!request)break;
     enqueue.current([request]);
    }
   }catch(error){if(!disposed)latest.current.error(`打开白板失败：${String(error)}`);}
   finally{draining=false;if(requested&&!disposed)void drain();}
  };
  const unsubscribe=bridge?.onPending(()=>void drain());void drain();
  return()=>{disposed=true;unsubscribe?.();window.removeEventListener('drop',drop,true);window.removeEventListener('dragover',over,true);};
 },[]);
 const controls=<><button className="native-app-control" title="打开白板文件" aria-label="打开白板文件" disabled={busy} onClick={()=>input.current?.click()}><FolderOpen size={18}/></button><input ref={input} type="file" aria-label="选择白板文件" accept=".moki,.moki-board,.moki.json,.moki-board.json" multiple hidden onChange={event=>{const files=Array.from(event.currentTarget.files??[]);event.currentTarget.value='';if(files.length)enqueue.current(files);}}/></>;
 const waitForIdle=useCallback(()=>queue.current,[]);
 return {controls,busy,waitForIdle};
}
