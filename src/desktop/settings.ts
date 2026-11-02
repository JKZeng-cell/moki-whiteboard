import {readFileSync,writeFileSync,renameSync,mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import type {DesktopSettingsState,DesktopSettingsUpdate,StartupStatus} from '../shared/desktop-settings-contract.js';

export const AUTOSTART_ARGUMENT='--moki-autostart';
export type LoginItemOptions={path?:string;args?:string[]};
export type LoginItemState={openAtLogin:boolean;status?:string;executableWillLaunchAtLogin?:boolean;wasOpenedAtLogin?:boolean};
type LoginItemAPI={getLoginItemSettings(options?:LoginItemOptions):LoginItemState;setLoginItemSettings(settings:LoginItemOptions&{openAtLogin:boolean;name?:string;enabled?:boolean}):void};
export function loginItemOptions(platform:NodeJS.Platform,executable:string):LoginItemOptions{
 return platform==='win32'?{path:executable,args:[AUTOSTART_ARGUMENT]}:{};
}

/** The OS owns startup registration; the JSON file stores only the close preference. */
export class DesktopSettings {
 closeToTray=true;
 trayAvailable=false;
 trayError:string|null=null;
 private readonly available:boolean;
 private readonly options:LoginItemOptions;
 constructor(private readonly file:string,private readonly api:LoginItemAPI,private readonly platform:NodeJS.Platform,packaged:boolean,executable:string){
  this.available=packaged&&(platform==='win32'||platform==='darwin');
  this.options=loginItemOptions(platform,executable);
  try{const value:unknown=JSON.parse(readFileSync(file,'utf8'));if(value&&typeof value==='object'&&'closeToTray' in value&&typeof value.closeToTray==='boolean')this.closeToTray=value.closeToTray;}
  catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')console.warn('桌面设置无法读取，使用默认关闭行为：',String(error));}
 }
 get():DesktopSettingsState{
  let startupStatus:StartupStatus='unavailable',openAtLogin=false,startupAvailable=this.available;
  let startupHint=this.available?'登录系统时启动，托盘可用时在后台运行。':'请在安装后的 Windows 或 macOS 客户端中设置开机自启动。';
  if(this.available){
   try{
    const value=this.api.getLoginItemSettings(this.options);
    openAtLogin=value.openAtLogin||value.status==='requires-approval';
    startupStatus=openAtLogin?'enabled':'disabled';
    if(value.status==='requires-approval'){startupStatus='requires-approval';startupHint='等待系统批准，请在 macOS 系统设置 → 通用 → 登录项中允许 MOKI 白板。';}
    else if(openAtLogin&&this.platform==='win32'&&value.executableWillLaunchAtLogin===false){startupStatus='disabled-by-system';startupHint='系统已禁用启动项，请在 Windows 设置或任务管理器的启动应用中启用 MOKI 白板。';}
    else if(this.platform==='darwin')startupHint='如系统要求批准，请在通用 → 登录项中允许应用；未签名或未公证的应用可能无法注册。';
   }catch(error){startupAvailable=false;startupHint='无法读取系统登录项：'+String(error);}
  }
  return {closeToTray:this.closeToTray,trayAvailable:this.trayAvailable,trayError:this.trayError,openAtLogin,startupAvailable,startupStatus,startupHint};
 }
 set(input:unknown):DesktopSettingsState{
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.entries(input).some(([key,value])=>!['closeToTray','openAtLogin'].includes(key)||typeof value!=='boolean'))throw new Error('桌面设置无效');
  const update=input as DesktopSettingsUpdate;
  if(update.openAtLogin!==undefined){
   if(!this.available)throw new Error('开机自启动仅支持安装后的 Windows 或 macOS 客户端');
   this.api.setLoginItemSettings({...this.options,openAtLogin:update.openAtLogin,...(this.platform==='win32'?{name:'com.moki.whiteboard',enabled:update.openAtLogin}:{})});
   const result=this.get();
   if(result.openAtLogin!==update.openAtLogin||!result.startupAvailable)throw new Error('系统未应用开机自启动设置。'+result.startupHint);
  }
  if(update.closeToTray!==undefined){
   // Commit to disk before changing the live preference, so failed writes cannot lie to the UI.
   mkdirSync(dirname(this.file),{recursive:true});
   writeFileSync(this.file+'.tmp',JSON.stringify({closeToTray:update.closeToTray},null,2)+'\n',{mode:0o600});
   renameSync(this.file+'.tmp',this.file);this.closeToTray=update.closeToTray;
  }
  return this.get();
 }
}
