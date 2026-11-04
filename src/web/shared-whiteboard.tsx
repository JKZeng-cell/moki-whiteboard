import {useEffect,useMemo,useRef,useState} from 'react';
import {Eye,FileText,Sun,Moon} from 'lucide-react';
import {NativeWhiteboard,createNativeWhiteboardStore,loadNativeSnapshot,type NativeWhiteboardEditor} from '../vendor/moki/web/components/native-whiteboard.js';
import type {WhiteboardSnapshot} from '../core/types.js';
import {useTheme} from './use-theme.js';
import {rememberedWhiteboardPage} from '../vendor/moki/web/lib/whiteboard-view-memory.js';

type SharedBoard={title:string;version:number;snapshot:WhiteboardSnapshot;attachments:Array<{id:string;name:string;url:string;mimeType:string}>};
export function SharedWhiteboard({token}:{token:string}){
 const store=useMemo(()=>createNativeWhiteboardStore(),[]),editor=useRef<NativeWhiteboardEditor|null>(null),selected=useRef('');
 const [board,setBoard]=useState<SharedBoard>(),[page,setPage]=useState(''),[error,setError]=useState(''),[materials,setMaterials]=useState(false);
 const {dark,setMode}=useTheme();
 const mount=useMemo(()=>(value:NativeWhiteboardEditor)=>{editor.current=value;},[]);
 useEffect(()=>{let live=true,pending=false,last=0;const load=async()=>{
  if(pending)return;pending=true;try{
   const response=await fetch('/share-api/'+encodeURIComponent(token)+'/board',{cache:'no-store'});if(!response.ok)throw new Error(response.status===404?'分享已停止或链接已失效。':'暂时无法读取分享，请确认分享者的白板仍在运行。');
   const value=await response.json() as SharedBoard;if(!live)return;setError('');if(value.version===last)return;
   const pages=Object.values(value.snapshot.document.store).filter(record=>record.typeName==='page');
   const preferred=selected.current||rememberedWhiteboardPage('share:'+token)||value.snapshot.session?.currentPageId;
   const active=pages.find(record=>record.id===preferred)?.id??pages[0]?.id??'';
   value.snapshot.session={...value.snapshot.session,currentPageId:active};selected.current=active;setPage(active);
   loadNativeSnapshot(store,value.snapshot as Parameters<typeof loadNativeSnapshot>[1]);last=value.version;setBoard(value);
  }catch(error){if(live){setError(error instanceof TypeError?'无法连接分享者，请确认共享仍已开启，且设备处于同一局域网。':error instanceof Error?error.message:String(error));setBoard(undefined);last=0;}}finally{pending=false;}
 };void load();const timer=setInterval(()=>void load(),2500);return()=>{live=false;clearInterval(timer);};},[store,token]);
 const pages=board?Object.values(board.snapshot.document.store).filter(record=>record.typeName==='page').sort((a,b)=>String(a.index??'').localeCompare(String(b.index??''))):[];
 return <main className="shared-whiteboard-shell"><header><div><img src="/moki-whiteboard-icon.png" alt=""/><h1>{board?.title??'MOKI 白板共享'}</h1><span><Eye size={14}/>只读查看</span></div><div>{board?<><select aria-label="切换共享页面" value={page} onChange={event=>{const id=event.target.value;selected.current=id;setPage(id);editor.current?.setCurrentPage(id);}}>{pages.map(item=><option value={item.id} key={item.id}>{String(('name' in item?item.name:undefined)??'页面')}</option>)}</select><button className="native-app-control" aria-label="查看共享素材" onClick={()=>setMaterials(value=>!value)}><FileText size={16}/></button></>:null}<button className="native-app-control" aria-label="切换外观" onClick={()=>setMode(dark?'light':'dark')}>{dark?<Sun size={16}/>:<Moon size={16}/>}</button></div></header>
 {error?<section role="alert" className="shared-unavailable">{error}</section>:board?<div className="shared-whiteboard-body"><div className="shared-canvas"><NativeWhiteboard store={store} readOnly viewStateKey={'share:'+token} onMount={mount}/></div>{materials?<aside className="shared-materials"><h2>共享素材</h2>{board.attachments.map(item=><article key={item.id}>{item.mimeType.startsWith('video/')?<video src={item.url} controls preload="metadata"/>:item.mimeType.startsWith('audio/')?<audio src={item.url} controls preload="metadata"/>:null}<a href={item.url} rel="noreferrer" target="_blank">{item.name}</a></article>)}{!board.attachments.length?<p>该白板没有可单独打开的附件。</p>:null}</aside>:null}</div>:<p className="shared-unavailable" role="status">正在读取共享白板…</p>}
 </main>;
}
