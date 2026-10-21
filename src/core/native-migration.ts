import type {BoardRecord,PageRecord,ShapeRecord} from './types.js';
// Retain IDs and user content from the earlier standalone renderer.
export function migrateLegacyRecords(store:Record<string,BoardRecord>){
 const records=Object.values(store);
 for(const record of records){
  if(record.typeName==='page'){
   const page=record as PageRecord;page.meta={...page.meta};
   if(!('mokiPageGroupId' in page.meta)&&typeof page.meta.groupId==='string'){page.meta.mokiPageGroupId=page.meta.groupId;page.meta.mokiPageGroupName=(store[page.meta.groupId] as {name?:string}|undefined)?.name??'未命名分组';}
   if('mokiPageGroupId' in page.meta)page.meta.groupId=page.meta.mokiPageGroupId??null;
  }
  if(record.typeName!=='shape')continue;
  const shape=record as ShapeRecord;const props=shape.props;
  if(shape.type==='image'&&typeof props.source==='string'&&!props.assetId){const id='asset:legacy-'+shape.id.replace(/^shape:/,'');store[id]={id,typeName:'asset',type:'image',props:{src:props.source,name:props.name??'图片',mimeType:props.mimeType??'image/png',width:props.w??360,height:props.h??240},meta:{}};props.assetId=id;props.altText=props.name??'图片';delete props.source;}
  if(shape.type==='file'){shape.type='resource';props.localPath=props.source??'';props.kind='local_file';props.scale=1;}
  if(typeof props.style==='string'&&!props.arrowStyle&&shape.type==='arrow')props.arrowStyle=props.style;
  if(['left','center','right'].includes(String(props.textAlign)))props.textAlign=({left:'start',center:'middle',right:'end'} as Record<string,string>)[String(props.textAlign)];
  if(props.mindmapRole&&!props.mokiMindMapNode){const root=props.mindmapRole==='root'?shape.id:String(props.mindmapRootId);Object.assign(props,{mokiMindMapNode:true,mokiMindMapId:'legacy-map:'+root,mokiMindMapRoot:props.mindmapRole==='root',mokiMindMapDirection:'right',mokiMindMapAutoManaged:false,mokiMindMapCollapsed:false,...(props.mindmapRole!=='root'?{mokiMindMapParentId:root}:{})});}
 }
 for(const record of records){if(record.typeName!=='shape')continue;const shape=record as ShapeRecord;if(shape.type!=='arrow'||!shape.props.mindmapRootId||shape.props.mokiMindMapEdge)continue;const root=String(shape.props.mindmapRootId);const end=shape.props.end as {x?:number;y?:number}|undefined;const x=shape.x+(end?.x??0),y=shape.y+(end?.y??0);const nodes=records.filter((node):node is ShapeRecord=>node.typeName==='shape'&&(node as ShapeRecord).props.mindmapRole==='branch'&&(node as ShapeRecord).props.mindmapRootId===root);nodes.sort((a,b)=>Math.hypot(a.x-x,a.y+Number(a.props.h??68)/2-y)-Math.hypot(b.x-x,b.y+Number(b.props.h??68)/2-y));if(nodes[0])Object.assign(shape.props,{mokiMindMapEdge:true,mokiMindMapId:'legacy-map:'+root,mokiMindMapFromId:root,mokiMindMapToId:nodes[0].id,arrowStyle:'line'});}
 return store;
}
