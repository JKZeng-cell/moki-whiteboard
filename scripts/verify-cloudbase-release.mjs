import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {readFile, stat, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';

const directory=resolve(process.argv[2]);
const {version}=JSON.parse(await readFile(join(directory,'win-unpacked/resources/app.asar.unpacked/package.json'),'utf8'));
const base='https://mokiupdate-d3g1pzxx41425d6e7-1452903096.tcloudbaseapp.com/whiteboard/';
const names=[`MOKI-Whiteboard-Setup-${version}-x64.exe`,`MOKI-Whiteboard-Setup-${version}-x64.exe.blockmap`,`MOKI-Whiteboard-${version}-Windows-x64.zip`,`SHA256SUMS-${version}.txt`];
const report={version,base,checkedAt:new Date().toISOString(),files:[],workbenchUpdates:[],passed:false};
async function digest(stream){
  const hash=createHash('sha256');let bytes=0;
  for await(const chunk of stream){hash.update(chunk);bytes+=chunk.length;}
  return {bytes,sha256:hash.digest('hex')};
}
try{
  for(const name of names){
    const file=join(directory,name.startsWith('SHA256SUMS-')?'SHA256SUMS.txt':name);
    const local=await digest(createReadStream(file));
    assert.equal(local.bytes,(await stat(file)).size);
    const url=base+name;
    const response=await fetch(`${url}?verify=${Date.now()}`,{headers:{'Cache-Control':'no-cache'},signal:AbortSignal.timeout(300000)});
    assert.equal(response.status,200,`Public HTTP status: ${name}`);
    const remote=await digest(response.body);
    assert.deepEqual(remote,local,`Public bytes/checksum: ${name}`);
    const plain=await fetch(url,{method:'HEAD',signal:AbortSignal.timeout(30000)});
    assert.equal(plain.status,200,`Plain public URL: ${name}`);
    if(plain.headers.has('content-length'))assert.equal(Number(plain.headers.get('content-length')),local.bytes);
    report.files.push({name,url,status:200,...remote});
    console.log(`Verified ${name}: ${remote.bytes} bytes, SHA-256 ${remote.sha256}`);
  }
  const baseline=JSON.parse(await readFile(join(directory,'workbench-update-baseline.json'),'utf8'));
  for(const item of baseline){
    const response=await fetch(item.url+`?verify=${Date.now()}`,{headers:{'Cache-Control':'no-cache'},signal:AbortSignal.timeout(30000)});
    assert.equal(response.status,200);
    const remote=await digest(response.body);
    assert.equal(remote.sha256,item.sha256,`Workbench manifest changed: ${item.url}`);
    report.workbenchUpdates.push({url:item.url,...remote,unchanged:true});
  }
  report.passed=true;
}catch(error){report.error=String(error.stack??error);process.exitCode=1;}
await writeFile(join(directory,'cloudbase-public-verification.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
