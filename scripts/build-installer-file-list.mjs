import {readdir,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const entries=await readdir(join(root,'node_modules/electron/dist'),{withFileTypes:true});
const lines=['; Generated from the Electron distribution. Only these program entries may be removed.','!macro MokiRemoveProgramFiles'];
for(const entry of entries){
  const name=entry.name==='electron.exe'?'MOKI Whiteboard.exe':entry.name==='LICENSE'?'LICENSE.electron.txt':entry.name;
  if(!/^[a-zA-Z0-9_. -]+$/.test(name)||name==='whiteboard-materials')throw new Error('Unsafe installer program entry');
  lines.push(`  IfFileExists "$INSTDIR\\${name}" 0 +5`,'  ClearErrors',`  ${entry.isDirectory()?'RMDir /r':'Delete'} "$INSTDIR\\${name}"`,'  IfErrors 0 +2','    Abort "Program file is busy. Close MOKI Whiteboard and retry."');
}
lines.push('!macroend','');
await mkdir(join(root,'build'),{recursive:true});
await writeFile(join(root,'build/installer-files.nsh'),lines.join('\n'));
console.log('Generated safe installer removal manifest');
