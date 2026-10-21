import { expect, it } from "vitest";
import {
  clampWhiteboardZoom,
  formatWhiteboardZoom,
  whiteboardWheelZoom,
  zoomWhiteboardAt,
  WHITEBOARD_MAX_ZOOM,
  WHITEBOARD_MIN_ZOOM,
} from "./whiteboard-zoom.js";

it("keeps the same world point under the cursor through continuous zoom and its inverse", () => {
  const camera = { x: -500, y: 200, zoom: 0.07 };
  const pointer = { x: 317.5, y: 211.25 };
  for (const target of [0.0001, 0.00231, 0.4321, 9.876, 10000]) {
    const next = zoomWhiteboardAt(camera, target, pointer);
    expect(next.x + pointer.x / next.zoom).toBeCloseTo(camera.x + pointer.x / camera.zoom, 5);
    expect(next.y + pointer.y / next.zoom).toBeCloseTo(camera.y + pointer.y / camera.zoom, 5);
    const restored = zoomWhiteboardAt(next, camera.zoom, pointer);
    expect(restored.x).toBeCloseTo(camera.x, 5);
    expect(restored.y).toBeCloseTo(camera.y, 5);
  }
});

it("preserves fractional trackpad input and normalizes wheel units without old limits", () => {
  expect(whiteboardWheelZoom(1, -0.25, 0, 600)).toBeCloseTo(Math.exp(0.0005), 8);
  expect(whiteboardWheelZoom(1, -1, 1, 600)).toBeCloseTo(Math.exp(0.032), 8);
  expect(whiteboardWheelZoom(1, -1, 2, 600)).toBeCloseTo(Math.exp(1.2), 8);
  expect(whiteboardWheelZoom(5, 10, 0, 600)).toBeGreaterThan(4);
  expect(whiteboardWheelZoom(0.05, -10, 0, 600)).toBeLessThan(0.1);
});

it("retains readable fractional percentages and finite transforms at numerical guardrails", () => {
  expect(formatWhiteboardZoom(0.0001)).toBe("0.01");
  expect(formatWhiteboardZoom(0.00321)).toBe("0.32");
  expect(formatWhiteboardZoom(1)).toBe("100");
  expect(formatWhiteboardZoom(10000)).toBe("1,000,000");
  expect(clampWhiteboardZoom(Infinity)).toBe(WHITEBOARD_MAX_ZOOM);
  expect(clampWhiteboardZoom(0)).toBe(WHITEBOARD_MIN_ZOOM);
  for (const delta of [-1e30, 1e30]) {
    let camera = { x: 0, y: 0, zoom: 1 };
    for (let index = 0; index < 20; index += 1) {
      camera = zoomWhiteboardAt(camera, whiteboardWheelZoom(camera.zoom, delta, 0, 600), { x: 400, y: 300 });
    }
    expect(Object.values(camera).every(Number.isFinite)).toBe(true);
    expect(camera.zoom).toBe(delta < 0 ? WHITEBOARD_MAX_ZOOM : WHITEBOARD_MIN_ZOOM);
  }
});
