import { app, BrowserWindow, shell, dialog, ipcMain, clipboard,Menu } from "electron";
import {readDesktopClipboardResources} from '../vendor/moki/desktop/clipboard-resources.js';
import {buildMediaContextMenuTemplate} from '../vendor/moki/desktop/media-context-menu.js';
import {buildAttachmentContextMenuTemplate} from '../vendor/moki/desktop/attachment-context-menu.js';
import { readFile,stat } from 'node:fs/promises';
import {WhiteboardOpenQueue,whiteboardPaths} from './whiteboard-open.js';
import {readWhiteboardTransferResource,restoreWhiteboardTransferResources} from '../vendor/moki/desktop/whiteboard-transfer-resources.js';
import type {DesktopWhiteboardTransferResource} from '../vendor/moki/shared/desktop-whiteboard-transfer-contract.js';
import {createApp} from '../server/app.js';
import {WhiteboardStore} from '../server/store.js';
import {ResourceCache,legacyResourcePath} from '../server/resource-cache.js';
import {DEVELOPER_CONTACT_URL,isAllowedExternalUrl} from '../shared/app-metadata.js';
import {APP_VERSION} from '../server/app-metadata.js';
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
let server: Awaited<ReturnType<typeof createApp>> | undefined;
let store: WhiteboardStore | undefined;
let resourceCache:ResourceCache|undefined;
let activeWindow: BrowserWindow | undefined;
const pendingWhiteboards = new WhiteboardOpenQueue(()=>{
 if(activeWindow&&!activeWindow.isDestroyed())activeWindow.webContents.send('moki:file-pending');
});
pendingWhiteboards.add(whiteboardPaths(process.argv));
const resourceRoot = () => resourceCache?.path??join(process.env.MOKI_WHITEBOARD_DATA ? dirname(process.env.MOKI_WHITEBOARD_DATA) : (app.isPackaged ? app.getPath('userData') : join(process.cwd(),'data')), 'resources');
let localOrigin = 'http://127.0.0.1:4321';
function installDesktopBridge(){
 const requireLocal=(event:Electron.IpcMainInvokeEvent)=>{if(!event.senderFrame?.url.startsWith(localOrigin+'/'))throw new Error('无效桌面调用来源');};
 const handle=(name:string,fn:(...args:any[])=>unknown)=>ipcMain.handle(name,(event,...args)=>{requireLocal(event);return fn(...args);});
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
 handle('moki:file-consume',async()=>{const path=pendingWhiteboards.take();if(!path)return null;try{const info=await stat(path);if(!info.isFile()||info.size>256*1024*1024)throw new Error('请选择不超过 256 MB 的白板文件');return {name:path.split(/[\\/]/).pop(),bytes:new Uint8Array(await readFile(path))};}catch(error){return {name:path,error:String(error)};}});
}
if (process.env.MOKI_WHITEBOARD_SMOKE === "1") app.disableHardwareAcceleration();
if(process.env.MOKI_WHITEBOARD_PROFILE)app.setPath('userData',process.env.MOKI_WHITEBOARD_PROFILE);
else if(app.isPackaged)app.setPath('userData',join(app.getPath('appData'),'moki-whiteboard'));
app.setAppUserModelId('com.moki.whiteboard');
const primary=app.requestSingleInstanceLock();if(!primary)app.quit();
app.on('second-instance',(_event,args)=>{
 pendingWhiteboards.add(whiteboardPaths(args));
 if(activeWindow?.isMinimized())activeWindow.restore();activeWindow?.show();activeWindow?.focus();
});
app.on('open-file',(event,path)=>{event.preventDefault();pendingWhiteboards.add([path]);activeWindow?.show();activeWindow?.focus();});

async function waitForServer(url: string): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { if ((await fetch(url)).ok) return; } catch { /* wait for local API */ }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("MOKI 白板本地服务启动超时");
}

async function openWindow() {
  if (!process.env.MOKI_WHITEBOARD_EXTERNAL_SERVER) {
    const dataPath = process.env.MOKI_WHITEBOARD_DATA ?? (app.isPackaged ? join(app.getPath("userData"), "moki-whiteboard.db") : join(process.cwd(), "data", "moki-whiteboard.db"));
    store=new WhiteboardStore(dataPath);
    const installRoot=dirname(process.execPath);
    resourceCache=new ResourceCache(store,app.isPackaged&&!process.env.MOKI_WHITEBOARD_DATA?join(installRoot,'whiteboard-materials'):legacyResourcePath(store),app.isPackaged?installRoot:undefined);
    try{resourceCache.activate();}catch(error){resourceCache.error='素材目录初始化或迁移失败，继续使用原目录：'+String(error);}
    const runtimeRoot=app.isPackaged?join(app.getAppPath()+'.unpacked','dist'):join(here,'..');
    server=await createApp({store,resourceCache,webRoot:join(runtimeRoot,'web'),mcpRuntime:{command:process.execPath,env:{ELECTRON_RUN_AS_NODE:'1'},entryPath:join(runtimeRoot,'mcp/server.js')}});
    const port=Number(process.env.MOKI_WHITEBOARD_PORT??4322);
    try{localOrigin=await server.listen({host:'127.0.0.1',port});}
    catch(error){if((error as NodeJS.ErrnoException).code!=='EADDRINUSE')throw error;localOrigin=await server.listen({host:'127.0.0.1',port:0});}
  }
  await waitForServer(`${localOrigin}/api/health`);
  const iconRoot=app.isPackaged?join(app.getAppPath()+'.unpacked','dist/web'):join(here,'../web');
  const win = new BrowserWindow({ width: 1440, height: 900, minWidth: 760, minHeight: 560, backgroundColor: "#f2f1f7", title: "MOKI 白板",icon:join(iconRoot,'moki-whiteboard-icon.png'), webPreferences: { contextIsolation: true, sandbox: true, preload:join(here,'preload.cjs') } });
  activeWindow=win;
  win.setMenuBarVisibility(false);
  win.webContents.setWindowOpenHandler(({ url }) => { if(isAllowedExternalUrl(url))void shell.openExternal(url); return { action: "deny" }; });
  await win.loadURL(localOrigin);
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
      pendingWhiteboards.add(request.runtimePaths);
      await waitForBoard(request.lastTitle);
      fileOpenSmoke={startup:true,runtimeNotification:true,pageCount:request.pageCount,shapeCount:request.shapeCount,mappedFolderRestored:true,queueDrained:!pendingWhiteboards.pending,boardCount:store.list().length};
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
        document.querySelector('.settings-theme-options [data-theme-mode="dark"]').click();
        await wait(()=>document.documentElement.dataset.colorScheme==='dark');
        document.querySelector('.settings-theme-options [data-theme-mode="system"]').click();
        await wait(()=>localStorage.getItem('moki-whiteboard-theme')==='system');
        document.querySelector('#settings-tab-cache').click();
        await wait(()=>document.querySelector('#material-cache-path')?.value===${JSON.stringify(pending)});
        document.querySelector('#settings-tab-mcp').click();
        await wait(()=>document.querySelector('.native-settings-modal pre')?.textContent.includes('moki-whiteboard'));
        document.querySelector('[aria-label="关闭设置"]').click();
        await wait(()=>!document.querySelector('.native-settings-modal'));
        return {tabs,about:true,appVersion:${JSON.stringify(APP_VERSION)},themeChanged:true,mcpConfig:true,cacheBridge:true,cachePath:initial.path,pendingPath:scheduled.pendingPath,activePathUnchanged:initial.path===scheduled.path};
      })()`);
      if(settingsSmoke?.tabs!==3||settingsSmoke?.activePathUnchanged!==true)throw new Error('Unified settings smoke failed');
    }
    let native=false;
    if(process.env.MOKI_WHITEBOARD_SMOKE_BOARD==='default')process.env.MOKI_WHITEBOARD_SMOKE_BOARD=store?.get().id;
    if(process.env.MOKI_WHITEBOARD_SMOKE_BOARD){await win.loadURL(`${localOrigin}/board/${encodeURIComponent(process.env.MOKI_WHITEBOARD_SMOKE_BOARD)}`);for(let attempt=0;attempt<50&&!native;attempt++){native=await win.webContents.executeJavaScript(`Boolean(document.querySelector('canvas.native-whiteboard-canvas')&&document.querySelector('[aria-label="插入思维导图"]'))`);if(!native)await new Promise(resolve=>setTimeout(resolve,100));}}
    const config=await (await fetch(`${localOrigin}/api/config`)).json() as {dataPath:string;mcpCommand:string;mcpEntryPath:string;mcpEnv:Record<string,string>};
    process.stdout.write(`${JSON.stringify({ ...result,...bridge,native,settingsSmoke,fileOpenSmoke,url: win.webContents.getURL(),dataPath:config.dataPath,mcpCommand:config.mcpCommand,mcpEntryPath:config.mcpEntryPath,mcpEnv:config.mcpEnv })}\n`);
    const failed=!result.shell||!bridge.preload||!bridge.portable||(process.env.MOKI_WHITEBOARD_SMOKE_BOARD&&!native);
    setTimeout(() => {process.exitCode=failed?1:0;app.quit();}, 250);
  }
}

if(primary)app.whenReady().then(async () => {installDesktopBridge();await openWindow();}).catch(async error=>{console.error(error);if(process.env.MOKI_WHITEBOARD_SMOKE!=='1')dialog.showErrorBox('MOKI 白板启动失败',String(error));await server?.close();store?.close();app.exit(1);});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
let closing=false;
app.on('before-quit',event=>{if(closing||!server)return;event.preventDefault();closing=true;void server.close().finally(()=>{store?.close();app.exit(Number(process.exitCode??0));});});
