import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createReadStream,existsSync} from 'node:fs';
import {readFile,stat,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';

const directory=resolve(process.argv[2]);
const {version}=JSON.parse(await readFile(join(directory,'win-unpacked/resources/app.asar.unpacked/package.json'),'utf8'));
const {version:sourceVersion}=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
assert.equal(version,sourceVersion);
const verified=JSON.parse(await readFile(join(directory,'local-verification.json'),'utf8'));
assert.equal(verified.settingsSmoke.appVersion,version);assert.equal(verified.protocolErrors,0);assert.equal(verified.tools,16);
const names=[`MOKI-Whiteboard-Setup-${version}-x64.exe`,`MOKI-Whiteboard-Setup-${version}-x64.exe.blockmap`,`MOKI-Whiteboard-${version}-Windows-x64.zip`];
const files=[];
for(const name of names){const hash=createHash('sha256'),hash512=createHash('sha512');for await(const chunk of createReadStream(join(directory,name))){hash.update(chunk);hash512.update(chunk);}const bytes=(await stat(join(directory,name))).size;assert.ok(bytes>0);files.push({name,bytes,sha256:hash.digest('hex'),sha512:hash512.digest('base64')});}
const checksums=files.map(file=>`${file.sha256}  ${file.name}`).join('\n')+'\n';
await writeFile(join(directory,'SHA256SUMS.txt'),checksums);await writeFile(join(directory,`SHA256SUMS-${version}.txt`),checksums);
if(existsSync(join(directory,'latest.yml'))){const manifest=await readFile(join(directory,'latest.yml'),'utf8');assert.match(manifest,new RegExp(`^version: ${version.replaceAll('.','\\.')}\\r?$`,'m'));assert.ok(manifest.includes(names[0]));assert.equal(manifest.match(/^sha512:\s*(.+)$/m)?.[1].trim(),files[0].sha512);}
const updateBase='https://mokiupdate-d3g1pzxx41425d6e7-1452903096.tcloudbaseapp.com/updates/';
const baseline=[];
if(!process.argv.includes('--local-only')){
 for(const name of ['latest.yml','latest-mac.yml']){const url=updateBase+name;const response=await fetch(url+'?baseline='+Date.now(),{headers:{'Cache-Control':'no-cache'},signal:AbortSignal.timeout(30000)});assert.equal(response.status,200);const bytes=Buffer.from(await response.arrayBuffer());baseline.push({url,version:bytes.toString().match(/^version:\s*(.+)$/m)?.[1].trim(),sha256:createHash('sha256').update(bytes).digest('hex')});}
 await writeFile(join(directory,'workbench-update-baseline.json'),JSON.stringify(baseline,null,2)+'\n');
}
const report={version,checkedAt:new Date().toISOString(),files,workbenchUpdates:baseline};
await writeFile(join(directory,'artifact-audit.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
