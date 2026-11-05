import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {Copy,FileDown,MoreHorizontal,Pencil,Share2,Trash2,ExternalLink} from 'lucide-react';
export type BoardCardAction='export'|'rename'|'duplicate'|'share'|'delete'|'open-window';
export function BoardCardMenu({title,onAction,canOpenWindow=false}:{title:string;canOpenWindow?:boolean;onAction:(action:BoardCardAction)=>void}){
 const [position,setPosition]=useState<{left:number;top:number}>(),trigger=useRef<HTMLButtonElement>(null),menu=useRef<HTMLDivElement>(null);
 const close=()=>{setPosition(undefined);trigger.current?.focus();};
 useEffect(()=>{if(!position)return;menu.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
  const outside=(event:PointerEvent)=>{if(!menu.current?.contains(event.target as Node)&&!trigger.current?.contains(event.target as Node))setPosition(undefined);};
  const dismiss=()=>setPosition(undefined);window.addEventListener('pointerdown',outside);window.addEventListener('resize',dismiss);window.addEventListener('scroll',dismiss,true);
  return()=>{window.removeEventListener('pointerdown',outside);window.removeEventListener('resize',dismiss);window.removeEventListener('scroll',dismiss,true);};
 },[position]);
 return <div className={'board-card-actions'+(position?' is-open':'')}><button ref={trigger} aria-label={'更多操作 '+title} title="更多操作" aria-haspopup="menu" aria-expanded={Boolean(position)} onClick={()=>{if(position){close();return;}const rect=trigger.current!.getBoundingClientRect(),height=canOpenWindow?248:208;setPosition({left:Math.max(12,Math.min(rect.right-184,window.innerWidth-196)),top:Math.max(12,rect.bottom+height+8>window.innerHeight?rect.top-height-6:rect.bottom+6)});}}><MoreHorizontal size={18}/></button>
 {position?createPortal(<div ref={menu} role="menu" aria-label={title+'的白板操作'} className="moki-menu-surface board-more-menu" style={position} onKeyDown={event=>{
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();}
  if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();const items=Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')??[]),index=items.indexOf(document.activeElement as HTMLButtonElement);items[event.key==='Home'?0:event.key==='End'?items.length-1:(index+(event.key==='ArrowDown'?1:-1)+items.length)%items.length]?.focus();}
  if(event.key==='Tab'){close();}
 }}>{([...(canOpenWindow?[['open-window','新窗口打开','在新窗口打开',ExternalLink] as const]:[]),['export','导出','导出整个白板',FileDown],['rename','重命名','重命名白板',Pencil],['duplicate','复制','复制白板',Copy],['share','共享','共享白板',Share2],['delete','删除','删除白板',Trash2]] as const).map(([action,label,text,Icon])=><button type="button" role="menuitem" tabIndex={-1} aria-label={label+' '+title} key={action} className={action==='delete'?'is-danger':''} onClick={()=>{close();onAction(action);}}><Icon size={15}/>{text}</button>)}</div>,document.body):null}</div>;
}
