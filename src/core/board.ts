import type {
  BoardDocument,
  BoardRecord,
  AlignmentMode,
  ElementInput,
  ElementUpdate,
  MokiColor,
  PageRecord,
  PageGroupRecord,
  Point,
  ShapeRecord,
  WhiteboardSnapshot,
} from "./types.js";

import {nativeShapeBounds,nativeShapeVisualBounds} from '../vendor/moki/whiteboard/native-whiteboard-model.js';
import {buildMindMapTemplate,addMindMapChild,mindMapChildren,mindMapDescendantIds,synchronizeMindMapSnapshot} from '../vendor/moki/whiteboard/mind-map.js';
import {migrateLegacyRecords} from './native-migration.js';

const DEFAULT_PAGE_ID = "page:moki";

function randomUUID(): string {
  return globalThis.crypto.randomUUID();
}

export function richText(text: string): Record<string, unknown> {
  return {
    type: "doc",
    content: text.split(/\r?\n/u).map((line) => ({
      type: "paragraph",
      content: line ? [{ type: "text", text: line }] : [],
    })),
  };
}

export function richTextValue(value: unknown): string {
  if (typeof value === "string") return value;
  const output: string[] = [];
  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    if (typeof record.text === "string") output.push(record.text);
    if (Array.isArray(record.content)) {
      for (const child of record.content) visit(child);
      if (record.type === "paragraph") output.push("\n");
    }
  };
  visit(value);
  return output.join("").replace(/\n$/u, "").replace(/\n{3,}/gu, "\n\n");
}

export function createSnapshot(): WhiteboardSnapshot {
  const page: PageRecord = { id: DEFAULT_PAGE_ID, typeName: "page", name: "页面 1", index: "a000001", meta: {} };
  return {
    engine: "moki-native",
    document: { store: { [page.id]: page }, schema: { engine:'moki-native',schemaVersion: 1 } },
    session: { currentPageId: page.id, camera: { x: 0, y: 0, zoom: 1 } },
  };
}

export function createBoard(title = "我的白板"): BoardDocument {
  return { id: randomUUID(), title, version: 1, updatedAt: new Date().toISOString(), snapshot: createSnapshot() };
}

export function cloneSnapshot(snapshot: WhiteboardSnapshot): WhiteboardSnapshot {
  return structuredClone(snapshot);
}

export function pages(snapshot: WhiteboardSnapshot): PageRecord[] {
  return Object.values(snapshot.document.store)
    .filter((record): record is PageRecord => record.typeName === "page" && typeof (record as PageRecord).name === "string")
    .sort((a, b) => a.index.localeCompare(b.index));
}

export function pageGroups(snapshot: WhiteboardSnapshot): PageGroupRecord[] {
  return Object.values(snapshot.document.store)
    .filter((record): record is PageGroupRecord => record.typeName === "page_group")
    .sort((a, b) => a.index.localeCompare(b.index));
}

export function shapes(snapshot: WhiteboardSnapshot, pageId?: string): ShapeRecord[] {
  return Object.values(snapshot.document.store)
    .filter((record): record is ShapeRecord => record.typeName === "shape")
    .filter((shape) => !pageId || shape.parentId === pageId)
    .sort((a, b) => a.index.localeCompare(b.index));
}

export function createPage(snapshot: WhiteboardSnapshot, name = ""): PageRecord {
  const list = pages(snapshot);
  const id = `page:${randomUUID()}`;
  const page: PageRecord = { id, typeName: "page", name: name.trim() || `页面 ${list.length + 1}`, index: `a${String(list.length + 1).padStart(6, "0")}`, meta: {} };
  snapshot.document.store[id] = page;
  snapshot.session.currentPageId = id;
  return page;
}

export function createPageGroup(snapshot: WhiteboardSnapshot, name: string): PageGroupRecord {
  const list = pageGroups(snapshot);
  const group: PageGroupRecord = { id: `page-group:${randomUUID()}`, typeName: "page_group", name: name.trim() || `分组 ${list.length + 1}`, index: `g${String(list.length + 1).padStart(6, "0")}`, meta: {} };
  snapshot.document.store[group.id] = group;
  return group;
}

export function updatePage(snapshot: WhiteboardSnapshot, pageId: string, update: { name?: string | undefined; groupId?: string | null | undefined; index?: string | undefined }): PageRecord {
  const record = snapshot.document.store[pageId];
  if (!record || record.typeName !== "page") throw new Error(`页面不存在：${pageId}`);
  const page = record as PageRecord;
  if (update.groupId && !pageGroups(snapshot).some((group) => group.id === update.groupId)) throw new Error(`页面分组不存在：${update.groupId}`);
  const next: PageRecord = {
    ...page,
    ...(update.name !== undefined ? { name: update.name.trim() || page.name } : {}),
    ...(update.index !== undefined ? { index: update.index } : {}),
    meta: update.groupId !== undefined ? { ...page.meta, groupId: update.groupId, mokiPageGroupId: update.groupId, mokiPageGroupName: update.groupId ? pageGroups(snapshot).find(group=>group.id===update.groupId)?.name : undefined } : page.meta,
  };
  snapshot.document.store[pageId] = next;
  return next;
}

export function updatePageGroup(snapshot: WhiteboardSnapshot, groupId: string, name: string): PageGroupRecord {
  const record = snapshot.document.store[groupId];
  if (!record || record.typeName !== "page_group") throw new Error(`页面分组不存在：${groupId}`);
  const next = { ...(record as PageGroupRecord), name: name.trim() || (record as PageGroupRecord).name };
  snapshot.document.store[groupId] = next;
  for(const page of pages(snapshot)) if(page.meta.mokiPageGroupId===groupId || page.meta.groupId===groupId) page.meta.mokiPageGroupName=next.name;
  return next;
}

export function deletePage(snapshot: WhiteboardSnapshot, pageId: string): string[] {
  const list = pages(snapshot);
  if (list.length <= 1) throw new Error("白板至少需要保留一个页面");
  if (!list.some((page) => page.id === pageId)) throw new Error(`页面不存在：${pageId}`);
  const deleted = shapes(snapshot, pageId).map((shape) => shape.id);
  deleted.forEach((id) => delete snapshot.document.store[id]);
  delete snapshot.document.store[pageId];
  if (snapshot.session.currentPageId === pageId) snapshot.session.currentPageId = pages(snapshot)[0]!.id;
  return deleted;
}

export function deletePageGroup(snapshot: WhiteboardSnapshot, groupId: string): void {
  const record = snapshot.document.store[groupId];
  if (!record || record.typeName !== "page_group") throw new Error(`页面分组不存在：${groupId}`);
  for (const page of pages(snapshot)) {
    if (page.meta.groupId === groupId || page.meta.mokiPageGroupId === groupId) snapshot.document.store[page.id] = { ...page, meta: { ...page.meta, groupId: null, mokiPageGroupId: null, mokiPageGroupName: null } };
  }
  delete snapshot.document.store[groupId];
}

function nextIndex(snapshot: WhiteboardSnapshot, pageId: string): string {
  return `a${String(shapes(snapshot, pageId).length + 1).padStart(8, "0")}`;
}

function autoPosition(snapshot: WhiteboardSnapshot, pageId: string, offset: number): Point {
  const existing = shapes(snapshot, pageId);
  if (!existing.length) return { x: (offset % 3) * 260, y: Math.floor(offset / 3) * 230 };
  const bounds = existing.map(shapeBounds);
  return { x: Math.max(...bounds.map((item) => item.x + item.width)) + 72 + (offset % 2) * 240, y: Math.min(...bounds.map((item) => item.y)) + Math.floor(offset / 2) * 220 };
}

function baseShape(snapshot: WhiteboardSnapshot, pageId: string, type: ShapeRecord["type"], x: number, y: number, props: Record<string, unknown>): ShapeRecord {
  return {
    id: `shape:${randomUUID()}`, typeName: "shape", type, x, y, rotation: 0,
    index: nextIndex(snapshot, pageId), parentId: pageId, opacity: 1, isLocked: false, props, meta: {},
  };
}

export function addElements(snapshot: WhiteboardSnapshot, pageId: string, inputs: ElementInput[]): ShapeRecord[] {
  if (!pages(snapshot).some((page) => page.id === pageId)) throw new Error(`页面不存在：${pageId}`);
  const created: ShapeRecord[] = [];
  inputs.forEach((input, offset) => {
    const automatic = autoPosition(snapshot, pageId, offset);
    const x = input.x ?? automatic.x;
    const y = input.y ?? automatic.y;
    const color = input.color ?? (input.kind === "note" ? "yellow" : "violet");
    let shape: ShapeRecord;
    if (input.kind === "note") {
      shape = baseShape(snapshot, pageId, "note", x, y, { w: input.width ?? 210, h: input.height ?? 210, color, labelColor: color, size: "m", scale: (input.width ?? 200) / 200, scaleY: (input.height ?? input.width ?? 200) / (input.width ?? 200), richText: richText(input.text ?? "新便签") });
    } else if (input.kind === "text") {
      shape = baseShape(snapshot, pageId, "text", x, y, { w: input.width ?? 260, h: input.height ?? 72, color, size: "m", bold: false, italic: false, underline: false, textAlign: "start", richText: richText(input.text ?? "文本") });
    } else if (input.kind === "arrow") {
      shape = baseShape(snapshot, pageId, "arrow", x, y, { w: input.width ?? 240, h: input.height ?? 80, color, arrowStyle: input.arrowStyle ?? "single", size: input.strokeSize ?? "m", start: { x: 0, y: 0 }, end: { x: input.width ?? 240, y: input.height ?? 80 } });
    } else if (input.kind === "draw") {
      const points = input.points ?? [{ x: 0, y: 0 }, { x: 160, y: 80 }];
      const minX = Math.min(...points.map((point) => point.x));
      const minY = Math.min(...points.map((point) => point.y));
      shape = baseShape(snapshot, pageId, "draw", input.x ?? minX, input.y ?? minY, { color, size: input.strokeSize ?? "m", points: points.map((point) => ({ x: point.x - minX, y: point.y - minY })) });
    } else if (input.kind === "image") {
      if (!input.source) throw new Error("图片元素缺少 source");
      const assetId='asset:'+randomUUID();
      snapshot.document.store[assetId]={id:assetId,typeName:'asset',type:'image',props:{src:input.source,name:input.name??'图片',mimeType:input.mimeType??'image/png',width:input.width??360,height:input.height??240},meta:{}};
      shape = baseShape(snapshot, pageId, "image", x, y, { w: input.width ?? 360, h: input.height ?? 240, assetId, altText:input.name??'图片' });
    } else if (input.kind === "file") {
      if (!input.source) throw new Error("文件元素缺少 source");
      shape = baseShape(snapshot, pageId, "resource", x, y, { w: input.width ?? 330, h: input.height ?? 82, localPath:input.source, source:input.source, name: input.name ?? "附件", kind:"local_file", mimeType: input.mimeType ?? "application/octet-stream", scale:1 });
    } else if (input.kind === "link") {
      if (!input.url) throw new Error("链接元素缺少 url");
      shape = baseShape(snapshot, pageId, "link", x, y, { w: input.width ?? 360, h: input.height ?? (input.mode === "preview" ? 300 : 82), url: input.url, title: input.title ?? input.text ?? input.url, titleAuto: !input.title, mode: input.mode ?? "link", scale: 1, color, richText: richText(input.title ?? input.text ?? input.url) });
    } else if (input.kind === "mindmap") {
      const template=buildMindMapTemplate({template:input.layout==='left'?'mind-left':input.layout==='both'?'mind-both':input.layout==='down'?'mind-down':'mind-right',center:{x,y},color});
      const rootInput=template.shapes.find(item=>item.id===template.rootId)!;
      const root=baseShape(snapshot,pageId,'geo',rootInput.x??x,rootInput.y??y,{...rootInput.props,richText:richText(input.text??'中心主题')});
      root.id=template.rootId;snapshot.document.store[root.id]=root;created.push(root);
      const branches=input.branches?.length?input.branches:['分支一','分支二','分支三'];
      for(const label of branches){const child=addMindMapChild(snapshot,root.id);if(!child)throw new Error('无法添加思维导图分支');const node=snapshot.document.store[child.nodeId] as ShapeRecord;node.props.richText=richText(label);created.push(node,snapshot.document.store[child.edgeId] as ShapeRecord);}
      synchronizeMindMapSnapshot(snapshot);
      return;
    } else {
      shape = baseShape(snapshot, pageId, "geo", x, y, { w: input.width ?? 220, h: input.height ?? 132, geo: input.kind, color, fill: "solid", strokeEnabled: true, strokeColor: color, strokeOpacity: 1, fillEnabled: true, fillColor: color, fillOpacity: .18, richText: richText(input.text ?? "") });
    }
    snapshot.document.store[shape.id] = shape;
    created.push(shape);
  });
  return created;
}

export function updateElements(snapshot: WhiteboardSnapshot, updates: ElementUpdate[]): ShapeRecord[] {
  return updates.map((update) => {
    const current = snapshot.document.store[update.id];
    if (!current || current.typeName !== "shape") throw new Error(`白板元素不存在：${update.id}`);
    const shape = current as ShapeRecord;
    const props = { ...shape.props };
    if (update.text !== undefined) props.richText = richText(update.text);
    if (update.width !== undefined) props.w = update.width;
    if (update.height !== undefined) props.h = update.height;
    if (update.color !== undefined) props.color = update.color;
    if (update.fontSize !== undefined) props.fontSize = update.fontSize;
    if (update.bold !== undefined) props.bold = update.bold;
    if (update.italic !== undefined) props.italic = update.italic;
    if (update.underline !== undefined) props.underline = update.underline;
    if (update.textAlign !== undefined) props.textAlign = {left:"start",center:"middle",right:"end"}[update.textAlign];
    if (update.arrowStyle !== undefined) props.arrowStyle = update.arrowStyle;
    if (update.strokeSize !== undefined) props.size = update.strokeSize;
    const next: ShapeRecord = {
      ...shape,
      ...(update.x !== undefined ? { x: update.x } : {}),
      ...(update.y !== undefined ? { y: update.y } : {}),
      ...(update.rotation !== undefined ? { rotation: update.rotation } : {}),
      ...(update.opacity !== undefined ? { opacity: update.opacity } : {}),
      props,
    };
    snapshot.document.store[next.id] = next;
    return next;
  });
}

export function deleteElements(snapshot: WhiteboardSnapshot, ids: string[]): string[] {
  const deleted: string[] = [];
  for (const id of ids) {
    const record = snapshot.document.store[id];
    if (record?.typeName === "shape") {
      for(const childId of mindMapDescendantIds(snapshot,id)) if(snapshot.document.store[childId]) {delete snapshot.document.store[childId];deleted.push(childId);}
      delete snapshot.document.store[id];
      deleted.push(id);
    }
  }
  return deleted;
}

export function alignElements(snapshot: WhiteboardSnapshot, ids: string[], mode: AlignmentMode): ShapeRecord[] {
  const selected = ids.map((id) => snapshot.document.store[id]).filter((record): record is ShapeRecord => Boolean(record?.typeName === "shape"));
  if (selected.length < 2) throw new Error("至少选择两个元素才能对齐");
  const bounds = selected.map(shapeBounds);
  const minX = Math.min(...bounds.map((item) => item.x));
  const minY = Math.min(...bounds.map((item) => item.y));
  const maxX = Math.max(...bounds.map((item) => item.x + item.width));
  const maxY = Math.max(...bounds.map((item) => item.y + item.height));
  const updates = new Map<string, Point>();
  selected.forEach((shape, index) => {
    const box = bounds[index]!;
    if (mode === "left") updates.set(shape.id, { x: minX, y: shape.y });
    if (mode === "center-x") updates.set(shape.id, { x: (minX + maxX - box.width) / 2, y: shape.y });
    if (mode === "right") updates.set(shape.id, { x: maxX - box.width, y: shape.y });
    if (mode === "top") updates.set(shape.id, { x: shape.x, y: minY });
    if (mode === "center-y") updates.set(shape.id, { x: shape.x, y: (minY + maxY - box.height) / 2 });
    if (mode === "bottom") updates.set(shape.id, { x: shape.x, y: maxY - box.height });
  });
  if (mode === "distribute-horizontal") {
    const ordered = selected.map((shape, index) => ({ shape, box: bounds[index]! })).sort((a, b) => a.box.x - b.box.x);
    const total = ordered.reduce((sum, item) => sum + item.box.width, 0);
    const gap = ordered.length > 1 ? (maxX - minX - total) / (ordered.length - 1) : 0;
    let cursor = minX;
    ordered.forEach(({ shape, box }) => { updates.set(shape.id, { x: cursor, y: shape.y }); cursor += box.width + gap; });
  }
  if (mode === "distribute-vertical") {
    const ordered = selected.map((shape, index) => ({ shape, box: bounds[index]! })).sort((a, b) => a.box.y - b.box.y);
    const total = ordered.reduce((sum, item) => sum + item.box.height, 0);
    const gap = ordered.length > 1 ? (maxY - minY - total) / (ordered.length - 1) : 0;
    let cursor = minY;
    ordered.forEach(({ shape, box }) => { updates.set(shape.id, { x: shape.x, y: cursor }); cursor += box.height + gap; });
  }
  return updateElements(snapshot, [...updates].map(([id, point]) => ({ id, ...point })));
}

function numeric(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function shapeBounds(shape: ShapeRecord): { x: number; y: number; width: number; height: number } {
  const bounds=nativeShapeVisualBounds(shape);
  return {x:bounds.x,y:bounds.y,width:bounds.width,height:bounds.height};
}

export function publicShape(shape: ShapeRecord) {
  const bounds = shapeBounds(shape);
  const color = typeof shape.props.color === "string" ? shape.props.color as MokiColor : "violet";
  const text = richTextValue(shape.props.richText);
  return { id: shape.id, kind: shape.type === "geo" ? String(shape.props.geo ?? "rectangle") : shape.type === "resource" ? "file" : shape.type, pageId: shape.parentId, ...bounds, rotation: shape.rotation, opacity: shape.opacity, color, text };
}

export function inspectSnapshot(snapshot: WhiteboardSnapshot, pageId?: string, limit = 200) {
  const all = shapes(snapshot, pageId).map(publicShape);
  const typeCounts: Record<string, number> = {};
  for (const item of all) typeCounts[item.kind] = (typeCounts[item.kind] ?? 0) + 1;
  const bounds = all.length ? {
    x: Math.min(...all.map((item) => item.x)),
    y: Math.min(...all.map((item) => item.y)),
    width: Math.max(...all.map((item) => item.x + item.width)) - Math.min(...all.map((item) => item.x)),
    height: Math.max(...all.map((item) => item.y + item.height)) - Math.min(...all.map((item) => item.y)),
  } : null;
  return { pageCount: pages(snapshot).length, shapeCount: all.length, typeCounts, bounds, shapes: all.slice(0, Math.max(1, Math.min(limit, 1000))), truncated: all.length > limit };
}

export function normalizeImportedSnapshot(value: unknown): WhiteboardSnapshot {
  if (!value || typeof value !== "object") throw new Error("白板文件不是有效 JSON 对象");
  const candidate = value as Partial<WhiteboardSnapshot>;
  if (!candidate.document?.store || typeof candidate.document.store !== "object") throw new Error("白板文件缺少 document.store");
  const pageList = Object.values(candidate.document.store).filter((record): record is PageRecord => Boolean(record && typeof record === "object" && record.typeName === "page"));
  if (!pageList.length) throw new Error("白板文件至少需要一个页面");
  return {
    engine: "moki-native",
    document: { store: migrateLegacyRecords(structuredClone(candidate.document.store)), schema: { engine:'moki-native',schemaVersion: 1 } },
    session: { ...structuredClone(candidate.session ?? {}), currentPageId: candidate.session?.currentPageId && pageList.some((page) => page.id === candidate.session!.currentPageId) ? candidate.session.currentPageId : pageList[0]!.id },
  };
}

export function isBoardRecord(value: unknown): value is BoardRecord {
  return Boolean(value && typeof value === "object" && typeof (value as BoardRecord).id === "string" && typeof (value as BoardRecord).typeName === "string");
}
