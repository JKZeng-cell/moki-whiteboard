import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,mkdtemp,mkdir,rm,readdir,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
const exec=promisify(execFile),out=resolve(process.argv[2]),arch=process.argv[3];
assert.equal(process.platform,'darwin');assert.equal(process.arch,arch);
const {version}=JSON.parse(await readFile('package.json','utf8'));
const names=[`MOKI-Whiteboard-${version}-macOS-${arch}.dmg`,`MOKI-Whiteboard-${version}-macOS-${arch}.zip`];
const scratch=await mkdtemp(join(tmpdir(),'moki-mac-release-'));
try{
 await exec('hdiutil',['verify',join(out,names[0])],{timeout:120000});
 await exec('unzip',['-tq',join(out,names[1])],{timeout:120000,maxBuffer:8*1024*1024});
 const extracted=join(scratch,'extracted');await mkdir(extracted);
 await exec('ditto',['-x','-k',join(out,names[1]),extracted],{timeout:180000});
 const appName=(await readdir(extracted)).find(name=>name.endsWith('.app'));assert.ok(appName,'ZIP must contain an app bundle');
 const app=join(extracted,appName),executable=join(app,'Contents/MacOS/MOKI Whiteboard');
 const {stdout:binaryArch}=await exec('lipo',['-archs',executable]);
 assert.equal(binaryArch.trim(),arch==='x64'?'x86_64':'arm64');
 await exec(process.execPath,['scripts/verify-packaged.mjs',app,out],{timeout:180000,maxBuffer:8*1024*1024});
 await exec(process.execPath,['scripts/verify-file-opening.mjs',app,out],{timeout:180000,maxBuffer:8*1024*1024});
 let signing='unsigned';
 try{const result=await exec('codesign',['--display','--verbose=4',app]);signing=/Signature=adhoc/.test(result.stderr)?'ad-hoc':'inspect signing output';}catch{/* Unsigned build, deliberately no Developer ID credentials. */}
 const files=[];
 for(const name of names){const sha=createHash('sha256');for await(const chunk of createReadStream(join(out,name)))sha.update(chunk);files.push({name,bytes:(await stat(join(out,name))).size,sha256:sha.digest('hex')});}
 await writeFile(join(out,`SHA256SUMS-macOS-${arch}.txt`),files.map(file=>`${file.sha256}  ${file.name}`).join('\n')+'\n');
 const report={version,arch,binaryArch:binaryArch.trim(),runnerOS:(await exec('sw_vers',['-productVersion'])).stdout.trim(),signing,developerIDSigned:false,notarized:false,zipIntegrity:true,dmgIntegrity:true,smokeTestedExtractedZIP:true,files};
 await writeFile(join(out,'macos-release-verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{
 if(!resolve(scratch).startsWith(resolve(tmpdir())+sep+'moki-mac-release-'))throw new Error('Unsafe macOS release scratch cleanup');
 await rm(scratch,{recursive:true,force:true,maxRetries:8,retryDelay:250});
}
