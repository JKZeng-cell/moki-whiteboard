// @vitest-environment jsdom
import {StrictMode} from 'react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {useWhiteboardFiles} from '../src/web/use-whiteboard-files.js';
const mocks=vi.hoisted(()=>({parse:vi.fn(),fetch:vi.fn()}));
vi.mock('../src/vendor/moki/web/lib/whiteboard-transfer.js',()=>({isWhiteboardTransferFile:(file:File)=>/\.moki(?:-board)?(?:\.json)?$/i.test(file.name),importWhiteboardTransferFile:mocks.parse}));
vi.mock('../src/vendor/moki/web/lib/api-fetch.js',()=>({apiFetch:mocks.fetch}));
afterEach(()=>{cleanup();vi.clearAllMocks();delete window.mokiDesktop;history.replaceState({},'','/');});
function setup(strict=false){
 const checkpoint=vi.fn(async()=>{}),open=vi.fn(),error=vi.fn();
 mocks.parse.mockResolvedValue({snapshot:{document:{store:{'page:a':{},'page:b':{}}}},pageName:'源页面'});
 mocks.fetch.mockResolvedValue({ok:true,json:async()=>({id:'imported'})});
 function Demo(){const state=useWhiteboardFiles({checkpoint,open,error});return <>{state.controls}{state.busy?<p role="status">处理中</p>:null}</>;}
 render(strict?<StrictMode><Demo/></StrictMode>:<Demo/>);return {checkpoint,open,error};
}
describe('whiteboard file gateway',()=>{
 it('opens selected files as a complete new board after saving, resetting the picker',async()=>{
  const {checkpoint,open}=setup();const file=new File(['archive'],'工作台策划.MOKI');
  fireEvent.change(screen.getByLabelText('选择白板文件'),{target:{files:[file]}});
  await waitFor(()=>expect(open).toHaveBeenCalledWith('imported'));
  expect(checkpoint.mock.invocationCallOrder[0]!).toBeLessThan(mocks.parse.mock.invocationCallOrder[0]!);
  expect(JSON.parse(mocks.fetch.mock.calls[0]![1].body)).toEqual({title:'工作台策划',snapshot:{document:{store:{'page:a':{},'page:b':{}}}}});
  expect((screen.getByLabelText('选择白板文件') as HTMLInputElement).value).toBe('');
 });
 it('intercepts .moki drops in the editor and imports every file sequentially',async()=>{
  history.replaceState({},'','/board/current');const {open}=setup();const bubble=vi.fn();document.body.addEventListener('drop',bubble);
  fireEvent.drop(document.body,{dataTransfer:{files:[new File(['a'],'a.moki'),new File(['b'],'b.moki-board')],types:['Files']}});
  await waitFor(()=>expect(open).toHaveBeenCalledTimes(2));expect(mocks.parse.mock.calls.map(call=>call[0].name)).toEqual(['a.moki','b.moki-board']);expect(bubble).not.toHaveBeenCalled();document.body.removeEventListener('drop',bubble);
 });
 it('preserves ordinary image drop handling in the editor',()=>{
  history.replaceState({},'','/board/current');setup();const bubble=vi.fn();document.body.addEventListener('drop',bubble);
  fireEvent.drop(document.body,{dataTransfer:{files:[new File(['a'],'photo.png')],types:['Files']}});expect(bubble).toHaveBeenCalledOnce();expect(mocks.parse).not.toHaveBeenCalled();document.body.removeEventListener('drop',bubble);
 });
 it('does not create or switch boards if saving fails',async()=>{
  const {checkpoint,open,error}=setup();checkpoint.mockRejectedValue(new Error('保存失败'));
  fireEvent.change(screen.getByLabelText('选择白板文件'),{target:{files:[new File(['a'],'a.moki')]}});
  await waitFor(()=>expect(error).toHaveBeenCalledWith('a.moki：保存失败'));expect(open).not.toHaveBeenCalled();expect(mocks.fetch).not.toHaveBeenCalled();
 });
 it('shows corrupt file errors and continues with later files',async()=>{
  const {open,error}=setup();mocks.parse.mockRejectedValueOnce(new Error('文件损坏'));
  fireEvent.change(screen.getByLabelText('选择白板文件'),{target:{files:[new File(['a'],'bad.moki'),new File(['b'],'good.moki')]}});
  await waitFor(()=>expect(open).toHaveBeenCalledOnce());expect(error).toHaveBeenCalledWith('bad.moki：文件损坏');
 });
 it('handles initial native file requests once in StrictMode and subsequent notifications',async()=>{
  const requests=[{name:'native.moki',bytes:new Uint8Array([1])}];let listener=()=>{};
  const consume=vi.fn(async()=>requests.shift()??null);
  window.mokiDesktop={captureWhiteboardLinkPreview:async()=>null,whiteboardFiles:{hasPending:async()=>requests.length>0,consume,onPending:callback=>{listener=callback;return()=>{};}}};
  const {open}=setup(true);await waitFor(()=>expect(open).toHaveBeenCalledOnce());expect(consume).toHaveBeenCalledOnce();
  requests.push({name:'second.moki',bytes:new Uint8Array([2])});listener();await waitFor(()=>expect(open).toHaveBeenCalledTimes(2));
 });
});
