import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,readdir,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {basename,join,resolve} from 'node:path';

const exec=promisify(execFile),directory=resolve(process.argv[2]);
const manifest=JSON.parse(await readFile('docs/releases/macos-0.1.7-arm64.json','utf8'));
assert.equal(process.env.GITHUB_REPOSITORY??manifest.repository,manifest.repository,'Run only in the intended repository');
const repo=manifest.repository,api=async path=>JSON.parse((await exec('gh',['api',`repos/${repo}/${path}`])).stdout);
const run=await api(`actions/runs/${manifest.runId}`);
assert.equal(run.conclusion,'success');assert.equal(run.head_sha,manifest.sourceCommit);
const artifact=await api(`actions/artifacts/${manifest.artifactId}`);
assert.equal(artifact.expired,false);assert.equal(artifact.name,manifest.artifactName);
assert.equal(artifact.workflow_run.id,manifest.runId);assert.equal(artifact.workflow_run.head_sha,manifest.sourceCommit);
async function listFiles(path){
 const files=[];
 for(const entry of await readdir(path,{withFileTypes:true})){
  assert.ok(!entry.isSymbolicLink(),'Unexpected artifact symlink');
  if(entry.isDirectory())files.push(...await listFiles(join(path,entry.name)));
  else files.push(join(path,entry.name));
 }
 return files;
}
const files=await listFiles(directory);
function find(name){const matches=files.filter(path=>basename(path)===name);assert.equal(matches.length,1,`Expected exactly one ${name}`);return matches[0];}
async function hashFile(path){const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);return hash.digest('hex');}
const report=JSON.parse(await readFile(find('macos-release-verification.json'),'utf8'));
assert.equal(report.version,manifest.version);assert.equal(report.arch,manifest.arch);assert.equal(report.binaryArch,'arm64');
for(const key of ['zipIntegrity','dmgIntegrity','smokeTestedExtractedZIP'])assert.equal(report[key],true);
assert.equal(report.developerIDSigned,false);assert.equal(report.notarized,false);
assert.deepEqual(report.files,manifest.files);
const desktop=JSON.parse(await readFile(find('local-verification.json'),'utf8'));
assert.equal(desktop.tools,16);assert.equal(desktop.stdioReadWrite,true);assert.equal(desktop.native,true);assert.equal(desktop.office.viewerStatus,200);
const opening=JSON.parse(await readFile(find('file-opening-verification.json'),'utf8'));
assert.equal(opening.packaged,true);assert.equal(opening.fileOpenSmoke.startup,true);assert.equal(opening.fileOpenSmoke.runtimeNotification,true);
const publishFiles=[];
for(const file of manifest.files){
 const path=find(file.name);assert.equal((await stat(path)).size,file.bytes);assert.equal(await hashFile(path),file.sha256);
 publishFiles.push({...file,path});
}
const checksums=join(directory,`SHA256SUMS-${manifest.version}-macOS-${manifest.arch}.txt`);
await writeFile(checksums,manifest.files.map(file=>`${file.sha256}  ${file.name}`).join('\n')+'\n');
const verification=join(directory,`macOS-${manifest.version}-${manifest.arch}-verification.json`);
await writeFile(verification,JSON.stringify({...report,sourceCommit:manifest.sourceCommit,buildRunURL:run.html_url},null,2)+'\n');
for(const path of [checksums,verification])publishFiles.push({path,name:basename(path),bytes:(await stat(path)).size,sha256:await hashFile(path)});
const before=await api(`releases/tags/${manifest.tag}`);
assert.equal(before.id,manifest.releaseId);assert.equal(before.draft,false);assert.equal(before.prerelease,false);
for(const file of publishFiles){
 const existing=before.assets.find(asset=>asset.name===file.name);
 if(existing){assert.equal(existing.size,file.bytes);assert.equal(existing.digest,`sha256:${file.sha256}`,'Refuse to replace an existing asset with different bytes');}
}
const marker='<!-- macos-arm64-0.1.7 -->';
const obsolete='This release does not publish a macOS/Linux package, a public npm package, or a hosted remote MCP service. No CloudBase or website download links are changed by this GitHub release.';
const addition=(await readFile('docs/releases/macos-0.1.7-notes.md','utf8')).trim();
let notes=before.body??'';
if(notes.includes(marker))assert.ok(notes.trim().endsWith(addition),'Existing macOS notes have changed; review before updating');
else{
 assert.ok(notes.includes(obsolete),'Existing release notes changed; review before updating');
 notes=notes.replace(obsolete,'Linux packages, a public npm package, and a hosted remote MCP service are not published. CloudBase and website downloads are unchanged.').trim()+'\n\n'+addition+'\n';
}
const notesPath=join(directory,'release-notes.md');await writeFile(notesPath,notes);
console.log(JSON.stringify({verified:true,tag:manifest.tag,source:manifest.sourceCommit,files:publishFiles.map(({path,...file})=>file),existingAssets:before.assets.length},null,2));
if(!process.argv.includes('--verify-only')){
 for(const file of publishFiles){
  if(!before.assets.some(asset=>asset.name===file.name))await exec('gh',['release','upload',manifest.tag,file.path,'--repo',repo],{timeout:300000});
 }
 await exec('gh',['release','edit',manifest.tag,'--repo',repo,'--notes-file',notesPath]);
 const after=await api(`releases/tags/${manifest.tag}`);
 assert.equal(after.id,before.id);assert.equal(after.body.trim(),notes.trim());
 for(const asset of before.assets){const current=after.assets.find(value=>value.id===asset.id);assert.ok(current,'Existing asset removed');assert.equal(current.name,asset.name);assert.equal(current.digest,asset.digest);assert.equal(current.size,asset.size);}
 const verified=[];
 for(const file of publishFiles){
  const asset=after.assets.find(asset=>asset.name===file.name);assert.ok(asset);assert.equal(asset.state,'uploaded');assert.equal(asset.size,file.bytes);assert.equal(asset.digest,`sha256:${file.sha256}`);
  // No authentication headers: verify the actual public download bytes.
  const response=await fetch(asset.browser_download_url,{signal:AbortSignal.timeout(180000)});
  assert.equal(response.status,200);const hash=createHash('sha256');let bytes=0;
  for await(const chunk of response.body){hash.update(chunk);bytes+=chunk.length;}
  assert.equal(bytes,file.bytes);assert.equal(hash.digest('hex'),file.sha256);
  verified.push({name:file.name,url:asset.browser_download_url,bytes,sha256:file.sha256,publicDownloadVerified:true});
 }
 const result={published:true,version:manifest.version,sourceCommit:manifest.sourceCommit,buildRunId:manifest.runId,releaseURL:after.html_url,existingAssetsPreserved:true,releaseNotesUpdated:true,files:verified};
 await writeFile(join(directory,'github-macos-release-verification.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
}
