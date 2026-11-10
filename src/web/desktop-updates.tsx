import {useEffect,useState} from 'react';
import {Download,FolderOpen,RefreshCw,X} from 'lucide-react';
import type {ClientUpdateState} from '../shared/client-update-contract.js';
import './desktop-updates.css';

function useClientUpdate(){
 const bridge=window.mokiDesktop?.clientUpdates;
 const [state,setState]=useState<ClientUpdateState>(),[error,setError]=useState('');
 useEffect(()=>{if(!bridge)return;let live=true,changed=false;const stop=bridge.onChanged(value=>{changed=true;if(live)setState(value);});void bridge.get().then(value=>{if(live&&!changed)setState(value);}).catch(()=>{if(live)setError('无法读取更新状态，请重新打开设置。');});return()=>{live=false;stop();};},[bridge]);
 const run=async(action:'check'|'download'|'reveal')=>{if(!bridge)return;setError('');try{setState(await bridge[action]());}catch{setError('更新操作失败，请检查网络后重试。');}};
 return {state,error,run,bridge};
}
function statusText(state:ClientUpdateState){
 if(state.state==='checking')return '正在检查 GitHub 最新发布…';
 if(state.state==='downloading')return `正在下载 ${state.percent??0}%`;
 if(state.state==='downloaded')return '安装包已下载并校验，请保存白板后手动安装。';
 if(state.state==='available')return '发现新安装包 '+state.availableTag;
 if(state.state==='current')return '当前已是最新发布';
 if(state.state==='error')return state.message??'暂时无法检查更新，请稍后重试。';
 if(state.state==='unsupported')return state.message;
 return '启动后自动检查，也可手动检查更新。';
}
export function DesktopUpdatesPanel(){
 const {state,error,run,bridge}=useClientUpdate();
 if(!bridge)return null;
 const busy=state?.state==='checking'||state?.state==='downloading',available=state?.availableTag&&state.state!=='downloaded';
 return <section className="desktop-updates-panel" aria-label="客户端更新"><h3>客户端更新</h3><p>从 GitHub 自动检查新安装包，确认后下载。下载不会关闭正在编辑的白板。</p>{state?<><p>当前安装批次：{state.currentTag}</p><p aria-live="polite">{statusText(state)}</p><div className="desktop-updates-actions"><button disabled={busy||state.state==='unsupported'} onClick={()=>void run('check')}><RefreshCw size={14}/>检查更新</button>{available?<button disabled={busy} onClick={()=>void run('download')}><Download size={14}/>{state.state==='downloading'?'下载中…':'下载更新'}</button>:null}{state.state==='downloaded'?<button onClick={()=>void run('reveal')}><FolderOpen size={14}/>打开安装包位置</button>:null}</div></>:<p>正在读取更新状态…</p>}{error?<p role="alert">{error}</p>:null}</section>;
}
export function DesktopUpdateNotice(){
 const {state,error,run}=useClientUpdate(),[dismissed,setDismissed]=useState('');
 if(!state?.availableTag||dismissed===state.availableTag||!['available','downloading','downloaded','error'].includes(state.state))return null;
 const downloading=state.state==='downloading';
 return <aside className="desktop-update-notice" aria-label="客户端更新提示" aria-live="polite"><div><b>{state.state==='downloaded'?'更新安装包已就绪':'发现 MOKI 白板更新 '+state.availableTag}</b><p>{statusText(state)}</p>{error?<p role="alert">{error}</p>:null}</div><button disabled={downloading} onClick={()=>void run(state.state==='downloaded'?'reveal':'download')}>{state.state==='downloaded'?<FolderOpen size={16}/>:<Download size={16}/>}<span>{state.state==='downloaded'?'打开位置':downloading?`下载 ${state.percent??0}%`:'下载更新'}</span></button><button aria-label="稍后更新" title="稍后更新" onClick={()=>setDismissed(state.availableTag!)}><X size={16}/></button></aside>;
}
