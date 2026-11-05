import {useEffect,useRef,useState} from 'react';
import {Check,Copy,Share2,X} from 'lucide-react';
import {sharingAPI,copySharingText,useLanSharingState} from './lan-sharing-client.js';
export function BoardShareDialog({board,close,openSettings}:{board:{id:string;title:string};close:()=>void;openSettings:()=>void}){
 const [loadError,setLoadError]=useState('');
 const state=useLanSharingState(setLoadError),section=useRef<HTMLElement>(null),attempted=useRef(false),pending=useRef(false);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[copied,setCopied]=useState(false),[address,setAddress]=useState('');
 const selected=state?.addresses.find(item=>item.address===address)?.address??state?.addresses[0]?.address;
 const link=state?.links.find(item=>item.boardId===board.id),url=link?.urls.find(value=>value.startsWith('http://'+selected+':'))??link?.urls[0]??'';
 useEffect(()=>setCopied(false),[url]);
 const generate=async()=>{if(pending.current)return;pending.current=true;setBusy(true);setError('');try{return await sharingAPI('/api/sharing/boards/'+encodeURIComponent(board.id),{method:'POST'});}catch(error){setError(error instanceof Error?error.message:String(error));}finally{pending.current=false;setBusy(false);}};
 useEffect(()=>{if(state?.enabled&&state.addresses.length&&!link&&!attempted.current){attempted.current=true;void generate();}},[state?.enabled,state?.addresses.length,link]);
 useEffect(()=>{const previous=document.activeElement as HTMLElement|null;section.current?.querySelector<HTMLButtonElement>('[aria-label="关闭共享"]')?.focus();return()=>{if(previous?.isConnected)previous.focus();};},[]);
 const copy=async()=>{setCopied(false);setError('');let value=url;if(!value){const next=await generate();const nextLink=next?.links.find(item=>item.boardId===board.id);value=nextLink?.urls.find(item=>item.startsWith('http://'+selected+':'))??nextLink?.urls[0]??'';}if(!value)return;try{await copySharingText(value);setCopied(true);}catch{setError('无法自动复制，请选中上方链接手动复制。');}};
 return <div className="native-modal-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)close();}}><section ref={section} role="dialog" aria-modal="true" aria-label="共享白板" className="native-mcp-modal board-share-dialog" onKeyDown={event=>{
  if(event.key==='Escape'){event.preventDefault();close();}
  if(event.key==='Tab'){const controls=Array.from(section.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input,select')??[]),first=controls[0],last=controls.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}
 }}><button type="button" className="native-modal-close" aria-label="关闭共享" onClick={close}><X size={18}/></button><Share2 size={28}/><h2>共享白板</h2><strong className="board-share-title">{board.title}</strong>
 {!state?<p role={loadError?"alert":"status"}>{loadError||"正在读取共享设置…"}</p>:!state.enabled?<><p>请先在设置中开启局域网共享，再生成这张白板的只读链接。</p><button className="manager-primary" onClick={openSettings}>前往设置</button></>:!state.addresses.length?<p role="status">未检测到局域网地址，请连接 Wi-Fi 或有线网络后重试。</p>:<><p>同一局域网内可查看页面、播放视频和查看附件。请保持本机应用运行。</p>{state.addresses.length>1?<label className="settings-share-select">局域网地址<select aria-label="共享使用的局域网地址" value={selected} onChange={event=>{setAddress(event.target.value);setCopied(false);}}>{state.addresses.map(item=><option key={item.address} value={item.address}>{item.name} · {item.address}</option>)}</select></label>:null}<label className="board-share-url">只读共享链接<input aria-label="只读共享链接" value={url} readOnly placeholder={busy?'正在生成链接…':'尚未生成链接'} onFocus={event=>event.currentTarget.select()}/></label><button className="manager-primary" disabled={busy} onClick={()=>void copy()}>{copied?<Check size={16}/>:<Copy size={16}/>} {busy?'正在生成…':copied?'已复制':url?'复制链接':'生成并复制链接'}</button><p className="board-share-note">可在设置中停止共享，或关闭局域网共享使所有链接失效。</p></>}
 {error?<p role="alert" className="manager-dialog-error">{error}</p>:null}</section></div>;
}
