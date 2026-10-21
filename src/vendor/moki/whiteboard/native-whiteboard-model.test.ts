import { describe, expect, it } from "vitest";
import type { WhiteboardSnapshot } from "../domain/whiteboard.js";
import {
  decodeLegacyDrawPath,
  markNativeSnapshot,
  nativeArrowEndpoints,
  nativeDrawPoints,
  nativeShapeBounds,
  nativeShapeVisualBounds,
  type NativeWhiteboardShape,
} from "./native-whiteboard-model.js";

function firstPointPath(dimensions: 2 | 3): string {
  const bytes = Buffer.alloc(dimensions === 2 ? 8 : 12);
  bytes.writeFloatLE(12.5, 0);
  bytes.writeFloatLE(-4, 4);
  if (dimensions === 3) bytes.writeFloatLE(0.5, 8);
  return bytes.toString("base64");
}

describe("native whiteboard model", () => {
  it("reads historical compact 2D and 3D draw paths", () => {
    expect(decodeLegacyDrawPath(firstPointPath(2), 2)).toEqual([
      { x: 12.5, y: -4, z: 0.5 },
    ]);
    expect(decodeLegacyDrawPath(firstPointPath(3), 3)).toEqual([
      { x: 12.5, y: -4, z: 0.5 },
    ]);
  });

  it("uses native point arrays without re-encoding them", () => {
    const shape: NativeWhiteboardShape = {
      id: "shape:draw",
      typeName: "shape",
      type: "draw",
      x: 100,
      y: 200,
      parentId: "page:page",
      index: "a1",
      props: { points: [{ x: 0, y: 0 }, { x: 80, y: 40 }], scale: 1 },
    };
    expect(nativeDrawPoints(shape)).toHaveLength(2);
    expect(nativeShapeBounds(shape)).toMatchObject({
      x: 100,
      y: 200,
      width: 80,
      height: 40,
    });
  });

  it("applies scale to arrow bounds", () => {
    const shape: NativeWhiteboardShape = {
      id: "shape:arrow",
      typeName: "shape",
      type: "arrow",
      x: 40,
      y: 60,
      parentId: "page:page",
      index: "a1",
      props: {
        start: { x: 10, y: 20 },
        end: { x: 110, y: 70 },
        scale: 2,
      },
    };
    expect(nativeShapeBounds(shape)).toMatchObject({
      x: 60,
      y: 100,
      width: 200,
      height: 100,
    });
  });

  it("returns rotated visual arrow endpoints", () => {
    const shape: NativeWhiteboardShape = {
      id: "shape:arrow-endpoints",
      typeName: "shape",
      type: "arrow",
      x: 100,
      y: 100,
      rotation: 90,
      parentId: "page:page",
      index: "a1",
      props: {
        start: { x: 0, y: 0 },
        end: { x: 100, y: 0 },
        scale: 1,
      },
    };

    expect(nativeArrowEndpoints(shape)).toEqual({
      start: { x: 150.5, y: 50.5 },
      end: { x: 150.5, y: 150.5 },
    });
  });

  it("applies independent horizontal and vertical stretch to shape bounds", () => {
    const shape: NativeWhiteboardShape = {
      id: "shape:stretched",
      typeName: "shape",
      type: "geo",
      x: 40,
      y: 60,
      parentId: "page:page",
      index: "a1",
      props: { w: 100, h: 80, scale: 1.5, scaleX: 2, scaleY: 0.5 },
    };
    expect(nativeShapeBounds(shape)).toMatchObject({
      x: 40,
      y: 60,
      width: 300,
      height: 60,
    });
  });

  it("scales both link card modes proportionally", () => {
    const link: NativeWhiteboardShape = {
      id: "shape:link",
      typeName: "shape",
      type: "link",
      x: 40,
      y: 60,
      parentId: "page:page",
      index: "a1",
      props: { mode: "link", w: 360, h: 82, scale: 2.5 },
    };
    const preview: NativeWhiteboardShape = {
      ...link,
      id: "shape:preview",
      props: { ...link.props, mode: "preview", h: 300 },
    };

    expect(nativeShapeBounds(link)).toMatchObject({ width: 900, height: 205 });
    expect(nativeShapeBounds(preview)).toMatchObject({ width: 900, height: 750 });
  });

  it("expands visual bounds around a rotated shape", () => {
    const shape: NativeWhiteboardShape = {
      id: "shape:rotated",
      typeName: "shape",
      type: "geo",
      x: 100,
      y: 100,
      rotation: 90,
      parentId: "page:page",
      index: "a1",
      props: { w: 120, h: 60, scale: 1 },
    };
    const bounds = nativeShapeVisualBounds(shape);
    expect(bounds).toMatchObject({
      x: 130,
      y: 70,
      center: { x: 160, y: 130 },
    });
    expect(bounds.width).toBeCloseTo(60);
    expect(bounds.height).toBeCloseTo(120);
  });

  it("marks migrated snapshots as native while preserving records", () => {
    const snapshot: WhiteboardSnapshot = {
      document: {
        store: { "page:page": { id: "page:page", typeName: "page" } },
        schema: {
          schemaVersion: 2,
          sequences: { legacy: { sequenceId: "com.previous.canvas.shape" } },
        },
      },
    };
    expect(markNativeSnapshot(snapshot)).toEqual({
      engine: "moki-native",
      document: {
        store: snapshot.document.store,
        schema: { engine: "moki-native", schemaVersion: 1 },
      },
    });
  });
});
