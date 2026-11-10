import {createHash,randomUUID} from 'node:crypto';
import {open,rename,unlink,stat} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {APP_RELEASE_REPOSITORY} from '../shared/app-release.js';
import type {ClientUpdateState} from '../shared/client-update-contract.js';

const releaseRoot='https://github.com/'+APP_RELEASE_REPOSITORY+'/releases/';
export const LATEST_RELEASE_API='https://api.github.com/repos/'+APP_RELEASE_REPOSITORY+'/releases/latest';
type Candidate={tag:string;releaseUrl:string;fileName:string;url:string;bytes:number;sha256:string};
type Options={currentTag:string;platform:string;arch:string;enabled:boolean;fetch?:(url:string,init?:RequestInit)=>Promise<Response>;chooseFile:(name:string)=>Promise<string|null>;reveal:(path:string)=>void;changed?:(state:ClientUpdateState)=>void};
function version(tag:string){const match=/^v(\d+)\.(\d+)\.(\d+)(?:-r([1-9]\d*))?$/u.exec(tag);return match?match.slice(1).map(value=>Number(value??0)):undefined;}
export function newerRelease(next:string,current:string){const a=version(next),b=version(current);if(!a||!b)return false;for(let i=0;i<4;i++){if(!Number.isSafeInteger(a[i])||!Number.isSafeInteger(b[i]))return false;if(a[i]!==b[i])return a[i]!>b[i]!;}return false;}
export function releaseCandidate(value:unknown,currentTag:string,platform:string,arch:string):Candidate|undefined{
 if(!value||typeof value!=='object')throw Error('GitHub 返回了无效的更新信息');
 const release=value as Record<string,unknown>,tag=String(release.tag_name??'');
 if(release.draft!==false||release.prerelease!==false||!version(tag))throw Error('不是有效的稳定发布');
 if(!newerRelease(tag,currentTag))return;
 const parts=version(tag)!,appVersion=parts.slice(0,3).join('.');
 const name=platform==='win32'&&arch==='x64'?`MOKI-Whiteboard-Setup-${appVersion}-x64.exe`:platform==='darwin'&&arch==='arm64'?`MOKI-Whiteboard-${appVersion}-macOS-arm64.dmg`:undefined;
 if(!name)throw Error('当前平台暂不提供更新安装包');
 const assets=Array.isArray(release.assets)?release.assets:[];
 const matches=assets.filter((asset:any)=>asset&&asset.name===name&&asset.state==='uploaded');
 if(matches.length!==1)throw Error('新版本安装包尚未就绪，请稍后检查');
 const asset=matches[0],url=releaseRoot+'download/'+encodeURIComponent(tag)+'/'+name,releaseUrl=releaseRoot+'tag/'+encodeURIComponent(tag);
 if(asset.browser_download_url!==url||release.html_url!==releaseUrl||!Number.isSafeInteger(asset.size)||asset.size<=0||!/^sha256:[a-f0-9]{64}$/u.test(String(asset.digest)))throw Error('安装包来源或校验信息无效');
 return {tag,releaseUrl,fileName:name.replace(appVersion,tag.slice(1)),url,bytes:asset.size,sha256:asset.digest.slice(7)};
}

/** One main-process updater for every window; never runs git or installs during editing. */
export class DesktopUpdates{
 private state:ClientUpdateState;
 private candidate:Candidate|undefined;
 private completed:{tag:string;path:string}|undefined;
 private pending:Promise<ClientUpdateState>|undefined;
 private controller=new AbortController();
 private startup:ReturnType<typeof setTimeout>|undefined;
 private interval:ReturnType<typeof setInterval>|undefined;
 private disposed=false;
 private readonly fetch:(url:string,init?:RequestInit)=>Promise<Response>;
 constructor(private readonly options:Options){
  this.fetch=options.fetch??globalThis.fetch;
  const supported=options.enabled&&(options.platform==='win32'&&options.arch==='x64'||options.platform==='darwin'&&options.arch==='arm64');
  this.state={state:supported?'idle':'unsupported',currentTag:options.currentTag,...(!supported?{message:'自动更新仅在 Windows x64 / macOS Apple Silicon 正式客户端中可用。'}:{})};
 }
 get(){return structuredClone(this.state);}
 private publish(patch:Partial<ClientUpdateState>){this.state={...this.state,...patch};if(!this.disposed)this.options.changed?.(this.get());return this.get();}
 private run(task:()=>Promise<ClientUpdateState>){
  if(this.disposed||this.state.state==='unsupported')return Promise.resolve(this.get());
  if(this.pending)return this.pending;
  this.pending=Promise.resolve().then(task).catch(error=>this.publish({state:'error',message:error instanceof Error?error.message:'更新请求失败，请检查网络后重试。'})).finally(()=>{this.pending=undefined;});return this.pending;
 }
 start(){if(this.startup||this.interval||this.disposed||this.state.state==='unsupported')return;this.startup=setTimeout(()=>{this.startup=undefined;void this.check();},12_000);this.interval=setInterval(()=>void this.check(),6*60*60_000);}
 check(){return this.run(async()=>{
  this.publish({state:'checking',message:undefined});
  const response=await this.fetch(LATEST_RELEASE_API,{headers:{Accept:'application/vnd.github+json'},signal:AbortSignal.any([this.controller.signal,AbortSignal.timeout(20_000)])});
  if(!response.ok)throw Error(response.status===403||response.status===429?'GitHub 检查频率受限，请稍后重试。':'无法连接 GitHub 更新服务，请检查网络后重试。');
  const candidate=releaseCandidate(await response.json(),this.options.currentTag,this.options.platform,this.options.arch);this.candidate=candidate;
  const checkedAt=new Date().toISOString();
  if(!candidate){this.completed=undefined;this.state={state:'current',currentTag:this.options.currentTag,checkedAt};return this.publish({});}
  if(this.completed?.tag!==candidate.tag)this.completed=undefined;
  return this.publish({state:this.completed?'downloaded':'available',availableTag:candidate.tag,releaseUrl:candidate.releaseUrl,fileName:candidate.fileName,bytes:candidate.bytes,percent:this.completed?100:0,checkedAt});
 });}
 download(){return this.run(async()=>{
  const candidate=this.candidate;if(!candidate)return this.get();
  if(this.completed?.tag===candidate.tag)return this.publish({state:'downloaded'});
  this.publish({state:'downloading',message:undefined,percent:0});
  const destination=await this.options.chooseFile(candidate.fileName);
  if(!destination)return this.publish({state:'available'});
  const temporary=join(dirname(destination),'.moki-update-'+randomUUID()+'.partial');
  let committed=false;
  try{
   const response=await this.fetch(candidate.url,{signal:AbortSignal.any([this.controller.signal,AbortSignal.timeout(20*60_000)])});
   if(!response.ok||!response.body)throw Error('安装包下载失败，请稍后重试。');
   const file=await open(temporary,'wx'),reader=response.body.getReader(),hash=createHash('sha256');let bytes=0,last=0,finished=false;
   try{
    while(true){const {done,value}=await reader.read();if(done){finished=true;break;}bytes+=value.byteLength;if(bytes>candidate.bytes)throw Error('安装包大小校验失败，已保留原文件。');hash.update(value);await file.writeFile(value);
     if(Date.now()-last>150){last=Date.now();this.publish({percent:Math.floor(bytes/candidate.bytes*100)});}
    }
    if(bytes!==candidate.bytes||hash.digest('hex')!==candidate.sha256)throw Error('安装包校验失败，请重新下载。');
    await file.sync();
   }finally{if(!finished)await reader.cancel().catch(()=>{});await file.close();}
   await rename(temporary,destination);committed=true;this.completed={tag:candidate.tag,path:destination};
   return this.publish({state:'downloaded',percent:100,message:'安装包已下载并校验。请先保存白板，再运行安装包完成更新。'});
  }finally{if(!committed)await unlink(temporary).catch(()=>{});}
 });}
 async reveal(){
  if(!this.completed)return this.get();
  try{if(!(await stat(this.completed.path)).isFile())throw Error();this.options.reveal(this.completed.path);return this.get();}
  catch{this.completed=undefined;return this.publish({state:'available',message:'下载文件已移动或删除，请重新下载。'});}
 }
 async dispose(){this.disposed=true;clearTimeout(this.startup);clearInterval(this.interval);this.controller.abort();await this.pending;}
}
