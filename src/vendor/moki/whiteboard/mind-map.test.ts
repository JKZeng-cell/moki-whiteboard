import { describe, expect, it } from "vitest";
import {
  createNativeWhiteboardSnapshot,
  isNativeShape,
  nativeShapeBounds,
  nextNativeIndex,
  type NativeWhiteboardShape,
} from "./native-whiteboard-model.js";
import {
  addMindMapChild,
  buildMindMapTemplate,
  isMindMapEdge,
  isMindMapNode,
  mindMapChildren,
  mindMapDescendantIds,
  mindMapParentId,
  promoteMindMapNode,
  reparentMindMapNode,
  synchronizeMindMapSnapshot,
  toggleMindMapBranch,
  type MindMapTemplateId,
  type MindMapShapeInput,
} from "./mind-map.js";

function insertShapes(inputs: MindMapShapeInput[]) {
  const snapshot = createNativeWhiteboardSnapshot();
  const pageId = "page:moki";
  const records = Object.values(snapshot.document.store);
  for (const input of inputs) {
    const shape = {
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
    } satisfies NativeWhiteboardShape;
    snapshot.document.store[shape.id] = shape;
    records.push(shape);
  }
  synchronizeMindMapSnapshot(snapshot);
  return snapshot;
}

function shapes(snapshot: ReturnType<typeof createNativeWhiteboardSnapshot>) {
  return Object.values(snapshot.document.store)
    .filter((record): record is NativeWhiteboardShape => isNativeShape(record));
}

describe("mind-map templates", () => {
  it("creates every template as editable parent-child nodes and relation edges", () => {
    const templates: MindMapTemplateId[] = [
      "mind-right",
      "mind-left",
      "mind-both",
      "mind-down",
      "tree-right",
      "tree-left",
      "tree-down",
      "timeline-right",
      "timeline-down",
    ];
    for (const template of templates) {
      const built = buildMindMapTemplate({ template, center: { x: 800, y: 500 }, color: "black" });
      const snapshot = insertShapes(built.shapes);
      const nodes = shapes(snapshot).filter(isMindMapNode);
      const edges = shapes(snapshot).filter(isMindMapEdge);
      expect(nodes.length).toBeGreaterThanOrEqual(5);
      expect(edges).toHaveLength(nodes.length - 1);
      expect(nodes.find((node) => node.id === built.rootId)?.props.mokiMindMapRoot).toBe(true);
      expect(edges.every((edge) => {
        const end = edge.props.end as { x?: number; y?: number };
        return Number.isFinite(end.x) && Number.isFinite(end.y);
      })).toBe(true);
    }
  });

  it("supports unbounded child creation, dynamic edges, hierarchy changes, and branch folding", () => {
    const built = buildMindMapTemplate({ template: "mind-right", center: { x: 700, y: 500 }, color: "violet" });
    const snapshot = insertShapes(built.shapes);
    let parentId = built.rootId;
    for (let index = 0; index < 20; index += 1) {
      const created = addMindMapChild(snapshot, parentId);
      expect(created).toBeDefined();
      parentId = created!.nodeId;
    }
    expect(mindMapDescendantIds(snapshot, built.rootId).size).toBe(24);

    const rootChildren = mindMapChildren(snapshot, built.rootId);
    const firstChild = rootChildren[0]!;
    const secondChild = rootChildren[1]!;
    const nested = addMindMapChild(snapshot, firstChild.id)!;
    expect(reparentMindMapNode(snapshot, nested.nodeId, secondChild.id)).toBe(true);
    expect(mindMapParentId(snapshot.document.store[nested.nodeId] as NativeWhiteboardShape)).toBe(secondChild.id);
    expect(promoteMindMapNode(snapshot, nested.nodeId)).toBe(true);
    expect(mindMapParentId(snapshot.document.store[nested.nodeId] as NativeWhiteboardShape)).toBe(built.rootId);

    const relation = shapes(snapshot).find((shape) => (
      isMindMapEdge(shape) && shape.props.mokiMindMapToId === nested.nodeId
    ))!;
    const previousEnd = structuredClone(relation.props.end);
    const nestedNode = snapshot.document.store[nested.nodeId] as NativeWhiteboardShape;
    nestedNode.x += 180;
    nestedNode.y += 90;
    expect(synchronizeMindMapSnapshot(snapshot)).toBe(true);
    expect(relation.props.end).not.toEqual(previousEnd);

    expect(toggleMindMapBranch(snapshot, built.rootId)).toBe(true);
    expect(shapes(snapshot).filter(isMindMapNode).filter((node) => node.id !== built.rootId)
      .every((node) => node.props.mokiMindMapHidden === true)).toBe(true);
    expect(toggleMindMapBranch(snapshot, built.rootId)).toBe(true);
    expect(shapes(snapshot).filter(isMindMapNode)
      .every((node) => node.props.mokiMindMapHidden === false)).toBe(true);
  });

  it("recreates a deleted relation edge when a disconnected node is dragged onto a parent", () => {
    const built = buildMindMapTemplate({ template: "mind-right", center: { x: 500, y: 400 }, color: "violet" });
    const snapshot = insertShapes(built.shapes);
    const child = mindMapChildren(snapshot, built.rootId)[0]!;
    const relation = shapes(snapshot).find((shape) => (
      isMindMapEdge(shape) && shape.props.mokiMindMapToId === child.id
    ))!;
    delete snapshot.document.store[relation.id];

    expect(reparentMindMapNode(snapshot, child.id, built.rootId)).toBe(true);
    const restored = shapes(snapshot).filter((shape) => (
      isMindMapEdge(shape) && shape.props.mokiMindMapToId === child.id
    ));
    expect(restored).toHaveLength(1);
    expect(restored[0]?.props.mokiMindMapFromId).toBe(built.rootId);
  });

  it("creates a manually positioned child without rearranging managed siblings", () => {
    const built = buildMindMapTemplate({ template: "mind-right", center: { x: 700, y: 500 }, color: "violet" });
    const snapshot = insertShapes(built.shapes);
    const before = mindMapChildren(snapshot, built.rootId).map((node) => ({ id: node.id, x: node.x, y: node.y }));
    const created = addMindMapChild(snapshot, built.rootId, { center: { x: 1_450, y: 920 } })!;
    const node = snapshot.document.store[created.nodeId] as NativeWhiteboardShape;
    expect(nativeShapeBounds(node).center).toEqual({ x: 1_450, y: 920 });
    expect(node.props).toMatchObject({
      mokiMindMapParentId: built.rootId,
      mokiMindMapAutoManaged: false,
      mokiMindMapDirection: "right",
    });
    expect(mindMapChildren(snapshot, built.rootId)
      .filter((child) => child.id !== created.nodeId)
      .map((child) => ({ id: child.id, x: child.x, y: child.y }))).toEqual(before);
    expect(shapes(snapshot).find((shape) => (
      isMindMapEdge(shape) && shape.props.mokiMindMapToId === created.nodeId
    ))?.props.mokiMindMapFromId).toBe(built.rootId);
  });
});
