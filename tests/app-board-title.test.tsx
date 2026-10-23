// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {App} from '../src/web/app.js';

vi.mock('../src/vendor/moki/web/pages/whiteboard-page.js',()=>({
 WhiteboardPage:({boardTitle}:{boardTitle?:string})=><h1>{boardTitle}</h1>,
}));
vi.mock('../src/web/use-whiteboard-files.js',()=>({useWhiteboardFiles:()=>({controls:null,busy:false})}));
vi.mock('../src/web/thumbnail-capture.js',()=>({captureThumbnail:vi.fn(async()=>true)}));

const items=[
 {id:'first',title:'动画分镜参考',version:1,updatedAt:'2026-10-23T00:00:00Z',pageCount:2,shapeCount:3},
 {id:'second',title:'产品创意整理',version:1,updatedAt:'2026-10-23T00:00:00Z',pageCount:1,shapeCount:0},
];
function mockApi(){
 vi.stubGlobal('fetch',vi.fn(async(path:string)=>({ok:true,status:200,json:async()=>{
  if(path==='/api/boards')return {items};
  if(path==='/api/config')return {appVersion:'0.1.7',dataPath:'test',mcpEntryPath:'test'};
  if(path.endsWith('/updates'))return {version:1,actor:'test',actionId:'test'};
  throw new Error('Unexpected request: '+path);
 }})));
}
afterEach(()=>{cleanup();vi.unstubAllGlobals();history.replaceState({},'','/');});

describe('editor board title wiring',()=>{
 it('loads the matching name when opening an editor URL directly',async()=>{
  mockApi();history.replaceState({},'','/board/second');render(<App/>);
  expect(await screen.findByRole('heading',{level:1,name:'产品创意整理'})).toBeInTheDocument();
  expect(screen.queryByRole('heading',{name:'动画分镜参考'})).toBeNull();
 });
 it('passes the selected board name from the manager into the editor',async()=>{
  mockApi();render(<App/>);
  fireEvent.click(await screen.findByRole('button',{name:'编辑白板 动画分镜参考'}));
  expect(await screen.findByRole('heading',{level:1,name:'动画分镜参考'})).toBeInTheDocument();
  expect(location.pathname).toBe('/board/first');
 });
});
