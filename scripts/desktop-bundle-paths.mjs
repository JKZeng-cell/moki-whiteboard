import {join} from 'node:path';
export function desktopBundlePaths(bundle,platform=process.platform){
 const resources=platform==='darwin'?join(bundle,'Contents','Resources'):join(bundle,'resources');
 return {
  executable:platform==='darwin'?join(bundle,'Contents','MacOS','MOKI Whiteboard'):join(bundle,'MOKI Whiteboard.exe'),
  unpacked:join(resources,'app.asar.unpacked'),
 };
}
