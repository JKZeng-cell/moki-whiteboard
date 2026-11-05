import {useLayoutEffect,useRef,useState} from 'react';
import {Copy,Hand,MousePointer2,FolderClosed,FolderOpen,X} from 'lucide-react';

export type SharedViewAction={label:string;run:()=>void;disabled?:boolean;shortcut?:string};
export function SharedViewToolbar({count,pan,setPan,copy,groupToggle,clear}:{count:number;pan:boolean;setPan:(value:boolean)=>void;copy:()=>void;groupToggle?:{collapsed:boolean;run:()=>void}|undefined;clear:()=>void}){
 return <div data-whiteboard-control-surface className="shared-view-toolbar" role="toolbar" aria-label="共享白板查看工具">
  <button aria-label="选择内容" title="选择内容 · 拖动框选" aria-pressed={!pan} onClick={()=>setPan(false)}><MousePointer2 size={17}/></button>
  <button aria-label="拖动画布" title="拖动画布 · 也可按住空格拖动" aria-pressed={pan} onClick={()=>setPan(true)}><Hand size={17}/></button>
  {count>0?<><span className="shared-selection-count" aria-live="polite">已选 {count} 项</span><button onClick={copy} title="复制内容（Ctrl / ⌘ + C）" aria-label="复制选中内容"><Copy size={16}/><span>复制</span></button>
  {groupToggle?<button aria-label={groupToggle.collapsed?'展开编组':'收起编组'} title="仅影响自己的视窗" onClick={groupToggle.run}>{groupToggle.collapsed?<FolderOpen size={17}/>:<FolderClosed size={17}/>}</button>:null}
  <button aria-label="取消选择" onClick={clear}><X size={16}/></button></>:null}
 </div>;
}

export function SharedViewContextMenu({point,actions,close}:{point:{x:number;y:number};actions:SharedViewAction[];close:()=>void}){
 const ref=useRef<HTMLDivElement>(null),[position,setPosition]=useState(point);
 useLayoutEffect(()=>{
  // Measure layout dimensions: the shared menu entrance animation scales its client rect.
  const element=ref.current!,parent=element.parentElement!;
  setPosition({x:Math.max(8,Math.min(point.x,parent.clientWidth-element.offsetWidth-8)),y:Math.max(8,Math.min(point.y,parent.clientHeight-element.offsetHeight-8))});
  const previous=document.activeElement as HTMLElement|null;
  element.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({preventScroll:true});
  const outside=(event:PointerEvent)=>{if(!element.contains(event.target as Node))close();};
  const dismiss=()=>close();document.addEventListener('pointerdown',outside);window.addEventListener('resize',dismiss);
  return()=>{document.removeEventListener('pointerdown',outside);window.removeEventListener('resize',dismiss);if(element.contains(document.activeElement))previous?.focus({preventScroll:true});};
 },[point,close,actions.length]);
 return <div ref={ref} data-whiteboard-control-surface role="menu" aria-label="共享白板只读菜单" className="moki-menu-surface shared-view-context" style={{left:position.x,top:position.y}} onContextMenu={event=>event.preventDefault()} onKeyDown={event=>{
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();return;}
  if(event.key==='Tab'){close();return;}
  if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
  event.preventDefault();const items=Array.from(ref.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')),index=items.indexOf(document.activeElement as HTMLButtonElement);
  const next=event.key==='Home'?0:event.key==='End'?items.length-1:(index+(event.key==='ArrowDown'?1:-1)+items.length)%items.length;items[next]?.focus();
 }}>
  <p>只读操作 · 不修改原白板</p>
  {actions.map(action=><button role="menuitem" key={action.label} disabled={action.disabled??false} onClick={()=>{action.run();close();}}><span>{action.label}</span>{action.shortcut?<kbd>{action.shortcut}</kbd>:null}</button>)}
 </div>;
}
