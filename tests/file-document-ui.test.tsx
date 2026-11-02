// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {useFileDocument} from '../src/web/use-file-document.js';
import {useEffect} from 'react';
import {App} from '../src/web/app.js';
const editor=vi.hoisted(()=>({events:[] as string[],mounts:0}));
vi.mock('../src/vendor/moki/web/pages/whiteboard-page.js',()=>({WhiteboardPage:({onCheckpointReady}:{onCheckpointReady:(callback:(()=>Promise<void>)|undefined)=>void})=>{
 useEffect(()=>{editor.mounts++;},[]);
 useEffect(()=>{onCheckpointReady(async()=>{editor.events.push('checkpoint');});return()=>onCheckpointReady(undefined);},[onCheckpointReady]);
 return <input aria-label="正在编辑的文字" data-whiteboard-inline-text-editor="true" onBlur={event=>editor.events.push('blur:'+event.currentTarget.value)}/>;
}}));
vi.mock('../src/web/thumbnail-capture.js',()=>({captureThumbnail:async()=>true}));
afterEach(()=>{cleanup();delete window.mokiDesktop;vi.unstubAllGlobals();history.replaceState({},'','/');editor.events=[];editor.mounts=0;});
function setup(){
 const checkpoint=vi.fn(async()=>{}),save=vi.fn(async()=>({path:'D:/file.moki',savedVersion:3,dirty:false})),saveAs=vi.fn(async()=>null);
 window.mokiDesktop={captureWhiteboardLinkPreview:async()=>null,whiteboardFiles:{hasPending:async()=>false,consume:async()=>null,onPending:()=>()=>{},documentInfo:async()=>({path:'D:/file.moki',savedVersion:2,dirty:true}),saveDocument:save,saveDocumentAs:saveAs}};
 function Demo(){const document=useFileDocument('board',checkpoint);return <><p>{document.status?.label}</p><button onClick={()=>void document.save().catch(()=>{})}>保存</button><button onClick={()=>void document.saveAs?.().catch(()=>{})}>另存为</button></>;}
 render(<Demo/>);return {checkpoint,save,saveAs};
}
it('flushes the editor before writing the original file and reports a successful file save',async()=>{
 const {checkpoint,save}=setup();await screen.findByText('有更改 · 待写入原文件');fireEvent.click(screen.getByText('保存'));
 await screen.findByText('已保存到原文件');expect(checkpoint.mock.invocationCallOrder[0]!).toBeLessThan(save.mock.invocationCallOrder[0]!);
});
it('does not write a stale file if the editor checkpoint fails',async()=>{
 const {checkpoint,save}=setup();checkpoint.mockRejectedValue(new Error('保存冲突'));await screen.findByText('有更改 · 待写入原文件');fireEvent.click(screen.getByText('保存'));
 await screen.findByText('原文件保存失败');expect(save).not.toHaveBeenCalled();
});
it('retains the document association when Save As is cancelled',async()=>{
 const {saveAs}=setup();await screen.findByText('有更改 · 待写入原文件');fireEvent.click(screen.getByText('另存为'));
 await waitFor(()=>expect(saveAs).toHaveBeenCalledWith('board'));await screen.findByText('有更改 · 待写入原文件');
});
it('Ctrl+S commits the focused editor before the file write; quitting uses the same save path',async()=>{
 history.replaceState({},'','/board/board');
 const write=vi.fn(async()=>{editor.events.push('write');return {path:'D:/file.moki',savedVersion:2,dirty:false};});
 window.mokiDesktop={captureWhiteboardLinkPreview:async()=>null,desktopSettings:{get:vi.fn(),set:vi.fn(),quit:vi.fn()},whiteboardFiles:{hasPending:async()=>false,consume:async()=>null,onPending:()=>()=>{},documentInfo:async()=>({path:'D:/file.moki',savedVersion:1,dirty:true}),saveDocument:write}};
 vi.stubGlobal('fetch',vi.fn(async(path:string)=>({ok:true,status:200,json:async()=>path==='/api/boards'?{items:[{id:'board',title:'File',version:1}]}:path.endsWith('/updates')?{version:1,actor:'local'}:{appVersion:'0.1.8'}})));
 render(<App/>);const input=screen.getByLabelText('正在编辑的文字');fireEvent.focus(input);input.focus();fireEvent.change(input,{target:{value:'最后一行'}});
 expect(fireEvent.keyDown(input,{key:'s',ctrlKey:true})).toBe(false);
 await waitFor(()=>expect(write).toHaveBeenCalledOnce());expect(editor.events).toEqual(['blur:最后一行','checkpoint','write']);
 await window.mokiBeforeQuit!();expect(write).toHaveBeenCalledTimes(2);
});
it('reloads the canvas when reopening the current file instead of leaving its old snapshot visible',async()=>{
 history.replaceState({},'','/board/board');let notify=()=>{};
 const requests:Array<{name:string;boardId:string}>=[];
 window.mokiDesktop={captureWhiteboardLinkPreview:async()=>null,whiteboardFiles:{hasPending:async()=>requests.length>0,consume:async()=>requests.shift()??null,onPending:listener=>{notify=listener;return()=>{};}}};
 vi.stubGlobal('fetch',vi.fn(async(path:string)=>({ok:true,status:200,json:async()=>path==='/api/boards'?{items:[{id:'board',title:'File',version:1}]}:path.endsWith('/updates')?{version:1,actor:'local'}:{appVersion:'0.1.8'}})));
 render(<App/>);expect(editor.mounts).toBe(1);requests.push({name:'same.moki',boardId:'board'});notify();
 await waitFor(()=>expect(editor.mounts).toBe(2));expect(location.pathname).toBe('/board/board');
});
