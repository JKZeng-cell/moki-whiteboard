import {contextBridge,ipcRenderer,webUtils} from 'electron';
contextBridge.exposeInMainWorld('mokiDesktop',{
 windows:{openBoard:(boardId:string,detachCurrent=false)=>ipcRenderer.invoke('moki:window-board',boardId,detachCurrent),focusBoard:(boardId:string)=>ipcRenderer.invoke('moki:window-focus-board',boardId)},
 desktopSettings:{get:()=>ipcRenderer.invoke('moki:desktop-get'),set:(update:unknown)=>ipcRenderer.invoke('moki:desktop-set',update),quit:()=>ipcRenderer.invoke('moki:desktop-quit')},
 clientUpdates:{get:()=>ipcRenderer.invoke('moki:update-get'),check:()=>ipcRenderer.invoke('moki:update-check'),download:()=>ipcRenderer.invoke('moki:update-download'),reveal:()=>ipcRenderer.invoke('moki:update-reveal'),onChanged:(listener:(state:unknown)=>void)=>{const handler=(_event:Electron.IpcRendererEvent,state:unknown)=>listener(state);ipcRenderer.on('moki:update-changed',handler);return()=>ipcRenderer.removeListener('moki:update-changed',handler);}},
 resourceCache:{get:()=>ipcRenderer.invoke('moki:cache-get'),set:(path:string|null)=>ipcRenderer.invoke('moki:cache-set',path)},
 getPathForFile:(file:File)=>webUtils.getPathForFile(file),
 openLocalPath:(path:string)=>ipcRenderer.invoke('moki:open-path',path),
 openExternalUrl:(url:string)=>ipcRenderer.invoke('moki:open-url',url),
 copyText:(text:string)=>ipcRenderer.invoke('moki:copy-text',text),
 readClipboardResources:()=>ipcRenderer.invoke('moki:clipboard-resources'),
 showMediaContextMenu:(input:unknown)=>ipcRenderer.invoke('moki:media-menu',input),
 showAttachmentContextMenu:(input:unknown)=>ipcRenderer.invoke('moki:attachment-menu',input),
 selectLocalFile:()=>ipcRenderer.invoke('moki:select-file'),
 selectLocalFolder:()=>ipcRenderer.invoke('moki:select-folder'),
 selectSavePath:(name:string)=>ipcRenderer.invoke('moki:save-path',name),
 captureWhiteboardLinkPreview:(rect:unknown)=>ipcRenderer.invoke('moki:capture',rect),
 whiteboardFiles:{hasPending:()=>ipcRenderer.invoke('moki:file-pending'),consume:()=>ipcRenderer.invoke('moki:file-consume'),onPending:(listener:()=>void)=>{ipcRenderer.on('moki:file-pending',listener);return()=>ipcRenderer.removeListener('moki:file-pending',listener);},readDocument:(path:string)=>ipcRenderer.invoke('moki:document-read',path),bindDocument:(token:string,boardId:string,expectedVersion:number)=>ipcRenderer.invoke('moki:document-bind',token,boardId,expectedVersion),documentInfo:(boardId:string)=>ipcRenderer.invoke('moki:document-info',boardId),saveDocument:(boardId:string,onlyIfDirty=false)=>ipcRenderer.invoke('moki:document-save',boardId,onlyIfDirty),saveDocumentAs:(boardId:string)=>ipcRenderer.invoke('moki:document-save-as',boardId),readResource:(input:unknown)=>ipcRenderer.invoke('moki:read-resource',input),restoreResources:(resources:unknown)=>ipcRenderer.invoke('moki:restore-resources',resources)}
});
