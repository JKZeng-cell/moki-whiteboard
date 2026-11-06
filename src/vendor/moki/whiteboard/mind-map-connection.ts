import type {WhiteboardSnapshot} from '../domain/whiteboard.js';
import {isNativeShape,nativeShapeBounds,type NativePoint,type NativeWhiteboardShape} from './native-whiteboard-model.js';

export type MindMapPort={point:NativePoint;normal:NativePoint};
export type MindMapCurve={start:NativePoint;control1:NativePoint;control2:NativePoint;end:NativePoint};
type Direction='left'|'right'|'down';

/** Port normals point out of the node, including when its rectangle is rotated. */
export function mindMapNodePort(node:NativeWhiteboardShape,output:boolean,direction:Direction=String(node.props.mokiMindMapDirection)==='left'?'left':node.props.mokiMindMapDirection==='down'?'down':'right'):MindMapPort{
  const bounds=nativeShapeBounds(node);
  const sign=output?1:-1;
  const normal=direction==='down'?{x:0,y:sign}:{x:(direction==='left'?-1:1)*sign,y:0};
  const local={x:normal.x*bounds.w/2,y:normal.y*bounds.h/2};
  const angle=(Number(node.rotation)||0)*Math.PI/180,cos=Math.cos(angle),sin=Math.sin(angle);
  return {point:{x:bounds.center.x+local.x*cos-local.y*sin,y:bounds.center.y+local.x*sin+local.y*cos},normal:{x:normal.x*cos-normal.y*sin,y:normal.x*sin+normal.y*cos}};
}

export function mindMapConnectionPorts(parent:NativeWhiteboardShape,child:NativeWhiteboardShape):{start:MindMapPort;end:MindMapPort}{
  const a=nativeShapeBounds(parent),b=nativeShapeBounds(child),dx=b.center.x-a.center.x,dy=b.center.y-a.center.y;
  const declared=child.props.mokiMindMapDirection;
  const direction:Direction=child.props.mokiMindMapAutoManaged!==false&&(declared==='left'||declared==='right'||declared==='down')
    ?declared:Math.abs(dy)>Math.abs(dx)*1.1&&dy>0?'down':dx<0?'left':'right';
  return {start:mindMapNodePort(parent,true,direction),end:mindMapNodePort(child,false,direction)};
}

/** Cubic endpoint tangents follow each port normal, never the dominant delta axis. */
export function mindMapCurve(start:MindMapPort,end:MindMapPort):MindMapCurve{
  const dx=end.point.x-start.point.x,dy=end.point.y-start.point.y,distance=Math.hypot(dx,dy);
  const handle=(normal:NativePoint)=>Math.min(distance/2,Math.max(12,Math.abs(dx*normal.x+dy*normal.y)*0.52));
  const from=handle(start.normal),to=handle(end.normal);
  return {start:start.point,control1:{x:start.point.x+start.normal.x*from,y:start.point.y+start.normal.y*from},control2:{x:end.point.x+end.normal.x*to,y:end.point.y+end.normal.y*to},end:end.point};
}

export function mindMapEdgeCurve(snapshot:WhiteboardSnapshot,edge:NativeWhiteboardShape):MindMapCurve|undefined{
  if(edge.type!=='arrow'||edge.props.mokiMindMapEdge!==true)return;
  const parent=snapshot.document.store[String(edge.props.mokiMindMapFromId??'')],child=snapshot.document.store[String(edge.props.mokiMindMapToId??'')];
  if(!isNativeShape(parent)||!isNativeShape(child))return;
  const ports=mindMapConnectionPorts(parent,child);
  return mindMapCurve(ports.start,ports.end);
}

/** The control hull contains the full curve, including outward bends near rotated nodes. */
export function mindMapCurveBounds(curve:MindMapCurve){
  const points=[curve.start,curve.control1,curve.control2,curve.end],x=Math.min(...points.map(p=>p.x)),y=Math.min(...points.map(p=>p.y));
  const w=Math.max(...points.map(p=>p.x))-x,h=Math.max(...points.map(p=>p.y))-y;
  return {x,y,w,h};
}

export function hitMindMapCurve(curve:MindMapCurve,point:NativePoint,tolerance:number):boolean{
  const distanceToSegment=(p:NativePoint,a:NativePoint,b:NativePoint)=>{
    const dx=b.x-a.x,dy=b.y-a.y,length=dx*dx+dy*dy;
    const t=length?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/length)):0;
    return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);
  };
  const mid=(a:NativePoint,b:NativePoint)=>({x:(a.x+b.x)/2,y:(a.y+b.y)/2});
  const visit=(c:MindMapCurve,depth:number):boolean=>{
    const bounds=mindMapCurveBounds(c);
    if(point.x<bounds.x-tolerance||point.x>bounds.x+bounds.w+tolerance||point.y<bounds.y-tolerance||point.y>bounds.y+bounds.h+tolerance)return false;
    const flatness=Math.max(distanceToSegment(c.control1,c.start,c.end),distanceToSegment(c.control2,c.start,c.end));
    if(flatness<=tolerance/4||depth>=16)return distanceToSegment(point,c.start,c.end)<=tolerance+flatness;
    const a=mid(c.start,c.control1),b=mid(c.control1,c.control2),d=mid(c.control2,c.end),e=mid(a,b),f=mid(b,d),center=mid(e,f);
    return visit({start:c.start,control1:a,control2:e,end:center},depth+1)||visit({start:center,control1:f,control2:d,end:c.end},depth+1);
  };
  return visit(curve,0);
}
