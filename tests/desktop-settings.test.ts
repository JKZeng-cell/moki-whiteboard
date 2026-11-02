import {afterEach,describe,expect,it,vi} from 'vitest';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DesktopSettings,loginItemOptions,AUTOSTART_ARGUMENT,type LoginItemState} from '../src/desktop/settings.js';
import {DesktopLifecycle} from '../src/desktop/lifecycle.js';
const scratch:string[]=[];
afterEach(()=>{for(const root of scratch.splice(0))rmSync(root,{recursive:true,force:true});});
function setup(platform:NodeJS.Platform='win32',packaged=true){
 const root=mkdtempSync(join(tmpdir(),'moki-settings-test-'));scratch.push(root);
 let state:LoginItemState={openAtLogin:false};
 const api={getLoginItemSettings:vi.fn(()=>state),setLoginItemSettings:vi.fn((value:{openAtLogin:boolean})=>{state={openAtLogin:value.openAtLogin};})};
 const file=join(root,'desktop-settings.json');
 return {file,api,settings:new DesktopSettings(file,api,platform,packaged,'C:/Program Files/MOKI/MOKI Whiteboard.exe'),setState:(value:LoginItemState)=>{state=value;}};
}
describe('desktop settings and native startup',()=>{
 it('defaults to close-to-tray without enabling OS startup and persists only the close preference',()=>{
  const {settings,api,file}=setup();expect(settings.get()).toMatchObject({closeToTray:true,openAtLogin:false,trayAvailable:false});expect(api.setLoginItemSettings).not.toHaveBeenCalled();
  settings.set({closeToTray:false});expect(JSON.parse(readFileSync(file,'utf8'))).toEqual({closeToTray:false});
  expect(new DesktopSettings(file,api,'win32',true,'C:/app.exe').closeToTray).toBe(false);
 });
 it('uses matching Windows executable and argument options for registration and readback, including spaces',()=>{
  const {settings,api}=setup();expect(settings.set({openAtLogin:true}).startupStatus).toBe('enabled');
  expect(api.setLoginItemSettings).toHaveBeenCalledWith({path:'C:/Program Files/MOKI/MOKI Whiteboard.exe',args:[AUTOSTART_ARGUMENT],openAtLogin:true,enabled:true,name:'com.moki.whiteboard'});
  expect(api.getLoginItemSettings).toHaveBeenLastCalledWith(loginItemOptions('win32','C:/Program Files/MOKI/MOKI Whiteboard.exe'));
  expect(settings.set({openAtLogin:false}).openAtLogin).toBe(false);
 });
 it('shows system-disabled Windows registrations instead of claiming effective startup',()=>{
  const {settings,setState}=setup();setState({openAtLogin:true,executableWillLaunchAtLogin:false});expect(settings.get()).toMatchObject({openAtLogin:true,startupStatus:'disabled-by-system'});
 });
 it('reports pending Mac approval and never uses removed openAsHidden fields',()=>{
  const {settings,api,setState}=setup('darwin');api.setLoginItemSettings.mockImplementation(()=>setState({openAtLogin:false,status:'requires-approval'}));
  expect(settings.set({openAtLogin:true})).toMatchObject({openAtLogin:true,startupStatus:'requires-approval'});expect(api.setLoginItemSettings).toHaveBeenCalledWith({openAtLogin:true});
 });
 it('rejects silent macOS registration failures',()=>{
  const {settings,api}=setup('darwin');api.setLoginItemSettings.mockImplementation(()=>{});expect(()=>settings.set({openAtLogin:true})).toThrow('系统未应用');expect(settings.get().openAtLogin).toBe(false);
 });
 it('does not register development Electron or unsupported platforms at login',()=>{
  for(const [platform,packaged] of [['win32',false],['linux',true]] as const){const {settings,api}=setup(platform,packaged);expect(settings.get().startupAvailable).toBe(false);expect(()=>settings.set({openAtLogin:true})).toThrow('安装后的');expect(api.setLoginItemSettings).not.toHaveBeenCalled();}
 });
 it('validates all setting values before mutating system startup',()=>{
  const {settings,api}=setup();for(const input of [null,[],{openAtLogin:'true'},{openAtLogin:true,other:true},{closeToTray:1}])expect(()=>settings.set(input)).toThrow('无效');expect(api.setLoginItemSettings).not.toHaveBeenCalled();
 });
});
describe('desktop close and quit lifecycle',()=>{
 function setupLifecycle(){const calls:string[]=[];const actions={canHide:()=>true,hide:vi.fn(()=>{calls.push('hide');}),prepare:vi.fn(async()=>{calls.push('prepare');}),stop:vi.fn(async()=>{calls.push('stop');}),exit:vi.fn(()=>{calls.push('exit');}),failed:vi.fn()};return {actions,calls,lifecycle:new DesktopLifecycle(actions),event:{preventDefault:vi.fn()}};}
 it('hides while keeping the renderer and service alive on normal close',()=>{const {actions,calls,lifecycle,event}=setupLifecycle();lifecycle.close(event);expect(event.preventDefault).toHaveBeenCalledOnce();expect(calls).toEqual(['hide']);expect(actions.stop).not.toHaveBeenCalled();});
 it('waits for saving, stops services, and exits once even with overlapping quit requests',async()=>{const {calls,lifecycle,event}=setupLifecycle();lifecycle.beforeQuit(event);await Promise.all([lifecycle.quit(),lifecycle.quit()]);expect(calls).toEqual(['prepare','stop','exit']);expect(lifecycle.exiting).toBe(true);});
 it('quits safely rather than hiding when no tray is usable or close-to-tray is disabled',async()=>{const {actions,calls,lifecycle,event}=setupLifecycle();actions.canHide=()=>false;lifecycle.close(event);await lifecycle.quit();expect(calls).toEqual(['prepare','stop','exit']);});
 it('keeps the app alive on save failure and allows retry',async()=>{const {actions,lifecycle}=setupLifecycle();actions.prepare.mockRejectedValueOnce(new Error('unsaved'));await lifecycle.quit();expect(actions.stop).not.toHaveBeenCalled();expect(actions.exit).not.toHaveBeenCalled();expect(actions.failed).toHaveBeenCalledOnce();expect(lifecycle.exiting).toBe(false);await lifecycle.quit();expect(actions.exit).toHaveBeenCalledOnce();});
});
