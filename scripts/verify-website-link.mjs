import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const directory=resolve(process.argv[2]);
const beforeHash=process.argv[3],previousVersion=process.argv[4];
assert(beforeHash&&previousVersion,'Pass the original website hash and previous whiteboard version');
const published=JSON.parse(await readFile(join(directory,'cloudbase-public-verification.json'),'utf8'));
assert.equal(published.passed,true);
const version=published.version,url=published.files[0].url;
const website=fileURLToPath(new URL('../../moki-website/',import.meta.url));
const deployed=fileURLToPath(new URL('../../moki-website-deploy/',import.meta.url));
const files=[join(website,'index.html'),join(deployed,'index.html')];
const contents=await Promise.all(files.map(file=>readFile(file,'utf8')));
assert.equal(contents[0],contents[1]);
for(const content of contents){
 assert(content.includes(url));assert(content.includes(`独立白板 · Windows x64 · ${version}`));
 const restored=content.replace(`MOKI-Whiteboard-Setup-${version}-x64.exe`,`MOKI-Whiteboard-Setup-${previousVersion}-x64.exe`).replace(`独立白板 · Windows x64 · ${version}`,`独立白板 · Windows x64 · ${previousVersion}`);
 assert.equal(createHash('sha256').update(restored).digest('hex'),beforeHash,'Only the whiteboard download link and label may change');
}
const reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));
const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
const preview=spawn(process.execPath,[join(website,'serve.mjs')],{cwd:website,windowsHide:true,env:{...process.env,PORT:String(port)},stdio:['ignore','pipe','pipe']});
let errors='';preview.stderr.on('data',chunk=>errors+=chunk);
try{
 await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error('Preview timeout: '+errors)),10000);
  preview.stdout.once('data',()=>{clearTimeout(timer);resolve();});
  preview.once('error',error=>{clearTimeout(timer);reject(error);});
 });
 const response=await fetch(`http://127.0.0.1:${port}/?release=${version}`,{signal:AbortSignal.timeout(10000)});
 assert.equal(response.status,200);const content=await response.text();
 assert(content.includes(url));assert(content.includes(`独立白板 · Windows x64 · ${version}`));
 const report={version,files,downloadUrl:url,onlyWhiteboardLinkAndLabelChanged:true,workbenchLinksAndOtherContentPreserved:true,localPreviewStatus:response.status,temporaryPreview:true,onlineWebsiteDeployed:false,checkedAt:new Date().toISOString()};
 await writeFile(join(directory,'website-download-verification.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report,null,2));
}finally{
 preview.kill();if(preview.exitCode===null)await new Promise(resolve=>preview.once('exit',resolve));
}
