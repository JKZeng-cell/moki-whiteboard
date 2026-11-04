import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {join,resolve,basename} from 'node:path';

// Only publish new revision tags after both native builds pass. Never replace assets.
const exec=promisify(execFile),root=resolve(process.argv[2]),repo=process.env.GITHUB_REPOSITORY;
assert.equal(repo,'JKZeng-cell/moki-whiteboard');
const version=JSON.parse(await readFile('package.json','utf8')).version;
const tag=process.env.RELEASE_TAG,sourceCommit=process.env.GITHUB_SHA;
assert.match(tag??'',new RegExp(`^v${version.replaceAll('.','\\.')}-r[1-9][0-9]*$`));
assert.match(sourceCommit??'',/^[a-f0-9]{40}$/u);
assert.equal((await exec('git',['rev-parse','HEAD'])).stdout.trim(),sourceCommit);
const gh=async args=>(await exec('gh',args,{timeout:20*60_000,maxBuffer:8*1024*1024})).stdout;
const api=async path=>JSON.parse(await gh(['api',`repos/${repo}/${path}`]));
const before=await api('releases?per_page=100');assert.ok(!before.some(item=>item.tag_name===tag),'Revision tag already has a Release; choose a new tag instead of overwriting');
const oldAssets=before.map(item=>({tag:item.tag_name,id:item.id,assets:item.assets.map(asset=>({id:asset.id,name:asset.name,size:asset.size,digest:asset.digest}))}));
const read=async(platform,name)=>JSON.parse(await readFile(join(root,platform,name),'utf8'));
const nativeChecks={};
for(const platform of ['windows','macos']){
 const local=await read(platform,'local-verification.json'),opening=await read(platform,'file-opening-verification.json'),source=await read(platform,'source-verification.json');
 assert.equal(local.packaged,true);assert.equal(local.native,true);assert.equal(local.tools,16);assert.equal(local.protocolErrors,0);assert.equal(local.stdioReadWrite,true);assert.equal(local.office.viewerStatus,200);
 assert.equal(local.settingsSmoke.appVersion,version);assert.equal(local.settingsSmoke.tabs,4);assert.equal(local.settingsSmoke.desktopSettings,true);assert.equal(local.settingsSmoke.agentInstructions,true);
 for(const key of ['trayCreated','closeToTray','backgroundService','restoreSameWindow'])assert.equal(local.lifecycleSmoke[key],true);
 assert.equal(opening.packaged,true);for(const key of ['startup','runtimeNotification','buttonWriteBack','shortcutWriteBack','reopenSameBoard','mappedFolderRestored'])assert.equal(opening.fileOpenSmoke[key],true);
 assert.equal(source.passed,true);assert.equal(source.compiledSourceIdentical,true);assert.equal(source.sourceCommit,sourceCommit);assert.equal(source.version,version);assert.ok(source.sourceFiles>0);
 nativeChecks[platform]={packaged:true,mcpTools:16,protocolErrors:0,officeViewer:true,settings:true,trayLifecycle:true,originalFileSaveAndReopen:true,compiledSourceIdentical:true,sourceFiles:source.sourceFiles};
}
const mac=await read('macos','macos-release-verification.json');assert.equal(mac.version,version);assert.equal(mac.arch,'arm64');assert.equal(mac.binaryArch,'arm64');for(const key of ['zipIntegrity','dmgIntegrity','smokeTestedExtractedZIP'])assert.equal(mac[key],true);
const win=await read('windows','artifact-audit.json');assert.equal(win.version,version);
const files=[];
async function digest(path){const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);return hash.digest('hex');}
for(const [platform,entries] of [['windows',win.files],['macos',mac.files]])for(const entry of entries){
 assert.equal(basename(entry.name),entry.name);assert.match(entry.name,/^MOKI-Whiteboard-[A-Za-z0-9.-]+$/u);
 const path=join(root,platform,entry.name),size=(await stat(path)).size;assert.equal(size,entry.bytes);assert.equal(await digest(path),entry.sha256);files.push({platform,name:entry.name,bytes:size,sha256:entry.sha256,path});
}
assert.equal(files.length,5);
const upload=[...files];
for(const [suffix,entries] of [['',files],['-Windows-x64',files.filter(item=>item.platform==='windows')],['-macOS-arm64',files.filter(item=>item.platform==='macos')]]){
 const name=`SHA256SUMS-${version}${suffix}.txt`,path=join(root,name);await writeFile(path,entries.map(item=>`${item.sha256}  ${item.name}`).join('\n')+'\n');upload.push({name,path,bytes:(await stat(path)).size,sha256:await digest(path)});
}
const verification={version,tag,sourceCommit,workflowRun:Number(process.env.GITHUB_RUN_ID),nativeChecks,signing:{windows:'unsigned',macOS:mac.signing,developerIDSigned:mac.developerIDSigned,notarized:mac.notarized},files:files.map(({path,...item})=>item)};
const verificationName=`verification-${tag}.json`,verificationPath=join(root,verificationName);await writeFile(verificationPath,JSON.stringify(verification,null,2));upload.push({name:verificationName,path:verificationPath,bytes:(await stat(verificationPath)).size,sha256:await digest(verificationPath)});
await gh(['release','create',tag,'--repo',repo,'--target',sourceCommit,'--draft','--title',`MOKI Whiteboard ${version} · 2026-11-04 update`,'--notes-file','docs/releases/v0.1.8-r2-notes.md']);
for(const file of upload)await gh(['release','upload',tag,file.path,'--repo',repo]);
let published=(await api('releases?per_page=100')).find(item=>item.tag_name===tag);assert.ok(published);assert.equal(published.target_commitish,sourceCommit);assert.equal(published.assets.length,upload.length);
for(const file of upload){const asset=published.assets.find(item=>item.name===file.name);assert.equal(asset?.state,'uploaded');assert.equal(asset.size,file.bytes);assert.equal(asset.digest,'sha256:'+file.sha256);}
await gh(['release','edit',tag,'--repo',repo,'--draft=false','--latest']);
published=await api(`releases/tags/${tag}`);assert.equal(published.draft,false);
for(const file of upload){
 const asset=published.assets.find(item=>item.name===file.name);let verified=false;
 for(let attempt=0;attempt<3&&!verified;attempt++)try{
  const response=await fetch(asset.browser_download_url,{signal:AbortSignal.timeout(10*60_000)});assert.equal(response.status,200);const hash=createHash('sha256');let size=0;
  for await(const chunk of response.body){size+=chunk.length;hash.update(chunk);}assert.equal(size,file.bytes);assert.equal(hash.digest('hex'),file.sha256);verified=true;
 }catch(error){if(attempt===2)throw error;await new Promise(resolve=>setTimeout(resolve,2000));}
}
for(const previous of oldAssets){const current=await api(`releases/${previous.id}`);assert.deepEqual(current.assets.map(asset=>({id:asset.id,name:asset.name,size:asset.size,digest:asset.digest})),previous.assets,'Existing Release assets changed');}
const report={...verification,url:published.html_url,releaseId:published.id,publicDownloadsVerified:true,previousAssetsUnchanged:true,assets:published.assets.map(asset=>({name:asset.name,id:asset.id,size:asset.size,digest:asset.digest,url:asset.browser_download_url}))};
await writeFile(join(root,'published-release.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({tag,url:report.url,sourceCommit,assets:report.assets.length,publicDownloadsVerified:true,previousAssetsUnchanged:true}));
