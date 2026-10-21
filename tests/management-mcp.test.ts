import {afterEach,describe,expect,it} from 'vitest';
import sharp from 'sharp';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type {Transport} from '@modelcontextprotocol/sdk/shared/transport.js';
import {createApp} from '../src/server/app.js';
import {WhiteboardStore} from '../src/server/store.js';

const cleanup:Array<()=>Promise<unknown>|void>=[];
afterEach(async()=>{while(cleanup.length)await cleanup.pop()!();});
describe('管理页与通用 MCP',()=>{
 it('保存真实图片、条件缓存、拒绝过期截图，并完整复制和删除白板',async()=>{
  const store=new WhiteboardStore(':memory:'),app=await createApp({store});cleanup.push(()=>store.close(),()=>app.close());
  const board=store.get(),pageId=board.snapshot.session.currentPageId;
  const image=await sharp({create:{width:300,height:180,channels:3,background:'#625bc5'}}).png().toBuffer();
  const headers={'content-type':'application/x-moki-board-thumbnail','x-moki-board-version':String(board.version),'x-moki-page-id':pageId};
  expect((await app.inject({method:'PUT',url:`/api/boards/${board.id}/thumbnail`,headers,payload:image})).statusCode).toBe(200);
  const thumbnail=await app.inject({url:`/api/boards/${board.id}/thumbnail`});expect(thumbnail.headers['content-type']).toBe('image/webp');expect((await sharp(thumbnail.rawPayload).metadata()).width).toBe(300);
  expect((await app.inject({url:`/api/boards/${board.id}/thumbnail`,headers:{'if-none-match':String(thumbnail.headers.etag)}})).statusCode).toBe(304);
  const copied=await app.inject({method:'POST',url:`/api/boards/${board.id}/duplicate`,payload:{title:'副本',expectedVersion:board.version}});expect(copied.statusCode).toBe(201);expect(store.get(copied.json().id).snapshot).toEqual(board.snapshot);expect(store.thumbnail(copied.json().id)?.content).toEqual(thumbnail.rawPayload);
  const renamed=await app.inject({method:'PATCH',url:`/api/boards/${board.id}`,payload:{title:'重命名',expectedVersion:board.version}});expect(renamed.statusCode).toBe(200);
  expect((await app.inject({method:'PUT',url:`/api/boards/${board.id}/thumbnail`,headers,payload:image})).statusCode).toBe(409);
  expect((await app.inject({method:'DELETE',url:`/api/boards/${board.id}?expectedVersion=${board.version}`})).statusCode).toBe(409);
  expect((await app.inject({method:'PUT',url:`/api/boards/${board.id}/thumbnail`,headers,payload:Buffer.from('not an image')})).statusCode).toBe(400);
  expect((await app.inject({method:'PUT',url:`/api/boards/${board.id}/thumbnail`,headers,payload:Buffer.alloc(1024*1024+1)})).statusCode).toBe(413);
  expect((await app.inject({method:'POST',url:'/api/boards',payload:{title:'   '}})).statusCode).toBe(400);
  expect((await app.inject({method:'DELETE',url:`/api/boards/${board.id}?expectedVersion=${renamed.json().version}`})).statusCode).toBe(204);expect(store.thumbnail(board.id)).toBeUndefined();expect((await app.inject({url:`/api/boards/${board.id}`})).statusCode).toBe(404);
 });
 it('使用官方 HTTP 客户端完成协议协商、工具发现、读写校验、资源和错误处理',async()=>{
  const store=new WhiteboardStore(':memory:'),app=await createApp({store});cleanup.push(()=>store.close(),()=>app.close());
  const address=await app.listen({host:'127.0.0.1',port:0});const client=new Client({name:'generic-http-agent',version:'1'});cleanup.push(()=>client.close());
  await client.connect(new StreamableHTTPClientTransport(new URL(address+'/mcp')) as Transport);await client.ping();
  const tools=await client.listTools();expect(tools.tools).toHaveLength(16);for(const tool of tools.tools){expect(tool.inputSchema.type).toBe('object');expect(tool.outputSchema?.type).toBe('object');}
  const created=await client.callTool({name:'whiteboard_create',arguments:{title:'HTTP Agent 白板'}});expect(created.structuredContent).toBeDefined();const board=(created.structuredContent as Record<string,unknown>).board as {id:string;version:number;snapshot:{session:{currentPageId:string}}};
  const added=await client.callTool({name:'whiteboard_add_elements',arguments:{boardId:board.id,pageId:board.snapshot.session.currentPageId,expectedVersion:board.version,elements:[{kind:'note',text:'通用 MCP 实际调用'}]}});expect(added.isError).not.toBe(true);
  const conflict=await client.callTool({name:'whiteboard_rename',arguments:{boardId:board.id,title:'过期写入',expectedVersion:board.version}});expect(conflict.isError).toBe(true);expect(conflict.structuredContent).toMatchObject({error:{code:'VERSION_CONFLICT',currentVersion:2}});
  const inspected=await client.callTool({name:'whiteboard_inspect',arguments:{boardId:board.id}});expect(inspected.structuredContent).toMatchObject({shapeCount:1,shapes:[{text:'通用 MCP 实际调用'}]});
  const exported=await client.callTool({name:'whiteboard_export',arguments:{boardId:board.id,includeArchive:true}});const archive=(exported.structuredContent as Record<string,unknown>).archive as {data:string};expect(Buffer.from(archive.data,'base64').subarray(0,2).toString()).toBe('PK');
  const image=await sharp({create:{width:80,height:50,channels:3,background:'yellow'}}).webp().toBuffer();store.saveThumbnail(board.id,2,board.snapshot.session.currentPageId,image,80,50);
  const captured=await client.callTool({name:'whiteboard_get_thumbnail',arguments:{boardId:board.id}});expect(captured.structuredContent).toMatchObject({current:true,version:2});expect((captured.content as Array<{type:string}>)[0]?.type).toBe('image');
  const resources=await client.listResources();expect(resources.resources.some(item=>item.uri.endsWith(board.id))).toBe(true);const snapshot=await client.readResource({uri:'moki-whiteboard://boards/'+board.id});const record=snapshot.contents[0]!;expect('text' in record&&JSON.parse(record.text).id).toBe(board.id);
  expect((await client.getPrompt({name:'operate-moki-whiteboard',arguments:{goal:'核对内容'}})).messages).toHaveLength(1);
  expect((await client.callTool({name:'whiteboard_inspect',arguments:{boardId:'missing'}})).structuredContent).toMatchObject({error:{code:'NOT_FOUND'}});
  expect((await client.callTool({name:'whiteboard_delete_board',arguments:{boardId:board.id}})).isError).toBe(true);expect(store.get(board.id)).toBeDefined();
  expect((await client.callTool({name:'whiteboard_delete_board',arguments:{boardId:board.id,confirm:true,expectedVersion:2}})).structuredContent).toMatchObject({deleted:true});
  expect((await fetch(address+'/mcp',{method:'POST',headers:{'content-type':'application/json',origin:'https://evil.example'},body:'{}'})).status).toBe(403);
  expect((await fetch(address+'/mcp')).status).toBe(405);
  expect((await app.inject({method:'POST',url:'/mcp',headers:{host:'evil.example'},payload:{}})).statusCode).toBe(403);
 });
});
