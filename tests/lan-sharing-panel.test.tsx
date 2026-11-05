// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {LanSharingPanel} from '../src/web/lan-sharing-panel.js';
import type {LanSharingState} from '../src/shared/lan-sharing-contract.js';
afterEach(()=>{cleanup();vi.unstubAllGlobals();delete window.mokiDesktop;});
function setup(addresses=[{name:'Wi-Fi',address:'192.168.1.2'}]){
 let state:LanSharingState={enabled:true,port:4323,addresses,links:[{boardId:'board',title:'创意白板',createdAt:'2026-11-05',urls:addresses.map(item=>'http://'+item.address+':4323/share/token')}]};
 const copy=vi.fn(async()=>true);window.mokiDesktop={captureWhiteboardLinkPreview:async()=>null,copyText:copy};
 const fetch=vi.fn(async(path:string,init?:RequestInit)=>{
  if(path.startsWith('/api/sharing/visits'))return new Response(JSON.stringify({total:0,onlineCount:0,page:1,pageSize:20,items:[]}));
  expect(path).not.toBe('/api/boards');if(new Headers(init?.headers).get('content-type')==='application/json')expect(init?.body).toBeDefined();
  if(init?.method==='PUT'){const enabled=JSON.parse(String(init.body)).enabled;state={...state,enabled,port:enabled?4323:null,links:enabled?state.links:[]};}
  if(init?.method==='DELETE')state={...state,links:[]};return new Response(JSON.stringify(state));
 });vi.stubGlobal('fetch',fetch);return {copy,fetch};
}
it('lists existing shared boards with copy and cancellation instead of a board picker',async()=>{
 const {copy,fetch}=setup();render(<LanSharingPanel/>);await screen.findByRole('list',{name:'已共享白板列表'});
 expect(screen.queryByRole('combobox',{name:'选择共享白板'})).toBeNull();expect(screen.queryByRole('button',{name:'生成分享链接'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'复制 创意白板 的共享链接'}));await waitFor(()=>expect(copy).toHaveBeenCalledWith('http://192.168.1.2:4323/share/token'));
 fireEvent.click(screen.getByRole('button',{name:'取消共享 创意白板'}));await screen.findByText(/暂无已共享的白板/);expect(fetch).toHaveBeenCalledWith('/api/sharing/boards/board',{method:'DELETE'});
 expect(screen.getByRole('switch',{name:'局域网共享'})).toBeChecked();fireEvent.click(screen.getByRole('switch',{name:'局域网共享'}));await screen.findByText(/局域网共享已关闭/);expect(screen.getByRole('switch',{name:'局域网共享'})).not.toBeChecked();
});
it('allows cancellation without a LAN address while disabling unusable copy links',async()=>{
 setup([]);render(<LanSharingPanel/>);await screen.findByRole('list',{name:'已共享白板列表'});expect(screen.getByRole('button',{name:'复制 创意白板 的共享链接'})).toBeDisabled();fireEvent.click(screen.getByRole('button',{name:'取消共享 创意白板'}));await screen.findByText(/暂无已共享的白板/);
});
it('opens per-board history and keeps the global history entry after revocation',async()=>{
 setup();render(<LanSharingPanel/>);await screen.findByRole('list',{name:'已共享白板列表'});fireEvent.click(screen.getByRole('button',{name:'查看 创意白板 的历史访问'}));await screen.findByText(/暂无访问记录/);fireEvent.click(screen.getByRole('button',{name:'返回已共享白板'}));fireEvent.click(screen.getByRole('button',{name:'取消共享 创意白板'}));await screen.findByText(/暂无已共享的白板/);fireEvent.click(screen.getByRole('button',{name:'全部访问记录'}));await screen.findByText('全部历史访问');
});
