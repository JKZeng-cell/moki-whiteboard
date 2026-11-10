import {afterEach,expect,it,vi} from 'vitest';
import {mkdtemp,readFile,readdir,rm,writeFile,unlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,basename,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {DesktopUpdates,LATEST_RELEASE_API,newerRelease,releaseCandidate} from '../src/desktop/updates.js';
const payload='verified installer bytes',roots:string[]=[],services:DesktopUpdates[]=[];
const hash=createHash('sha256').update(payload).digest('hex');
function release(tag='v0.1.8-r9',platform='win32'){
 const name=platform==='win32'?'MOKI-Whiteboard-Setup-0.1.8-x64.exe':'MOKI-Whiteboard-0.1.8-macOS-arm64.dmg';
 return {tag_name:tag,draft:false,prerelease:false,html_url:'https://github.com/JKZeng-cell/moki-whiteboard/releases/tag/'+tag,assets:[{name,state:'uploaded',browser_download_url:'https://github.com/JKZeng-cell/moki-whiteboard/releases/download/'+tag+'/'+name,size:Buffer.byteLength(payload),digest:'sha256:'+hash}]};
}
async function setup(options:Partial<ConstructorParameters<typeof DesktopUpdates>[0]>={}){
 const root=await mkdtemp(join(tmpdir(),'moki-updates-'));roots.push(root);const destination=join(root,'update.exe');
 const fetch=vi.fn(async(url:string)=>url===LATEST_RELEASE_API?new Response(JSON.stringify(release())):new Response(payload));
 const reveal=vi.fn(),chooseFile=vi.fn(async()=>destination),changed=vi.fn();
 const service=new DesktopUpdates({currentTag:'v0.1.8-r8',platform:'win32',arch:'x64',enabled:true,fetch,chooseFile,reveal,changed,...options});services.push(service);
 return {root,destination,fetch,reveal,chooseFile,changed,service};
}
afterEach(async()=>{await Promise.all(services.splice(0).map(service=>service.dispose()));vi.useRealTimers();for(const root of roots.splice(0)){if(dirname(root)!==resolve(tmpdir())||!basename(root).startsWith('moki-updates-'))throw Error('Unsafe cleanup');await rm(root,{recursive:true,force:true});}});

it('compares package revisions numerically without requiring an application version bump',()=>{
 expect(newerRelease('v0.1.8-r10','v0.1.8-r9')).toBe(true);expect(newerRelease('v0.1.9','v0.1.8-r99')).toBe(true);
 for(const next of ['v0.1.8-r8','v0.1.8-r7','v0.1.7-r99','v0.1.9-beta','not-a-version'])expect(newerRelease(next,'v0.1.8-r8')).toBe(false);
 expect(releaseCandidate(release(),'v0.1.8-r8','win32','x64')?.fileName).toBe('MOKI-Whiteboard-Setup-0.1.8-r9-x64.exe');
 expect(releaseCandidate(release('v0.1.8-r9','darwin'),'v0.1.8-r8','darwin','arm64')?.fileName).toContain('r9-macOS-arm64.dmg');
});
it('rejects draft releases, foreign download sources, missing hashes and missing platform packages',()=>{
 const draft=release();draft.draft=true;expect(()=>releaseCandidate(draft,'v0.1.8-r8','win32','x64')).toThrow();
 for(const field of ['digest','browser_download_url']){const value=release();value.assets[0]![field as 'digest']='https://evil.example/update.exe';expect(()=>releaseCandidate(value,'v0.1.8-r8','win32','x64')).toThrow();}
 expect(()=>releaseCandidate({...release(),assets:[]},'v0.1.8-r8','darwin','arm64')).toThrow('尚未就绪');
});
it('checks automatically without downloading or prompting for a save location',async()=>{
 vi.useFakeTimers();const {service,fetch,chooseFile}=await setup();service.start();await vi.advanceTimersByTimeAsync(12_000);
 expect(service.get()).toMatchObject({state:'available',currentTag:'v0.1.8-r8',availableTag:'v0.1.8-r9'});
 expect(fetch).toHaveBeenCalledTimes(1);expect(chooseFile).not.toHaveBeenCalled();await vi.advanceTimersByTimeAsync(6*60*60_000);expect(fetch).toHaveBeenCalledTimes(2);
});
it('streams, verifies and atomically saves only after an explicit download request',async()=>{
 const {service,destination,fetch,reveal,chooseFile}=await setup();await service.check();expect(fetch).toHaveBeenCalledTimes(1);
 expect(await service.download()).toMatchObject({state:'downloaded',percent:100});expect(await readFile(destination,'utf8')).toBe(payload);
 expect(chooseFile).toHaveBeenCalledWith('MOKI-Whiteboard-Setup-0.1.8-r9-x64.exe');await service.reveal();expect(reveal).toHaveBeenCalledWith(destination);
 await service.download();expect(fetch).toHaveBeenCalledTimes(2);await unlink(destination);expect(await service.reveal()).toMatchObject({state:'available'});
});
it.each(['digest','size'])('preserves an existing installer and removes partial downloads on %s mismatch',async(field)=>{
 const bad=release();if(field==='digest')bad.assets[0]!.digest='sha256:'+'0'.repeat(64);else bad.assets[0]!.size++;
 const fetch=vi.fn(async(url:string)=>url===LATEST_RELEASE_API?new Response(JSON.stringify(bad)):new Response(payload));
 const {service,destination,root}=await setup({fetch});await writeFile(destination,'previous installer');await service.check();
 expect(await service.download()).toMatchObject({state:'error'});expect(await readFile(destination,'utf8')).toBe('previous installer');expect(await readdir(root)).toEqual(['update.exe']);
});
it('cancels the save dialog without fetching an installer',async()=>{
 const {service,fetch}=await setup({chooseFile:async()=>null});await service.check();expect(await service.download()).toMatchObject({state:'available'});expect(fetch).toHaveBeenCalledTimes(1);
});
it('coalesces requests from multiple windows into one download',async()=>{
 let finish!:(response:Response)=>void;const fetch=vi.fn(async(url:string)=>url===LATEST_RELEASE_API?new Response(JSON.stringify(release())):await new Promise<Response>(resolve=>{finish=resolve;}));
 const {service}=await setup({fetch});await service.check();const first=service.download(),second=service.download();expect(first).toBe(second);await vi.waitFor(()=>expect(fetch).toHaveBeenCalledTimes(2));finish(new Response(payload));expect((await first).state).toBe('downloaded');
});
it('reports GitHub errors and allows a later retry without changing the installed revision',async()=>{
 const fetch=vi.fn().mockResolvedValueOnce(new Response('',{status:403})).mockResolvedValueOnce(new Response(JSON.stringify(release('v0.1.8-r7'))));const {service}=await setup({fetch});
 expect(await service.check()).toMatchObject({state:'error',currentTag:'v0.1.8-r8'});expect(await service.check()).toMatchObject({state:'current',currentTag:'v0.1.8-r8'});
});
it('does not make requests in development or on unsupported platforms',async()=>{
 for(const option of [{enabled:false},{platform:'darwin',arch:'x64'}]){const {service,fetch}=await setup(option);service.start();expect((await service.check()).state).toBe('unsupported');expect(fetch).not.toHaveBeenCalled();}
});
