import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const externalData = process.env.MOKI_WHITEBOARD_SMOKE_DATA;
const temp = externalData ? undefined : mkdtempSync(join(tmpdir(), "moki-whiteboard-mcp-"));
const dataPath = externalData ?? join(temp, "smoke.db");
const transport = new StdioClientTransport({
  command: process.execPath,
  args: process.env.MOKI_WHITEBOARD_SMOKE_SOURCE?[resolve('node_modules/tsx/dist/cli.mjs'),resolve('src/mcp/server.ts')]:[resolve("dist/mcp/server.js")],
  cwd: process.cwd(),
  env: { ...process.env, MOKI_WHITEBOARD_DATA: dataPath },
  stderr: "pipe",
});
const client = new Client({ name: "moki-whiteboard-smoke", version: "1.0.0" });
let stderr='';transport.stderr?.on('data',chunk=>{stderr=(stderr+String(chunk)).slice(-4000);});
const protocolErrors=[];client.onerror=error=>protocolErrors.push(error.message);

function parsed(result) {
  const item = result.content.find((block) => block.type === "text");
  return JSON.parse(item?.text ?? "{}");
}

try {
  await client.connect(transport);
  const tools = await client.listTools();
  if(tools.tools.length!==16||tools.tools.some(tool=>tool.inputSchema.type!=='object'||tool.outputSchema?.type!=='object'))throw new Error('MCP 工具或 JSON Schema 不完整');
  const inspected = parsed(await client.callTool({ name: "whiteboard_inspect", arguments: process.env.MOKI_WHITEBOARD_SMOKE_BOARD?{boardId:process.env.MOKI_WHITEBOARD_SMOKE_BOARD}:{} }));
  const boardId = inspected.board.id;
  const pageId = inspected.pages[0].id;
  const baselineShapeCount = inspected.shapeCount;
  const added = parsed(await client.callTool({ name: "whiteboard_add_elements", arguments: {
    boardId,
    pageId,
    elements: [{ kind: "note", text: "stdio MCP 闭环验证", color: "green", x: 96, y: 72 }],
  } }));
  const verified = parsed(await client.callTool({ name: "whiteboard_inspect", arguments: { boardId } }));
  if (verified.shapeCount !== baselineShapeCount + 1 || !verified.shapes.some((shape) => shape.id === added.elementIds[0] && shape.text === "stdio MCP 闭环验证")) throw new Error("MCP 写入后读取验证失败");
  const conflict=await client.callTool({name:'whiteboard_rename',arguments:{boardId,title:'不得覆盖',expectedVersion:inspected.board.version}});
  if(!conflict.isError||conflict.structuredContent?.error?.code!=='VERSION_CONFLICT')throw new Error('版本冲突保护失败');
  const resource=await client.readResource({uri:'moki-whiteboard://boards/'+boardId});if(JSON.parse(resource.contents[0].text).id!==boardId)throw new Error('资源读取失败');
  await client.getPrompt({name:'operate-moki-whiteboard',arguments:{goal:'验证白板内容'}});
  if(!externalData){const exported=await client.callTool({name:'whiteboard_export',arguments:{boardId,includeArchive:true}});if(exported.isError||Buffer.from(exported.structuredContent.archive.data,'base64').subarray(0,2).toString()!=='PK')throw new Error('stdio 独立归档导出失败');}
  await client.ping();if(protocolErrors.length)throw new Error('stdio 协议错误：'+protocolErrors.join('; '));
  let cleaned = false;
  if (externalData) {
    await client.callTool({ name: "whiteboard_delete_elements", arguments: { boardId, ids: added.elementIds } });
    cleaned = true;
  }
  process.stdout.write(JSON.stringify({ tools: tools.tools.length, createdId: added.elementIds[0], verified: true, version: verified.board.version,structuredResults:true,versionConflict:true,resources:true,prompts:true,protocolErrors:protocolErrors.length, cleaned }, null, 2) + "\n");
} catch(error){console.error(stderr);throw error;} finally {
  await client.close();
  if (temp) rmSync(temp, { recursive: true, force: true });
}
