import {posix,win32} from 'node:path';
export function desktopCachePaths(platform:NodeJS.Platform,executable:string,userData:string){
 const paths=platform==='win32'?win32:posix;
 const executableDirectory=paths.dirname(executable);
 const candidate=paths.dirname(paths.dirname(executableDirectory));
 const installPath=platform==='darwin'&&candidate.endsWith('.app')?candidate:executableDirectory;
 return {installPath,defaultPath:paths.join(platform==='darwin'?userData:installPath,'whiteboard-materials')};
}
