import {Globe2,Terminal} from 'lucide-react';

export function McpTransportSwitch({http,onChange}:{http:boolean;onChange:(http:boolean)=>void}){
 return <div className="mcp-transport-switch" role="group" aria-label="MCP 连接方式">
  <button type="button" aria-pressed={!http} onClick={()=>onChange(false)}><Terminal size={15} aria-hidden="true"/>stdio</button>
  <button type="button" aria-pressed={http} onClick={()=>onChange(true)}><Globe2 size={15} aria-hidden="true"/>Streamable HTTP</button>
 </div>;
}
