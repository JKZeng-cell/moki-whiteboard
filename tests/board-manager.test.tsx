// @vitest-environment jsdom
import {afterEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {BoardManager,type BoardSummary} from '../src/web/board-manager.js';
import {WorkbenchPageHeader} from '../src/vendor/moki/web/components/workbench-page-header.js';
import {NativeControlsContext} from '../src/web/native-context.js';
import {McpTransportSwitch} from '../src/web/mcp-transport-switch.js';

afterEach(()=>{cleanup();vi.unstubAllGlobals();});
const item:BoardSummary={id:'test-board',title:'测试白板',version:1,updatedAt:new Date().toISOString(),pageCount:1,shapeCount:0,thumbnail:{version:1,capturedAt:new Date().toISOString()}};
describe('白板管理表单',()=>{
 it('卡片与空结果位于独立滚动区域，署名页脚位于容器外',()=>{
  render(<BoardManager items={[item]} open={vi.fn()} refresh={async()=>{}} controls={null}/>);
  const cards=screen.getByRole('region',{name:'白板卡片列表'}),footer=screen.getByRole('contentinfo');
  expect(cards.querySelector('.board-grid')).not.toBeNull();expect(footer.textContent).toBe('Power by JKZeng');expect(footer.closest('.manager-content')).toBeNull();
  const icon=screen.getByRole('img',{name:'MOKI 白板图标'});expect(icon.getAttribute('src')).toBe('/moki-whiteboard-icon.png');expect(icon.closest('.manager-header')).not.toBeNull();
  fireEvent.change(screen.getByRole('textbox',{name:'搜索白板'}),{target:{value:'不存在'}});expect(cards.textContent).toContain('没有找到匹配的白板');
 });
 it('MCP 分段切换显示选中状态并保留连接方式切换',()=>{
  const change=vi.fn();const {rerender}=render(<McpTransportSwitch http={false} onChange={change}/>);
  expect(screen.getByRole('group',{name:'MCP 连接方式'})).toBeDefined();expect(screen.getByRole('button',{name:'stdio'}).getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(screen.getByRole('button',{name:'Streamable HTTP'}));expect(change).toHaveBeenCalledWith(true);
  rerender(<McpTransportSwitch http={true} onChange={change}/>);expect(screen.getByRole('button',{name:'Streamable HTTP'}).getAttribute('aria-pressed')).toBe('true');expect(screen.getByRole('button',{name:'stdio'}).getAttribute('aria-pressed')).toBe('false');
 });
 it('编辑页只保留返回、编辑操作与统一设置入口，不显示独立主题和 MCP 按钮',()=>{
  render(<NativeControlsContext.Provider value={{back:vi.fn(),settings:vi.fn()}}><WorkbenchPageHeader title="无限白板" actions={<button>保存</button>}/></NativeControlsContext.Provider>);
  expect(screen.queryByRole('button',{name:/切换到.*色模式/})).toBeNull();
  expect(screen.getByRole('button',{name:'返回白板管理页'})).toBeDefined();expect(screen.getByRole('button',{name:'设置'})).toBeDefined();expect(screen.queryByRole('button',{name:'MCP 连接'})).toBeNull();expect(screen.getByRole('button',{name:'保存'})).toBeDefined();
 });
 it('确认删除不发送空 JSON 请求体，完成后刷新列表',async()=>{
  const fetch=vi.fn(async()=>({ok:true,status:204}));vi.stubGlobal('fetch',fetch);const refresh=vi.fn(async()=>{});
  render(<BoardManager items={[item]} open={vi.fn()} refresh={refresh} controls={null}/>);
  fireEvent.click(screen.getByRole('button',{name:'删除 测试白板'}));expect(fetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'确认删除'}));
  await waitFor(()=>expect(refresh).toHaveBeenCalledOnce());
  expect(fetch).toHaveBeenCalledWith('/api/boards/test-board?expectedVersion=1',{method:'DELETE',headers:{}});expect(screen.queryByRole('dialog')).toBeNull();
 });
 it('支持从白板卡片导出整个白板文件',()=>{
  const click=vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{});
  render(<BoardManager items={[item]} open={vi.fn()} refresh={async()=>{}} controls={null}/>);
  fireEvent.click(screen.getByRole('button',{name:'导出 测试白板'}));
  expect(click).toHaveBeenCalledOnce();
  click.mockRestore();
 });
 it('新建校验空名称、防重复提交，并进入新白板编辑',async()=>{
  let finish!:()=>void;const fetch=vi.fn((_url:string,_init:RequestInit)=>new Promise(resolve=>{finish=()=>resolve({ok:true,status:201,json:async()=>({id:'new-board'})});}));vi.stubGlobal('fetch',fetch);const open=vi.fn();
  render(<BoardManager items={[item]} open={open} refresh={async()=>{}} controls={null}/>);
  fireEvent.click(screen.getByRole('button',{name:'新建白板'}));fireEvent.change(screen.getByRole('textbox',{name:'白板名称'}),{target:{value:'   '}});expect((screen.getByRole('button',{name:'创建并编辑'}) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByRole('textbox',{name:'白板名称'}),{target:{value:'  新建验收  '}});fireEvent.submit(screen.getByRole('dialog'));fireEvent.submit(screen.getByRole('dialog'));expect(fetch).toHaveBeenCalledOnce();
  expect(JSON.parse(String(fetch.mock.calls[0]![1]!.body))).toMatchObject({title:'新建验收'});finish();await waitFor(()=>expect(open).toHaveBeenCalledWith('new-board'));
 });
 it('版本冲突保留输入并要求用户重新确认',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>({ok:false,status:409,json:async()=>({currentVersion:2})})));
  render(<BoardManager items={[item]} open={vi.fn()} refresh={async()=>{}} controls={null}/>);
  fireEvent.click(screen.getByRole('button',{name:'重命名 测试白板'}));fireEvent.change(screen.getByRole('textbox',{name:'白板名称'}),{target:{value:'新名称'}});fireEvent.click(screen.getByRole('button',{name:'保存'}));
  await waitFor(()=>expect(screen.getByRole('alert').textContent).toContain('关闭弹窗后重新操作'));expect((screen.getByRole('textbox',{name:'白板名称'}) as HTMLInputElement).value).toBe('新名称');
 });
});
