// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {installSharedCanvasWheelZoom} from '../src/web/shared-canvas-wheel.js';
let uninstall:(()=>void)|undefined;
afterEach(()=>{uninstall?.();uninstall=undefined;document.body.innerHTML='';vi.restoreAllMocks();});
function setup(){
 document.body.innerHTML='<header>标题</header><div class="shared-canvas"><canvas class="native-whiteboard-canvas"></canvas><video></video><aside>素材</aside></div>';
 const canvas=document.querySelector('canvas')!,receive=vi.fn();canvas.addEventListener('wheel',receive);
 vi.spyOn(canvas,'getBoundingClientRect').mockReturnValue({left:20,top:100,right:820,bottom:700,width:800,height:600} as DOMRect);
 uninstall=installSharedCanvasWheelZoom(document);return {canvas,receive};
}
it('cancels browser zoom over the canvas without delivering two zoom gestures',()=>{
 const {canvas,receive}=setup();const gesture=new WheelEvent('wheel',{ctrlKey:true,deltaY:-120,clientX:400,clientY:300,bubbles:true,cancelable:true});
 expect(canvas.dispatchEvent(gesture)).toBe(false);expect(gesture.defaultPrevented).toBe(true);expect(receive).toHaveBeenCalledOnce();expect(receive.mock.calls[0]![0]).toBe(gesture);
});
it('routes Ctrl+wheel over media and materials to the native canvas with its original scale and anchor',()=>{
 const {receive}=setup();const gesture=new WheelEvent('wheel',{ctrlKey:true,deltaY:-3,deltaMode:1,clientX:700,clientY:250,bubbles:true,cancelable:true});
 expect(document.querySelector('video')!.dispatchEvent(gesture)).toBe(false);expect(receive).toHaveBeenCalledOnce();expect(receive.mock.calls[0]![0]).toMatchObject({ctrlKey:true,deltaY:-3,deltaMode:1,clientX:700,clientY:250});
});
it('uses the canvas center for a macOS modified wheel gesture over the header',()=>{
 const {receive}=setup();document.querySelector('header')!.dispatchEvent(new WheelEvent('wheel',{metaKey:true,deltaY:120,clientX:50,clientY:30,bubbles:true,cancelable:true}));
 expect(receive).toHaveBeenCalledOnce();expect(receive.mock.calls[0]![0]).toMatchObject({metaKey:true,clientX:420,clientY:400});
});
it('keeps ordinary panel scrolling and removes the capture when leaving the viewer',()=>{
 const {receive}=setup(),panel=document.querySelector('aside')!;expect(panel.dispatchEvent(new WheelEvent('wheel',{deltaY:100,bubbles:true,cancelable:true}))).toBe(true);expect(receive).not.toHaveBeenCalled();
 uninstall!();expect(panel.dispatchEvent(new WheelEvent('wheel',{ctrlKey:true,deltaY:100,bubbles:true,cancelable:true}))).toBe(true);expect(receive).not.toHaveBeenCalled();
});
it('prevents browser zoom while a preview is open without zooming the canvas behind it',()=>{
 const {receive,canvas}=setup();const preview=document.createElement('section');preview.setAttribute('aria-modal','true');document.body.append(preview);
 expect(preview.dispatchEvent(new WheelEvent('wheel',{ctrlKey:true,deltaY:-120,bubbles:true,cancelable:true}))).toBe(false);expect(receive).not.toHaveBeenCalled();
 expect(canvas.dispatchEvent(new WheelEvent('wheel',{ctrlKey:true,deltaY:-120,bubbles:true,cancelable:true}))).toBe(false);expect(receive).not.toHaveBeenCalled();
});
