import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {fileURLToPath} from 'node:url';
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { z } from "zod";
import { addElements, alignElements, createPage, createPageGroup, deleteElements, deletePage, deletePageGroup, inspectSnapshot, pageGroups, pages, shapes, updateElements, updatePage, updatePageGroup } from "../core/board.js";
import { AlignmentModeSchema, ElementInputSchema, ElementUpdateSchema } from "../core/types.js";
import { WHITEBOARD_TRANSFER_MIME } from "../core/transfer.js";
import {exportBoard} from './portable-export.js';
import {readAgentContext} from './agent-context.js';
import { BoardNotFoundError, VersionConflictError, WhiteboardStore } from "./store.js";
import {registerThumbnailRoutes} from './thumbnail-routes.js';
import {registerMcpRoutes} from './mcp-routes.js';
import { registerNativeRoutes } from './native-routes.js';
import { registerLibraryRoutes } from './library-routes.js';
import {FileEditConflict} from '../vendor/moki/documents/file-edit-guard.js';
import {ResourceCache} from './resource-cache.js';
import {APP_VERSION} from './app-metadata.js';

const IdParams = z.object({ id: z.string().min(1) });
const PageParams = z.object({ id: z.string().min(1), pageId: z.string().min(1) });
const GroupParams = z.object({ id: z.string().min(1), groupId: z.string().min(1) });
const actor = (headers: Record<string, unknown>) => typeof headers["x-moki-actor"] === "string" ? headers["x-moki-actor"].slice(0, 100) : "local-ui";

export async function createApp(options: { store: WhiteboardStore; resourceCache?:ResourceCache;webRoot?: string;mcpRuntime?:{command:string;env:Record<string,string>;entryPath?:string} }) {
  const app = Fastify({ logger: false, bodyLimit: 100 * 1024 * 1024 });
  const { store } = options;
  store.db.exec('CREATE TABLE IF NOT EXISTS native_agent_context (board_id TEXT PRIMARY KEY,context_json TEXT NOT NULL)');
  const cache=options.resourceCache??new ResourceCache(store);
  await registerNativeRoutes(app, store,cache);
  registerLibraryRoutes(app, store,cache);
  registerThumbnailRoutes(app,store);
  registerMcpRoutes(app,store);

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof VersionConflictError) return reply.code(409).send({ error: error.message, currentVersion: error.currentVersion });
    if(error instanceof FileEditConflict)return reply.code(409).send({error:error.message});
    const statusCode = error instanceof z.ZodError ? 400 : error instanceof BoardNotFoundError?404:(error instanceof Error&&'statusCode' in error&&typeof error.statusCode==='number'?error.statusCode:500);
    return reply.code(statusCode).send({ error: error instanceof Error ? error.message : "未知错误" });
  });

  app.get("/api/health", async () => ({ status: "ok", app: "MOKI 白板", mcp: true }));
  app.get("/api/config", async () => ({ appVersion:APP_VERSION,dataPath: store.path,resourceCache:cache.info(),mcpEntryPath:options.mcpRuntime?.entryPath??fileURLToPath(new URL(import.meta.url.endsWith('.ts')?'../../dist/mcp/server.js':'../mcp/server.js',import.meta.url)),mcpCommand:options.mcpRuntime?.command??'node',mcpEnv:options.mcpRuntime?.env??{},httpMcpUrl:'/mcp' }));
  app.get("/api/boards", async () => ({ items: store.list().map((item) => {
    const snapshot = store.get(item.id).snapshot;
    return { ...item, pageCount: pages(snapshot).length, shapeCount: shapes(snapshot).length,thumbnail:store.thumbnailInfo(item.id) };
  }) }));
  app.post("/api/boards", async (request, reply) => {
    const body = z.object({ title: z.string().trim().min(1).max(120), snapshot: z.unknown().optional() }).parse(request.body);
    return reply.code(201).send(store.create(body.title, actor(request.headers), body.snapshot));
  });
  app.get("/api/boards/:id", async (request) => store.get(IdParams.parse(request.params).id));
  app.get('/api/boards/:id/agent-context',async request=>readAgentContext(store,store.get(IdParams.parse(request.params).id).id));
  app.put('/api/boards/:id/agent-context',async request=>{const id=store.get(IdParams.parse(request.params).id).id;const body=z.object({selection:z.object({source:z.enum(['whiteboard','library','browser']),label:z.string().max(1000),content:z.string().max(200000),itemCount:z.number().int().nonnegative(),capturedAt:z.string()}).nullable().optional(),request:z.object({prompt:z.string().max(20000),capturedAt:z.string()}).nullable().optional()}).parse(request.body);const value={...readAgentContext(store,id),...body,updatedAt:new Date().toISOString()};store.db.prepare('INSERT OR REPLACE INTO native_agent_context VALUES (?,?)').run(id,JSON.stringify(value));return value;});
  app.get('/api/boards/:id/updates',async request=>{const board=store.get(IdParams.parse(request.params).id);const latest=store.history(board.id,1)[0];return {version:board.version,actor:latest?.actor,actionId:String(latest?.id??''),detail:latest?.detail};});
  app.patch("/api/boards/:id", async (request) => {
    const { id } = IdParams.parse(request.params);
    const body = z.object({ title: z.string().trim().min(1).max(120),expectedVersion:z.number().int().positive().optional() }).parse(request.body);
    return store.rename(id, body.title, actor(request.headers),body.expectedVersion);
  });
  app.delete("/api/boards/:id", async (request, reply) => {
    const { id } = IdParams.parse(request.params);
    const query=z.object({expectedVersion:z.coerce.number().int().positive().optional()}).parse(request.query);
    store.delete(id, actor(request.headers),query.expectedVersion);
    return reply.code(204).send();
  });
  app.post('/api/boards/:id/duplicate',async(request,reply)=>{
    const {id}=IdParams.parse(request.params);const body=z.object({title:z.string().trim().min(1).max(120),expectedVersion:z.number().int().positive().optional()}).parse(request.body);
    return reply.code(201).send(store.duplicate(id,body.title,actor(request.headers),body.expectedVersion));
  });
  app.put("/api/boards/:id/snapshot", async (request) => {
    const { id } = IdParams.parse(request.params);
    const body = z.object({ snapshot: z.unknown(), expectedVersion: z.number().int().positive().optional() }).parse(request.body);
    return store.replaceSnapshot(id, body.snapshot, actor(request.headers), body.expectedVersion);
  });
  app.get("/api/boards/:id/inspect", async (request) => {
    const { id } = IdParams.parse(request.params);
    const query = z.object({ pageId: z.string().optional(), limit: z.coerce.number().int().optional() }).parse(request.query);
    const board = store.get(id);
    return { board: { id: board.id, title: board.title, version: board.version, updatedAt: board.updatedAt }, pages: pages(board.snapshot), ...inspectSnapshot(board.snapshot, query.pageId, query.limit) };
  });
  app.get("/api/boards/:id/audit", async (request) => {
    const { id } = IdParams.parse(request.params);
    const query = z.object({ limit: z.coerce.number().int().optional() }).parse(request.query);
    return { items: store.history(id, query.limit) };
  });
  app.get("/api/boards/:id/export", async (request, reply) => {
    const board = store.get(IdParams.parse(request.params).id);
    const result = await exportBoard(store,board.id);
    reply.header("content-type", WHITEBOARD_TRANSFER_MIME);
    reply.header("content-disposition", `attachment; filename*=UTF-8''${encodeURIComponent(result.fileName)}`);
    return reply.send(Buffer.from(await result.blob.arrayBuffer()));
  });
  app.post("/api/boards/:id/pages", async (request, reply) => {
    const { id } = IdParams.parse(request.params);
    const body = z.object({ name: z.string().min(1).max(120).optional() }).parse(request.body);
    let pageId = "";
    const board = store.mutate(id, actor(request.headers), "page.create", { name: body.name }, (snapshot) => { pageId = createPage(snapshot, body.name).id; });
    return reply.code(201).send({ board, pageId });
  });
  app.get("/api/boards/:id/pages", async (request) => {
    const board = store.get(IdParams.parse(request.params).id);
    return { groups: pageGroups(board.snapshot), items: pages(board.snapshot).map((page) => ({ ...page, shapeCount: shapes(board.snapshot, page.id).length })) };
  });
  app.patch("/api/boards/:id/pages/:pageId", async (request) => {
    const { id, pageId } = PageParams.parse(request.params);
    const body = z.object({ name: z.string().min(1).max(120).optional(), groupId: z.string().min(1).nullable().optional(), index: z.string().min(1).max(40).optional() }).parse(request.body);
    const board = store.mutate(id, actor(request.headers), "page.update", { pageId, ...body }, (snapshot) => { updatePage(snapshot, pageId, body); });
    return { board };
  });
  app.delete("/api/boards/:id/pages/:pageId", async (request) => {
    const { id, pageId } = PageParams.parse(request.params);
    let deletedElementIds: string[] = [];
    const board = store.mutate(id, actor(request.headers), "page.delete", { pageId }, (snapshot) => { deletedElementIds = deletePage(snapshot, pageId); });
    return { board, deletedElementIds };
  });
  app.post("/api/boards/:id/page-groups", async (request, reply) => {
    const { id } = IdParams.parse(request.params);
    const body = z.object({ name: z.string().min(1).max(120) }).parse(request.body);
    let groupId = "";
    const board = store.mutate(id, actor(request.headers), "page-group.create", body, (snapshot) => { groupId = createPageGroup(snapshot, body.name).id; });
    return reply.code(201).send({ board, groupId });
  });
  app.patch("/api/boards/:id/page-groups/:groupId", async (request) => {
    const { id, groupId } = GroupParams.parse(request.params);
    const body = z.object({ name: z.string().min(1).max(120) }).parse(request.body);
    const board = store.mutate(id, actor(request.headers), "page-group.update", { groupId, ...body }, (snapshot) => { updatePageGroup(snapshot, groupId, body.name); });
    return { board };
  });
  app.delete("/api/boards/:id/page-groups/:groupId", async (request) => {
    const { id, groupId } = GroupParams.parse(request.params);
    const board = store.mutate(id, actor(request.headers), "page-group.delete", { groupId }, (snapshot) => { deletePageGroup(snapshot, groupId); });
    return { board };
  });
  app.post("/api/boards/:id/elements", async (request, reply) => {
    const { id } = IdParams.parse(request.params);
    const body = z.object({ pageId: z.string().min(1), elements: z.array(ElementInputSchema).min(1).max(200) }).parse(request.body);
    let elementIds: string[] = [];
    const board = store.mutate(id, actor(request.headers), "elements.create", { pageId: body.pageId, count: body.elements.length }, (snapshot) => { elementIds = addElements(snapshot, body.pageId, body.elements).map((item) => item.id); });
    return reply.code(201).send({ board, elementIds });
  });
  app.patch("/api/boards/:id/elements", async (request) => {
    const { id } = IdParams.parse(request.params);
    const body = z.object({ updates: z.array(ElementUpdateSchema).min(1).max(200) }).parse(request.body);
    const board = store.mutate(id, actor(request.headers), "elements.update", { ids: body.updates.map((item) => item.id) }, (snapshot) => { updateElements(snapshot, body.updates); });
    return { board };
  });
  app.delete("/api/boards/:id/elements", async (request) => {
    const { id } = IdParams.parse(request.params);
    const body = z.object({ ids: z.array(z.string().min(1)).min(1).max(200) }).parse(request.body);
    let deletedIds: string[] = [];
    const board = store.mutate(id, actor(request.headers), "elements.delete", { ids: body.ids }, (snapshot) => { deletedIds = deleteElements(snapshot, body.ids); });
    return { board, deletedIds };
  });
  app.post("/api/boards/:id/elements/align", async (request) => {
    const { id } = IdParams.parse(request.params);
    const body = z.object({ ids: z.array(z.string().min(1)).min(2).max(200), mode: AlignmentModeSchema }).parse(request.body);
    const board = store.mutate(id, actor(request.headers), "elements.align", body, (snapshot) => { alignElements(snapshot, body.ids, body.mode); });
    return { board, alignedIds: body.ids };
  });

  const webRoot = options.webRoot ?? resolve(process.cwd(), "dist/web");
  if (existsSync(webRoot)) {
    await app.register(fastifyStatic, { root: webRoot });
    app.setNotFoundHandler((request, reply) => request.url.startsWith("/api/")||request.url.startsWith('/assets/') ? reply.code(404).send({ error: "资源不存在" }) : reply.sendFile("index.html"));
  }
  return app;
}
