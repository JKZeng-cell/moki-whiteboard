import {useEffect,useRef,useState} from 'react';
import {Copy,Link2,Unlink} from 'lucide-react';
import type {LanSharingState} from '../shared/lan-sharing-contract.js';

async function sharingAPI<T>(path:string,init?:RequestInit):Promise<T>{const response=await fetch(path,{...init,...(init?.body===undefined?{}:{headers:{'content-type':'application/json'}})});const value=await response.json();if(!response.ok)throw new Error(value.error??'局域网共享操作失败');return value as T;}
export function LanSharingPanel({currentBoardId}:{currentBoardId?:string|undefined}){
 const [state,setState]=useState<LanSharingState>(),[boards,setBoards]=useState<Array<{id:string;title:string}>>([]),[selected,setSelected]=useState(currentBoardId??''),[address,setAddress]=useState('');
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[copied,setCopied]=useState('');
 const timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
 useEffect(()=>{let live=true;void Promise.all([sharingAPI<LanSharingState>('/api/sharing'),sharingAPI<{items:Array<{id:string;title:string}>}>('/api/boards')]).then(([value,list])=>{if(!live)return;if(typeof value.enabled!=='boolean')throw new Error('无法读取局域网共享设置');setState(value);setBoards(list.items);setSelected(current=>list.items.some(board=>board.id===current)?current:list.items[0]?.id??'');setAddress(value.addresses[0]?.address??'');}).catch(error=>{if(live)setError(String(error));});return()=>{live=false;clearTimeout(timer.current);};},[]);
 const update=async(path:string,method:string,body?:unknown)=>{if(busy)return;setBusy(true);setError('');setCopied('');try{setState(await sharingAPI<LanSharingState>(path,{method,...(body===undefined?{}:{body:JSON.stringify(body)})}));}catch(error){setError(error instanceof Error?error.message:String(error));}finally{setBusy(false);}};
 const copy=async(id:string,url:string)=>{setError('');try{if(window.mokiDesktop?.copyText){if(!await window.mokiDesktop.copyText(url))throw new Error('复制失败');}else await navigator.clipboard.writeText(url);setCopied(id);clearTimeout(timer.current);timer.current=setTimeout(()=>setCopied(''),1800);}catch{setError('无法复制链接，请选中链接手动复制。');}};
 return <section className="settings-lan-sharing"><h3>局域网共享</h3><label className="settings-toggle-row"><span><strong>开启局域网只读共享</strong><small>同一网络的设备可通过链接查看指定白板。需要保持本机白板应用运行。</small></span><input type="checkbox" role="switch" aria-label="局域网共享" disabled={busy||!state} checked={state?.enabled??false} onChange={event=>void update('/api/sharing','PUT',{enabled:event.target.checked})}/></label>
 {state?.enabled?<>
  {!state.addresses.length?<p role="status">未检测到局域网 IPv4 地址，请先连接 Wi-Fi 或有线网络后重新打开设置。</p>:<>
   {state.addresses.length>1?<label className="settings-share-select">局域网地址<select aria-label="局域网地址" value={address} onChange={event=>setAddress(event.target.value)}>{state.addresses.map(item=><option key={item.address} value={item.address}>{item.name} · {item.address}</option>)}</select></label>:null}
   <div className="settings-share-create"><select aria-label="选择共享白板" value={selected} disabled={busy} onChange={event=>setSelected(event.target.value)}>{boards.map(board=><option key={board.id} value={board.id}>{board.title}</option>)}</select><button className="settings-secondary" disabled={busy||!selected} onClick={()=>void update('/api/sharing/boards/'+encodeURIComponent(selected),'POST')}><Link2 size={14}/>生成分享链接</button></div>
   {state.links.map(link=>{const url=link.urls.find(value=>value.startsWith('http://'+address+':'))??link.urls[0]??'';return <article key={link.boardId} className="settings-share-link"><strong>{link.title}<span>仅供查看</span></strong><div><input aria-label={link.title+'的共享链接'} value={url} readOnly onFocus={event=>event.currentTarget.select()}/><button title="复制链接" aria-label={'复制 '+link.title+' 的共享链接'} disabled={!url} onClick={()=>void copy(link.boardId,url)}><Copy size={15}/>{copied===link.boardId?'已复制':'复制'}</button><button title="停止分享此白板" aria-label={'停止分享 '+link.title} disabled={busy} onClick={()=>void update('/api/sharing/boards/'+encodeURIComponent(link.boardId),'DELETE')}><Unlink size={15}/></button></div></article>;})}
  </>}
  <p className="settings-cache-detail">关闭开关会使全部旧链接失效。若其他设备无法访问，请检查是否在同一局域网，以及系统防火墙是否允许白板应用连接。</p>
 </>:null}
 {error?<p role="alert" className="manager-dialog-error">{error}</p>:null}</section>;
}
