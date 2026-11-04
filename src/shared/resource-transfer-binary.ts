import {z} from 'zod';
import type {DesktopWhiteboardTransferResource} from '../vendor/moki/shared/desktop-whiteboard-transfer-contract.js';
import {WHITEBOARD_ARCHIVE_MAX_FILES} from '../vendor/moki/shared/whiteboard-transfer-limits.js';

export const RESOURCE_TRANSFER_MIME='application/x-moki-resources';
const magic=new TextEncoder().encode('MOKIRSC1');
const Manifest=z.array(z.object({shapeId:z.string(),name:z.string(),kind:z.enum(['file','folder']),files:z.array(z.object({relativePath:z.string(),size:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)})).max(WHITEBOARD_ARCHIVE_MAX_FILES)})).max(2000);

/** Binary payload avoids the size and extra copies of JSON/Base64 strings. */
export function resourceTransferParts(resources:DesktopWhiteboardTransferResource[]):Uint8Array[]{
 const manifest=Manifest.parse(resources.map(resource=>({...resource,files:resource.files.map(file=>({relativePath:file.relativePath,size:file.bytes.byteLength}))})));
 if(manifest.reduce((count,item)=>count+item.files.length,0)>WHITEBOARD_ARCHIVE_MAX_FILES)throw new Error('白板便携文件数量超过 20000 个');
 const json=new TextEncoder().encode(JSON.stringify(manifest)),header=new Uint8Array(12);header.set(magic);new DataView(header.buffer).setUint32(8,json.byteLength,true);
 return [header,json,...resources.flatMap(resource=>resource.files.map(file=>file.bytes))];
}
export function readResourceTransfer(bytes:Uint8Array):DesktopWhiteboardTransferResource[]{
 if(bytes.byteLength<12||!magic.every((value,index)=>bytes[index]===value))throw new Error('附件传输格式无效');
 const size=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(8,true);let offset=12+size;
 if(offset>bytes.byteLength)throw new Error('附件清单不完整');
 const manifest=Manifest.parse(JSON.parse(new TextDecoder().decode(bytes.subarray(12,offset))));let count=0;
 const resources=manifest.map(resource=>({...resource,files:resource.files.map(file=>{
  if(++count>WHITEBOARD_ARCHIVE_MAX_FILES)throw new Error('白板便携文件数量超过 20000 个');
  const end=offset+file.size;if(!Number.isSafeInteger(end)||end>bytes.byteLength)throw new Error('附件内容不完整');
  const content=bytes.subarray(offset,end);offset=end;return {relativePath:file.relativePath,bytes:content};
 })}));
 if(offset!==bytes.byteLength)throw new Error('附件传输包含多余内容');
 return resources;
}
