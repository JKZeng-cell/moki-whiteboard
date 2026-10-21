import { McpServer, ResourceTemplate, type ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {AnySchema,ZodRawShapeCompat} from "@modelcontextprotocol/sdk/server/zod-compat.js";
import type {ToolAnnotations} from "@modelcontextprotocol/sdk/types.js";
import {BoardNotFoundError,VersionConflictError} from '../server/store.js';
import {NativeWhiteboardEditor,createNativeWhiteboardStore,getNativeSnapshot,loadNativeSnapshot} from '../vendor/moki/web/components/native-whiteboard.js';
import { z } from "zod";
import { addElements, alignElements, createPage, createPageGroup, deleteElements, deletePage, deletePageGroup, inspectSnapshot, pageGroups, pages, updateElements, updatePage, updatePageGroup } from "../core/board.js";
import { AlignmentModeSchema, ColorSchema, ElementKindSchema } from "../core/types.js";
import type { WhiteboardStore } from "../server/store.js";
import {readAgentContext} from '../server/agent-context.js';
import {exportBoard} from '../server/portable-export.js';
import {APP_VERSION} from '../server/app-metadata.js';

const boardIdSchema = z.string().min(1).default("default").describe("白板 ID；省略时使用最近更新的白板，建议始终指定准确 ID");
const expectedVersionSchema=z.number().int().positive().optional().describe('先 inspect 获得版本；过期写入会返回 VERSION_CONFLICT 而不会覆盖内容');
const content = (value: Record<string,unknown>) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],structuredContent:value });
const BoardResultSchema=z.object({id:z.string(),title:z.string(),version:z.number().int().positive(),updatedAt:z.string().optional(),snapshot:z.record(z.string(),z.unknown()).optional()}).passthrough();
const ToolResultSchema=z.object({
 board:BoardResultSchema.optional(),boards:z.array(BoardResultSchema).optional(),boardId:z.string().optional(),version:z.number().int().positive().optional(),
 pageId:z.string().optional(),elementIds:z.array(z.string()).optional(),updatedIds:z.array(z.string()).optional(),deletedIds:z.array(z.string()).optional(),alignedIds:z.array(z.string()).optional(),
 deleted:z.boolean().optional(),current:z.boolean().optional(),
 error:z.object({code:z.enum(['NOT_FOUND','VERSION_CONFLICT','OPERATION_FAILED']),message:z.string(),currentVersion:z.number().int().positive().optional()}).optional(),
}).passthrough();

export function createMcpServer(store: WhiteboardStore): McpServer {
  const server = new McpServer({ name: "moki-whiteboard", version: APP_VERSION });
  function tool<Input extends undefined|ZodRawShapeCompat|AnySchema=undefined>(name:string,config:{title?:string;description?:string;inputSchema?:Input;annotations?:ToolAnnotations},callback:ToolCallback<Input>){
    const invoke=callback as unknown as (...args:Parameters<ToolCallback<Input>>)=>ReturnType<ToolCallback<Input>>;
    const guarded=(async(...args:Parameters<ToolCallback<Input>>)=>{
      try{return await invoke(...args);}catch(error){
        const detail={code:error instanceof VersionConflictError?'VERSION_CONFLICT':error instanceof BoardNotFoundError?'NOT_FOUND':'OPERATION_FAILED',message:error instanceof Error?error.message:String(error),...(error instanceof VersionConflictError?{currentVersion:error.currentVersion}:{})};
        return {...content({error:detail}),isError:true};
      }
    }) as ToolCallback<Input>;
    return server.registerTool(name,{...config,outputSchema:ToolResultSchema},guarded);
  }
  server.registerResource('board-snapshot',new ResourceTemplate('moki-whiteboard://boards/{boardId}',{list:async()=>({resources:store.list().map(board=>({uri:'moki-whiteboard://boards/'+board.id,name:board.title,mimeType:'application/json'}))})}),{mimeType:'application/json',description:'指定白板的完整原生快照'},async(uri,{boardId})=>({contents:[{uri:uri.href,mimeType:'application/json',text:JSON.stringify(store.get(String(boardId)))}]}));
  tool('whiteboard_rename',{description:'重命名明确指定的白板；支持版本校验。',inputSchema:{boardId:z.string().min(1),title:z.string().trim().min(1).max(120),expectedVersion:z.number().int().positive().optional()},annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:false}},async({boardId,title,expectedVersion})=>content({board:store.rename(boardId,title,'mcp-agent',expectedVersion)}));
  tool('whiteboard_duplicate',{description:'复制白板的全部页面与内容；图片和文件引用保留。',inputSchema:{boardId:z.string().min(1),title:z.string().trim().min(1).max(120),expectedVersion:z.number().int().positive().optional()},annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:false,openWorldHint:false}},async({boardId,title,expectedVersion})=>content({board:store.duplicate(boardId,title,'mcp-agent',expectedVersion)}));
  tool('whiteboard_delete_board',{description:'删除明确指定的整张白板，不可撤回；需要 confirm=true，建议提供 expectedVersion。不会删除原始映射文件。',inputSchema:{boardId:z.string().min(1).refine(id=>id!=='default','必须指定明确白板 ID'),confirm:z.literal(true),expectedVersion:z.number().int().positive().optional()},annotations:{readOnlyHint:false,destructiveHint:true,idempotentHint:false,openWorldHint:false}},async({boardId,expectedVersion})=>{store.delete(boardId,'mcp-agent',expectedVersion);return content({boardId,deleted:true});});
  tool('whiteboard_get_thumbnail',{description:'读取最后一次编辑保存的真实白板截图。尚未打开编辑的白板可能没有截图；返回截图版本和是否最新。',inputSchema:{boardId:boardIdSchema},annotations:{readOnlyHint:true,openWorldHint:false}},async({boardId})=>{
    const board=store.get(boardId),thumbnail=store.thumbnail(board.id);if(!thumbnail)throw new Error('尚无截图，请在应用中打开白板并保存');
    return {...content({boardId:board.id,...thumbnail.info,current:thumbnail.info.version===board.version}),content:[{type:'image' as const,mimeType:'image/webp',data:thumbnail.content.toString('base64')},{type:'text' as const,text:JSON.stringify({boardId:board.id,...thumbnail.info,current:thumbnail.info.version===board.version})}]};
  });

  server.registerResource(
    "当前 MOKI 白板",
    "moki-whiteboard://current",
    { title: "最近更新的 MOKI 白板快照", description: "最近更新白板的页面与元素结构；不等同于当前浏览器打开的白板", mimeType: "application/json" },
    async (uri) => {
      const board = store.get("default");
      return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify({ board: { id: board.id, title: board.title, version: board.version }, pages: pages(board.snapshot), ...inspectSnapshot(board.snapshot) }, null, 2) }] };
    },
  );

  tool("whiteboard_list", {
    title: "列出 MOKI 白板",
    description: "列出可供 Agent 操作的所有白板文档。",
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async () => content({ boards: store.list() }));

  tool("whiteboard_create", {
    title: "新建 MOKI 白板",
    description: "创建一个独立白板文档，并自动包含一个空白页面。",
    inputSchema: { title: z.string().min(1).max(120).describe("白板标题") },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ title }) => content({ board: store.create(title, "mcp-agent") }));

  tool("whiteboard_inspect", {
    title: "读取白板",
    description: "读取页面、元素 ID、位置、尺寸、颜色和文本。修改前先调用此工具取得准确 ID。",
    inputSchema: {
      boardId: boardIdSchema,
      pageId: z.string().optional().describe("仅检查指定页面"),
      limit: z.number().int().min(1).max(1000).default(200),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ boardId, pageId, limit }) => {
    const board = store.get(boardId);
    return content({ board: { id: board.id, title: board.title, version: board.version, updatedAt: board.updatedAt }, pages: pages(board.snapshot), agentContext:readAgentContext(store,board.id), ...inspectSnapshot(board.snapshot, pageId, limit) });
  });

  tool("whiteboard_create_page", {
    title: "新建白板页面",
    description: "在指定白板中创建新页面，并将其设为当前页面。",
    inputSchema: { boardId: boardIdSchema,expectedVersion:expectedVersionSchema, name: z.string().trim().min(1).max(120).optional() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ boardId, name,expectedVersion }) => {
    let pageId = "";
    const board = store.mutate(boardId, "mcp-agent", "page.create", { name }, (snapshot) => { pageId = createPage(snapshot, name).id; },expectedVersion);
    return content({ boardId: board.id, version: board.version, pageId });
  });

  tool("whiteboard_manage_pages", {
    title: "管理白板页面",
    description: "列出、重命名、移动到分组或删除页面。删除页面也会删除该页内容，且白板至少保留一页。",
    inputSchema: {
      boardId: boardIdSchema,
      action: z.enum(["list", "update", "delete"]),
      expectedVersion:expectedVersionSchema,
      pageId: z.string().optional(),
      name: z.string().min(1).max(120).optional(),
      groupId: z.string().nullable().optional(),
      index: z.string().max(40).optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  }, async ({ boardId, action, pageId, name, groupId, index,expectedVersion }) => {
    if (action === "list") {
      const board = store.get(boardId);
      return content({ boardId: board.id, pages: pages(board.snapshot), groups: pageGroups(board.snapshot) });
    }
    if (!pageId) throw new Error("update/delete 操作需要 pageId");
    const board = store.mutate(boardId, "mcp-agent", `page.${action}`, { pageId, name, groupId, index }, (snapshot) => {
      if (action === "delete") deletePage(snapshot, pageId);
      else updatePage(snapshot, pageId, { name, groupId, index });
    },expectedVersion);
    return content({ boardId: board.id, version: board.version, pageId, action });
  });

  tool("whiteboard_manage_page_groups", {
    title: "管理白板页面分组",
    description: "创建、重命名、删除或列出页面分组；删除分组时页面会保留并回到未分组。",
    inputSchema: { boardId: boardIdSchema,expectedVersion:expectedVersionSchema, action: z.enum(["list", "create", "update", "delete"]), groupId: z.string().optional(), name: z.string().trim().min(1).max(120).optional() },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  }, async ({ boardId, action, groupId, name,expectedVersion }) => {
    if (action === "list") {
      const board = store.get(boardId);
      return content({ boardId: board.id, groups: pageGroups(board.snapshot) });
    }
    let affectedId = groupId;
    const board = store.mutate(boardId, "mcp-agent", `page-group.${action}`, { groupId, name }, (snapshot) => {
      if (action === "create") affectedId = createPageGroup(snapshot, name ?? "新分组").id;
      else if (!groupId) throw new Error("update/delete 操作需要 groupId");
      else if (action === "update") updatePageGroup(snapshot, groupId, name ?? "未命名分组");
      else deletePageGroup(snapshot, groupId);
    },expectedVersion);
    return content({ boardId: board.id, version: board.version, groupId: affectedId, action });
  });

  const elementInput = z.object({
    kind: ElementKindSchema.describe("note、text、rectangle、ellipse、triangle、diamond、cloud、star、arrow、draw、image、file、link 或 mindmap"),
    text: z.string().max(20_000).optional(),
    x: z.number().finite().optional(),
    y: z.number().finite().optional(),
    width: z.number().finite().min(16).max(20_000).optional(),
    height: z.number().finite().min(16).max(20_000).optional(),
    color: ColorSchema.optional(),
    points: z.array(z.object({ x: z.number().finite(), y: z.number().finite() })).min(2).max(10_000).optional(),
    source: z.string().max(25_000_000).optional().describe("图片或文件的 data URL / 可访问 URL"),
    name: z.string().max(500).optional(),
    mimeType: z.string().max(200).optional(),
    url: z.string().url().max(8_000).optional(),
    title: z.string().max(500).optional(),
    branches: z.array(z.string().min(1).max(500)).min(1).max(30).optional(),
    layout: z.enum(["right", "left", "both", "down"]).optional(),
    mode: z.enum(["link", "preview"]).optional(),
    arrowStyle: z.enum(["single", "double", "line", "dashed"]).optional(),
    strokeSize: z.enum(["s", "m", "l", "xl"]).optional(),
  });
  tool("whiteboard_add_elements", {
    title: "添加白板元素",
    description: "批量添加便签、文本、图形、箭头、画笔、思维导图、图片、文件或链接。坐标是无限画布世界坐标；省略坐标时自动排列。",
    inputSchema: { boardId: boardIdSchema,expectedVersion:expectedVersionSchema, pageId: z.string().min(1), elements: z.array(elementInput).min(1).max(200) },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ boardId, pageId, elements,expectedVersion }) => {
    let elementIds: string[] = [];
    const board = store.mutate(boardId, "mcp-agent", "elements.create", { pageId, count: elements.length }, (snapshot) => { elementIds = addElements(snapshot, pageId, elements).map((item) => item.id); },expectedVersion);
    return content({ boardId: board.id, version: board.version, elementIds });
  });

  const updateInput = z.object({
    id: z.string().min(1),
    text: z.string().max(20_000).optional(),
    x: z.number().finite().optional(),
    y: z.number().finite().optional(),
    width: z.number().finite().min(16).max(20_000).optional(),
    height: z.number().finite().min(16).max(20_000).optional(),
    color: ColorSchema.optional(),
    rotation: z.number().finite().optional(),
    fontSize: z.number().finite().min(8).max(160).optional(),
    bold: z.boolean().optional(),
    italic: z.boolean().optional(),
    underline: z.boolean().optional(),
    textAlign: z.enum(["left", "center", "right"]).optional(),
    opacity: z.number().finite().min(.05).max(1).optional(),
    arrowStyle: z.enum(["single", "double", "line", "dashed"]).optional(),
    strokeSize: z.enum(["s", "m", "l", "xl"]).optional(),
  });
  tool("whiteboard_update_elements", {
    title: "更新白板元素",
    description: "按准确元素 ID 批量修改文本、位置、尺寸、颜色或旋转角度。",
    inputSchema: { boardId: boardIdSchema,expectedVersion:expectedVersionSchema, updates: z.array(updateInput).min(1).max(200) },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ boardId, updates,expectedVersion }) => {
    const board = store.mutate(boardId, "mcp-agent", "elements.update", { ids: updates.map((item) => item.id) }, (snapshot) => { updateElements(snapshot, updates); },expectedVersion);
    return content({ boardId: board.id, version: board.version, updatedIds: updates.map((item) => item.id) });
  });

  tool("whiteboard_align_elements", {
    title: "对齐白板元素",
    description: "将两个或更多元素按边缘、中心或间距进行对齐分布。",
    inputSchema: { boardId: boardIdSchema,expectedVersion:expectedVersionSchema, ids: z.array(z.string().min(1)).min(2).max(200), mode: AlignmentModeSchema },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ boardId, ids, mode,expectedVersion }) => {
    const board = store.mutate(boardId, "mcp-agent", "elements.align", { ids, mode }, (snapshot) => { alignElements(snapshot, ids, mode); },expectedVersion);
    return content({ boardId: board.id, version: board.version, alignedIds: ids, mode });
  });

  tool("whiteboard_delete_elements", {
    title: "删除白板元素",
    description: "仅删除明确给出的元素 ID。不会删除页面或整个白板。",
    inputSchema: { boardId: boardIdSchema,expectedVersion:expectedVersionSchema, ids: z.array(z.string().min(1)).min(1).max(200) },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  }, async ({ boardId, ids,expectedVersion }) => {
    let deletedIds: string[] = [];
    const board = store.mutate(boardId, "mcp-agent", "elements.delete", { ids }, (snapshot) => { deletedIds = deleteElements(snapshot, ids); },expectedVersion);
    return content({ boardId: board.id, version: board.version, deletedIds, missingIds: ids.filter((id) => !deletedIds.includes(id)) });
  });

  tool("whiteboard_export", {
    title: "导出白板快照",
    description: "返回完整快照和 .moki ZIP 下载地址（下载需要 API）。includeArchive=true 时直接返回含图片/文件的归档 Base64，无需 API；归档最多 8 MiB，较大白板请通过应用导出。",
    inputSchema: { boardId: boardIdSchema,includeArchive:z.boolean().default(false) },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async ({ boardId,includeArchive }) => {
    const board = store.get(boardId);
    let archive:Record<string,string>|undefined;
    if(includeArchive){const result=await exportBoard(store,board.id);if(result.blob.size>8*1024*1024)throw new Error('归档超过 8 MiB，请通过应用或 HTTP 导出');archive={encoding:'base64',mimeType:'application/zip',data:Buffer.from(await result.blob.arrayBuffer()).toString('base64')};}
    return content({ fileName: `${board.title}.moki`, downloadUrl:`http://127.0.0.1:${process.env.MOKI_WHITEBOARD_PORT??'4321'}/api/boards/${encodeURIComponent(board.id)}/export`, boardId: board.id, version: board.version, snapshot: board.snapshot,...(archive?{archive}:{}) });
  });

  server.registerPrompt("operate-moki-whiteboard", {
    title: "操作 MOKI 白板",
    description: "引导 Agent 安全、可验证地编辑白板",
    argsSchema: { goal: z.string().describe("希望在白板中完成的目标") },
  }, async ({ goal }) => ({ messages: [{ role: "user", content: { type: "text", text: `目标：${goal}\n\n请先调用 whiteboard_list 和 whiteboard_inspect，使用准确 boardId/pageId/元素 ID。修改后再次 inspect 验证结果。删除只允许针对明确 ID。` } }] }));

  tool('whiteboard_native_edit',{
    title:'原生白板编辑操作',
    description:'直接调用与 UI 相同的 MOKI 原生编辑器。支持原生 props 编辑、分组/资料夹，以及真正的思维导图分支操作。先 whiteboard_inspect/whiteboard_export 获取准确 ID 和记录；rotation 使用角度。',
    inputSchema:{boardId:boardIdSchema,pageId:z.string(),action:z.enum(['create','update','group','ungroup','collapse','expand','rename_folder','describe_folder','mindmap_child','mindmap_sibling','mindmap_promote','mindmap_toggle','mindmap_reparent']),ids:z.array(z.string()).max(200).optional(),parentId:z.string().optional(),text:z.string().max(20000).optional(),records:z.array(z.object({id:z.string().optional(),type:z.string().optional(),x:z.number().finite().optional(),y:z.number().finite().optional(),rotation:z.number().finite().optional(),opacity:z.number().min(0).max(1).optional(),isLocked:z.boolean().optional(),props:z.record(z.string(),z.unknown()).optional()})).max(200).optional(),expectedVersion:z.number().int().positive().optional()},
    annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:false,openWorldHint:false}
  },async({boardId,pageId,action,ids=[],parentId,text,records,expectedVersion})=>{
    let result:unknown;
    const board=store.mutate(boardId,'mcp-agent','native.'+action,{pageId,ids},snapshot=>{
      if(!pages(snapshot).some(page=>page.id===pageId))throw new Error('页面不存在');
      const nativeStore=createNativeWhiteboardStore();loadNativeSnapshot(nativeStore,snapshot);
      const editor=new NativeWhiteboardEditor(nativeStore);editor.setCurrentPage(pageId);
      for(const id of ids){if(editor.getShape(id)?.parentId!==pageId)throw new Error('元素不存在或不属于指定页面：'+id);}
      editor.select(...ids);
      const shapeId=ids[0];
      if(action==='create'){if(!records?.length||records.some(record=>!record.type))throw new Error('create 需要包含 type 的原生 records');editor.createShapes(records as Parameters<NativeWhiteboardEditor['createShapes']>[0]);result=true;}
      else if(action==='update'){if(!records?.length)throw new Error('update 需要 records');for(const record of records)if(!record.id||editor.getShape(record.id)?.parentId!==pageId)throw new Error('记录 ID 不属于指定页面');editor.updateShapes(records as Parameters<NativeWhiteboardEditor['updateShapes']>[0]);result=true;}
      else if(action==='group')result=editor.groupSelectedShapes();
      else if(action==='ungroup')result=editor.ungroupSelectedShapes();
      else if(action==='collapse')result=editor.collapseSelectedGroup();
      else {
        if(!shapeId)throw new Error('该操作需要 ids[0]');
        if(action==='expand')result=editor.expandGroupFolder(shapeId);
        if(action==='rename_folder')result=editor.renameGroupFolder(shapeId,text??'');
        if(action==='describe_folder')result=editor.updateGroupFolderDescription(shapeId,text??'');
        if(action==='mindmap_child')result=editor.addMindMapChild(shapeId);
        if(action==='mindmap_sibling')result=editor.addMindMapSibling(shapeId);
        if(action==='mindmap_promote')result=editor.promoteMindMapNode(shapeId);
        if(action==='mindmap_toggle')result=editor.toggleMindMapBranch(shapeId);
        if(action==='mindmap_reparent'){if(!parentId||editor.getShape(parentId)?.parentId!==pageId)throw new Error('需要同页 parentId');result=editor.reparentMindMapNode(shapeId,parentId);}
      }
      if(result===false||result===undefined)throw new Error('操作未应用，请核对元素类型与选择');
      const next=getNativeSnapshot(nativeStore);snapshot.document=next.document as typeof snapshot.document;snapshot.session=next.session as typeof snapshot.session;
    },expectedVersion);
    return content({boardId:board.id,version:board.version,action,result,...inspectSnapshot(board.snapshot,pageId)});
  });
  // Discovery is request-based: database changes from another process do not
  // produce push notifications, especially on the stateless HTTP transport.
  server.server.registerCapabilities({tools:{listChanged:false},resources:{listChanged:false},prompts:{listChanged:false}});
  return server;
}
