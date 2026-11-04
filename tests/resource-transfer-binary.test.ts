import {afterEach,expect,it} from 'vitest';
import {mkdtemp,mkdir,readFile,rm,writeFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {RESOURCE_TRANSFER_MIME,resourceTransferParts,readResourceTransfer} from '../src/shared/resource-transfer-binary.js';
import {restoreWhiteboardTransferResources} from '../src/vendor/moki/desktop/whiteboard-transfer-resources.js';
import {WhiteboardStore} from '../src/server/store.js';
import {createApp} from '../src/server/app.js';
import type {DesktopWhiteboardTransferResource} from '../src/vendor/moki/shared/desktop-whiteboard-transfer-contract.js';
const fixture:DesktopWhiteboardTransferResource[]=[{shapeId:'shape:one',name:'资料',kind:'folder',files:[{relativePath:'一.bin',bytes:new Uint8Array([0,128,255])},{relativePath:'nested/二.bin',bytes:new Uint8Array([4,5])}]}];
const encode=(resources=fixture)=>Buffer.concat(resourceTransferParts(resources));
const cleanup:Array<()=>Promise<void>>=[];
afterEach(async()=>{while(cleanup.length)await cleanup.pop()!();});

it('retains binary file boundaries and Unicode names without Base64 conversion',()=>{expect(readResourceTransfer(new Uint8Array(encode()))).toEqual(fixture);});
it('rejects truncated payloads, invalid headers and trailing bytes',()=>{
 const bytes=encode();for(const candidate of [bytes.subarray(0,10),bytes.subarray(0,bytes.length-1),Buffer.concat([bytes,Buffer.from([1])]),Buffer.from('invalid data')])expect(()=>readResourceTransfer(candidate)).toThrow();
});
it('rejects unsafe attachment paths and cleans the partial import directory',async()=>{
 const root=await mkdtemp(join(tmpdir(),'moki-resource-path-'));cleanup.push(()=>rm(root,{recursive:true,force:true}));
 const unsafe=structuredClone(fixture);unsafe[0]!.files[1]!.relativePath='../outside.bin';
 await expect(restoreWhiteboardTransferResources(root,readResourceTransfer(encode(unsafe)),'bad')).rejects.toThrow('不安全路径');expect(await readdir(root)).toEqual([]);
});
it('round-trips binary resource reads and restores through real HTTP handlers',async()=>{
 const root=await mkdtemp(join(tmpdir(),'moki-binary-http-')),store=new WhiteboardStore(join(root,'test.db')),app=await createApp({store,webRoot:join(root,'none')});
 cleanup.push(async()=>{await app.close();store.close();await rm(root,{recursive:true,force:true});});
 const folder=join(root,'source');await mkdir(folder);await writeFile(join(folder,'first.bin'),Buffer.from([0,128,255]));
 const mapped=await app.inject({method:'POST',url:'/api/library/items',payload:{name:'source',kind:'local_folder',target:folder,tags:[]}});expect(mapped.statusCode).toBe(201);
 const read=await app.inject({method:'POST',url:'/api/library/resources/read',headers:{accept:RESOURCE_TRANSFER_MIME},payload:{source:folder}});
 expect(read.statusCode).toBe(200);expect(read.headers['content-type']).toContain(RESOURCE_TRANSFER_MIME);
 const resources=readResourceTransfer(read.rawPayload);resources[0]!.shapeId='shape:import';
 const restored=await app.inject({method:'POST',url:'/api/library/resources/restore',headers:{'content-type':RESOURCE_TRANSFER_MIME},payload:encode(resources)});
 expect(restored.statusCode).toBe(200);expect(await readFile(join(restored.json()[0].localPath,'first.bin'))).toEqual(Buffer.from([0,128,255]));
});
