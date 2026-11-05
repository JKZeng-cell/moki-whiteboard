// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {BoardShareDialog} from '../src/web/board-share-dialog.js';
import type {LanSharingState} from '../src/shared/lan-sharing-contract.js';
afterEach(()=>{cleanup();vi.unstubAllGlobals();delete window.mokiDesktop;});
const board={id:'board',title:'创意白板'},url='http://192.168.1.2:4323/share/token';
function setup(enabled=true,existing=false){
 let state:LanSharingState={enabled,port:enabled?4323:null,addresses:[{name:'Wi-Fi',address:'192.168.1.2'}],links:existing?[{boardId:board.id,title:board.title,createdAt:'now',urls:[url]}]:[]};
 const fetch=vi.fn(async(_path:string,init?:RequestInit)=>{if(init?.method==='POST'){expect(init.body).toBeUndefined();expect(new Headers(init.headers).has('content-type')).toBe(false);state={...state,links:[{boardId:board.id,title:board.title,createdAt:'now',urls:[url]}]};}return new Response(JSON.stringify(state));});
 vi.stubGlobal('fetch',fetch);const copy=vi.fn(async()=>true);window.mokiDesktop={captureWhiteboardLinkPreview:async()=>null,copyText:copy};return {fetch,copy};
}
it('creates one board link automatically, then copies it without navigating away',async()=>{
 const {fetch,copy}=setup();render(<BoardShareDialog board={board} close={vi.fn()} openSettings={vi.fn()}/>);
 await waitFor(()=>expect(screen.getByRole('textbox',{name:'只读共享链接'})).toHaveValue(url));
 expect(fetch.mock.calls.filter(([,init])=>init?.method==='POST')).toHaveLength(1);fireEvent.click(screen.getByRole('button',{name:'复制链接'}));await screen.findByRole('button',{name:'已复制'});expect(copy).toHaveBeenCalledWith(url);
});
it('reuses an existing link and retains it when clipboard access fails',async()=>{
 const {fetch,copy}=setup(true,true);copy.mockResolvedValue(false);render(<BoardShareDialog board={board} close={vi.fn()} openSettings={vi.fn()}/>);
 fireEvent.click(await screen.findByRole('button',{name:'复制链接'}));await screen.findByRole('alert');expect(screen.getByRole('textbox',{name:'只读共享链接'})).toHaveValue(url);expect(fetch.mock.calls.some(([,init])=>init?.method==='POST')).toBe(false);
});
it('requires enabling sharing in settings and supports Escape dismissal',async()=>{
 const {fetch}=setup(false),settings=vi.fn(),close=vi.fn();render(<BoardShareDialog board={board} close={close} openSettings={settings}/>);
 fireEvent.click(await screen.findByRole('button',{name:'前往设置'}));expect(settings).toHaveBeenCalledOnce();expect(fetch.mock.calls.some(([,init])=>init?.method==='POST')).toBe(false);fireEvent.keyDown(screen.getByRole('dialog'),{key:'Escape'});expect(close).toHaveBeenCalledOnce();
});
it('shows a recoverable settings error instead of an endless loading message',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>{throw new Error('共享服务连接中断');}));render(<BoardShareDialog board={board} close={vi.fn()} openSettings={vi.fn()}/>);expect((await screen.findByRole('alert')).textContent).toContain('共享服务连接中断');
});
it('does not generate an unusable link when no LAN interface is connected',async()=>{
 const fetch=vi.fn(async()=>new Response(JSON.stringify({enabled:true,port:4323,addresses:[],links:[]})));vi.stubGlobal('fetch',fetch);
 render(<BoardShareDialog board={board} close={vi.fn()} openSettings={vi.fn()}/>);await screen.findByText(/未检测到局域网地址/);expect(screen.queryByRole('button',{name:'复制链接'})).toBeNull();expect(fetch).toHaveBeenCalledTimes(1);
});
