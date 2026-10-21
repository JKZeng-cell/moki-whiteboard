import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {access,mkdir,mkdtemp,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
const run=promisify(execFile);
const root=fileURLToPath(new URL('../',import.meta.url));
await run(process.execPath,[join(root,'scripts/build-installer-file-list.mjs')],{windowsHide:true});
const nsisRoot=join(process.env.LOCALAPPDATA,'electron-builder/Cache/nsis-3.0.4.1');
const compiler=join(nsisRoot,(await readdir(nsisRoot)).find(name=>name.startsWith('nsis-3.0.4.1-')),'Bin/makensis.exe');
const scratch=await mkdtemp(join(tmpdir(),'moki-installer-cache-'));
try{
 const install=join(scratch,'install');await mkdir(install);
 const programEntries=await readdir(join(root,'node_modules/electron/dist'),{withFileTypes:true});
 for(const entry of programEntries){
  const name=entry.name==='electron.exe'?'MOKI Whiteboard.exe':entry.name==='LICENSE'?'LICENSE.electron.txt':entry.name;
  if(entry.isDirectory()){await mkdir(join(install,name));await writeFile(join(install,name,'old-program.txt'),'old');}
  else await writeFile(join(install,name),'old');
 }
 await writeFile(join(install,'uninstall.exe'),'old');
 const caches=['whiteboard-materials','custom-materials'];
 for(const name of caches){await mkdir(join(install,name));await writeFile(join(install,name,'user-material.txt'),'keep');}
 const executable=join(scratch,'cleanup-check.exe');
 const source=['Unicode true','Name "MOKI cache cleanup verification"',`OutFile "${executable}"`,'RequestExecutionLevel user','SilentInstall silent','!define UNINSTALL_FILENAME "uninstall.exe"',`!include "${join(root,'build/installer.nsh')}"`,'Section',`  StrCpy $INSTDIR "${install}"`,'  !insertmacro customRemoveFiles','SectionEnd',''].join('\n');
 await writeFile(join(scratch,'verify.nsi'),source);
 await run(compiler,['/WX','/V2',join(scratch,'verify.nsi')],{windowsHide:true,timeout:60000});
 await run(executable,[],{windowsHide:true,timeout:60000});
 for(const name of caches)assert.equal(await readFile(join(install,name,'user-material.txt'),'utf8'),'keep');
 for(const entry of programEntries){const name=entry.name==='electron.exe'?'MOKI Whiteboard.exe':entry.name==='LICENSE'?'LICENSE.electron.txt':entry.name;await assert.rejects(access(join(install,name)));}
 // Compile file-opening registration / removal without executing registry writes.
 const associations=['Unicode true','Name "MOKI association compile verification"',`OutFile "${join(scratch,'association-compile-only.exe')}"`,'RequestExecutionLevel user','SilentInstall silent','!define UNINSTALL_FILENAME "uninstall.exe"',`!include "${join(root,'build/installer.nsh')}"`,'Section',`  StrCpy $INSTDIR "${install}"`,'  !insertmacro customInstall','  !insertmacro customUnInstall','SectionEnd',''].join('\n');
 await writeFile(join(scratch,'association-compile-only.nsi'),associations);
 await run(compiler,['/WX','/V2',join(scratch,'association-compile-only.nsi')],{windowsHide:true,timeout:60000});
 console.log(JSON.stringify({nsisCompiled:true,fileAssociationMacrosCompiled:true,actualCleanupExecuted:true,programFilesRemoved:true,defaultCachePreserved:true,customCachePreserved:true,registryUntouched:true}));
}finally{
 if(!resolve(scratch).startsWith(resolve(tmpdir())+sep+'moki-installer-cache-'))throw new Error('Unsafe smoke cleanup');
 await rm(scratch,{recursive:true,force:true,maxRetries:8,retryDelay:250});
}
