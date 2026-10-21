import {contextBridge,ipcRenderer,webUtils} from 'electron';
contextBridge.exposeInMainWorld('mokiDesktop',{
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
 whiteboardFiles:{hasPending:()=>ipcRenderer.invoke('moki:file-pending'),consume:()=>ipcRenderer.invoke('moki:file-consume'),onPending:(listener:()=>void)=>{ipcRenderer.on('moki:file-pending',listener);return()=>ipcRenderer.removeListener('moki:file-pending',listener);},readResource:(input:unknown)=>ipcRenderer.invoke('moki:read-resource',input),restoreResources:(resources:unknown)=>ipcRenderer.invoke('moki:restore-resources',resources)}
});
