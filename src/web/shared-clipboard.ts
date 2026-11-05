import type {WhiteboardSnapshot} from '../core/types.js';
import type {SharedAttachment} from '../shared/lan-sharing-contract.js';
import {isNativeRecord,nativeRichTextValue,type NativeWhiteboardRecord} from '../vendor/moki/whiteboard/native-whiteboard-model.js';
import {NATIVE_WHITEBOARD_CLIPBOARD_TYPE} from '../vendor/moki/web/lib/workbench-selection-context.js';
import {escapeClipboardHtml,nativeClipboardHtml} from '../vendor/moki/web/lib/whiteboard-clipboard-html.js';
import {sharedSelectionWithContents} from './shared-view-state.js';

export type SharedClipboard={native:string;text:string;html:string;images:string[];count:number};
/** A flattened PNG must also paste as an image when the destination is MOKI. */
export function buildSharedImageClipboard(data:string,width:number,height:number):SharedClipboard{
 const native=JSON.stringify({version:1,shapes:[{id:'shape:shared-image',typeName:'shape',type:'image',parentId:'page:clipboard',index:'a1',x:0,y:0,rotation:0,opacity:1,props:{w:width,h:height,assetId:'asset:shared-image',altText:'白板选中内容.png'}}],assets:[{id:'asset:shared-image',typeName:'asset',type:'image',props:{src:data,w:width,h:height,mimeType:'image/png',name:'白板选中内容.png'}}]});
 return {native,text:'白板选中内容（图片）',html:nativeClipboardHtml(native,`<img src="${escapeClipboardHtml(data)}" alt="白板选中内容">`),images:[data],count:1};
}
const webURL=(value:unknown,base:string,image=false)=>{if(typeof value!=='string'||!value.trim())return '';try{const url=new URL(value,base);return ['http:','https:'].includes(url.protocol)||(image&&/^data:image\/(?:png|jpeg|gif|webp|avif|bmp);base64,/i.test(value))?url.href:'';}catch{return '';}};
export function buildSharedClipboard(snapshot:WhiteboardSnapshot,ids:readonly string[],attachments:SharedAttachment[],base:string,inlineImages:ReadonlyMap<string,string>=new Map()):SharedClipboard{
 const selected=sharedSelectionWithContents(snapshot,ids),shapes=structuredClone(selected),assetIds=new Set(shapes.map(shape=>shape.props.assetId).filter((id):id is string=>typeof id==='string'));
 const assets=structuredClone(Object.values(snapshot.document.store).filter((record):record is NativeWhiteboardRecord=>isNativeRecord(record)&&record.typeName==='asset'&&assetIds.has(record.id)));
 for(const asset of assets){const props=asset.props as Record<string,unknown>;const source=webURL(props.src,base,asset.type==='image');props.src=inlineImages.get(source)??source;}
 const text:string[]=[],body:string[]=[],images:string[]=[];
 for(const shape of shapes){
  const material=attachments.find(item=>item.id===shape.id),asset=assets.find(item=>item.id===shape.props.assetId),assetProps=asset?.props as Record<string,unknown>|undefined;
  if(shape.type==='group-folder')continue;
  const label=String(shape.props.name??shape.props.altText??shape.props.title??assetProps?.name??material?.name??'');
  if(shape.type==='resource'&&material?.url){shape.type='link';shape.props={w:shape.props.w??360,h:shape.props.h??82,...shape.props,url:webURL(material.url,base),title:label,mode:'link'};}
  if(shape.type==='link')shape.props.url=webURL(shape.props.url,base);
  const content=nativeRichTextValue(shape.props.richText),url=shape.type==='link'?webURL(shape.props.url,base):shape.type==='media'?String(assetProps?.src??''):'';
  if(shape.type==='image'&&assetProps?.src){const src=String(assetProps.src);images.push(src);text.push(label||'图片');body.push(`<p><img src="${escapeClipboardHtml(src)}" alt="${escapeClipboardHtml(label)}"></p>`);}
  else if(content){text.push(content);body.push(`<p>${escapeClipboardHtml(content).replaceAll('\n','<br>')}</p>`);}
  else if(url){text.push([label,url].filter(Boolean).join('\n'));body.push(`<p><a href="${escapeClipboardHtml(url)}">${escapeClipboardHtml(label||url)}</a></p>`);}
  else if(label){text.push(label);body.push(`<p>${escapeClipboardHtml(label)}</p>`);}
 }
 const native=JSON.stringify({version:1,shapes,assets});
 return {native,text:text.join('\n\n')||'白板选中内容',html:nativeClipboardHtml(native,body.join('')),images,count:shapes.filter(shape=>shape.type!=='group-folder').length};
}
export function writeSharedClipboardEvent(event:ClipboardEvent,payload:SharedClipboard){
 if(!event.clipboardData)return false;
 try{event.clipboardData.setData(NATIVE_WHITEBOARD_CLIPBOARD_TYPE,payload.native);}catch{/* Standard formats still work across apps. */}
 event.clipboardData.setData('text/plain',payload.text);event.clipboardData.setData('text/html',payload.html);event.preventDefault();return true;
}
/** execCommand copy remains usable on non-secure LAN HTTP origins. */
export function copySharedClipboardFallback(payload:SharedClipboard):boolean{
 const previous=document.activeElement as HTMLElement|null,input=document.createElement('textarea');input.value=payload.text;input.readOnly=true;input.style.cssText='position:fixed;left:-10000px;top:0';document.body.append(input);input.select();
 const copy=(event:ClipboardEvent)=>{writeSharedClipboardEvent(event,payload);};document.addEventListener('copy',copy);
 try{return typeof document.execCommand==='function'&&document.execCommand('copy');}finally{document.removeEventListener('copy',copy);input.remove();previous?.focus({preventScroll:true});}
}
export async function inlineSharedImages(payload:SharedClipboard,cache:Map<string,string>){
 await Promise.allSettled(payload.images.filter(src=>!src.startsWith('data:')&&!cache.has(src)).map(async src=>{const response=await fetch(src);if(!response.ok)throw new Error('图片无法读取');const blob=await response.blob();if(!blob.type.startsWith('image/'))return;const value=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=reject;reader.readAsDataURL(blob);});cache.set(src,value);}));
}
