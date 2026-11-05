import {useEffect,useRef,useState} from 'react';
import type {PDFDocumentProxy} from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

/** Render scoped PDF bytes without relying on browser plugins or owner-only APIs. */
export function SharedPdfPreview({url}:{url:string}){
 const [pdf,setPdf]=useState<PDFDocumentProxy>(),[page,setPage]=useState(1),[error,setError]=useState(''),[width,setWidth]=useState(600);
 const container=useRef<HTMLDivElement>(null),canvas=useRef<HTMLCanvasElement>(null);
 useEffect(()=>{let live=true,dispose=()=>{};setPdf(undefined);setPage(1);setError('');
  void import('pdfjs-dist').then(async module=>{
   if(!live)return;module.GlobalWorkerOptions.workerSrc=pdfWorkerUrl;
   const task=module.getDocument({url,useSystemFonts:true,useWasm:false});dispose=()=>{void task.destroy();};
   const document=await task.promise;if(live)setPdf(document);
  }).catch(()=>{if(live)setError('PDF 暂时无法预览，可通过上方“打开”下载查看。');});
  return()=>{live=false;dispose();};
 },[url]);
 useEffect(()=>{const element=container.current;if(!element)return;const resize=()=>setWidth(Math.max(100,element.clientWidth-32));resize();const observer=new ResizeObserver(resize);observer.observe(element);return()=>observer.disconnect();},[]);
 useEffect(()=>{if(!pdf||!canvas.current)return;let live=true,cancel=()=>{};
  void pdf.getPage(page).then(async document=>{
   if(!live||!canvas.current)return;const viewport=document.getViewport({scale:Math.min(2,width/document.getViewport({scale:1}).width)}),target=canvas.current,density=Math.min(window.devicePixelRatio||1,2);
   target.width=Math.ceil(viewport.width*density);target.height=Math.ceil(viewport.height*density);target.style.width=viewport.width+'px';target.style.height=viewport.height+'px';
   const render=document.render({canvas:target,viewport,transform:density===1?undefined:[density,0,0,density,0,0]});cancel=()=>render.cancel();await render.promise;
  }).catch(error=>{if(live&&error?.name!=='RenderingCancelledException')setError('此页暂时无法显示，可下载文件查看。');});
  return()=>{live=false;cancel();};
 },[pdf,page,width]);
 return <div className="flex h-full min-h-0 flex-col"><div className="flex shrink-0 items-center justify-center gap-4 border-b border-[#e4e6ef] p-2 text-xs"><button className="settings-secondary" disabled={!pdf||page<=1} onClick={()=>setPage(value=>value-1)}>上一页</button><span role="status">{pdf?`${page} / ${pdf.numPages} 页`:'正在读取 PDF…'}</span><button className="settings-secondary" disabled={!pdf||page>=pdf.numPages} onClick={()=>setPage(value=>value+1)}>下一页</button></div><div ref={container} className="min-h-0 flex-1 overflow-auto p-4">{error?<p role="alert" className="p-4 text-center text-xs">{error}</p>:<canvas ref={canvas} aria-label={`PDF 第 ${page} 页`} className="mx-auto bg-white shadow-sm"/>}</div></div>;
}
