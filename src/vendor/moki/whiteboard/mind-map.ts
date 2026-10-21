import type { WhiteboardSnapshot } from "../domain/whiteboard.js";
import {
  createNativeId,
  isNativeShape,
  nativeRichText,
  nativeShapeBounds,
  nextNativeIndex,
  type NativePoint,
  type NativeWhiteboardRecord,
  type NativeWhiteboardShape,
} from "./native-whiteboard-model.js";

export type MindMapTemplateId =
  | "mind-right"
  | "mind-left"
  | "mind-both"
  | "mind-down"
  | "tree-right"
  | "tree-left"
  | "tree-down"
  | "timeline-right"
  | "timeline-down";

export type MindMapShapeInput = Partial<NativeWhiteboardShape> & { type: string };

type MindMapDirection = "right" | "left" | "down";

const NODE_WIDTH = 184;
const NODE_HEIGHT = 64;
const ROOT_WIDTH = 204;
const ROOT_HEIGHT = 72;
const HORIZONTAL_GAP = 116;
const VERTICAL_GAP = 46;

function mapId(): string {
  return `mindmap:${createNativeId("shape").slice(6)}`;
}

function shapeId(): string {
  return createNativeId("shape");
}

function finite(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function isMindMapNode(shape: NativeWhiteboardShape | undefined): shape is NativeWhiteboardShape {
  return Boolean(shape?.props.mokiMindMapNode === true);
}

export function isMindMapEdge(shape: NativeWhiteboardShape | undefined): shape is NativeWhiteboardShape {
  return Boolean(shape?.type === "arrow" && shape.props.mokiMindMapEdge === true);
}

export function isMindMapShapeHidden(shape: NativeWhiteboardShape): boolean {
  return shape.props.mokiMindMapHidden === true;
}

export function mindMapParentId(shape: NativeWhiteboardShape | undefined): string | undefined {
  const value = shape?.props.mokiMindMapParentId;
  return typeof value === "string" && value ? value : undefined;
}

export function mindMapMapId(shape: NativeWhiteboardShape | undefined): string | undefined {
  const value = shape?.props.mokiMindMapId;
  return typeof value === "string" && value ? value : undefined;
}

export function mindMapChildren(
  snapshot: WhiteboardSnapshot,
  parentId: string,
): NativeWhiteboardShape[] {
  return Object.values(snapshot.document.store)
    .filter((record): record is NativeWhiteboardShape => (
      isNativeShape(record)
      && isMindMapNode(record)
      && mindMapParentId(record) === parentId
    ))
    .sort((left, right) => (
      finite(left.props.mokiMindMapOrder) - finite(right.props.mokiMindMapOrder)
      || left.index.localeCompare(right.index)
    ));
}

export function mindMapDescendantIds(snapshot: WhiteboardSnapshot, nodeId: string): Set<string> {
  const descendants = new Set<string>();
  const pending = [nodeId];
  while (pending.length > 0) {
    const parentId = pending.shift()!;
    for (const child of mindMapChildren(snapshot, parentId)) {
      if (descendants.has(child.id)) continue;
      descendants.add(child.id);
      pending.push(child.id);
    }
  }
  return descendants;
}

function nodeInput(input: {
  id: string;
  mapId: string;
  parentId?: string;
  x: number;
  y: number;
  label: string;
  color: string;
  direction: MindMapDirection;
  order: number;
  root?: boolean;
}): MindMapShapeInput {
  const root = input.root === true;
  return {
    id: input.id,
    type: "geo",
    x: input.x,
    y: input.y,
    props: {
      w: root ? ROOT_WIDTH : NODE_WIDTH,
      h: root ? ROOT_HEIGHT : NODE_HEIGHT,
      geo: "round-rectangle",
      scale: 1,
      richText: nativeRichText(input.label),
      size: root ? "m" : "s",
      bold: root,
      textAlign: "middle",
      color: input.color,
      strokeEnabled: true,
      strokeColor: input.color,
      strokeOpacity: root ? 1 : 0.78,
      fillEnabled: true,
      fillColor: "light-violet",
      fillOpacity: root ? 0.42 : 0.18,
      mokiMindMapNode: true,
      mokiMindMapId: input.mapId,
      ...(input.parentId ? { mokiMindMapParentId: input.parentId } : {}),
      mokiMindMapDirection: input.direction,
      mokiMindMapOrder: input.order,
      mokiMindMapRoot: root,
      mokiMindMapAutoManaged: true,
      mokiMindMapCollapsed: false,
      mokiMindMapHidden: false,
    },
  };
}

function edgeInput(input: {
  id: string;
  mapId: string;
  fromId: string;
  toId: string;
  color: string;
}): MindMapShapeInput {
  return {
    id: input.id,
    type: "arrow",
    x: 0,
    y: 0,
    props: {
      start: { x: 0, y: 0 },
      end: { x: 1, y: 1 },
      color: input.color,
      size: "m",
      arrowStyle: "line",
      mokiMindMapEdge: true,
      mokiMindMapId: input.mapId,
      mokiMindMapFromId: input.fromId,
      mokiMindMapToId: input.toId,
      mokiMindMapHidden: false,
    },
  };
}

type TemplateNode = {
  key: string;
  parent?: string;
  x: number;
  y: number;
  label: string;
  direction: MindMapDirection;
};

function templateNodes(template: MindMapTemplateId): TemplateNode[] {
  const basicRight: TemplateNode[] = [
    { key: "root", x: -310, y: -36, label: "中心主题", direction: "right" },
    ...[-165, -55, 55, 165].map((y, index) => ({
      key: `branch-${index}`,
      parent: "root",
      x: 110,
      y,
      label: `分支 ${index + 1}`,
      direction: "right" as const,
    })),
  ];
  if (template === "mind-right") return basicRight;
  if (template === "mind-left") {
    return basicRight.map((node) => ({
      ...node,
      x: node.key === "root" ? 106 : -310,
      direction: "left" as const,
    }));
  }
  if (template === "mind-both") {
    return [
      { key: "root", x: -102, y: -36, label: "中心主题", direction: "right" },
      { key: "left-1", parent: "root", x: -420, y: -120, label: "左侧分支 1", direction: "left" },
      { key: "left-2", parent: "root", x: -420, y: 55, label: "左侧分支 2", direction: "left" },
      { key: "right-1", parent: "root", x: 140, y: -120, label: "右侧分支 1", direction: "right" },
      { key: "right-2", parent: "root", x: 140, y: 55, label: "右侧分支 2", direction: "right" },
    ];
  }
  if (template === "mind-down") {
    return [
      { key: "root", x: -102, y: -245, label: "中心主题", direction: "down" },
      ...[-330, -110, 110, 330].map((x, index) => ({
        key: `branch-${index}`,
        parent: "root",
        x,
        y: 80,
        label: `分支 ${index + 1}`,
        direction: "down" as const,
      })),
    ];
  }
  if (template === "timeline-right" || template === "timeline-down") {
    const down = template === "timeline-down";
    return Array.from({ length: 5 }, (_, index) => ({
      key: index === 0 ? "root" : `stage-${index}`,
      ...(index > 0 ? { parent: index === 1 ? "root" : `stage-${index - 1}` } : {}),
      x: down ? -102 : -480 + index * 250,
      y: down ? -260 + index * 125 : -36,
      label: index === 0 ? "起点" : `阶段 ${index}`,
      direction: down ? "down" as const : "right" as const,
    }));
  }
  const direction: MindMapDirection = template === "tree-left"
    ? "left"
    : template === "tree-down"
      ? "down"
      : "right";
  const rootX = direction === "left" ? 120 : direction === "down" ? -102 : -360;
  const rootY = direction === "down" ? -260 : -36;
  const firstPositions = direction === "down"
    ? [{ x: -300, y: 20 }, { x: -92, y: 20 }, { x: 116, y: 20 }]
    : [{ x: direction === "left" ? -180 : -30, y: -150 }, { x: direction === "left" ? -180 : -30, y: -30 }, { x: direction === "left" ? -180 : -30, y: 90 }];
  const secondPositions = direction === "down"
    ? [{ x: -300, y: 170 }, { x: -92, y: 170 }, { x: 116, y: 170 }]
    : [{ x: direction === "left" ? -470 : 260, y: -150 }, { x: direction === "left" ? -470 : 260, y: -30 }, { x: direction === "left" ? -470 : 260, y: 90 }];
  return [
    { key: "root", x: rootX, y: rootY, label: "主题", direction },
    ...firstPositions.map((position, index) => ({ key: `level-1-${index}`, parent: "root", ...position, label: `一级 ${index + 1}`, direction })),
    ...secondPositions.map((position, index) => ({ key: `level-2-${index}`, parent: `level-1-${index}`, ...position, label: `二级 ${index + 1}`, direction })),
  ];
}

export function buildMindMapTemplate(input: {
  template: MindMapTemplateId;
  center: NativePoint;
  color: string;
}): { rootId: string; nodeIds: string[]; shapes: MindMapShapeInput[] } {
  const currentMapId = mapId();
  const specs = templateNodes(input.template);
  const ids = new Map(specs.map((node) => [node.key, shapeId()]));
  const nodes = specs.map((node, index) => nodeInput({
    id: ids.get(node.key)!,
    mapId: currentMapId,
    ...(node.parent ? { parentId: ids.get(node.parent)! } : {}),
    x: input.center.x + node.x,
    y: input.center.y + node.y,
    label: node.label,
    color: input.color,
    direction: node.direction,
    order: index,
    root: !node.parent,
  }));
  const edges = specs.flatMap((node) => node.parent ? [edgeInput({
    id: shapeId(),
    mapId: currentMapId,
    fromId: ids.get(node.parent)!,
    toId: ids.get(node.key)!,
    color: input.color,
  })] : []);
  return {
    rootId: ids.get("root")!,
    nodeIds: [...ids.values()],
    shapes: [...edges, ...nodes],
  };
}

export type MindMapOutlineBranch = {
  title: string;
  children: string[];
};

/** Builds assistant-authored content with the same native node metadata as UI templates. */
export function buildMindMapOutline(input: {
  topic: string;
  branches: MindMapOutlineBranch[];
  layout: "right" | "left" | "both" | "down";
  center: NativePoint;
  color: string;
}): { rootId: string; nodeIds: string[]; shapes: MindMapShapeInput[] } {
  const currentMapId = mapId();
  const rootId = shapeId();
  const nodeIds = [rootId];
  const nodes: MindMapShapeInput[] = [nodeInput({
    id: rootId,
    mapId: currentMapId,
    x: input.center.x - ROOT_WIDTH / 2,
    y: input.center.y - ROOT_HEIGHT / 2,
    label: input.topic,
    color: input.color,
    direction: input.layout === "down" ? "down" : "right",
    order: 0,
    root: true,
  })];
  const edges: MindMapShapeInput[] = [];
  let order = 1;

  const addNode = (value: {
    parentId: string;
    x: number;
    y: number;
    label: string;
    direction: MindMapDirection;
  }): string => {
    const id = shapeId();
    nodeIds.push(id);
    nodes.push(nodeInput({
      id,
      mapId: currentMapId,
      parentId: value.parentId,
      x: value.x,
      y: value.y,
      label: value.label,
      color: input.color,
      direction: value.direction,
      order: order++,
    }));
    edges.push(edgeInput({
      id: shapeId(),
      mapId: currentMapId,
      fromId: value.parentId,
      toId: id,
      color: input.color,
    }));
    return id;
  };

  if (input.layout === "down") {
    const branchStep = 260;
    const startX = input.center.x - ((input.branches.length - 1) * branchStep) / 2;
    input.branches.forEach((branch, branchIndex) => {
      const branchCenterX = startX + branchIndex * branchStep;
      const branchId = addNode({
        parentId: rootId,
        x: branchCenterX - NODE_WIDTH / 2,
        y: input.center.y + 170,
        label: branch.title,
        direction: "down",
      });
      branch.children.forEach((label, childIndex) => {
        addNode({
          parentId: branchId,
          x: branchCenterX - NODE_WIDTH / 2,
          y: input.center.y + 360 + childIndex * 110,
          label,
          direction: "down",
        });
      });
    });
    return { rootId, nodeIds, shapes: [...edges, ...nodes] };
  }

  const branchSide = (index: number): "left" | "right" => (
    input.layout === "left" ? "left" : input.layout === "both" && index % 2 === 1 ? "left" : "right"
  );
  for (const side of ["left", "right"] as const) {
    const entries = input.branches
      .map((branch, index) => ({ branch, index }))
      .filter((entry) => branchSide(entry.index) === side);
    const totalRows = entries.reduce(
      (sum, entry) => sum + Math.max(1, entry.branch.children.length),
      0,
    );
    let row = 0;
    for (const { branch } of entries) {
      const rows = Math.max(1, branch.children.length);
      const branchY = input.center.y + (row + rows / 2 - totalRows / 2) * 110 - NODE_HEIGHT / 2;
      const direction: MindMapDirection = side;
      const branchId = addNode({
        parentId: rootId,
        x: side === "right"
          ? input.center.x + 230
          : input.center.x - 230 - NODE_WIDTH,
        y: branchY,
        label: branch.title,
        direction,
      });
      branch.children.forEach((label, childIndex) => {
        addNode({
          parentId: branchId,
          x: side === "right"
            ? input.center.x + 530
            : input.center.x - 530 - NODE_WIDTH,
          y: input.center.y + (row + childIndex + 0.5 - totalRows / 2) * 110 - NODE_HEIGHT / 2,
          label,
          direction,
        });
      });
      row += rows;
    }
  }
  return { rootId, nodeIds, shapes: [...edges, ...nodes] };
}

function directionFor(parent: NativeWhiteboardShape, child: NativeWhiteboardShape): MindMapDirection {
  const parentBounds = nativeShapeBounds(parent);
  const childBounds = nativeShapeBounds(child);
  const dx = childBounds.center.x - parentBounds.center.x;
  const dy = childBounds.center.y - parentBounds.center.y;
  if (Math.abs(dy) > Math.abs(dx) * 1.1 && dy > 0) return "down";
  return dx < 0 ? "left" : "right";
}

function connectionPoints(parent: NativeWhiteboardShape, child: NativeWhiteboardShape): { start: NativePoint; end: NativePoint } {
  const parentBounds = nativeShapeBounds(parent);
  const childBounds = nativeShapeBounds(child);
  const direction = directionFor(parent, child);
  if (direction === "down") {
    return {
      start: { x: parentBounds.center.x, y: parentBounds.y + parentBounds.h },
      end: { x: childBounds.center.x, y: childBounds.y },
    };
  }
  if (direction === "left") {
    return {
      start: { x: parentBounds.x, y: parentBounds.center.y },
      end: { x: childBounds.x + childBounds.w, y: childBounds.center.y },
    };
  }
  return {
    start: { x: parentBounds.x + parentBounds.w, y: parentBounds.center.y },
    end: { x: childBounds.x, y: childBounds.center.y },
  };
}

function hiddenForNode(nodes: Map<string, NativeWhiteboardShape>, node: NativeWhiteboardShape): boolean {
  const visited = new Set<string>([node.id]);
  let parentId = mindMapParentId(node);
  while (parentId) {
    if (visited.has(parentId)) return false;
    visited.add(parentId);
    const parent = nodes.get(parentId);
    if (!parent) return false;
    if (parent.props.mokiMindMapCollapsed === true) return true;
    parentId = mindMapParentId(parent);
  }
  return false;
}

/** Keeps relation edges and collapsed-branch visibility aligned with node state. */
export function synchronizeMindMapSnapshot(snapshot: WhiteboardSnapshot): boolean {
  const allShapes = Object.values(snapshot.document.store)
    .filter((record): record is NativeWhiteboardShape => isNativeShape(record));
  let changed = false;
  const rawNodes = new Map(allShapes.filter(isMindMapNode).map((shape) => [shape.id, shape]));
  const legacyMapIds = new Map<string, string>();
  for (const node of rawNodes.values()) {
    if (mindMapMapId(node)) continue;
    const visited = new Set<string>([node.id]);
    let root = node;
    let parentId = mindMapParentId(root);
    while (parentId && !visited.has(parentId)) {
      visited.add(parentId);
      const parent = rawNodes.get(parentId);
      if (!parent) break;
      root = parent;
      parentId = mindMapParentId(root);
    }
    const legacyMapId = legacyMapIds.get(root.id) ?? `mindmap:legacy:${root.id}`;
    legacyMapIds.set(root.id, legacyMapId);
    node.props = {
      ...node.props,
      mokiMindMapId: legacyMapId,
      mokiMindMapRoot: !mindMapParentId(node),
      mokiMindMapCollapsed: node.props.mokiMindMapCollapsed === true,
      mokiMindMapHidden: false,
    };
    changed = true;
  }
  const nodes = new Map(allShapes.filter(isMindMapNode).map((shape) => [shape.id, shape]));
  for (const edge of allShapes) {
    const fromId = typeof edge.props.mokiMindMapFromId === "string" ? edge.props.mokiMindMapFromId : "";
    const toId = typeof edge.props.mokiMindMapToId === "string" ? edge.props.mokiMindMapToId : "";
    const child = nodes.get(toId);
    if (edge.type !== "arrow" || !nodes.has(fromId) || !child || edge.props.mokiMindMapEdge === true) continue;
    edge.props = {
      ...edge.props,
      mokiMindMapEdge: true,
      mokiMindMapId: mindMapMapId(child),
      arrowStyle: "line",
      mokiMindMapHidden: false,
    };
    changed = true;
  }
  for (const node of nodes.values()) {
    const hidden = hiddenForNode(nodes, node);
    if (node.props.mokiMindMapHidden !== hidden) {
      node.props = { ...node.props, mokiMindMapHidden: hidden };
      changed = true;
    }
  }
  for (const edge of allShapes.filter(isMindMapEdge)) {
    const fromId = typeof edge.props.mokiMindMapFromId === "string" ? edge.props.mokiMindMapFromId : "";
    const toId = typeof edge.props.mokiMindMapToId === "string" ? edge.props.mokiMindMapToId : "";
    const parent = nodes.get(fromId);
    const child = nodes.get(toId);
    if (!parent || !child || mindMapParentId(child) !== parent.id) {
      delete snapshot.document.store[edge.id];
      changed = true;
      continue;
    }
    const { start, end } = connectionPoints(parent, child);
    const hidden = child.props.mokiMindMapHidden === true;
    const nextEnd = { x: end.x - start.x, y: end.y - start.y };
    const currentStart = edge.props.start as Partial<NativePoint> | undefined;
    const currentEnd = edge.props.end as Partial<NativePoint> | undefined;
    if (
      Math.abs(edge.x - start.x) > 0.001
      || Math.abs(edge.y - start.y) > 0.001
      || Math.abs(finite(currentStart?.x) - 0) > 0.001
      || Math.abs(finite(currentStart?.y) - 0) > 0.001
      || Math.abs(finite(currentEnd?.x) - nextEnd.x) > 0.001
      || Math.abs(finite(currentEnd?.y) - nextEnd.y) > 0.001
      || edge.props.mokiMindMapHidden !== hidden
    ) {
      edge.x = start.x;
      edge.y = start.y;
      edge.rotation = 0;
      edge.props = {
        ...edge.props,
        start: { x: 0, y: 0 },
        end: nextEnd,
        scale: 1,
        scaleX: 1,
        scaleY: 1,
        mokiMindMapHidden: hidden,
      };
      changed = true;
    }
  }
  return changed;
}

function currentRecords(snapshot: WhiteboardSnapshot): NativeWhiteboardRecord[] {
  return Object.values(snapshot.document.store).filter((record): record is NativeWhiteboardRecord => (
    Boolean(record && typeof record === "object" && typeof record.id === "string" && typeof record.typeName === "string")
  ));
}

export function addMindMapChild(
  snapshot: WhiteboardSnapshot,
  parentId: string,
  options: { center?: NativePoint } = {},
): { nodeId: string; edgeId: string } | undefined {
  const parent = snapshot.document.store[parentId];
  if (!isNativeShape(parent) || !isMindMapNode(parent)) return undefined;
  const currentMapId = mindMapMapId(parent);
  if (!currentMapId) return undefined;
  const siblings = mindMapChildren(snapshot, parentId);
  const parentBounds = nativeShapeBounds(parent);
  const direction = String(parent.props.mokiMindMapDirection) as MindMapDirection;
  const dx = options.center ? options.center.x - parentBounds.center.x : 0;
  const dy = options.center ? options.center.y - parentBounds.center.y : 0;
  const resolvedDirection: MindMapDirection = options.center
    ? Math.abs(dy) > Math.abs(dx) * 1.1 && dy > 0
      ? "down"
      : dx < 0 ? "left" : "right"
    : direction === "left" || direction === "down" ? direction : "right";
  const nodeId = shapeId();
  const edgeId = shapeId();
  const siblingBounds = siblings.map(nativeShapeBounds);
  const x = options.center
    ? options.center.x - NODE_WIDTH / 2
    : resolvedDirection === "left"
    ? parentBounds.x - HORIZONTAL_GAP - NODE_WIDTH
    : resolvedDirection === "down"
      ? siblingBounds.length > 0
        ? Math.max(...siblingBounds.map((bounds) => bounds.x + bounds.w)) + VERTICAL_GAP
        : parentBounds.center.x - NODE_WIDTH / 2
      : parentBounds.x + parentBounds.w + HORIZONTAL_GAP;
  const y = options.center
    ? options.center.y - NODE_HEIGHT / 2
    : resolvedDirection === "down"
    ? parentBounds.y + parentBounds.h + HORIZONTAL_GAP
    : siblingBounds.length > 0
      ? Math.max(...siblingBounds.map((bounds) => bounds.y + bounds.h)) + VERTICAL_GAP
      : parentBounds.center.y - NODE_HEIGHT / 2;
  const color = typeof parent.props.strokeColor === "string" ? parent.props.strokeColor : "black";
  const node = nodeInput({
    id: nodeId,
    mapId: currentMapId,
    parentId,
    x,
    y,
    label: `新节点 ${siblings.length + 1}`,
    color,
    direction: resolvedDirection,
    order: siblings.length,
  });
  if (options.center) {
    node.props = { ...node.props, mokiMindMapAutoManaged: false };
  }
  const edge = edgeInput({ id: edgeId, mapId: currentMapId, fromId: parentId, toId: nodeId, color });
  const pageId = parent.parentId;
  const records = currentRecords(snapshot);
  for (const input of [edge, node]) {
    const shape: NativeWhiteboardShape = {
      id: input.id!,
      typeName: "shape",
      type: input.type,
      x: input.x ?? 0,
      y: input.y ?? 0,
      parentId: pageId,
      index: nextNativeIndex(records, pageId),
      rotation: 0,
      opacity: 1,
      props: { ...(input.props ?? {}) },
      meta: {},
    };
    snapshot.document.store[shape.id] = shape;
    records.push(shape);
  }
  const createdNode = snapshot.document.store[nodeId];
  const managedSiblings = [...siblings, createdNode]
    .filter((shape): shape is NativeWhiteboardShape => isNativeShape(shape) && shape.props.mokiMindMapAutoManaged !== false);
  if (managedSiblings.length === siblings.length + 1) {
    if (resolvedDirection === "down") {
      const totalWidth = managedSiblings.length * NODE_WIDTH + (managedSiblings.length - 1) * 28;
      const startX = parentBounds.center.x - totalWidth / 2;
      managedSiblings.forEach((shape, index) => {
        shape.x = startX + index * (NODE_WIDTH + 28);
        shape.y = parentBounds.y + parentBounds.h + HORIZONTAL_GAP;
      });
    } else {
      const totalHeight = managedSiblings.length * NODE_HEIGHT + (managedSiblings.length - 1) * 28;
      const startY = parentBounds.center.y - totalHeight / 2;
      managedSiblings.forEach((shape, index) => {
        shape.x = resolvedDirection === "left"
          ? parentBounds.x - HORIZONTAL_GAP - NODE_WIDTH
          : parentBounds.x + parentBounds.w + HORIZONTAL_GAP;
        shape.y = startY + index * (NODE_HEIGHT + 28);
      });
    }
  }
  parent.props = { ...parent.props, mokiMindMapCollapsed: false };
  synchronizeMindMapSnapshot(snapshot);
  return { nodeId, edgeId };
}

export function reparentMindMapNode(
  snapshot: WhiteboardSnapshot,
  nodeId: string,
  nextParentId: string,
): boolean {
  const node = snapshot.document.store[nodeId];
  const nextParent = snapshot.document.store[nextParentId];
  if (
    !isNativeShape(node)
    || !isNativeShape(nextParent)
    || !isMindMapNode(node)
    || !isMindMapNode(nextParent)
    || node.props.mokiMindMapRoot === true
    || mindMapMapId(node) !== mindMapMapId(nextParent)
    || node.id === nextParent.id
    || mindMapDescendantIds(snapshot, node.id).has(nextParent.id)
  ) return false;
  const siblings = mindMapChildren(snapshot, nextParentId).filter((shape) => shape.id !== nodeId);
  node.props = {
    ...node.props,
    mokiMindMapParentId: nextParentId,
    mokiMindMapDirection: directionFor(nextParent, node),
    mokiMindMapOrder: siblings.length,
    mokiMindMapAutoManaged: false,
    mokiMindMapHidden: false,
  };
  const edge = Object.values(snapshot.document.store).find((record) => (
    isNativeShape(record)
    && isMindMapEdge(record)
    && record.props.mokiMindMapToId === nodeId
  ));
  if (isNativeShape(edge)) {
    edge.props = { ...edge.props, mokiMindMapFromId: nextParentId };
  } else {
    const input = edgeInput({
      id: shapeId(),
      mapId: mindMapMapId(node)!,
      fromId: nextParentId,
      toId: nodeId,
      color: typeof nextParent.props.strokeColor === "string" ? nextParent.props.strokeColor : "black",
    });
    snapshot.document.store[input.id!] = {
      id: input.id!, typeName: "shape", type: "arrow", x: 0, y: 0,
      parentId: node.parentId,
      index: nextNativeIndex(currentRecords(snapshot), node.parentId),
      rotation: 0, opacity: 1, props: { ...input.props }, meta: {},
    };
  }
  synchronizeMindMapSnapshot(snapshot);
  return true;
}

export function promoteMindMapNode(snapshot: WhiteboardSnapshot, nodeId: string): boolean {
  const node = snapshot.document.store[nodeId];
  if (!isNativeShape(node) || !isMindMapNode(node)) return false;
  const parentId = mindMapParentId(node);
  const parent = parentId ? snapshot.document.store[parentId] : undefined;
  if (!isNativeShape(parent) || !isMindMapNode(parent)) return false;
  const grandParentId = mindMapParentId(parent);
  return grandParentId ? reparentMindMapNode(snapshot, nodeId, grandParentId) : false;
}

export function toggleMindMapBranch(snapshot: WhiteboardSnapshot, nodeId: string): boolean {
  const node = snapshot.document.store[nodeId];
  if (!isNativeShape(node) || !isMindMapNode(node) || mindMapChildren(snapshot, nodeId).length === 0) return false;
  node.props = {
    ...node.props,
    mokiMindMapCollapsed: node.props.mokiMindMapCollapsed !== true,
  };
  synchronizeMindMapSnapshot(snapshot);
  return true;
}
