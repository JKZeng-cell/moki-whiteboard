// Run after `npm ci && npm run build`. Uses only a disposable database.
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';

const root=fileURLToPath(new URL('../',import.meta.url));
const scratch=await mkdtemp(join(tmpdir(),'moki-whiteboard-agent-example-'));
const client=new Client({name:'moki-agent-quickstart',version:'1.0.0'});
const transport=new StdioClientTransport({
 command:process.execPath,args:[join(root,'dist/mcp/server.js')],cwd:root,
 env:{...process.env,MOKI_WHITEBOARD_DATA:join(scratch,'demo.db')},stderr:'pipe',
});
let diagnostics='';transport.stderr?.on('data',chunk=>{diagnostics=(diagnostics+chunk).slice(-4000);});
const protocolErrors=[];client.onerror=error=>protocolErrors.push(String(error));
async function call(name,args={}){
 const result=await client.callTool({name,arguments:args});
 if(result.isError)throw new Error(JSON.stringify(result.structuredContent??result.content));
 assert.ok(result.structuredContent,'Missing structured tool result');return result.structuredContent;
}
try{
 await client.connect(transport);
 const {tools}=await client.listTools();assert.equal(tools.length,16);
 for(const tool of tools)assert.match(tool.description??'',/^[A-Z]/);
 await call('whiteboard_list');
 const {board}=await call('whiteboard_create',{title:'Agent quickstart / 创意整理'});
 const inspected=await call('whiteboard_inspect',{boardId:board.id});
 const pageId=inspected.pages[0].id;
 const notes=await call('whiteboard_add_elements',{
  boardId:board.id,pageId,expectedVersion:inspected.board.version,
  elements:[{kind:'note',text:'Collect references',x:0,y:0},{kind:'note',text:'Review ideas',x:300,y:0}],
 });
 const ids=notes.elementIds;
 const grouped=await call('whiteboard_native_edit',{boardId:board.id,pageId,ids,action:'group',expectedVersion:notes.version});
 const collapsed=await call('whiteboard_native_edit',{boardId:board.id,pageId,ids,action:'collapse',expectedVersion:grouped.version});
 const folderId=collapsed.result;assert.equal(typeof folderId,'string');
 const expanded=await call('whiteboard_native_edit',{boardId:board.id,pageId,ids:[folderId],action:'expand',expectedVersion:collapsed.version});
 assert.equal(expanded.result.length,2);
 const final=await call('whiteboard_inspect',{boardId:board.id});
 assert.equal(final.shapeCount,2);assert.equal(protocolErrors.length,0);
 console.log(JSON.stringify({verified:true,tools:tools.length,isolatedDatabase:true,notes:2,groupCollapseExpand:true,version:final.board.version},null,2));
}catch(error){if(diagnostics)console.error(diagnostics);throw error;}
finally{
 await client.close();
 if(!resolve(scratch).startsWith(resolve(tmpdir())+sep+'moki-whiteboard-agent-example-'))throw new Error('Unsafe example cleanup path');
 await rm(scratch,{recursive:true,force:true,maxRetries:8,retryDelay:250});
}
