import {expect,it} from 'vitest';
import {readBoundedWhiteboardResponse} from '../src/vendor/moki/shared/whiteboard-transfer-limits.js';
import {importWhiteboardTransferFile} from '../src/vendor/moki/web/lib/whiteboard-transfer.js';
it('does not reject a valid archive based on its reported file size',async()=>{
 const snapshot={document:{store:{'page:one':{id:'page:one',typeName:'page',name:'页面 1'}},schema:{}}};
 const file=new File([JSON.stringify({format:'moki-whiteboard',version:1,snapshot})],'board.moki');Object.defineProperty(file,'size',{value:1024**3+1});
 expect((await importWhiteboardTransferFile(file)).snapshot.document.store['page:one']).toBeDefined();
});
it('cancels unknown-length remote downloads before buffering more than the attachment budget',async()=>{
 let cancelled=false;const stream=new ReadableStream<Uint8Array>({pull(controller){controller.enqueue(new Uint8Array(8));},cancel(){cancelled=true;}});
 await expect(readBoundedWhiteboardResponse(new Response(stream),16)).rejects.toThrow('读取预算');expect(cancelled).toBe(true);
});
it('retains complete bytes when a chunked download fits the attachment budget',async()=>{
 const stream=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new Uint8Array([1,2]));controller.enqueue(new Uint8Array([3,4]));controller.close();}});
 expect(await readBoundedWhiteboardResponse(new Response(stream),4)).toEqual(new Uint8Array([1,2,3,4]));
});
