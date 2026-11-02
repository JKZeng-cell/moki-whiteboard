import {useEffect,useState} from 'react';
import type {DesktopSettingsState,DesktopSettingsUpdate} from '../shared/desktop-settings-contract.js';

export function DesktopSettingsPanel(){
 const bridge=window.mokiDesktop?.desktopSettings;
 const [state,setState]=useState<DesktopSettingsState>(),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{let live=true;if(bridge)void bridge.get().then(value=>{if(live)setState(value);}).catch(error=>{if(live)setError(String(error));});return()=>{live=false;};},[bridge]);
 async function save(update:DesktopSettingsUpdate){
  if(!bridge||busy)return;setBusy(true);setError('');
  try{setState(await bridge.set(update));}
  catch(error){setError(String(error));try{setState(await bridge.get());}catch{/* Keep the original error. */}}
  finally{setBusy(false);}
 }
 if(!bridge)return <p>托盘运行和开机自启动仅在桌面客户端中可用。</p>;
 return <><h3>启动与关闭</h3>{state?<>
  <label className="settings-toggle-row"><span><strong>关闭窗口后在托盘运行</strong><small>继续提供本地 MCP 服务；通过托盘菜单重新打开或退出。</small></span><input type="checkbox" role="switch" aria-label="关闭窗口后在托盘运行" checked={state.closeToTray} disabled={busy} onChange={event=>void save({closeToTray:event.target.checked})}/></label>
  {!state.trayAvailable?<p role="status">{state.trayError??'当前系统托盘不可用'}，关闭窗口将正常退出。</p>:null}
  <label className="settings-toggle-row"><span><strong>开机自启动</strong><small>{state.startupHint}</small></span><input type="checkbox" role="switch" aria-label="开机自启动" checked={state.openAtLogin} disabled={busy||!state.startupAvailable} onChange={event=>void save({openAtLogin:event.target.checked})}/></label>
  {state.startupStatus==='requires-approval'||state.startupStatus==='disabled-by-system'?<p role="status">自启动尚未生效，请完成系统设置中的授权。</p>:null}
  <div className="settings-cache-actions"><button className="settings-secondary" disabled={busy} onClick={()=>{setError('');void bridge.quit().catch(error=>setError(String(error)));}}>退出 MOKI 白板</button></div>
 </>:<p>正在读取桌面设置…</p>}{error?<p role="alert" className="manager-dialog-error">{error}</p>:null}</>;
}
