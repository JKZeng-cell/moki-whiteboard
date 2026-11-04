import {useCallback,useEffect,useRef,useState} from 'react';
import {useTheme} from './use-theme.js';
import {useWhiteboardFiles} from './use-whiteboard-files.js';
import {useFileDocument} from './use-file-document.js';
import {BoardManager,type BoardSummary} from './board-manager.js';
import {captureThumbnail} from './thumbnail-capture.js';
import {Settings,X} from 'lucide-react';
import {McpConnectionPanel} from './mcp-connection-panel.js';
import type {McpConnectionInfo} from './mcp-connection.js';
import {SettingsDialog,type SettingsTab} from './settings-dialog.js';
import {WhiteboardPage} from '../vendor/moki/web/pages/whiteboard-page.js';
import {NativeControlsContext} from './native-context.js';
import {dispatchWorkbenchDataUpdated} from '../vendor/moki/web/lib/workbench-events.js';
import {getNativeClientActor} from '../vendor/moki/web/lib/api-fetch.js';
import {WORKBENCH_SELECTION_EVENT,MOKI_ASSISTANT_COMPOSE_EVENT,MOKI_ASSISTANT_EDITOR_EXIT_EVENT,readWorkbenchSelectionContext,type MokiAssistantComposeRequest} from '../vendor/moki/web/lib/workbench-selection-context.js';
declare global {interface Window {mokiBeforeQuit?:()=>Promise<void>;}}
function route(){const m=location.pathname.match(/^\/board\/([^/]+)/);return m?.[1]?decodeURIComponent(m[1]):undefined;}
async function api<T>(path:string,init?:RequestInit):Promise<T>{const r=await fetch(path,{...init,headers:{'content-type':'application/json',...init?.headers}});if(r.status===204)return undefined as T;const b=await r.json();if(!r.ok)throw new Error(b.error??'请求失败');return b as T;}
export function App(){
 const [id,setId]=useState(route),[items,setItems]=useState<BoardSummary[]>([]),[error,setError]=useState(''),[settings,setSettings]=useState(false);
 const [openRevision,setOpenRevision]=useState(0);
 const [connection,setConnection]=useState<McpConnectionInfo>();
 const [http,setHttp]=useState(false);
 const [settingsTab,setSettingsTab]=useState<SettingsTab>('general');
 const setMcp=(open:boolean)=>{setSettings(open);if(open)setSettingsTab('mcp');};
 const {mode:themeMode,setMode:setThemeMode,dark}=useTheme();
 const [agentTask,setAgentTask]=useState('');
 const [syncError,setSyncError]=useState('');
 useEffect(()=>{if(!id)return;const publish=(body:unknown)=>void api('/api/boards/'+id+'/agent-context',{method:'PUT',body:JSON.stringify(body)}).catch(e=>setError(String(e)));const selection=()=>{const selected=readWorkbenchSelectionContext();publish({selection:selected?{...selected,label:selected.label.slice(0,1000),content:selected.content.slice(0,200000)}:null});};const compose=(event:Event)=>{const request=(event as CustomEvent<MokiAssistantComposeRequest>).detail;selection();publish({request:{prompt:request.prompt,capturedAt:request.capturedAt}});setAgentTask(`白板 ID：${id}\n请先通过 whiteboard_inspect 读取 agentContext，确认当前选区和编辑请求。\n\n${request.prompt}`);setMcp(true);};const close=()=>{setAgentTask('');setMcp(false);publish({request:null});};addEventListener(WORKBENCH_SELECTION_EVENT,selection);addEventListener(MOKI_ASSISTANT_COMPOSE_EVENT,compose);addEventListener(MOKI_ASSISTANT_EDITOR_EXIT_EVENT,close);return()=>{removeEventListener(WORKBENCH_SELECTION_EVENT,selection);removeEventListener(MOKI_ASSISTANT_COMPOSE_EVENT,compose);removeEventListener(MOKI_ASSISTANT_EDITOR_EXIT_EVENT,close);};},[id]);
 const checkpoint=useRef<(()=>Promise<void>)|undefined>(undefined),version=useRef<number|undefined>(undefined);
 const flushLocal=useCallback(async()=>{document.querySelector<HTMLElement>('[data-whiteboard-inline-text-editor]')?.blur();if(id&&!checkpoint.current)throw new Error('白板正在加载，请稍后保存');await checkpoint.current?.();},[id]);
 const fileDocument=useFileDocument(id,flushLocal);
 const refresh=useCallback(async()=>{try{setItems((await api<{items:BoardSummary[]}>('/api/boards')).items);}catch(e){setError(String(e));}},[]);
 const navigate=(next?:string)=>{history.pushState({},'',next?'/board/'+encodeURIComponent(next):'/');version.current=undefined;checkpoint.current=undefined;setOpenRevision(value=>value+1);setId(next);void refresh();};
 const whiteboardFiles=useWhiteboardFiles({checkpoint:()=>fileDocument.save(false,true),open:next=>{setSettings(false);navigate(next);},error:setError});
 useEffect(()=>{if(id)return;const focus=()=>void refresh();const timer=setInterval(focus,3000);addEventListener('focus',focus);return()=>{clearInterval(timer);removeEventListener('focus',focus);};},[id,refresh]);
 useEffect(()=>{const pop=()=>{version.current=undefined;setId(route());void refresh();};addEventListener('popstate',pop);void refresh();void api<McpConnectionInfo>('/api/config').then(setConnection).catch(e=>setError(String(e)));return()=>removeEventListener('popstate',pop);},[refresh]);
 useEffect(()=>{if(!window.mokiDesktop?.desktopSettings)return;const flush=async()=>{await fileDocument.save(false,true);if(id)await captureThumbnail(id).catch(()=>{});};window.mokiBeforeQuit=flush;return()=>{if(window.mokiBeforeQuit===flush)delete window.mokiBeforeQuit;};},[id,fileDocument.save]);
 useEffect(()=>{if(!id)return;const key=(event:KeyboardEvent)=>{if((event.ctrlKey||event.metaKey)&&!event.altKey&&event.key.toLowerCase()==='s'){event.preventDefault();event.stopImmediatePropagation();if(!event.repeat)void fileDocument.save().catch(error=>setError(String(error)));}};window.addEventListener('keydown',key,true);return()=>window.removeEventListener('keydown',key,true);},[id,fileDocument.save]);
 useEffect(()=>{if(!id)return;let pending=false,disposed=false,failures=0;setSyncError('');const poll=async()=>{if(pending)return;pending=true;try{const b=await api<{version:number;actor:string;actionId:string;detail?:{ids?:string[];changedShapeIds?:string[]}}>('/api/boards/'+id+'/updates');if(disposed)return;failures=0;setSyncError('');const previous=version.current;version.current=b.version;if(previous!==undefined&&b.version!==previous&&b.actor!==getNativeClientActor())dispatchWorkbenchDataUpdated({resource:'whiteboard',operation:'updated',actionId:b.actionId,changedShapeIds:b.detail?.changedShapeIds??b.detail?.ids??[]});}catch(e){if(!disposed&&++failures>=3)setSyncError('Agent 同步连接中断，正在重试：'+String(e));}finally{pending=false;}};void poll();const timer=setInterval(()=>void poll(),900);return()=>{disposed=true;clearInterval(timer);};},[id]);
 useEffect(()=>{if(!id)return;let last:number|undefined,pending=false,disposed=false;const timer=setInterval(()=>{if(pending||version.current===undefined||version.current===last)return;const observed=version.current;pending=true;void captureThumbnail(id).then(saved=>{if(saved&&!disposed)last=observed;}).catch(e=>{if(!disposed)setError(String(e));}).finally(()=>{pending=false;});},1300);return()=>{disposed=true;clearInterval(timer);};},[id,dark]);
 const back=async()=>{try{await fileDocument.save(false,true);}catch(e){setError('保存失败，尚未离开白板：'+String(e));return;}try{if(id)await captureThumbnail(id);}catch(e){setError('白板内容已保存，截图将在下次打开时重试：'+String(e));}navigate();};
 return <>
 {id?<NativeControlsContext.Provider value={{back:()=>void back(),settings:()=>{setSettingsTab('general');setSettings(true);}}}><WhiteboardPage key={`${id}:${openRevision}`} boardTitle={items.find(item=>item.id===id)?.title ?? '白板名称加载中…'} onSave={()=>fileDocument.save()} onSaveAs={fileDocument.saveAs} fileStatus={fileDocument.status} onCheckpointReady={value=>{checkpoint.current=value;}}/></NativeControlsContext.Provider>:
 <BoardManager items={items} open={next=>navigate(next)} refresh={refresh} controls={<>{whiteboardFiles.controls}<button className="native-app-control" aria-label="设置" title="设置" onClick={()=>{setSettingsTab('general');setSettings(true);}}><Settings size={18}/></button></>}/>}
 {whiteboardFiles.busy?<div className="whiteboard-file-progress" role="status">正在打开白板文件…</div>:null}
 {error||syncError?<div className="native-app-error" role="alert">{error||syncError}<button aria-label="关闭错误" onClick={()=>{setError('');setSyncError('');}}><X size={15}/></button></div>:null}
 {settings?<SettingsDialog currentBoardId={id} version={connection?.appVersion??''} tab={settingsTab} onTab={setSettingsTab} close={()=>setSettings(false)} themeMode={themeMode} onThemeMode={setThemeMode} mcp={<McpConnectionPanel info={connection} agentTask={agentTask} http={http} onTransportChange={setHttp}/>}/>:null}
 </>;
}
