import {useCallback,useEffect,useRef,useState} from 'react';
import {useTheme} from './use-theme.js';
import {useWhiteboardFiles} from './use-whiteboard-files.js';
import {BoardManager,type BoardSummary} from './board-manager.js';
import {captureThumbnail} from './thumbnail-capture.js';
import {McpTransportSwitch} from './mcp-transport-switch.js';
import {Code2,Settings,X} from 'lucide-react';
import {SettingsDialog,type SettingsTab} from './settings-dialog.js';
import {WhiteboardPage} from '../vendor/moki/web/pages/whiteboard-page.js';
import {NativeControlsContext} from './native-context.js';
import {dispatchWorkbenchDataUpdated} from '../vendor/moki/web/lib/workbench-events.js';
import {getNativeClientActor} from '../vendor/moki/web/lib/api-fetch.js';
import {WORKBENCH_SELECTION_EVENT,MOKI_ASSISTANT_COMPOSE_EVENT,MOKI_ASSISTANT_EDITOR_EXIT_EVENT,readWorkbenchSelectionContext,type MokiAssistantComposeRequest} from '../vendor/moki/web/lib/workbench-selection-context.js';
type Summary=BoardSummary;
function route(){const m=location.pathname.match(/^\/board\/([^/]+)/);return m?.[1]?decodeURIComponent(m[1]):undefined;}
async function api<T>(path:string,init?:RequestInit):Promise<T>{const r=await fetch(path,{...init,headers:{'content-type':'application/json',...init?.headers}});if(r.status===204)return undefined as T;const b=await r.json();if(!r.ok)throw new Error(b.error??'请求失败');return b as T;}
export function App(){
 const [id,setId]=useState(route),[items,setItems]=useState<Summary[]>([]),[error,setError]=useState(''),[settings,setSettings]=useState(false),[path,setPath]=useState(''),[entry,setEntry]=useState(''),[http,setHttp]=useState(false),[copied,setCopied]=useState(false);
 const [appVersion,setAppVersion]=useState('');
 const [settingsTab,setSettingsTab]=useState<SettingsTab>('appearance');
 const setMcp=(open:boolean)=>{setSettings(open);if(open)setSettingsTab('mcp');};
 const [mcpCommand,setMcpCommand]=useState('node'),[mcpEnv,setMcpEnv]=useState<Record<string,string>>({});
 const {mode:themeMode,setMode:setThemeMode,dark}=useTheme();
 const [agentTask,setAgentTask]=useState('');
 const [syncError,setSyncError]=useState('');
 useEffect(()=>{if(!id)return;const publish=(body:unknown)=>void api('/api/boards/'+id+'/agent-context',{method:'PUT',body:JSON.stringify(body)}).catch(e=>setError(String(e)));const selection=()=>{const selected=readWorkbenchSelectionContext();publish({selection:selected?{...selected,label:selected.label.slice(0,1000),content:selected.content.slice(0,200000)}:null});};const compose=(event:Event)=>{const request=(event as CustomEvent<MokiAssistantComposeRequest>).detail;selection();publish({request:{prompt:request.prompt,capturedAt:request.capturedAt}});setAgentTask(`白板 ID：${id}\n请先通过 whiteboard_inspect 读取 agentContext，确认当前选区和编辑请求。\n\n${request.prompt}`);setMcp(true);};const close=()=>{setAgentTask('');setMcp(false);publish({request:null});};addEventListener(WORKBENCH_SELECTION_EVENT,selection);addEventListener(MOKI_ASSISTANT_COMPOSE_EVENT,compose);addEventListener(MOKI_ASSISTANT_EDITOR_EXIT_EVENT,close);return()=>{removeEventListener(WORKBENCH_SELECTION_EVENT,selection);removeEventListener(MOKI_ASSISTANT_COMPOSE_EVENT,compose);removeEventListener(MOKI_ASSISTANT_EDITOR_EXIT_EVENT,close);};},[id]);
 const checkpoint=useRef<(()=>Promise<void>)|undefined>(undefined),version=useRef<number|undefined>(undefined);
 const refresh=useCallback(async()=>{try{setItems((await api<{items:Summary[]}>('/api/boards')).items);}catch(e){setError(String(e));}},[]);
 const navigate=(next?:string)=>{history.pushState({},'',next?'/board/'+encodeURIComponent(next):'/');version.current=undefined;checkpoint.current=undefined;setId(next);void refresh();};
 const whiteboardFiles=useWhiteboardFiles({checkpoint:async()=>{await checkpoint.current?.();},open:next=>{setSettings(false);navigate(next);},error:setError});
 useEffect(()=>{if(id)return;const focus=()=>void refresh();const timer=setInterval(focus,3000);addEventListener('focus',focus);return()=>{clearInterval(timer);removeEventListener('focus',focus);};},[id,refresh]);
 useEffect(()=>{const pop=()=>{version.current=undefined;setId(route());void refresh();};addEventListener('popstate',pop);void refresh();void api<{appVersion:string;dataPath:string;mcpEntryPath:string;mcpCommand?:string;mcpEnv?:Record<string,string>}>('/api/config').then(r=>{setAppVersion(r.appVersion);setPath(r.dataPath);setEntry(r.mcpEntryPath);setMcpCommand(r.mcpCommand??'node');setMcpEnv(r.mcpEnv??{});}).catch(e=>setError(String(e)));return()=>removeEventListener('popstate',pop);},[refresh]);
 useEffect(()=>{if(!id)return;let pending=false,disposed=false,failures=0;setSyncError('');const poll=async()=>{if(pending)return;pending=true;try{const b=await api<{version:number;actor:string;actionId:string;detail?:{ids?:string[];changedShapeIds?:string[]}}>('/api/boards/'+id+'/updates');if(disposed)return;failures=0;setSyncError('');const previous=version.current;version.current=b.version;if(previous!==undefined&&b.version!==previous&&b.actor!==getNativeClientActor())dispatchWorkbenchDataUpdated({resource:'whiteboard',operation:'updated',actionId:b.actionId,changedShapeIds:b.detail?.changedShapeIds??b.detail?.ids??[]});}catch(e){if(!disposed&&++failures>=3)setSyncError('Agent 同步连接中断，正在重试：'+String(e));}finally{pending=false;}};void poll();const timer=setInterval(()=>void poll(),900);return()=>{disposed=true;clearInterval(timer);};},[id]);
 useEffect(()=>{if(!id)return;let last:number|undefined,pending=false,disposed=false;const timer=setInterval(()=>{if(pending||version.current===undefined||version.current===last)return;const observed=version.current;pending=true;void captureThumbnail(id).then(saved=>{if(saved&&!disposed)last=observed;}).catch(e=>{if(!disposed)setError(String(e));}).finally(()=>{pending=false;});},1300);return()=>{disposed=true;clearInterval(timer);};},[id,dark]);
 const back=async()=>{try{await checkpoint.current?.();}catch(e){setError('保存失败，尚未离开白板：'+String(e));return;}try{if(id)await captureThumbnail(id);}catch(e){setError('白板内容已保存，截图将在下次打开时重试：'+String(e));}navigate();};
 const config=JSON.stringify(http?{mcpServers:{'moki-whiteboard':{url:location.origin+'/mcp'}}}:{mcpServers:{'moki-whiteboard':{command:mcpCommand,args:[entry.replaceAll('\\','/')],env:{...mcpEnv,MOKI_WHITEBOARD_DATA:path.replaceAll('\\','/')}}}},null,2);
 const copy=async(value:string)=>{try{await navigator.clipboard.writeText(value);setCopied(true);setTimeout(()=>setCopied(false),1600);}catch(e){setError('复制失败：'+String(e));}};
 return <>
 {id?<NativeControlsContext.Provider value={{back:()=>void back(),settings:()=>{setSettingsTab('appearance');setSettings(true);}}}><WhiteboardPage key={id} boardTitle={items.find(item=>item.id===id)?.title ?? '白板名称加载中…'} onCheckpointReady={value=>{checkpoint.current=value;}}/></NativeControlsContext.Provider>:
 <BoardManager items={items} open={next=>navigate(next)} refresh={refresh} controls={<>{whiteboardFiles.controls}<button className="native-app-control" aria-label="设置" title="设置" onClick={()=>{setSettingsTab('appearance');setSettings(true);}}><Settings size={18}/></button></>}/>}
 {whiteboardFiles.busy?<div className="whiteboard-file-progress" role="status">正在打开白板文件…</div>:null}
 {error||syncError?<div className="native-app-error" role="alert">{error||syncError}<button aria-label="关闭错误" onClick={()=>{setError('');setSyncError('');}}><X size={15}/></button></div>:null}
 {settings?<SettingsDialog version={appVersion} tab={settingsTab} onTab={setSettingsTab} close={()=>setSettings(false)} themeMode={themeMode} onThemeMode={setThemeMode} mcp={<> <Code2 size={30}/><h2>{agentTask?'请求 Agent 编辑当前内容':'连接 MOKI 白板 MCP'}</h2><p>Agent 与白板共享本地数据库，支持读取、创建、修改、对齐和操作审计。编辑请求须由连接的 Agent 执行。</p>{agentTask?<><pre>{agentTask}</pre><button className="manager-primary" onClick={()=>void copy(agentTask)}>复制编辑请求</button></>:null}<McpTransportSwitch http={http} onChange={value=>{setHttp(value);setCopied(false);}}/>{http?<p>本机标准 MCP HTTP 入口：{location.origin+'/mcp'}。需保持应用服务运行；如配置了 token，请在客户端添加 Bearer 认证。</p>:null}<pre>{config}</pre><button className="manager-primary" onClick={()=>void copy(config)}>{copied?'已复制':'复制 MCP 配置'}</button> </>}/>:null}
 </>;
}
