import {describe,expect,it} from 'vitest';
import {createNativeWhiteboardSnapshot,type NativePoint,type NativeWhiteboardShape} from './native-whiteboard-model.js';
import {synchronizeMindMapSnapshot} from './mind-map.js';
import {hitMindMapCurve,mindMapConnectionPorts,mindMapCurve,mindMapCurveBounds,mindMapEdgeCurve,type MindMapCurve} from './mind-map-connection.js';

const node=(id:string,x:number,y:number,props:Record<string,unknown>={}):NativeWhiteboardShape=>({id,typeName:'shape',type:'geo',x,y,parentId:'page:moki',index:id,rotation:0,opacity:1,props:{w:200,h:80,mokiMindMapNode:true,mokiMindMapId:'map:1',...props},meta:{}});
const pointAt=(c:MindMapCurve,t:number):NativePoint=>{const k=1-t;return {x:k*k*k*c.start.x+3*k*k*t*c.control1.x+3*k*t*t*c.control2.x+t*t*t*c.end.x,y:k*k*k*c.start.y+3*k*k*t*c.control1.y+3*k*t*t*c.control2.y+t*t*t*c.end.y};};
const expectNormal=(tangent:NativePoint,normal:NativePoint)=>{
  expect(tangent.x*normal.y-tangent.y*normal.x).toBeCloseTo(0,8);
  expect(tangent.x*normal.x+tangent.y*normal.y).toBeGreaterThan(0);
};

describe('mind-map perpendicular connections',()=>{
  it.each(['right','left','down'] as const)('keeps %s port tangents perpendicular even when the other axis is longer',direction=>{
    const parent=node('parent',20,30),child=node('child',direction==='left'?-400:direction==='down'?1200:400,direction==='down'?300:1200,{mokiMindMapDirection:direction});
    const ports=mindMapConnectionPorts(parent,child),curve=mindMapCurve(ports.start,ports.end);
    expectNormal({x:curve.control1.x-curve.start.x,y:curve.control1.y-curve.start.y},ports.start.normal);
    expectNormal({x:curve.control2.x-curve.end.x,y:curve.control2.y-curve.end.y},ports.end.normal);
    if(direction==='down'){expect(curve.control1.x).toBe(curve.start.x);expect(curve.control2.x).toBe(curve.end.x);}
    else{expect(curve.control1.y).toBe(curve.start.y);expect(curve.control2.y).toBe(curve.end.y);}
  });

  it('synchronizes scaled, rotated node ports and keeps a legacy edge attached without new stored routing properties',()=>{
    const parent=node('parent',20,30,{mokiMindMapRoot:true,scale:1.4,scaleX:1.3}),child=node('child',600,500,{mokiMindMapDirection:'right',mokiMindMapParentId:'parent',scaleY:0.7});
    parent.rotation=45;child.rotation=-30;
    const edge:NativeWhiteboardShape={...node('edge',0,0),type:'arrow',props:{mokiMindMapEdge:true,mokiMindMapFromId:'parent',mokiMindMapToId:'child',start:{x:0,y:0},end:{x:1,y:1}}};
    const snapshot=createNativeWhiteboardSnapshot();for(const shape of [parent,child,edge])snapshot.document.store[shape.id]=shape;
    const unsynchronized=mindMapEdgeCurve(snapshot,edge)!;
    expect(unsynchronized.start).toEqual(mindMapConnectionPorts(parent,child).start.point);
    expect(unsynchronized.end).toEqual(mindMapConnectionPorts(parent,child).end.point);
    synchronizeMindMapSnapshot(snapshot);
    const ports=mindMapConnectionPorts(parent,child),curve=mindMapEdgeCurve(snapshot,edge)!;
    expect(curve.start.x).toBeCloseTo(ports.start.point.x);expect(curve.start.y).toBeCloseTo(ports.start.point.y);
    expect(curve.end.x).toBeCloseTo(ports.end.point.x);expect(curve.end.y).toBeCloseTo(ports.end.point.y);
    expectNormal({x:curve.control1.x-curve.start.x,y:curve.control1.y-curve.start.y},ports.start.normal);
    expectNormal({x:curve.control2.x-curve.end.x,y:curve.control2.y-curve.end.y},ports.end.normal);
    expect(synchronizeMindMapSnapshot(snapshot)).toBe(false);
  });

  it.each([0,0.001,1,10])('keeps touching and very short connections finite (gap %s)',gap=>{
    const curve=mindMapCurve({point:{x:0,y:0},normal:{x:1,y:0}},{point:{x:gap,y:0},normal:{x:-1,y:0}});
    for(const p of Object.values(curve)){expect(Number.isFinite(p.x)&&Number.isFinite(p.y)).toBe(true);expect(p.x).toBeGreaterThanOrEqual(0);expect(p.x).toBeLessThanOrEqual(gap);}
    expect(hitMindMapCurve(curve,pointAt(curve,0.5),0.1)).toBe(true);
  });

  it('preserves horizontal normals when the two port x coordinates are identical',()=>{
    const curve=mindMapCurve({point:{x:0,y:0},normal:{x:1,y:0}},{point:{x:0,y:1000},normal:{x:-1,y:0}});
    expect(curve.control1.x).toBeGreaterThan(0);expect(curve.control2.x).toBeLessThan(0);
    expect(curve.control1.y).toBe(0);expect(curve.control2.y).toBe(1000);
    const bounds=mindMapCurveBounds(curve);
    for(let t=0;t<=1;t+=0.01){const p=pointAt(curve,t);expect(p.x).toBeGreaterThanOrEqual(bounds.x);expect(p.x).toBeLessThanOrEqual(bounds.x+bounds.w);}
  });

  it.each([0.5,1,2])('hits the visible curve rather than the invisible straight chord at scale %s',scale=>{
    const curve=mindMapCurve({point:{x:0,y:0},normal:{x:1,y:0}},{point:{x:600*scale,y:1000*scale},normal:{x:-1,y:0}});
    expect(hitMindMapCurve(curve,pointAt(curve,0.15),2*scale)).toBe(true);
    expect(hitMindMapCurve(curve,{x:90*scale,y:150*scale},2*scale)).toBe(false);
  });
});
