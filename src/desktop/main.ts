import { app, BrowserWindow, shell, dialog, ipcMain, clipboard,Menu,Tray,nativeImage } from "electron";
import {readDesktopClipboardResources} from '../vendor/moki/desktop/clipboard-resources.js';
import {buildMediaContextMenuTemplate} from '../vendor/moki/desktop/media-context-menu.js';
import {buildAttachmentContextMenuTemplate} from '../vendor/moki/desktop/attachment-context-menu.js';
import { readFile } from 'node:fs/promises';
import {WhiteboardDocuments} from './whiteboard-documents.js';
import {WhiteboardOpenQueue,whiteboardPaths} from './whiteboard-open.js';
import {readWhiteboardTransferResource,restoreWhiteboardTransferResources} from '../vendor/moki/desktop/whiteboard-transfer-resources.js';
import type {DesktopWhiteboardTransferResource} from '../vendor/moki/shared/desktop-whiteboard-transfer-contract.js';
import {createApp} from '../server/app.js';
import {WhiteboardStore} from '../server/store.js';
import {ResourceCache,legacyResourcePath} from '../server/resource-cache.js';
import {DEVELOPER_CONTACT_URL,isAllowedExternalUrl} from '../shared/app-metadata.js';
import {APP_VERSION} from '../server/app-metadata.js';
import {desktopCachePaths} from './runtime-paths.js';
import {DesktopSettings,AUTOSTART_ARGUMENT} from './settings.js';
import {DesktopLifecycle} from './lifecycle.js';
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
let server: Awaited<ReturnType<typeof createApp>> | undefined;
let store: WhiteboardStore | undefined;
let resourceCache:ResourceCache|undefined;
let documents:WhiteboardDocuments|undefined;
let activeWindow: BrowserWindow | undefined;
let desktopSettings:DesktopSettings|undefined;
let tray:Tray|undefined;
let openingWindow:Promise<void>|undefined;
const lifecycle=new DesktopLifecycle({
 canHide:()=>Boolean(tray&&!tray.isDestroyed()&&desktopSettings?.closeToTray),
 hide:()=>activeWindow?.hide(),
 prepare:async()=>{
  const win=activeWindow;if(!win||win.isDestroyed()||win.webContents.isLoadingMainFrame())return;
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{await Promise.race([win.webContents.executeJavaScript('(async()=>{await window.mokiBeforeQuit?.();})()'),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('白板保存超时，请稍后重试退出')),40000);})]);}
  finally{clearTimeout(timer);}
 },
 stop:async()=>{try{await server?.close();}finally{store?.close();tray?.destroy();}},
 exit:()=>app.exit(Number(process.exitCode??0)),
 failed:error=>{console.error('退出前保存失败：',error);if(process.env.MOKI_WHITEBOARD_SMOKE==='1'){app.exit(1);return;}void openWindow();dialog.showErrorBox('白板尚未保存，未退出',String(error));}
});
const pendingWhiteboards = new WhiteboardOpenQueue(()=>{
 if(activeWindow&&!activeWindow.isDestroyed())activeWindow.webContents.send('moki:file-pending');
});
pendingWhiteboards.add(whiteboardPaths(process.argv));
const resourceRoot = () => resourceCache?.path??join(process.env.MOKI_WHITEBOARD_DATA ? dirname(process.env.MOKI_WHITEBOARD_DATA) : (app.isPackaged ? app.getPath('userData') : join(process.cwd(),'data')), 'resources');
let localOrigin = 'http://127.0.0.1:4321';
function installDesktopBridge(){
 const requireLocal=(event:Electron.IpcMainInvokeEvent)=>{if(!event.senderFrame?.url.startsWith(localOrigin+'/'))throw new Error('无效桌面调用来源');};
 const handle=(name:string,fn:(...args:any[])=>unknown)=>ipcMain.handle(name,(event,...args)=>{requireLocal(event);return fn(...args);});
 handle('moki:desktop-get',()=>desktopSettings!.get());
 handle('moki:desktop-set',(input:unknown)=>desktopSettings!.set(input));
 handle('moki:desktop-quit',()=>{setImmediate(()=>void lifecycle.quit());});
 handle('moki:cache-get',()=>{if(!resourceCache)throw new Error('当前连接不是独立客户端本地服务');return resourceCache.info();});
 handle('moki:cache-set',(path:unknown)=>{if(!resourceCache)throw new Error('当前连接不是独立客户端本地服务');if(path!==null&&typeof path!=='string')throw new Error('素材路径无效');return resourceCache.schedule(path);});
 handle('moki:select-file',async()=>{const result=await dialog.showOpenDialog(activeWindow!,{properties:['openFile']});return result.canceled?null:result.filePaths[0]??null;});
 handle('moki:select-folder',async()=>{const result=await dialog.showOpenDialog(activeWindow!,{properties:['openDirectory']});return result.canceled?null:result.filePaths[0]??null;});
 handle('moki:save-path',async(name:string)=>{const result=await dialog.showSaveDialog(activeWindow!,{defaultPath:String(name)});return result.canceled?null:result.filePath??null;});
 handle('moki:open-path',async(path:string)=>!(await shell.openPath(String(path))));
 handle('moki:open-url',async(value:string)=>{if(!isAllowedExternalUrl(value))return false;await shell.openExternal(new URL(value).href);return true;});
 handle('moki:copy-text',async(text:string)=>{await clipboard.writeText(String(text));return true;});
 handle('moki:clipboard-resources',async()=>{
  const text=await clipboard.readText(),formats=new Map<string,Buffer>();
  for(const item of await clipboard.read())for(const type of item.types){const raw=/format="([^"]+)"/i.exec(type)?.[1]??type;if(!/^(?:cf_hdrop|filenamew?|text\/uri-list)$/i.test(raw))continue;try{const value=await item.getType(type);if(value instanceof Blob&&value.size<=4*1024*1024)formats.set(raw,Buffer.from(await value.arrayBuffer()));}catch{}}
  return readDesktopClipboardResources({availableFormats:()=>[...formats.keys()],read:name=>formats.get(name)?.toString('utf8')??'',readBuffer:name=>formats.get(name)??Buffer.alloc(0),readText:()=>text});
 });
 const contextMenu=(template:(settle:(action:any)=>void)=>Electron.MenuItemConstructorOptions[])=>new Promise(resolve=>{let settled=false;const settle=(action:unknown)=>{if(!settled){settled=true;resolve(action);}};const items=template(settle);if(!items.length||!activeWindow){settle(null);return;}Menu.buildFromTemplate(items).popup({window:activeWindow,callback:()=>settle(null)});});
 handle('moki:media-menu',(input:Record<string,unknown>)=>contextMenu(settle=>buildMediaContextMenuTemplate({canCopyFrame:input?.canCopyFrame===true,hasPath:input?.hasPath===true,canOpen:input?.canOpen===true},settle)));
 handle('moki:attachment-menu',(input:Record<string,unknown>)=>contextMenu(settle=>buildAttachmentContextMenuTemplate({canOpenDefault:input?.canOpenDefault===true,canOpenLibrary:input?.canOpenLibrary===true,canSaveAs:input?.canSaveAs===true,canReveal:input?.canReveal===true},settle)));
 handle('moki:capture',async(rect:{x:number;y:number;width:number;height:number})=>{if(!activeWindow||![rect.x,rect.y,rect.width,rect.height].every(Number.isFinite)||rect.width<1||rect.height<1)return null;return (await activeWindow.webContents.capturePage({x:Math.round(rect.x),y:Math.round(rect.y),width:Math.round(rect.width),height:Math.round(rect.height)})).toDataURL();});
 handle('moki:read-resource',(input:{source:string;name?:string})=>readWhiteboardTransferResource(input));
 handle('moki:restore-resources',(resources:DesktopWhiteboardTransferResource[])=>restoreWhiteboardTransferResources(resourceRoot(),resources));
 handle('moki:file-pending',()=>pendingWhiteboards.pending);
 const requireDocuments=()=>{if(!documents)throw new Error('直接文件编辑需要使用客户端本地服务');return documents;};
 handle('moki:file-consume',async()=>{const path=pendingWhiteboards.take();if(!path)return null;try{return await requireDocuments().read(path);}catch(error){return {name:path,error:String(error)};}});
 handle('moki:document-read',(path:string)=>requireDocuments().read(path));
 handle('moki:document-bind',(token:string,boardId:string,expectedVersion:number)=>requireDocuments().bind(token,boardId,expectedVersion));
 handle('moki:document-info',(boardId:string)=>requireDocuments().info(boardId));
 handle('moki:document-save',(boardId:string,onlyIfDirty=false)=>requireDocuments().save(boardId,onlyIfDirty));
 handle('moki:document-save-as',async(boardId:string)=>{const board=store!.get(boardId);const result=await dialog.showSaveDialog(activeWindow!,{defaultPath:board.title.replace(/[<>:"/\\|?*\x00-\x1f]/gu,'_')+'.moki',filters:[{name:'MOKI 白板',extensions:['moki']}]});return result.canceled||!result.filePath?null:requireDocuments().saveAs(boardId,result.filePath);});
}
if (process.env.MOKI_WHITEBOARD_SMOKE === "1") app.disableHardwareAcceleration();
if(process.env.MOKI_WHITEBOARD_PROFILE)app.setPath('userData',process.env.MOKI_WHITEBOARD_PROFILE);
else if(app.isPackaged)app.setPath('userData',join(app.getPath('appData'),'moki-whiteboard'));
app.setAppUserModelId('com.moki.whiteboard');
const primary=app.requestSingleInstanceLock();if(!primary)app.quit();
app.on('second-instance',(_event,args)=>{
 pendingWhiteboards.add(whiteboardPaths(args));
 if(!args.includes(AUTOSTART_ARGUMENT)||whiteboardPaths(args).length)void openWindow().catch(showWindowError);
});
app.on('open-file',(event,path)=>{event.preventDefault();pendingWhiteboards.add([path]);if(app.isReady())void openWindow().catch(showWindowError);});

function showWindowError(error:unknown){console.error(error);dialog.showErrorBox('MOKI 白板打开失败',String(error));}
function iconRoot(){return app.isPackaged?join(app.getAppPath()+'.unpacked','dist/web'):join(here,'../web');}
function createTray(){
 try{
  const image=nativeImage.createFromPath(join(iconRoot(),'moki-whiteboard-icon.png')).resize({width:process.platform==='darwin'?18:20,height:process.platform==='darwin'?18:20});
  if(image.isEmpty())throw new Error('托盘图标无法读取');
  tray=new Tray(image);tray.setToolTip('MOKI 白板');
  const show=()=>void openWindow().catch(showWindowError);
  tray.setContextMenu(Menu.buildFromTemplate([{label:'打开 MOKI 白板',click:show},{type:'separator'},{label:'退出 MOKI 白板',click:()=>void lifecycle.quit()}]));
  tray.on('double-click',show);tray.on('click',()=>{if(process.platform!=='darwin')show();});
  desktopSettings!.trayAvailable=true;
 }catch(error){tray?.destroy();tray=undefined;desktopSettings!.trayError='托盘启动失败：'+String(error);console.error(desktopSettings!.trayError);}
}
function openWindow(show=true):Promise<void>{
 const reveal=()=>{if(activeWindow&&!activeWindow.isDestroyed()){if(activeWindow.isMinimized())activeWindow.restore();activeWindow.show();activeWindow.focus();}};
 if(activeWindow&&!activeWindow.isDestroyed()){if(show)reveal();return Promise.resolve();}
 if(openingWindow)return openingWindow.then(()=>{if(show)reveal();});
 openingWindow=createWindow(show).finally(()=>{openingWindow=undefined;});return openingWindow;
}

async function waitForServer(url: string): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { if ((await fetch(url)).ok) return; } catch { /* wait for local API */ }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("MOKI 白板本地服务启动超时");
}

async function createWindow(show:boolean) {
  if (!process.env.MOKI_WHITEBOARD_EXTERNAL_SERVER && !server) {
    const dataPath = process.env.MOKI_WHITEBOARD_DATA ?? (app.isPackaged ? join(app.getPath("userData"), "moki-whiteboard.db") : join(process.cwd(), "data", "moki-whiteboard.db"));
    store=new WhiteboardStore(dataPath);
    documents=new WhiteboardDocuments(store);
    const paths=desktopCachePaths(process.platform,process.execPath,app.getPath('userData'));
    resourceCache=new ResourceCache(store,app.isPackaged&&!process.env.MOKI_WHITEBOARD_DATA?paths.defaultPath:legacyResourcePath(store),app.isPackaged?paths.installPath:undefined);
    try{resourceCache.activate();}catch(error){resourceCache.error='素材目录初始化或迁移失败，继续使用原目录：'+String(error);}
    const runtimeRoot=app.isPackaged?join(app.getAppPath()+'.unpacked','dist'):join(here,'..');
    server=await createApp({store,resourceCache,webRoot:join(runtimeRoot,'web'),mcpRuntime:{command:process.execPath,env:{ELECTRON_RUN_AS_NODE:'1'},entryPath:join(runtimeRoot,'mcp/server.js')}});
    const port=Number(process.env.MOKI_WHITEBOARD_PORT??4322);
    try{localOrigin=await server.listen({host:'127.0.0.1',port});}
    catch(error){if((error as NodeJS.ErrnoException).code!=='EADDRINUSE')throw error;localOrigin=await server.listen({host:'127.0.0.1',port:0});}
  }
  await waitForServer(`${localOrigin}/api/health`);
  const win = new BrowserWindow({ show:false,width: 1440, height: 900, minWidth: 760, minHeight: 560, backgroundColor: "#f2f1f7", title: "MOKI 白板",icon:join(iconRoot(),'moki-whiteboard-icon.png'), webPreferences: { contextIsolation: true, sandbox: true, preload:join(here,'preload.cjs') } });
  activeWindow=win;
  win.on('close',event=>lifecycle.close(event));
  win.on('query-session-end',()=>{lifecycle.exiting=true;});
  win.on('closed',()=>{if(activeWindow===win)activeWindow=undefined;});
  win.setMenuBarVisibility(false);
  win.webContents.setWindowOpenHandler(({ url }) => { if(isAllowedExternalUrl(url))void shell.openExternal(url); return { action: "deny" }; });
  await win.loadURL(localOrigin);
  if(show)win.show();
  if (process.env.MOKI_WHITEBOARD_SMOKE === "1") {
    let result = { title: "", shell: false };
    for (let attempt = 0; attempt < 50 && !result.shell; attempt += 1) {
      result = await win.webContents.executeJavaScript(`({ title: document.title, shell: document.querySelector('.manager-shell, .app-shell') !== null })`) as { title: string; shell: boolean };
      if (!result.shell) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const bridge=await win.webContents.executeJavaScript(`({preload:typeof window.mokiDesktop?.getPathForFile==='function',portable:typeof window.mokiDesktop?.whiteboardFiles?.restoreResources==='function',nativeMenu:typeof window.mokiDesktop?.showMediaContextMenu==='function'})`);
    let fileOpenSmoke:Record<string,unknown>|undefined;
    if(process.env.MOKI_WHITEBOARD_SMOKE_FILES){
      if(!process.env.MOKI_WHITEBOARD_DATA||!store)throw new Error('File smoke requires an isolated local database');
      const request=JSON.parse(process.env.MOKI_WHITEBOARD_SMOKE_FILES) as {initialTitle:string;runtimePaths:string[];lastTitle:string;pageCount:number;shapeCount:number};
      const waitForBoard=async(title:string)=>{
        for(let i=0;i<100;i++){
          const board=store!.list().find(board=>board.title===title);
          if(board&&win.webContents.getURL().endsWith('/board/'+board.id)&&await win.webContents.executeJavaScript(`Boolean(document.querySelector('canvas.native-whiteboard-canvas'))`))return store!.get(board.id);
          await new Promise(resolve=>setTimeout(resolve,100));
        }
        throw new Error('File open smoke timeout: '+title);
      };
      const initial=await waitForBoard(request.initialTitle);
      const records=Object.values(initial.snapshot.document.store);
      if(records.filter(record=>record.typeName==='page').length!==request.pageCount||records.filter(record=>record.typeName==='shape').length!==request.shapeCount)throw new Error('Imported content missing');
      const folder=records.find(record=>record.typeName==='shape'&&record.type==='resource') as {props?:{localPath?:string}}|undefined;
      if(!folder?.props?.localPath||!(await readFile(join(folder.props.localPath,'nested','keep.txt'),'utf8')).includes('portable-folder'))throw new Error('Mapped folder not restored');
      const editAndSave=async(marker:string,shortcut:boolean)=>{
        const pageId=Object.values(store!.get(initial.id).snapshot.document.store).find(record=>record.typeName==='page')!.id;
        const response=await fetch(`${localOrigin}/api/boards/${initial.id}/elements`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({pageId,elements:[{kind:'text',text:marker}]})});
        if(!response.ok)throw new Error('Document smoke edit failed');
        await win.webContents.executeJavaScript(shortcut?`window.dispatchEvent(new KeyboardEvent('keydown',{key:'s',${process.platform==='darwin'?'metaKey':'ctrlKey'}:true,bubbles:true,cancelable:true}))`:`document.querySelector('[aria-label="立即保存白板"]').click()`);
        for(let i=0;i<100;i++){if(documents!.info(initial.id)?.dirty===false)return;await new Promise(resolve=>setTimeout(resolve,100));}
        throw new Error('Original document was not saved: '+marker);
      };
      await editAndSave('文件按钮保存验收',false);
      await editAndSave('文件快捷键保存验收',true);
      const reopened=await documents!.read(documents!.info(initial.id)!.path);
      if(reopened.boardId!==initial.id)throw new Error('Reopening created a duplicate document');
      pendingWhiteboards.add(request.runtimePaths);
      await waitForBoard(request.lastTitle);
      fileOpenSmoke={startup:true,runtimeNotification:true,pageCount:request.pageCount,shapeCount:request.shapeCount,mappedFolderRestored:true,buttonWriteBack:true,shortcutWriteBack:true,reopenSameBoard:true,queueDrained:!pendingWhiteboards.pending,boardCount:store.list().length};
    }
    let settingsSmoke:Record<string,unknown>|undefined;
    if(process.env.MOKI_WHITEBOARD_SMOKE_SETTINGS==='1'){
      if(!process.env.MOKI_WHITEBOARD_DATA)throw new Error('Settings smoke requires an isolated data path');
      const pending=join(dirname(process.env.MOKI_WHITEBOARD_DATA),'custom-material-smoke');
      settingsSmoke=await win.webContents.executeJavaScript(`(async()=>{
        const wait=async check=>{for(let i=0;i<50;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,100));}throw new Error('Settings UI timeout');};
        const initial=await window.mokiDesktop.resourceCache.get();
        const scheduled=await window.mokiDesktop.resourceCache.set(${JSON.stringify(pending)});
        document.querySelector('[aria-label="设置"]').click();
        await wait(()=>document.querySelector('#settings-tab-cache'));
        await wait(()=>document.querySelector('.settings-about')?.textContent.includes(${JSON.stringify('v'+APP_VERSION)}));
        if(document.querySelector('.settings-about a')?.getAttribute('href')!==${JSON.stringify(DEVELOPER_CONTACT_URL)})throw new Error('Developer contact link is invalid');
        const tabs=document.querySelectorAll('.settings-tabs [role="tab"]').length;
        document.querySelector('#settings-tab-general').click();
        await wait(()=>document.querySelector('[aria-label="关闭窗口后在托盘运行"]'));
        const desktop=await window.mokiDesktop.desktopSettings.get();
        if(!desktop.trayAvailable)throw new Error('Tray unavailable: '+desktop.trayError);
        document.querySelector('#settings-tab-appearance').click();
        await wait(()=>document.querySelector('.settings-theme-options'));
        document.querySelector('.settings-theme-options [data-theme-mode="dark"]').click();
        await wait(()=>document.documentElement.dataset.colorScheme==='dark');
        document.querySelector('.settings-theme-options [data-theme-mode="system"]').click();
        await wait(()=>localStorage.getItem('moki-whiteboard-theme')==='system');
        document.querySelector('#settings-tab-cache').click();
        await wait(()=>document.querySelector('#material-cache-path')?.value===${JSON.stringify(pending)});
        document.querySelector('#settings-tab-mcp').click();
        await wait(()=>document.querySelector('[aria-label="MCP 连接方式"]'));
        document.querySelector('.mcp-config-details').open=true;
        await wait(()=>document.querySelector('.native-settings-modal pre')?.textContent.includes('moki-whiteboard'));
        if(!Array.from(document.querySelectorAll('button')).some(button=>button.textContent==='复制 Agent 接入说明'))throw new Error('Agent onboarding action missing');
        document.querySelector('[aria-label="关闭设置"]').click();
        await wait(()=>!document.querySelector('.native-settings-modal'));
        return {tabs,about:true,appVersion:${JSON.stringify(APP_VERSION)},themeChanged:true,mcpConfig:true,agentInstructions:true,desktopSettings:true,cacheBridge:true,cachePath:initial.path,pendingPath:scheduled.pendingPath,activePathUnchanged:initial.path===scheduled.path};
      })()`);
      if(settingsSmoke?.tabs!==4||settingsSmoke?.activePathUnchanged!==true)throw new Error('Unified settings smoke failed');
    }
    let native=false;
    if(process.env.MOKI_WHITEBOARD_SMOKE_BOARD==='default')process.env.MOKI_WHITEBOARD_SMOKE_BOARD=store?.get().id;
    if(process.env.MOKI_WHITEBOARD_SMOKE_BOARD){await win.loadURL(`${localOrigin}/board/${encodeURIComponent(process.env.MOKI_WHITEBOARD_SMOKE_BOARD)}`);for(let attempt=0;attempt<50&&!native;attempt++){native=await win.webContents.executeJavaScript(`Boolean(document.querySelector('canvas.native-whiteboard-canvas')&&document.querySelector('[aria-label="插入思维导图"]'))`);if(!native)await new Promise(resolve=>setTimeout(resolve,100));}}
    const config=await (await fetch(`${localOrigin}/api/config`)).json() as {dataPath:string;mcpCommand:string;mcpEntryPath:string;mcpEnv:Record<string,string>};
    let lifecycleSmoke:Record<string,unknown>|undefined;
    if(desktopSettings?.trayAvailable){
      const previous=desktopSettings.closeToTray;desktopSettings.closeToTray=true;
      win.close();if(win.isDestroyed()||win.isVisible())throw new Error('Close did not retain hidden window');
      if(!(await fetch(`${localOrigin}/api/health`)).ok)throw new Error('Background service stopped');
      await openWindow();if(!win.isVisible()||activeWindow!==win)throw new Error('Tray restore did not reuse window');
      desktopSettings.closeToTray=previous;
      lifecycleSmoke={trayCreated:true,closeToTray:true,backgroundService:true,restoreSameWindow:true};
    }
    process.stdout.write(`${JSON.stringify({ ...result,...bridge,native,settingsSmoke,fileOpenSmoke,lifecycleSmoke,url: win.webContents.getURL(),dataPath:config.dataPath,mcpCommand:config.mcpCommand,mcpEntryPath:config.mcpEntryPath,mcpEnv:config.mcpEnv })}\n`);
    const failed=!result.shell||!bridge.preload||!bridge.portable||(process.env.MOKI_WHITEBOARD_SMOKE_BOARD&&!native);
    setTimeout(() => {process.exitCode=failed?1:0;app.quit();}, 250);
  }
}

if(primary)app.whenReady().then(async () => {
  desktopSettings=new DesktopSettings(join(app.getPath('userData'),'desktop-settings.json'),app,process.platform,app.isPackaged,process.execPath);
  installDesktopBridge();
  createTray();
  if(process.platform==='darwin')Menu.setApplicationMenu(Menu.buildFromTemplate([{role:'appMenu'},{role:'editMenu'},{role:'viewMenu'},{role:'windowMenu'}]));
  let login=process.argv.includes(AUTOSTART_ARGUMENT);
  if(process.platform==='darwin'&&app.isPackaged){try{login||=app.getLoginItemSettings().wasOpenedAtLogin;}catch(error){console.warn('无法读取本次登录启动状态：',String(error));}}
  await openWindow(!login||!desktopSettings.trayAvailable||pendingWhiteboards.pending);
  app.on('activate',()=>{void openWindow().catch(showWindowError);});
}).catch(async error=>{console.error(error);if(process.env.MOKI_WHITEBOARD_SMOKE!=='1')dialog.showErrorBox('MOKI 白板启动失败',String(error));await server?.close();store?.close();app.exit(1);});
app.on("window-all-closed", () => { if (!lifecycle.exiting)void lifecycle.quit(); });
app.on('before-quit',event=>lifecycle.beforeQuit(event));
