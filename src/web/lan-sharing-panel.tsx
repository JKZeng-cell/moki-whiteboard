import {useEffect,useRef,useState} from 'react';
import {Copy,Unlink} from 'lucide-react';
import {sharingAPI,copySharingText,useLanSharingState} from './lan-sharing-client.js';

export function LanSharingPanel(){
 const [loadError,setLoadError]=useState(''),[error,setError]=useState(''),[address,setAddress]=useState('');
 const state=useLanSharingState(setLoadError),[busy,setBusy]=useState(false),[copied,setCopied]=useState('');
 const timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),pending=useRef(false);
 const selected=state?.addresses.find(item=>item.address===address)?.address??state?.addresses[0]?.address??'';
 useEffect(()=>()=>clearTimeout(timer.current),[]);
 const update=async(path:string,method:string,body?:unknown)=>{
  if(pending.current)return;pending.current=true;setBusy(true);setError('');setCopied('');
  try{await sharingAPI(path,{method,...(body===undefined?{}:{body:JSON.stringify(body)})});}
  catch(error){setError(error instanceof Error?error.message:String(error));}
  finally{pending.current=false;setBusy(false);}
 };
 const copy=async(id:string,url:string)=>{setError('');try{await copySharingText(url);setCopied(id);clearTimeout(timer.current);timer.current=setTimeout(()=>setCopied(''),1800);}catch{setError('无法复制链接，请选中链接手动复制。');}};
 return <section className="settings-lan-sharing"><h3>局域网共享</h3><label className="settings-toggle-row"><span><strong>开启局域网只读共享</strong><small>默认开启，可手动关闭。同一网络的设备可通过链接查看指定白板，需要保持本机应用运行。</small></span><input type="checkbox" role="switch" aria-label="局域网共享" disabled={busy||!state} checked={state?.enabled??false} onChange={event=>void update('/api/sharing','PUT',{enabled:event.target.checked})}/></label>
 {state?<>
  {state.enabled&&!state.addresses.length?<p role="status">未检测到局域网 IPv4 地址，请连接 Wi-Fi 或有线网络。已共享白板仍可在下方取消共享。</p>:null}
  {state.enabled&&state.addresses.length>1?<label className="settings-share-select">局域网地址<select aria-label="局域网地址" value={selected} onChange={event=>setAddress(event.target.value)}>{state.addresses.map(item=><option key={item.address} value={item.address}>{item.name} · {item.address}</option>)}</select></label>:null}
  <div className="settings-shared-heading"><h4>已共享的白板</h4><span>{state.links.length} 张</span></div>
  {state.links.length?<ul aria-label="已共享白板列表" className="settings-shared-boards">{state.links.map(link=>{const url=link.urls.find(value=>value.startsWith('http://'+selected+':'))??link.urls[0]??'';return <li key={link.boardId}><article className="settings-share-link"><strong>{link.title}<span>仅供查看</span></strong><div><input aria-label={link.title+'的共享链接'} value={url} readOnly onFocus={event=>event.currentTarget.select()}/><button title="复制链接" aria-label={'复制 '+link.title+' 的共享链接'} disabled={!url||busy} onClick={()=>void copy(link.boardId,url)}><Copy size={15}/>{copied===link.boardId?'已复制':'复制'}</button></div><button className="settings-share-revoke" aria-label={'取消共享 '+link.title} disabled={busy} onClick={()=>void update('/api/sharing/boards/'+encodeURIComponent(link.boardId),'DELETE')}><Unlink size={14}/>取消共享</button></article></li>;})}</ul>:<p className="settings-shared-empty">{state.enabled?'暂无已共享的白板。可从编辑页右上角或白板卡片“更多”菜单生成共享链接。':'局域网共享已关闭，所有旧链接已失效。'}</p>}
  {state.enabled?<p className="settings-cache-detail">取消共享会立即使该白板的旧链接失效；关闭开关会使全部旧链接失效。其他设备需处于同一局域网，且系统防火墙允许白板应用连接。</p>:null}
 </>:null}
 {error||loadError?<p role="alert" className="manager-dialog-error">{error||loadError}</p>:null}</section>;
}
