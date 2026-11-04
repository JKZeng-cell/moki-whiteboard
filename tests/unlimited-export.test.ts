import {afterEach,expect,it,vi} from 'vitest';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {strFromU8,unzipSync} from 'fflate';
import {createSnapshot} from '../src/core/board.js';
import {createWhiteboardTransferFile} from '../src/vendor/moki/web/lib/whiteboard-transfer-v2.js';
import {readWhiteboardTransferResource} from '../src/vendor/moki/desktop/whiteboard-transfer-resources.js';

afterEach(()=>vi.unstubAllGlobals());

it('exports remote assets with declared or chunked sizes beyond import budgets',async()=>{
 const payload=new Uint8Array(64).fill(7),snapshot=createSnapshot();
 for(const id of ['declared','chunked'])snapshot.document.store['asset:'+id]={id:'asset:'+id,typeName:'asset',type:'media',props:{src:'https://example.test/'+id,mimeType:'video/mp4',name:id}};
 const fetcher:typeof fetch=async input=>new Response(payload,{headers:{'content-type':'video/mp4',...(String(input).endsWith('declared')?{'content-length':String(1024**3+1)}:{})}});
 const result=await createWhiteboardTransferFile(snapshot,{fetcher});
 const archive=unzipSync(new Uint8Array(await result.blob.arrayBuffer()));
 const manifest=JSON.parse(strFromU8(archive['manifest.json']!));
 expect(result.blob.size).toBeGreaterThan(16);expect(result.assetCount).toBe(2);
 expect(archive[manifest.assets[0].archivePath]).toEqual(payload);
 expect(manifest.assets[1].archivePath).toBe(manifest.assets[0].archivePath);
});

it('reads local files, folders and inline attachments without export byte budgets',async()=>{
 const root=await mkdtemp(join(tmpdir(),'moki-unlimited-export-'));
 try{
  const folder=join(root,'folder');await mkdir(folder);const payload=Buffer.alloc(64,5);
  await writeFile(join(folder,'first.bin'),payload);await writeFile(join(folder,'second.bin'),Buffer.alloc(64,6));
  const local=await readWhiteboardTransferResource({source:join(folder,'first.bin')});expect(local.files[0]!.bytes).toEqual(await readFile(join(folder,'first.bin')));
  const inline=await readWhiteboardTransferResource({source:'data:application/octet-stream;base64,'+payload.toString('base64')});expect(inline.files[0]!.bytes).toEqual(payload);
  const result=await createWhiteboardTransferFile(createSnapshot(),{resources:[{shapeId:'shape:folder',name:'folder',kind:'folder',sources:[{source:folder}]}],readResource:readWhiteboardTransferResource});
  const archive=unzipSync(new Uint8Array(await result.blob.arrayBuffer()));
  const manifest=JSON.parse(strFromU8(archive['manifest.json']!));
  expect(result.fileCount).toBe(2);expect(result.blob.size).toBeGreaterThan(16);
  expect(archive[manifest.resources[0].files[0].archivePath]).toEqual(new Uint8Array(payload));
  expect(archive[manifest.resources[0].files[1].archivePath]).toEqual(new Uint8Array(64).fill(6));
 }finally{await rm(root,{recursive:true,force:true});}
});

it('reads remote mapped files without rejecting declared or actual export size',async()=>{
 const payload=new Uint8Array(64).fill(9);
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(payload,{headers:{'content-length':String(1024**3+1)}})));
 const result=await readWhiteboardTransferResource({source:'https://example.test/file.bin'});
 expect(result.files[0]!.bytes).toEqual(payload);
});
