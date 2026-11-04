import {WHITEBOARD_MIN_ZOOM,WHITEBOARD_MAX_ZOOM} from './whiteboard-zoom.js';
export type WhiteboardView={x:number;y:number;zoom:number};
export type PageViewMemory={read:(pageId:string)=>WhiteboardView|undefined;write:(pageId:string,view:WhiteboardView)=>void;activate?:(pageId:string)=>void};
export function validWhiteboardView(value:unknown):value is WhiteboardView{
 if(!value||typeof value!=='object')return false;const v=value as WhiteboardView;
 return [v.x,v.y,v.zoom].every(Number.isFinite)&&v.zoom>=WHITEBOARD_MIN_ZOOM&&v.zoom<=WHITEBOARD_MAX_ZOOM;
}
export function browserPageViews(key:string|undefined):PageViewMemory{
 const prefix='moki:page-view:v1:'+key;
 return {
  read(pageId){if(!key)return;try{const value:unknown=JSON.parse(localStorage.getItem(prefix+':'+pageId)??'null');return validWhiteboardView(value)?value:undefined;}catch{return;}},
  write(pageId,view){if(!key||!validWhiteboardView(view))return;try{const value=JSON.stringify(view);if(localStorage.getItem(prefix+':'+pageId)!==value)localStorage.setItem(prefix+':'+pageId,value);}catch{/* View memory must not block editing when storage is full. */}},
  activate(pageId){if(key)try{localStorage.setItem(prefix+':active',pageId);}catch{}},
 };
}
export function rememberedWhiteboardPage(key:string):string|undefined{
 try{return localStorage.getItem('moki:page-view:v1:'+key+':active')??undefined;}catch{return;}
}
