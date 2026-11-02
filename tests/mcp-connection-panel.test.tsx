// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {useState} from 'react';
import {McpConnectionPanel as ConnectionPanel} from '../src/web/mcp-connection-panel.js';
import {mcpConnectionConfig,mcpAgentInstructions} from '../src/web/mcp-connection.js';
const info={appVersion:'0.1.7',dataPath:'C:\\Users\\创作\\whiteboard.db',mcpEntryPath:'C:\\MOKI Whiteboard\\dist\\mcp\\server.js',mcpCommand:'C:\\MOKI Whiteboard\\MOKI Whiteboard.exe',mcpEnv:{ELECTRON_RUN_AS_NODE:'1'}};
function McpConnectionPanel(props:Pick<Parameters<typeof ConnectionPanel>[0],'info'|'agentTask'>){const [http,setHttp]=useState(false);return <ConnectionPanel {...props} http={http} onTransportChange={setHttp}/>;}
afterEach(()=>{cleanup();delete window.mokiDesktop;vi.restoreAllMocks();});
describe('copyable Agent onboarding',()=>{
 it('includes the actual runtime and shared database, preserves existing services, and verifies without writes',async()=>{
  const copy=vi.fn(async(_text:string)=>true);window.mokiDesktop={captureWhiteboardLinkPreview:async()=>null,copyText:copy};render(<McpConnectionPanel info={info} agentTask=""/>);
  fireEvent.click(screen.getByRole('button',{name:'复制 Agent 接入说明'}));await screen.findByRole('button',{name:'已复制接入说明'});
  const prompt=copy.mock.calls[0]![0] as unknown as string;
  expect(prompt).toContain(mcpConnectionConfig(info,false,location.origin));expect(prompt).toContain('保留其他服务');expect(prompt).toContain('whiteboard_list');expect(prompt).toContain('whiteboard_inspect');expect(prompt).toContain('不要为了测试而创建、修改或删除');
  const config=JSON.parse(mcpConnectionConfig(info,false,location.origin));expect(config.mcpServers['moki-whiteboard']).toEqual({command:info.mcpCommand,args:['C:/MOKI Whiteboard/dist/mcp/server.js'],env:{ELECTRON_RUN_AS_NODE:'1',MOKI_WHITEBOARD_DATA:'C:/Users/创作/whiteboard.db'}});
 });
 it('copies the selected HTTP URL and token guidance instead of a stdio executable',async()=>{
  const copy=vi.fn(async(_text:string)=>true);window.mokiDesktop={captureWhiteboardLinkPreview:async()=>null,copyText:copy};render(<McpConnectionPanel info={info} agentTask=""/>);fireEvent.click(screen.getByRole('button',{name:'Streamable HTTP'}));fireEvent.click(screen.getByRole('button',{name:'复制 Agent 接入说明'}));await waitFor(()=>expect(copy).toHaveBeenCalledOnce());
  expect(copy.mock.calls[0]![0]).toContain(location.origin+'/mcp');expect(copy.mock.calls[0]![0]).toContain('Bearer token');expect(copy.mock.calls[0]![0]).not.toContain(info.mcpCommand);
 });
 it('does not copy incomplete config, and surfaces clipboard failures',async()=>{
  const {rerender}=render(<McpConnectionPanel info={undefined} agentTask=""/>);expect(screen.getByRole('button',{name:'复制 Agent 接入说明'})).toBeDisabled();
  window.mokiDesktop={captureWhiteboardLinkPreview:async()=>null,copyText:async()=>false};rerender(<McpConnectionPanel info={info} agentTask=""/>);fireEvent.click(screen.getByRole('button',{name:'复制 MCP 配置'}));expect(await screen.findByRole('alert')).toHaveTextContent('复制失败');expect(screen.queryByRole('button',{name:'已复制 MCP 配置'})).toBeNull();
 });
 it('keeps explicit edit requests separate from onboarding instructions',()=>{const config=mcpConnectionConfig(info,false,location.origin);const prompt=mcpAgentInstructions(config,false);expect(prompt).toContain('expectedVersion');expect(prompt).not.toContain('立即修改当前白板');});
});
