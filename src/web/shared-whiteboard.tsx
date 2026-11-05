import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {Download,Eye,Keyboard,Maximize2,Minimize2,Sun,Moon,X,UsersRound} from 'lucide-react';
import {NativeWhiteboard,createNativeWhiteboardStore,loadNativeSnapshot,exportNativeWhiteboardImage,downloadNativeWhiteboardImage,type NativeWhiteboardEditor} from '../vendor/moki/web/components/native-whiteboard.js';
import {WorkbenchPageHeader} from '../vendor/moki/web/components/workbench-page-header.js';
import {WhiteboardMaterialsPanel,type WhiteboardMaterial} from '../vendor/moki/web/components/whiteboard-materials-panel.js';
import type {WhiteboardSnapshot} from '../core/types.js';
import type {SharedAttachment} from '../shared/lan-sharing-contract.js';
import {SharedMaterialPreview,type SharedMaterial} from './shared-material-preview.js';
import {useTheme} from './use-theme.js';
import {rememberedWhiteboardPage} from '../vendor/moki/web/lib/whiteboard-view-memory.js';
import {installSharedCanvasWheelZoom} from './shared-canvas-wheel.js';
import {createSharedVisitor} from './shared-visitors.js';
import {applySharedGroupView,sharedGroupId} from './shared-view-state.js';
import {buildSharedClipboard,buildSharedImageClipboard,copySharedClipboardFallback,inlineSharedImages,writeSharedClipboardEvent,type SharedClipboard} from './shared-clipboard.js';
import {isNativeShape} from '../vendor/moki/whiteboard/native-whiteboard-model.js';
import {SharedViewToolbar,SharedViewContextMenu,type SharedViewAction} from './shared-view-controls.js';
type SharedBoard={title:string;version:number;snapshot:WhiteboardSnapshot;attachments:SharedAttachment[];onlineCount?:number};
const VIEW_SHORTCUTS=[{label:'选择 / 框选内容',keys:'点击 / 拖动空白处'},{label:'多选内容',keys:'Shift + 点击'},{label:'复制选中内容',keys:'Ctrl / ⌘ + C'},{label:'全选当前页',keys:'Ctrl / ⌘ + A'},{label:'拖动画布',keys:'空格 + 拖动 / 中键'},{label:'缩放画布',keys:'Ctrl / ⌘ + 滚轮'},{label:'适配当前页面',keys:'Ctrl / ⌘ + 0'},{label:'重置视图',keys:'Home'},{label:'画布全屏',keys:'F'},{label:'快捷键提示',keys:'?'},{label:'关闭弹窗 / 退出全屏',keys:'Esc'}];
export function SharedWhiteboard({token}:{token:string}){
 const store=useMemo(()=>createNativeWhiteboardStore(),[]),editor=useRef<NativeWhiteboardEditor|null>(null);
 const [board,setBoard]=useState<SharedBoard>(),[page,setPage]=useState(''),[error,setError]=useState(''),[materials,setMaterials]=useState(false),[query,setQuery]=useState('');
 const [preview,setPreview]=useState<SharedMaterial>(),[shortcuts,setShortcuts]=useState(false),[fullscreen,setFullscreen]=useState(false),[exportError,setExportError]=useState('');
 const {dark,setMode}=useTheme();
 const visitor=useMemo(()=>createSharedVisitor(token),[token]);
 const [online,setOnline]=useState<number>();
 useEffect(()=>{const hide=()=>visitor.leave(),show=()=>visitor.resume();window.addEventListener('pagehide',hide);window.addEventListener('pageshow',show);return()=>{window.removeEventListener('pagehide',hide);window.removeEventListener('pageshow',show);};},[visitor]);
 const canonical=useRef<SharedBoard|undefined>(undefined),groupViews=useRef(new Map<string,boolean>()),imageCache=useRef(new Map<string,string>()),clipboard=useRef<SharedClipboard|undefined>(undefined);
 const [selected,setSelected]=useState<string[]>([]),[pan,setPanState]=useState(false),[menu,setMenu]=useState<{x:number;y:number}>(),[notice,setNotice]=useState(''),[viewRevision,setViewRevision]=useState(0);
 const closeMenu=useCallback(()=>setMenu(undefined),[]);
 const selectionChanged=useCallback((ids:string[])=>setSelected(ids),[]);
 const select=useCallback((ids:string[])=>{editor.current?.selectForViewing(ids);setSelected(editor.current?.getSelectedShapeIds()??[]);},[]);
 const installView=useCallback((value:SharedBoard)=>{
  const snapshot=applySharedGroupView(value.snapshot,groupViews.current);
  const pages=Object.values(snapshot.document.store).filter(record=>record.typeName==='page');
  const preferred=editor.current?.getCurrentPageId()||rememberedWhiteboardPage('share:'+token)||snapshot.session?.currentPageId;
  const active=pages.find(record=>record.id===preferred)?.id??pages[0]?.id??'';
  const camera=(store.snapshot as WhiteboardSnapshot).session?.camera;
  snapshot.session={...snapshot.session,...(camera?{camera:{...camera}}:{}),currentPageId:active};
  const ids=editor.current?.getSelectedShapeIds()??[];
  loadNativeSnapshot(store,snapshot as Parameters<typeof loadNativeSnapshot>[1]);setPage(active);select(ids);setViewRevision(value=>value+1);
 },[store,token,select]);
 const toggleGroup=useCallback((groupId:string,collapsed:boolean)=>{
  const value=canonical.current;if(!value)return;groupViews.current.set(groupId,collapsed);installView(value);
  select(Object.values(store.snapshot.document.store).filter(isNativeShape).filter(shape=>sharedGroupId(shape)===groupId&&(collapsed?shape.type==='group-folder':shape.type!=='group-folder')).map(shape=>shape.id));
 },[installView,select,store]);
 const setPan=(value:boolean)=>{editor.current?.setCurrentTool(value?'hand':'select');setPanState(value);};
 useEffect(()=>{select([]);closeMenu();},[page,select,closeMenu]);
 useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>setNotice(''),4000);return()=>clearTimeout(timer);},[notice]);
 useEffect(()=>{
  clipboard.current=undefined;if(!board||!selected.length)return;
  const snapshot=structuredClone(store.snapshot) as WhiteboardSnapshot;
  const build=()=>buildSharedClipboard(snapshot,selected,board.attachments,location.href,imageCache.current);
  let live=true;const payload=build();clipboard.current=payload;
  void inlineSharedImages(payload,imageCache.current).then(()=>{if(live)clipboard.current=build();});
  return()=>{live=false;};
 },[board,selected,store,viewRevision]);
 useEffect(()=>{const copy=(event:ClipboardEvent)=>{
  if(event.defaultPrevented||document.querySelector('[aria-modal=true]')||event.target instanceof Element&&event.target.closest('input,textarea,select,[contenteditable=true]')||window.getSelection()?.toString())return;
  if(clipboard.current&&writeSharedClipboardEvent(event,clipboard.current))setNotice('已复制选中内容');
 };window.addEventListener('copy',copy);return()=>window.removeEventListener('copy',copy);},[]);
 const copy=()=>{const payload=clipboard.current;if(!payload)return;try{if(!copySharedClipboardFallback(payload))throw new Error();setNotice('已复制选中内容，可粘贴到其他应用或 MOKI 白板');}catch{setExportError('浏览器未允许复制，请使用 Ctrl / ⌘ + C。');}};
 const selectionImage=()=>exportNativeWhiteboardImage(store.snapshot as Parameters<typeof exportNativeWhiteboardImage>[0],{scope:'selection',shapeIds:editor.current?.getSelectedShapeIds()??[],pageId:page,fileName:(board?.title??'共享白板')+'-选中内容',requireImages:true});
 const copyImage=async()=>{try{
  if(navigator.clipboard?.write&&typeof ClipboardItem!=='undefined'){await navigator.clipboard.write([new ClipboardItem({'image/png':selectionImage().then(result=>result.blob)})]);setNotice('已复制选中内容为图片');}
  else {const result=await selectionImage(),data=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=reject;reader.readAsDataURL(result.blob);});if(!copySharedClipboardFallback(buildSharedImageClipboard(data,result.width,result.height)))throw new Error();setNotice('已复制图片，可粘贴到支持富文本的应用；也可下载 PNG');}
 }catch{setExportError('浏览器未允许复制图片，可使用“下载选中内容图片”。');}};
 const downloadSelection=async()=>{try{downloadNativeWhiteboardImage(await selectionImage());}catch(error){setExportError(error instanceof Error?error.message:String(error));}};
 useEffect(()=>installSharedCanvasWheelZoom(document),[]);
 const mount=useMemo(()=>(value:NativeWhiteboardEditor)=>{editor.current=value;setPage(value.getCurrentPageId());},[]);
 useEffect(()=>store.listen(()=>setPage(editor.current?.getCurrentPageId()??'')),[store]);
 useEffect(()=>{let live=true,pending=false,last=0;const load=async()=>{
  if(pending)return;pending=true;try{
   const response=await fetch('/share-api/'+encodeURIComponent(token)+'/board',{cache:'no-store',headers:visitor.headers()});if(!response.ok)throw new Error(response.status===404?'分享已停止或链接已失效。':'暂时无法读取分享，请确认分享者的白板仍在运行。');
   const value=await response.json() as SharedBoard;if(!live)return;setError('');setOnline(typeof value.onlineCount==='number'?value.onlineCount:undefined);if(value.version===last)return;
   canonical.current=value;installView(value);last=value.version;setBoard(value);
  }catch(error){if(live){setError(error instanceof TypeError?'无法连接分享者，请确认共享仍已开启，且设备处于同一局域网。':error instanceof Error?error.message:String(error));setBoard(undefined);clipboard.current=undefined;last=0;}}finally{pending=false;}
 };void load();const timer=setInterval(()=>void load(),2500);return()=>{live=false;clearInterval(timer);};},[store,token,installView,visitor]);
 const currentMaterials=useMemo<SharedMaterial[]>(()=>board?.attachments.filter(item=>item.pageId===page).map(item=>({shapeId:item.id,name:item.name,kind:item.kind,mimeType:item.mimeType,...(item.previewUrl?{previewUrl:item.previewUrl}:{}),...(item.url?{openUrl:item.url}:{}),...(item.mediaKind?{mediaKind:item.mediaKind}:{})}))??[],[board,page]);
 useEffect(()=>{setPreview(current=>current?currentMaterials.find(item=>item.shapeId===current.shapeId):undefined);},[currentMaterials]);
 const filtered=currentMaterials.filter(item=>[item.name,item.kind,item.mediaKind,item.kind==='image'?'图片':item.kind==='media'?item.mediaKind==='audio'?'音频':'视频':item.kind==='link'?'链接 网页':'资料 文件'].some(value=>value?.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())));
 const open=(material:WhiteboardMaterial)=>{if(!material.openUrl)return;try{const url=new URL(material.openUrl,location.href);if(['http:','https:'].includes(url.protocol))window.open(url.href,'_blank','noopener,noreferrer');}catch{}};
 const locate=(id:string)=>{const value=editor.current;if(!value)return;const shape=store.snapshot.document.store[id];if(isNativeShape(shape)&&shape.props.mokiGroupCollapsed){const group=sharedGroupId(shape);if(group)toggleGroup(group,false);}select([id]);value.zoomToSelection();};
 const showPreview=(material:WhiteboardMaterial)=>{const item=currentMaterials.find(item=>item.shapeId===material.shapeId);if(item?.previewUrl)setPreview(item);};
 useEffect(()=>{const key=(event:KeyboardEvent)=>{
  if(event.key==='Escape'){setPreview(undefined);setShortcuts(false);setFullscreen(false);return;}
  if(event.target instanceof Element&&event.target.closest('input,textarea,select,video,audio,[contenteditable=true],[role=menu]'))return;
  if(document.querySelector('[role="dialog"]'))return;
  if((event.ctrlKey||event.metaKey)&&event.key==='0'){event.preventDefault();editor.current?.fitCurrentPage();}
  else if(!event.ctrlKey&&!event.metaKey&&!event.altKey){if(event.key==='?'){event.preventDefault();setShortcuts(value=>!value);}if(event.key.toLowerCase()==='f'){event.preventDefault();setFullscreen(value=>!value);}if(event.key==='Home'){event.preventDefault();editor.current?.resetView();}}
 };window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[]);
 const exportImage=async()=>{setExportError('');try{downloadNativeWhiteboardImage(await exportNativeWhiteboardImage(store.snapshot as Parameters<typeof exportNativeWhiteboardImage>[0],{scope:'canvas',pageId:editor.current?.getCurrentPageId()??page,fileName:board?.title??'共享白板'}));}catch(error){setExportError(error instanceof Error?error.message:String(error));}};
 const shapes=selected.map(id=>editor.current?.getShape(id)).filter(isNativeShape),groupId=shapes.length?sharedGroupId(shapes[0]):undefined;
 const sameGroup=groupId&&shapes.every(shape=>sharedGroupId(shape)===groupId)?groupId:undefined;
 const collapsed=shapes.some(shape=>shape.type==='group-folder');
 const groupToggle=sameGroup?{collapsed,run:()=>toggleGroup(sameGroup,!collapsed)}:undefined;
 const selectedMaterial=selected.length===1?currentMaterials.find(item=>item.shapeId===selected[0]):undefined;
 const contextActions:SharedViewAction[]=[
  ...(selected.length?[{label:'复制选中内容',run:copy,shortcut:'Ctrl / ⌘ + C'},{label:'复制为图片',run:()=>void copyImage()},{label:'下载选中内容图片',run:()=>void downloadSelection()},
   ...(selectedMaterial?.previewUrl?[{label:'预览内容',run:()=>setPreview(selectedMaterial)}]:[]),
   ...(selectedMaterial?.openUrl?[{label:selectedMaterial.kind==='link'?'打开链接':'打开 / 下载附件',run:()=>open(selectedMaterial)}]:[]),
   ...(groupToggle?[{label:collapsed?'展开编组（仅自己）':'收起编组（仅自己）',run:groupToggle.run}]:[]),
   {label:'定位选中内容',run:()=>editor.current?.zoomToSelection()},
   {label:'取消选择',run:()=>select([]),shortcut:'Esc'}]:[]),
  {label:'全选当前页面',run:()=>select([...(editor.current?.getCurrentPageShapeIds()??[])]),shortcut:'Ctrl / ⌘ + A'},
  {label:'适配当前页面',run:()=>editor.current?.fitCurrentPage(),shortcut:'Ctrl / ⌘ + 0'},
  {label:'重置视图',run:()=>editor.current?.resetView(),shortcut:'Home'},
 ];
 const viewButton='grid size-9 place-items-center rounded-xl border border-[#e2e4ed] bg-white/95 text-[#30364d] shadow-sm transition hover:bg-[#f0efff]';
 return <main className="moki-native-page shared-whiteboard-shell"><WorkbenchPageHeader eyebrow="MOKI CANVAS" title={board?.title??'MOKI 白板共享'} description="局域网共享 · 仅供查看" actions={<>{board?<span className="shared-online-badge" title="按浏览器去重；同一浏览器多标签页合并。异常断线最多 75 秒后移出。" aria-label={online===undefined?'在线人数统计中':'当前在线 '+online+' 人'}><UsersRound size={14}/><span>在线 {online??'…'} 人</span></span>:null}<span className="shared-readonly-badge"><Eye size={14}/>只读查看</span><button className="native-app-control" aria-label="切换外观" onClick={()=>setMode(dark?'light':'dark')}>{dark?<Sun size={16}/>:<Moon size={16}/>}</button></>}/>
 {error?<section role="alert" className="shared-unavailable">{error}</section>:board?<div className={'whiteboard-canvas-frame whiteboard-canvas shared-canvas relative min-h-0 flex-1'+(fullscreen?' shared-canvas-fullscreen':'')}><NativeWhiteboard store={store} readOnly viewStateKey={'share:'+token} onMount={mount} onReadonlySelectionChange={selectionChanged} onReadonlyGroupToggle={toggleGroup} onReadonlyContextMenu={setMenu} onReadonlyShapeOpen={id=>{const record=store.snapshot.document.store[id];if(record?.typeName==='shape'&&record.type==='link'){const props=record.props as Record<string,unknown>;open({shapeId:id,name:String(props.title??'链接'),kind:'link',openUrl:String(props.url??'')});return;}const material=currentMaterials.find(item=>item.shapeId===id);if(material?.previewUrl)setPreview(material);else if(material)open(material);}}/>
 <SharedViewToolbar count={selected.length} pan={pan} setPan={setPan} copy={copy} groupToggle={groupToggle} clear={()=>select([])}/>
 {menu?<SharedViewContextMenu point={menu} actions={contextActions} close={closeMenu}/>:null}
 {notice?<p role="status" className="shared-copy-notice">{notice}</p>:null}
 <WhiteboardMaterialsPanel materialPanelOpen={materials} setMaterialPanelOpen={setMaterials} currentMaterials={currentMaterials} filteredMaterials={filtered} materialQuery={query} setMaterialQuery={setQuery} locateMaterial={locate} setPreviewMaterial={showPreview} openMaterial={open} canOpenMaterial={material=>Boolean(material.openUrl)}/>
 <button type="button" data-whiteboard-control-button aria-label={fullscreen?'退出画布全屏':'画布全屏'} title={fullscreen?'退出全屏（Esc）':'画布全屏'} aria-pressed={fullscreen} onClick={()=>setFullscreen(value=>!value)} className={'absolute right-3 top-3 z-30 '+viewButton}>{fullscreen?<Minimize2 size={16}/>:<Maximize2 size={16}/>}</button>
 <button type="button" data-whiteboard-control-button aria-label="导出白板图片" title="导出当前页面为 PNG 图片" onClick={()=>void exportImage()} className={'absolute right-14 top-3 z-30 '+viewButton}><Download size={16}/></button>
 <div className="absolute bottom-3 right-3 z-40"><button type="button" data-whiteboard-control-button aria-label="白板快捷键" title="查看白板快捷键" aria-expanded={shortcuts} onClick={()=>setShortcuts(value=>!value)} className={viewButton}><Keyboard size={16}/></button>{shortcuts?<section aria-label="白板快捷键列表" className="moki-menu-surface absolute bottom-11 right-0 max-h-[min(32rem,calc(100dvh-8rem))] w-72 overflow-y-auto p-3"><div className="mb-2.5"><p className="text-xs font-black text-[#30364d]">白板快捷键</p><p className="mt-0.5 text-[0.625rem] text-[#8b90a1]">只读共享，编辑快捷键不可用</p></div><div className="grid gap-1.5">{VIEW_SHORTCUTS.map(item=><div key={item.label} className="flex items-center justify-between gap-3 rounded-lg bg-[#f6f7fa] px-2.5 py-1.5"><span className="text-[0.6875rem] font-semibold text-[#555c70]">{item.label}</span><kbd className="shrink-0 rounded-md border border-[#dde0e9] bg-white px-1.5 py-0.5 text-[0.625rem] font-bold text-[#4e5570] shadow-sm">{item.keys}</kbd></div>)}</div></section>:null}</div>
 {preview?<SharedMaterialPreview material={preview} close={()=>setPreview(undefined)} open={()=>open(preview)}/>:null}{exportError?<p role="alert" className="shared-export-error">{exportError}<button aria-label="关闭提示" onClick={()=>setExportError('')}><X size={14}/></button></p>:null}
 </div>:<p className="shared-unavailable" role="status">正在读取共享白板…</p>}
 </main>;
}
