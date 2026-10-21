import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/mcp/create-server.js";
import { WhiteboardStore } from "../src/server/store.js";

const cleanup: Array<() => Promise<void> | void> = [];
afterEach(async () => { while (cleanup.length) await cleanup.pop()!(); });

function textResult(result: Awaited<ReturnType<Client["callTool"]>>): Record<string, unknown> {
  const block = (result as { content: Array<{ type: string; text?: string }> }).content[0];
  if (!block || block.type !== "text") throw new Error("missing text result");
  return JSON.parse(block.text ?? "{}") as Record<string, unknown>;
}

describe("MOKI whiteboard MCP", () => {
  it('uses the native editor for grouping, folders, and mind map branches',async()=>{
    const store=new WhiteboardStore(':memory:');const server=createMcpServer(store),client=new Client({name:'native-agent',version:'1'});const [a,b]=InMemoryTransport.createLinkedPair();await Promise.all([server.connect(b),client.connect(a)]);cleanup.push(async()=>{await client.close();await server.close();store.close();});const inspected=textResult(await client.callTool({name:'whiteboard_inspect',arguments:{}}));const boardId=(inspected.board as {id:string}).id,pageId=(inspected.pages as {id:string}[])[0]!.id;
    const added=textResult(await client.callTool({name:'whiteboard_add_elements',arguments:{boardId,pageId,elements:[{kind:'note',text:'A'},{kind:'note',text:'B'}]}}));const ids=added.elementIds as string[];const grouped=textResult(await client.callTool({name:'whiteboard_native_edit',arguments:{boardId,pageId,action:'group',ids}}));expect(grouped.result).toBeTypeOf('string');const collapsed=textResult(await client.callTool({name:'whiteboard_native_edit',arguments:{boardId,pageId,action:'collapse',ids}}));expect(collapsed.result).toBeTypeOf('string');await client.callTool({name:'whiteboard_native_edit',arguments:{boardId,pageId,action:'expand',ids:[collapsed.result]}});
    const map=textResult(await client.callTool({name:'whiteboard_add_elements',arguments:{boardId,pageId,elements:[{kind:'mindmap',text:'主题',branches:['分支']}]}}));const root=(map.elementIds as string[])[0];const child=textResult(await client.callTool({name:'whiteboard_native_edit',arguments:{boardId,pageId,action:'mindmap_child',ids:[root]}}));expect(child.result).toBeTypeOf('string');expect(child.shapeCount).toBe(7);
  });
  it("lets an agent inspect, add, and verify an element", async () => {
    const store = new WhiteboardStore(":memory:");
    const server = createMcpServer(store);
    const client = new Client({ name: "test-agent", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    cleanup.push(async () => { await client.close(); await server.close(); store.close(); });

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining([
      "whiteboard_inspect", "whiteboard_add_elements", "whiteboard_update_elements", "whiteboard_delete_elements",
      "whiteboard_align_elements", "whiteboard_manage_pages", "whiteboard_manage_page_groups",
    ]));
    const first = textResult(await client.callTool({ name: "whiteboard_inspect", arguments: {} }));
    const board = first.board as { id: string };
    const pageId = (first.pages as Array<{id:string}>)[0]!.id;
    const added = textResult(await client.callTool({ name: "whiteboard_add_elements", arguments: {
      boardId: board.id, pageId, elements: [{ kind: "note", text: "MCP 控制成功", color: "violet", x: 120, y: 80 }],
    } }));
    expect(added.elementIds).toHaveLength(1);
    const verified = textResult(await client.callTool({ name: "whiteboard_inspect", arguments: { boardId: board.id } }));
    expect(verified).toMatchObject({ shapeCount: 1, shapes: [{ text: "MCP 控制成功", x: 120, y: 80 }] });
    expect(store.history(board.id)[0]).toMatchObject({ actor: "mcp-agent", action: "elements.create" });
  });
});
