import type {BoardDocument} from '../core/types.js';
import {exportNativeWhiteboardImage} from '../vendor/moki/web/components/native-whiteboard.js';

export async function captureThumbnail(id:string,activeBoardOnly=true){
 const active=()=>location.pathname.endsWith('/'+encodeURIComponent(id));
 if(activeBoardOnly&&!active())return false;
 let canvas=document.querySelector<HTMLCanvasElement>('canvas.native-whiteboard-canvas');
 if(activeBoardOnly&&(!canvas||!canvas.width||!canvas.height))return false;
 if(!activeBoardOnly){canvas=document.createElement('canvas');canvas.width=640;canvas.height=400;}
 if(!canvas)return false;
 const response=await fetch('/api/boards/'+encodeURIComponent(id));if(!response.ok)return false;
 const board=await response.json() as BoardDocument;
 const pageId=board.snapshot.session?.currentPageId??Object.values(board.snapshot.document.store).find(record=>record.typeName==='page');
 const selected=typeof pageId==='string'?pageId:(pageId as {id:string})?.id;if(!selected)return false;
 await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
 if(activeBoardOnly&&!active())return false;
 let source:CanvasImageSource=canvas,width=canvas.width,height=canvas.height;
 let bitmap:ImageBitmap|undefined;
 if(Object.values(board.snapshot.document.store).some(record=>record.typeName==='shape'&&record.parentId===selected)){
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{
   const result=await Promise.race([exportNativeWhiteboardImage(board.snapshot,{pageId:selected,scope:'canvas',padding:24,maxDimension:640,maxPixels:250000,background:'canvas',requireImages:true}),new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>reject(new Error('截图生成超时')),8000);})]);
   bitmap=await createImageBitmap(result.blob);source=bitmap;width=bitmap.width;height=bitmap.height;
  }finally{if(timer)clearTimeout(timer);}
 }
 if(activeBoardOnly&&!active()){bitmap?.close();return false;}
 const preview=document.createElement('canvas');const scale=Math.min(640/width,400/height,1);
 preview.width=Math.max(1,Math.round(width*scale));preview.height=Math.max(1,Math.round(height*scale));
 const context=preview.getContext('2d');if(!context){bitmap?.close();return false;}
 context.fillStyle=document.documentElement.dataset.colorScheme==='dark'?'#1d2435':'#fafafe';context.fillRect(0,0,preview.width,preview.height);context.drawImage(source,0,0,preview.width,preview.height);bitmap?.close();
 const blob=await new Promise<Blob|null>(resolve=>preview.toBlob(resolve,'image/webp',.85));if(!blob)return false;
 const saved=await fetch('/api/boards/'+encodeURIComponent(id)+'/thumbnail',{method:'PUT',headers:{'content-type':'application/x-moki-board-thumbnail','x-moki-board-version':String(board.version),'x-moki-page-id':selected},body:blob});
 if(saved.status===409)return false;if(!saved.ok)throw new Error('白板截图保存失败');return true;
}
