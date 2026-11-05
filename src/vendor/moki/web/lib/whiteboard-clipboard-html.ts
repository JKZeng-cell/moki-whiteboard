const marker='data-moki-whiteboard';
export function escapeClipboardHtml(value:string){return value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');}
export function nativeClipboardHtml(serialized:string,body:string){return `<div ${marker}="${escapeClipboardHtml(serialized)}">${body}</div>`;}
export function inlineClipboardImageFromHtml(html:string):string{
 if(!html||typeof DOMParser==='undefined')return '';
 try{const src=new DOMParser().parseFromString(html,'text/html').querySelector('img')?.getAttribute('src')??'';return /^data:image\/(?:png|jpeg|gif|webp|avif|bmp);base64,/i.test(src)?src:'';}catch{return '';}
}
export function nativeClipboardFromHtml(html:string):string{
 if(!html.includes(marker)||typeof DOMParser==='undefined')return '';
 try{
  const serialized=new DOMParser().parseFromString(html,'text/html').querySelector(`[${marker}]`)?.getAttribute(marker);
  if(!serialized||serialized.length>16*1024*1024)return '';
  const value=JSON.parse(serialized);
  if(value?.version!==1||!Array.isArray(value.shapes)||value.shapes.length>2000||value.assets!==undefined&&!Array.isArray(value.assets))return '';
  // HTML is a web clipboard format: never restore sender-local filesystem handles.
  for(const record of [...value.shapes,...(value.assets??[])]){
   const props=record?.props;if(!props||typeof props!=='object')continue;
   for(const key of ['localPath','libraryItemId','filePath','sourcePath'])delete props[key];
   for(const key of ['url','src'])if(typeof props[key]==='string'){
    let safe=false;try{safe=['http:','https:'].includes(new URL(props[key]).protocol);}catch{/* Absolute web references only. */}
    if(key==='src'&&record.type==='image'&&/^data:image\/(?:png|jpeg|gif|webp|avif|bmp);base64,/i.test(props[key]))safe=true;
    if(!safe)props[key]='';
   }
  }
  return JSON.stringify(value);
 }catch{return '';}
}
