// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {afterEach,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {DesktopUpdatesPanel,DesktopUpdateNotice} from '../src/web/desktop-updates.js';
import type {ClientUpdateState} from '../src/shared/client-update-contract.js';
afterEach(()=>{cleanup();delete window.mokiDesktop;});
function setup(initial:ClientUpdateState){
 let state=initial;const listeners=new Set<(s:ClientUpdateState)=>void>();
 const emit=(next:ClientUpdateState)=>{state=next;listeners.forEach(listener=>listener(next));return next;};
 const bridge={get:vi.fn(async()=>state),check:vi.fn(async()=>emit({...state,state:'available',availableTag:'v0.1.8-r9'})),download:vi.fn(async()=>emit({...state,state:'downloaded',percent:100})),reveal:vi.fn(async()=>state),onChanged:(listener:(s:ClientUpdateState)=>void)=>{listeners.add(listener);return()=>listeners.delete(listener);}};
 window.mokiDesktop={captureWhiteboardLinkPreview:async()=>null,clientUpdates:bridge};return {bridge,emit,listeners};
}
it('shows an update prompt but downloads only after the user clicks, then offers its folder',async()=>{
 const {bridge}=setup({state:'available',currentTag:'v0.1.8-r8',availableTag:'v0.1.8-r9'});render(<><DesktopUpdateNotice/><DesktopUpdatesPanel/></>);
 const notice=await screen.findByRole('complementary',{name:'客户端更新提示'});expect(bridge.download).not.toHaveBeenCalled();
 fireEvent.click(within(notice).getByRole('button',{name:'下载更新'}));await screen.findByText('更新安装包已就绪');expect(bridge.download).toHaveBeenCalledOnce();
 fireEvent.click(screen.getByRole('button',{name:'打开安装包位置'}));expect(bridge.reveal).toHaveBeenCalledOnce();
});
it('dismisses one revision without suppressing later releases and disables duplicate downloads',async()=>{
 const {emit}=setup({state:'available',currentTag:'v0.1.8-r8',availableTag:'v0.1.8-r9'});render(<DesktopUpdateNotice/>);fireEvent.click(await screen.findByRole('button',{name:'稍后更新'}));expect(screen.queryByRole('complementary')).toBeNull();
 act(()=>{emit({state:'downloading',currentTag:'v0.1.8-r8',availableTag:'v0.1.8-r10',percent:24});});expect(screen.getByRole('button',{name:'下载 24%'})).toBeDisabled();
});
it('cleans up subscriptions and does not show client controls in a browser preview',()=>{
 const {listeners}=setup({state:'idle',currentTag:'v0.1.8-r8'});const view=render(<DesktopUpdatesPanel/>);expect(listeners.size).toBe(1);view.unmount();expect(listeners.size).toBe(0);
 delete window.mokiDesktop;const web=render(<><DesktopUpdatesPanel/><DesktopUpdateNotice/></>);expect(web.container).toBeEmptyDOMElement();
});
