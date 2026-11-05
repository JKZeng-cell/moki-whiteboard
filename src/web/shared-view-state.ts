import type {WhiteboardSnapshot} from '../core/types.js';
import {isNativeShape,nativeShapeVisualBounds,type NativeWhiteboardShape} from '../vendor/moki/whiteboard/native-whiteboard-model.js';

export function sharedGroupId(shape:NativeWhiteboardShape|undefined){return typeof shape?.props.mokiGroupId==='string'?shape.props.mokiGroupId:undefined;}
export const sharedFolderId=(groupId:string)=>'shape:shared-folder:'+groupId;

/** Per-window overrides are projected onto each fresh server snapshot, never written back. */
export function applySharedGroupView(source:WhiteboardSnapshot,overrides:ReadonlyMap<string,boolean>):WhiteboardSnapshot{
 const snapshot=structuredClone(source),records=snapshot.document.store;
 for(const [groupId,collapsed] of overrides){
  const members=Object.values(records).filter((record):record is NativeWhiteboardShape=>isNativeShape(record)&&sharedGroupId(record)===groupId&&record.type!=='group-folder');
  const folders=Object.values(records).filter((record):record is NativeWhiteboardShape=>isNativeShape(record)&&sharedGroupId(record)===groupId&&record.type==='group-folder');
  if(!members.length)continue;
  if(collapsed){
   if(members.length<2)continue;
   members.forEach(shape=>{shape.props={...shape.props,mokiGroupCollapsed:true};});
   if(folders.length)continue;
   const bounds=members.map(nativeShapeVisualBounds),left=Math.min(...bounds.map(b=>b.x)),top=Math.min(...bounds.map(b=>b.y)),right=Math.max(...bounds.map(b=>b.x+b.w)),bottom=Math.max(...bounds.map(b=>b.y+b.h));
   const x=(left+right)/2-120,y=(top+bottom)/2-90,id=sharedFolderId(groupId),props=members[0]!.props;
   records[id]={id,typeName:'shape',type:'group-folder',parentId:members[0]!.parentId,index:'zz-shared-view',x,y,rotation:0,opacity:1,props:{w:240,h:180,mokiGroupId:groupId,groupLabel:props.mokiGroupLabel??'编组',groupDescription:props.mokiGroupDescription??'仅在当前视窗中收起',groupColor:props.mokiGroupColor??'#776bd8',groupOriginX:x,groupOriginY:y}};
  }else{
   const folder=folders[0],dx=folder&&Number.isFinite(Number(folder.props.groupOriginX))?folder.x-Number(folder.props.groupOriginX):0,dy=folder&&Number.isFinite(Number(folder.props.groupOriginY))?folder.y-Number(folder.props.groupOriginY):0;
   folders.forEach(shape=>{delete records[shape.id];});
   members.forEach(shape=>{shape.x+=dx;shape.y+=dy;shape.props={...shape.props,mokiGroupCollapsed:false,...(folder?{mokiGroupLabel:folder.props.groupLabel,mokiGroupDescription:folder.props.groupDescription,mokiGroupColor:folder.props.groupColor}:{})};});
  }
 }
 return snapshot;
}

export function sharedSelectionWithContents(snapshot:WhiteboardSnapshot,ids:readonly string[]){
 const records=Object.values(snapshot.document.store).filter(isNativeShape),selected=new Set(ids);
 for(const id of ids){const shape=records.find(shape=>shape.id===id);if(shape?.type==='group-folder'){const group=sharedGroupId(shape);if(group)records.filter(member=>sharedGroupId(member)===group).forEach(member=>selected.add(member.id));}}
 return records.filter(shape=>selected.has(shape.id));
}
