import type {FastifyInstance} from 'fastify';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {createMcpServer} from '../mcp/create-server.js';
import type {WhiteboardStore} from './store.js';
import type {Transport} from '@modelcontextprotocol/sdk/shared/transport.js';
import {timingSafeEqual} from 'node:crypto';

export function registerMcpRoutes(app:FastifyInstance,store:WhiteboardStore){
 app.route({method:['GET','POST','DELETE'],url:'/mcp',bodyLimit:32*1024*1024,handler:async(request,reply)=>{
  // The service is loopback-only. Reject foreign Host/Origin values before
  // handing the request to the SDK, including DNS rebinding attempts.
  if(!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(request.headers.host??''))return reply.code(403).send({error:'MCP 仅允许本机连接'});
  const origin=request.headers.origin;
  if(origin){let valid=false;try{const url=new URL(origin);valid=url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)&&((url.host===request.headers.host)||['4320','4321'].includes(url.port));}catch{}if(!valid)return reply.code(403).send({error:'不允许的 MCP Origin'});}
  const token=process.env.MOKI_WHITEBOARD_MCP_TOKEN;if(token){const actual=Buffer.from(request.headers.authorization??''),expected=Buffer.from('Bearer '+token);if(actual.length!==expected.length||!timingSafeEqual(actual,expected))return reply.code(401).header('www-authenticate','Bearer').send({error:'MCP 身份验证失败'});}
  if(request.method!=='POST')return reply.code(405).header('allow','POST').send({jsonrpc:'2.0',error:{code:-32000,message:'此无状态 MCP 入口仅支持 POST'},id:null});
  const server=createMcpServer(store),transport=new StreamableHTTPServerTransport({enableJsonResponse:true});
  await server.connect(transport as Transport);reply.hijack();let closed=false;
  reply.raw.on('close',()=>{if(!closed){closed=true;void server.close();}});
  try{await transport.handleRequest(request.raw,reply.raw,request.body);}catch(error){await server.close();if(!reply.raw.headersSent){reply.raw.writeHead(500,{'content-type':'application/json'});reply.raw.end(JSON.stringify({jsonrpc:'2.0',error:{code:-32603,message:'MCP 请求处理失败'},id:null}));}}
 }});
}
