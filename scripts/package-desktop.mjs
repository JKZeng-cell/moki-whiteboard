import {spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const {version}=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
const output=`release-build-${version}-${new Date().toISOString().replace(/[:.]/g,'-')}`;
async function run(command,args){
 const child=spawn(command,args,{cwd:root,windowsHide:true,stdio:'inherit',env:{...process.env,CSC_IDENTITY_AUTO_DISCOVERY:'false'}});
 const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve);});
 if(code!==0)throw new Error(`Packaging command failed (${code})`);
}
if(process.platform!=='win32')throw new Error('Windows packaging requires Windows.');
await run(process.execPath,[join(root,'scripts/build-whiteboard-icon.mjs')]);
await run(process.execPath,[join(root,'scripts/build-installer-file-list.mjs')]);
await run(process.execPath,[join(root,'node_modules/vite/bin/vite.js'),'build']);
await run(process.execPath,[join(root,'node_modules/typescript/bin/tsc'),'-p','tsconfig.build.json']);
await run(process.execPath,[join(root,'node_modules/electron-builder/out/cli/cli.js'),'--win','nsis','zip','--x64',`--config.directories.output=${output}`]);
console.log(`Windows client artifacts: ${join(root,output)}`);
