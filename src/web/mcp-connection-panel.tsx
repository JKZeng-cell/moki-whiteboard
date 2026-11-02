import {useEffect,useRef,useState} from 'react';
import {Code2} from 'lucide-react';
import {McpTransportSwitch} from './mcp-transport-switch.js';
import {mcpAgentInstructions,mcpConnectionConfig,type McpConnectionInfo} from './mcp-connection.js';

export function McpConnectionPanel({info,agentTask,http,onTransportChange}:{info:McpConnectionInfo|undefined;agentTask:string;http:boolean;onTransportChange:(http:boolean)=>void}){
 const [copied,setCopied]=useState(''),[error,setError]=useState('');
 const timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
 useEffect(()=>()=>clearTimeout(timer.current),[]);
 const config=info?mcpConnectionConfig(info,http,location.origin):'';
 async function copy(value:string,label:string){
  setError('');
  try{if(window.mokiDesktop?.copyText){if(!await window.mokiDesktop.copyText(value))throw new Error('系统剪贴板不可用');}else await navigator.clipboard.writeText(value);clearTimeout(timer.current);setCopied(label);timer.current=setTimeout(()=>setCopied(''),1600);}
  catch(error){setError('复制失败：'+String(error));}
 }
 return <><Code2 size={30}/><h2>{agentTask?'请求 Agent 编辑当前内容':'连接 MOKI 白板 MCP'}</h2><p>复制接入说明并发给你的 Agent，由 Agent 根据所用客户端配置 MCP。白板不内置模型；配置生效可能需要客户端重启或授权。</p>
  {agentTask?<><pre>{agentTask}</pre><button className="settings-secondary" onClick={()=>void copy(agentTask,'task')}>{copied==='task'?'已复制编辑请求':'复制编辑请求'}</button></>:null}
  <McpTransportSwitch http={http} onChange={value=>{onTransportChange(value);setCopied('');}}/>
  {http?<p>本机入口：{location.origin+'/mcp'}。保持应用或托盘服务运行；配置了 token 时，客户端须使用 Bearer 认证。</p>:null}
  <div className="settings-cache-actions"><button className="manager-primary" disabled={!config} onClick={()=>void copy(mcpAgentInstructions(config,http),'agent')}>{copied==='agent'?'已复制接入说明':'复制 Agent 接入说明'}</button><button className="settings-secondary" disabled={!config} onClick={()=>void copy(config,'config')}>{copied==='config'?'已复制 MCP 配置':'复制 MCP 配置'}</button></div>
  <p>接入说明包含当前连接方式、完整配置和只读验证步骤，可直接粘贴给 Agent。</p><details className="mcp-config-details"><summary>查看 MCP 配置</summary><pre>{config||'正在读取本机连接信息…'}</pre></details>
  {error?<p role="alert" className="manager-dialog-error">{error}</p>:null}
 </>;
}
