import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/server/app.js";
import { importPortableWhiteboard, WHITEBOARD_TRANSFER_MIME } from "../src/core/transfer.js";
import { WhiteboardStore } from "../src/server/store.js";
import {readFileSync} from 'node:fs';

const stores: WhiteboardStore[] = [];
afterEach(() => { while (stores.length) stores.pop()!.close(); });

describe("whiteboard API", () => {
  it('creates a new board with all imported pages without changing the source board',async()=>{
    const store=new WhiteboardStore(':memory:');stores.push(store);const app=await createApp({store});
    try{
      const original=store.get('default');
      const pageResponse=await app.inject({method:'POST',url:`/api/boards/${original.id}/pages`,payload:{name:'第二页'}});
      expect(pageResponse.statusCode).toBe(201);
      const snapshot=store.get(original.id).snapshot,source=store.get(original.id);
      const response=await app.inject({method:'POST',url:'/api/boards',payload:{title:'导入副本',snapshot}});
      expect(response.statusCode).toBe(201);expect(response.json().id).not.toBe(original.id);
      expect(Object.values(response.json().snapshot.document.store).filter((record:any)=>record.typeName==='page')).toHaveLength(2);
      expect(store.get(original.id)).toEqual(source);
      const count=store.list().length;
      const invalid=await app.inject({method:'POST',url:'/api/boards',payload:{title:'损坏文件',snapshot:{bad:true}}});
      expect(invalid.statusCode).toBeGreaterThanOrEqual(400);expect(store.list()).toHaveLength(count);
    }finally{await app.close();}
  });
  it('returns the standalone version directly from package metadata',async()=>{
    const store=new WhiteboardStore(':memory:');stores.push(store);const app=await createApp({store});
    try{const metadata=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));expect((await app.inject('/api/config')).json().appVersion).toBe(metadata.version);}finally{await app.close();}
  });
  it("returns the bundled desktop MCP runtime without requiring system Node",async()=>{
    const store=new WhiteboardStore(':memory:');stores.push(store);
    const runtime={command:'C:/MOKI/MOKI Whiteboard.exe',env:{ELECTRON_RUN_AS_NODE:'1'},entryPath:'C:/MOKI/resources/app.asar.unpacked/dist/mcp/server.js'};
    const app=await createApp({store,mcpRuntime:runtime});
    try{expect((await app.inject({url:'/api/config'})).json()).toMatchObject({mcpCommand:runtime.command,mcpEnv:runtime.env,mcpEntryPath:runtime.entryPath});}finally{await app.close();}
  });
  it("persists edits and exposes audit evidence", async () => {
    const store = new WhiteboardStore(":memory:"); stores.push(store);
    const app = await createApp({ store });
    const board = store.get("default");
    const pageId = board.snapshot.session.currentPageId;
    const createResponse = await app.inject({
      method: "POST", url: `/api/boards/${board.id}/elements`,
      headers: { "x-moki-actor": "api-test" },
      payload: { pageId, elements: [{ kind: "note", text: "API 便签", x: 12, y: 32 }] },
    });
    expect(createResponse.statusCode).toBe(201);
    const created = createResponse.json();
    expect(created.elementIds).toHaveLength(1);

    const inspectResponse = await app.inject({ method: "GET", url: `/api/boards/${board.id}/inspect` });
    expect(inspectResponse.json()).toMatchObject({ shapeCount: 1, shapes: [{ text: "API 便签" }] });
    const auditResponse = await app.inject({ method: "GET", url: `/api/boards/${board.id}/audit` });
    expect(auditResponse.json().items[0]).toMatchObject({ actor: "api-test", action: "elements.create" });
    await app.close();
  });

  it("rejects stale snapshot writes", async () => {
    const store = new WhiteboardStore(":memory:"); stores.push(store);
    const app = await createApp({ store });
    const board = store.get("default");
    store.rename(board.id, "已产生新版本", "test");
    const response = await app.inject({ method: "PUT", url: `/api/boards/${board.id}/snapshot`, payload: { snapshot: board.snapshot, expectedVersion: board.version } });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ currentVersion: board.version + 1 });
    await app.close();
  });

  it("supports page groups, page updates and alignment", async () => {
    const store = new WhiteboardStore(":memory:"); stores.push(store);
    const app = await createApp({ store });
    const initial = store.get("default"), pageId = initial.snapshot.session.currentPageId;
    const group = await app.inject({ method: "POST", url: `/api/boards/${initial.id}/page-groups`, payload: { name: "探索" } });
    expect(group.statusCode).toBe(201);
    const groupId = group.json().groupId as string;
    const moved = await app.inject({ method: "PATCH", url: `/api/boards/${initial.id}/pages/${pageId}`, payload: { name: "灵感", groupId } });
    expect(moved.statusCode).toBe(200);
    const created = await app.inject({ method: "POST", url: `/api/boards/${initial.id}/elements`, payload: { pageId, elements: [{kind:"note",x:10,y:10},{kind:"note",x:220,y:90}] } });
    const ids = created.json().elementIds as string[];
    const aligned = await app.inject({ method: "POST", url: `/api/boards/${initial.id}/elements/align`, payload: { ids, mode: "top" } });
    expect(aligned.statusCode).toBe(200);
    const latest = store.get(initial.id);
    expect(latest.snapshot.document.store[ids[1]!]).toMatchObject({ y: 10 });
    await app.close();
  });

  it("exports a Workbench-compatible portable archive", async () => {
    const store = new WhiteboardStore(":memory:"); stores.push(store);
    const app = await createApp({ store });
    const board = store.get("default");
    const response = await app.inject({ method: "GET", url: `/api/boards/${board.id}/export` });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain(WHITEBOARD_TRANSFER_MIME);
    expect(importPortableWhiteboard(new Uint8Array(response.rawPayload))).toMatchObject({ format: "moki-v2" });
    await app.close();
  });
});
