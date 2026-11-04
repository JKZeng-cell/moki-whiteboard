// No product byte-size cap for archive import/export or attachment restoration.
// HTTP parsers require a finite integer; this is the JS representable ceiling.
export const WHITEBOARD_HTTP_BODY_LIMIT = Number.MAX_SAFE_INTEGER;
export const WHITEBOARD_ARCHIVE_MAX_FILES = 20_000;

/** Cancel over-budget downloads; export callers pass Infinity to read the full source. */
export async function readBoundedWhiteboardResponse(response:Response,maxBytes=Infinity):Promise<Uint8Array>{
 const oversized=()=>new Error('资源大小超过读取预算');
 if(Number(response.headers.get('content-length'))>maxBytes){await response.body?.cancel();throw oversized();}
 if(!response.body)return new Uint8Array();
 const reader=response.body.getReader(),chunks:Uint8Array[]=[];let total=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>maxBytes)throw oversized();chunks.push(value);}}
 catch(error){await reader.cancel().catch(()=>{});throw error;}
 finally{reader.releaseLock();}
 if(chunks.length===1)return chunks[0]!;
 const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;
}
