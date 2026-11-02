import {useCallback,useEffect,useRef,useState} from 'react';
import type {DesktopWhiteboardDocumentInfo} from '../vendor/moki/shared/desktop-whiteboard-transfer-contract.js';

export function useFileDocument(id:string|undefined,checkpoint:()=>Promise<void>){
 const bridge=window.mokiDesktop?.whiteboardFiles;
 const latest=useRef({id,checkpoint});latest.current={id,checkpoint};
 const [info,setInfo]=useState<DesktopWhiteboardDocumentInfo|null>(null);
 const [saving,setSaving]=useState(false),[problem,setProblem]=useState('');
 const flights=useRef(new Map<string|undefined,Promise<void>>());
 useEffect(()=>{
  setInfo(null);setProblem('');setSaving(false);let disposed=false,pending=false;
  const refresh=async()=>{if(!id||!bridge?.documentInfo||pending)return;pending=true;try{const value=await bridge.documentInfo(id);if(!disposed&&!flights.current.has(id))setInfo(value);}catch(error){if(!disposed)setProblem(String(error));}finally{pending=false;}};
  void refresh();const timer=setInterval(()=>void refresh(),900);
  return()=>{disposed=true;clearInterval(timer);};
 },[id,bridge]);
 const save=useCallback((as=false,onlyIfDirty=false):Promise<void>=>{
  const {id:boardId,checkpoint:flush}=latest.current;
  const pending=flights.current.get(boardId);if(pending)return pending;
  const operation=(async()=>{
   setSaving(true);setProblem('');
   try{
    await flush();
    if(boardId){const value=as?await bridge?.saveDocumentAs?.(boardId):await bridge?.saveDocument?.(boardId,onlyIfDirty);if(latest.current.id===boardId&&value!==undefined&&(!as||value!==null))setInfo(value);}
   }catch(error){if(latest.current.id===boardId)setProblem(error instanceof Error?error.message:String(error));throw error;}
   finally{if(latest.current.id===boardId)setSaving(false);}
  })();
  flights.current.set(boardId,operation);void operation.finally(()=>{if(flights.current.get(boardId)===operation)flights.current.delete(boardId);}).catch(()=>{});return operation;
 },[bridge]);
 const status=info?{path:info.path,state:problem?'error' as const:saving?'saving' as const:info.dirty?'pending' as const:'saved' as const,label:problem?'原文件保存失败':saving?'正在写入原文件':info.dirty?'有更改 · 待写入原文件':'已保存到原文件'}:undefined;
 return {save,saveAs:bridge?.saveDocumentAs?()=>save(true):undefined,status};
}
