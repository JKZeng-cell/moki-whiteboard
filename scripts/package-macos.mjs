import {spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const {version}=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
const arch=process.argv.find(arg=>arg.startsWith('--arch='))?.slice(7)??process.arch;
if(process.platform!=='darwin')throw new Error('Build macOS installers on a macOS host or the macOS Packages workflow.');
if(arch!=='arm64'||process.arch!=='arm64')throw new Error('macOS packaging currently supports Apple Silicon arm64 only: the bundled Office formula engine does not provide a darwin-x64 native binary.');
const output=`release-build-mac-${version}-${arch}-${new Date().toISOString().replace(/[:.]/g,'-')}`;
async function run(args){
 const child=spawn(process.execPath,args,{cwd:root,stdio:'inherit',env:{...process.env,CSC_IDENTITY_AUTO_DISCOVERY:'false'}});
 const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
 if(code!==0)throw new Error(`macOS packaging command failed (${code})`);
}
await run([join(root,'scripts/build-mac-icon.mjs')]);
await run([join(root,'node_modules/vite/bin/vite.js'),'build']);
await run([join(root,'node_modules/typescript/bin/tsc'),'-p','tsconfig.build.json']);
await run([join(root,'node_modules/electron-builder/out/cli/cli.js'),'--config',join(root,'electron-builder.mac.json'),'--mac','dmg','zip',`--${arch}`,'--publish','never',`--config.directories.output=${output}`]);
await run([join(root,'scripts/verify-macos-release.mjs'),join(root,output),arch]);
console.log(`Verified macOS ${arch} artifacts: ${join(root,output)}`);
