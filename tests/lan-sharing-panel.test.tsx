// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {LanSharingPanel} from '../src/web/lan-sharing-panel.js';
afterEach(()=>{cleanup();vi.unstubAllGlobals();delete window.mokiDesktop;});
it('enables sharing, creates and copies a per-board read-only link, revokes it and turns sharing off',async()=>{
 let state={enabled:false,port:null as number|null,addresses:[{name:'Wi-Fi',address:'192.168.1.2'}],links:[] as Array<{boardId:string;title:string;createdAt:string;urls:string[]}>};
 const copy=vi.fn(async()=>true);window.mokiDesktop={captureWhiteboardLinkPreview:async()=>null,copyText:copy};
 vi.stubGlobal('fetch',vi.fn(async(path:string,init?:RequestInit)=>{
  if(new Headers(init?.headers).get('content-type')==='application/json')expect(init?.body).toBeDefined();
  if(path==='/api/boards')return new Response(JSON.stringify({items:[{id:'board',title:'创意白板'}]}));
  if(init?.method==='PUT'){const enabled=JSON.parse(String(init.body)).enabled;state={...state,enabled,port:enabled?4323:null,links:enabled?state.links:[]};}
  if(init?.method==='POST')state={...state,links:[{boardId:'board',title:'创意白板',createdAt:'2026-11-04',urls:['http://192.168.1.2:4323/share/token']}]};
  if(init?.method==='DELETE')state={...state,links:[]};
  return new Response(JSON.stringify(state));
 }));
 render(<LanSharingPanel currentBoardId="board"/>);await waitFor(()=>expect(screen.getByRole('switch',{name:'局域网共享'})).not.toBeDisabled());
 fireEvent.click(screen.getByRole('switch',{name:'局域网共享'}));await screen.findByRole('button',{name:'生成分享链接'});fireEvent.click(screen.getByRole('button',{name:'生成分享链接'}));
 await screen.findByText('仅供查看');fireEvent.click(screen.getByRole('button',{name:'复制 创意白板 的共享链接'}));await waitFor(()=>expect(copy).toHaveBeenCalledWith('http://192.168.1.2:4323/share/token'));
 fireEvent.click(screen.getByRole('button',{name:'停止分享 创意白板'}));await waitFor(()=>expect(screen.queryByText('仅供查看')).toBeNull());
 fireEvent.click(screen.getByRole('switch',{name:'局域网共享'}));await waitFor(()=>expect(screen.queryByRole('button',{name:'生成分享链接'})).toBeNull());
});
