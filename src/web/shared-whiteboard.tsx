import {useEffect,useMemo,useRef,useState} from 'react';
import {Download,Eye,Keyboard,Maximize2,Minimize2,Sun,Moon,X} from 'lucide-react';
import {NativeWhiteboard,createNativeWhiteboardStore,loadNativeSnapshot,exportNativeWhiteboardImage,downloadNativeWhiteboardImage,type NativeWhiteboardEditor} from '../vendor/moki/web/components/native-whiteboard.js';
import {WorkbenchPageHeader} from '../vendor/moki/web/components/workbench-page-header.js';
import {WhiteboardMaterialsPanel,type WhiteboardMaterial} from '../vendor/moki/web/components/whiteboard-materials-panel.js';
import type {WhiteboardSnapshot} from '../core/types.js';
import type {SharedAttachment} from '../shared/lan-sharing-contract.js';
import {SharedMaterialPreview,type SharedMaterial} from './shared-material-preview.js';
import {useTheme} from './use-theme.js';
import {rememberedWhiteboardPage} from '../vendor/moki/web/lib/whiteboard-view-memory.js';
import {installSharedCanvasWheelZoom} from './shared-canvas-wheel.js';
type SharedBoard={title:string;version:number;snapshot:WhiteboardSnapshot;attachments:SharedAttachment[]};
const VIEW_SHORTCUTS=[{label:'拖动画布',keys:'拖动空白处'},{label:'缩放画布',keys:'Ctrl / ⌘ + 滚轮'},{label:'适配当前页面',keys:'Ctrl / ⌘ + 0'},{label:'重置视图',keys:'Home'},{label:'画布全屏',keys:'F'},{label:'快捷键提示',keys:'?'},{label:'关闭弹窗 / 退出全屏',keys:'Esc'}];
export function SharedWhiteboard({token}:{token:string}){
 const store=useMemo(()=>createNativeWhiteboardStore(),[]),editor=useRef<NativeWhiteboardEditor|null>(null);
 const [board,setBoard]=useState<SharedBoard>(),[page,setPage]=useState(''),[error,setError]=useState(''),[materials,setMaterials]=useState(false),[query,setQuery]=useState('');
 const [preview,setPreview]=useState<SharedMaterial>(),[shortcuts,setShortcuts]=useState(false),[fullscreen,setFullscreen]=useState(false),[exportError,setExportError]=useState('');
 const {dark,setMode}=useTheme();
 useEffect(()=>installSharedCanvasWheelZoom(document),[]);
 const mount=useMemo(()=>(value:NativeWhiteboardEditor)=>{editor.current=value;setPage(value.getCurrentPageId());},[]);
 useEffect(()=>store.listen(()=>setPage(editor.current?.getCurrentPageId()??'')),[store]);
 useEffect(()=>{let live=true,pending=false,last=0;const load=async()=>{
  if(pending)return;pending=true;try{
   const response=await fetch('/share-api/'+encodeURIComponent(token)+'/board',{cache:'no-store'});if(!response.ok)throw new Error(response.status===404?'分享已停止或链接已失效。':'暂时无法读取分享，请确认分享者的白板仍在运行。');
   const value=await response.json() as SharedBoard;if(!live)return;setError('');if(value.version===last)return;
   const pages=Object.values(value.snapshot.document.store).filter(record=>record.typeName==='page');
   const preferred=editor.current?.getCurrentPageId()||rememberedWhiteboardPage('share:'+token)||value.snapshot.session?.currentPageId;
   const active=pages.find(record=>record.id===preferred)?.id??pages[0]?.id??'';
   value.snapshot.session={...value.snapshot.session,currentPageId:active};setPage(active);
   loadNativeSnapshot(store,value.snapshot as Parameters<typeof loadNativeSnapshot>[1]);last=value.version;setBoard(value);
  }catch(error){if(live){setError(error instanceof TypeError?'无法连接分享者，请确认共享仍已开启，且设备处于同一局域网。':error instanceof Error?error.message:String(error));setBoard(undefined);last=0;}}finally{pending=false;}
 };void load();const timer=setInterval(()=>void load(),2500);return()=>{live=false;clearInterval(timer);};},[store,token]);
 const currentMaterials=useMemo<SharedMaterial[]>(()=>board?.attachments.filter(item=>item.pageId===page).map(item=>({shapeId:item.id,name:item.name,kind:item.kind,mimeType:item.mimeType,...(item.previewUrl?{previewUrl:item.previewUrl}:{}),...(item.url?{openUrl:item.url}:{}),...(item.mediaKind?{mediaKind:item.mediaKind}:{})}))??[],[board,page]);
 useEffect(()=>{setPreview(current=>current?currentMaterials.find(item=>item.shapeId===current.shapeId):undefined);},[currentMaterials]);
 const filtered=currentMaterials.filter(item=>[item.name,item.kind,item.mediaKind,item.kind==='image'?'图片':item.kind==='media'?item.mediaKind==='audio'?'音频':'视频':item.kind==='link'?'链接 网页':'资料 文件'].some(value=>value?.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())));
 const open=(material:WhiteboardMaterial)=>{if(!material.openUrl)return;try{const url=new URL(material.openUrl,location.href);if(['http:','https:'].includes(url.protocol))window.open(url.href,'_blank','noopener,noreferrer');}catch{}};
 const locate=(id:string)=>{const value=editor.current;if(!value)return;value.select(id);value.zoomToSelection();value.select();};
 const showPreview=(material:WhiteboardMaterial)=>{const item=currentMaterials.find(item=>item.shapeId===material.shapeId);if(item?.previewUrl)setPreview(item);};
 useEffect(()=>{const key=(event:KeyboardEvent)=>{
  if(event.key==='Escape'){setPreview(undefined);setShortcuts(false);setFullscreen(false);return;}
  if(event.target instanceof Element&&event.target.closest('input,textarea,select,video,audio,[contenteditable=true]'))return;
  if(document.querySelector('[role="dialog"]'))return;
  if((event.ctrlKey||event.metaKey)&&event.key==='0'){event.preventDefault();editor.current?.fitCurrentPage();}
  else if(!event.ctrlKey&&!event.metaKey&&!event.altKey){if(event.key==='?'){event.preventDefault();setShortcuts(value=>!value);}if(event.key.toLowerCase()==='f'){event.preventDefault();setFullscreen(value=>!value);}if(event.key==='Home'){event.preventDefault();editor.current?.resetView();}}
 };window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[]);
 const exportImage=async()=>{setExportError('');try{downloadNativeWhiteboardImage(await exportNativeWhiteboardImage(store.snapshot as Parameters<typeof exportNativeWhiteboardImage>[0],{scope:'canvas',pageId:editor.current?.getCurrentPageId()??page,fileName:board?.title??'共享白板'}));}catch(error){setExportError(error instanceof Error?error.message:String(error));}};
 const viewButton='grid size-9 place-items-center rounded-xl border border-[#e2e4ed] bg-white/95 text-[#30364d] shadow-sm transition hover:bg-[#f0efff]';
 return <main className="moki-native-page shared-whiteboard-shell"><WorkbenchPageHeader eyebrow="MOKI CANVAS" title={board?.title??'MOKI 白板共享'} description="局域网共享 · 仅供查看" actions={<><span className="shared-readonly-badge"><Eye size={14}/>只读查看</span><button className="native-app-control" aria-label="切换外观" onClick={()=>setMode(dark?'light':'dark')}>{dark?<Sun size={16}/>:<Moon size={16}/>}</button></>}/>
 {error?<section role="alert" className="shared-unavailable">{error}</section>:board?<div className={'whiteboard-canvas-frame whiteboard-canvas shared-canvas relative min-h-0 flex-1'+(fullscreen?' shared-canvas-fullscreen':'')}><NativeWhiteboard store={store} readOnly viewStateKey={'share:'+token} onMount={mount} onReadonlyShapeOpen={id=>{const record=store.snapshot.document.store[id];if(record?.typeName==='shape'&&record.type==='link'){const props=record.props as Record<string,unknown>;open({shapeId:id,name:String(props.title??'链接'),kind:'link',openUrl:String(props.url??'')});return;}const material=currentMaterials.find(item=>item.shapeId===id);if(material?.previewUrl)setPreview(material);else if(material)open(material);}}/>
 <WhiteboardMaterialsPanel materialPanelOpen={materials} setMaterialPanelOpen={setMaterials} currentMaterials={currentMaterials} filteredMaterials={filtered} materialQuery={query} setMaterialQuery={setQuery} locateMaterial={locate} setPreviewMaterial={showPreview} openMaterial={open} canOpenMaterial={material=>Boolean(material.openUrl)}/>
 <button type="button" data-whiteboard-control-button aria-label={fullscreen?'退出画布全屏':'画布全屏'} title={fullscreen?'退出全屏（Esc）':'画布全屏'} aria-pressed={fullscreen} onClick={()=>setFullscreen(value=>!value)} className={'absolute right-3 top-3 z-30 '+viewButton}>{fullscreen?<Minimize2 size={16}/>:<Maximize2 size={16}/>}</button>
 <button type="button" data-whiteboard-control-button aria-label="导出白板图片" title="导出当前页面为 PNG 图片" onClick={()=>void exportImage()} className={'absolute right-14 top-3 z-30 '+viewButton}><Download size={16}/></button>
 <div className="absolute bottom-3 right-3 z-40"><button type="button" data-whiteboard-control-button aria-label="白板快捷键" title="查看白板快捷键" aria-expanded={shortcuts} onClick={()=>setShortcuts(value=>!value)} className={viewButton}><Keyboard size={16}/></button>{shortcuts?<section aria-label="白板快捷键列表" className="moki-menu-surface absolute bottom-11 right-0 max-h-[min(32rem,calc(100dvh-8rem))] w-72 overflow-y-auto p-3"><div className="mb-2.5"><p className="text-xs font-black text-[#30364d]">白板快捷键</p><p className="mt-0.5 text-[0.625rem] text-[#8b90a1]">只读共享，编辑快捷键不可用</p></div><div className="grid gap-1.5">{VIEW_SHORTCUTS.map(item=><div key={item.label} className="flex items-center justify-between gap-3 rounded-lg bg-[#f6f7fa] px-2.5 py-1.5"><span className="text-[0.6875rem] font-semibold text-[#555c70]">{item.label}</span><kbd className="shrink-0 rounded-md border border-[#dde0e9] bg-white px-1.5 py-0.5 text-[0.625rem] font-bold text-[#4e5570] shadow-sm">{item.keys}</kbd></div>)}</div></section>:null}</div>
 {preview?<SharedMaterialPreview material={preview} close={()=>setPreview(undefined)} open={()=>open(preview)}/>:null}{exportError?<p role="alert" className="shared-export-error">{exportError}<button aria-label="关闭提示" onClick={()=>setExportError('')}><X size={14}/></button></p>:null}
 </div>:<p className="shared-unavailable" role="status">正在读取共享白板…</p>}
 </main>;
}
