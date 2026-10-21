import type { WhiteboardSnapshot } from "../domain/whiteboard.js";

export type NativePoint = { x: number; y: number; z?: number };
export type NativeBezierAnchor = { x: number; y: number; in: NativePoint; out: NativePoint };
export type NativeBounds = {
  x: number;
  y: number;
  w: number;
  h: number;
  width: number;
  height: number;
  center: NativePoint;
};

export type NativeWhiteboardRecord = {
  id: string;
  typeName: string;
  [key: string]: unknown;
};

export type NativeWhiteboardShape = NativeWhiteboardRecord & {
  typeName: "shape";
  type: string;
  x: number;
  y: number;
  parentId: string;
  index: string;
  rotation?: number;
  opacity?: number;
  props: Record<string, unknown>;
};

const DEFAULT_PAGE_ID = "page:moki";
const legacyPointCache = new WeakMap<object, NativePoint[]>();
const drawExtentCache = new WeakMap<object, { minX: number; minY: number; maxX: number; maxY: number }>();

export function createNativeId(prefix: "shape" | "asset" | "page"): string {
  const random = globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}:${random}`;
}

export function nativeRichText(text: string): Record<string, unknown> {
  return {
    type: "doc",
    content: text.split(/\r?\n/u).map((line) => ({
      type: "paragraph",
      content: line ? [{ type: "text", text: line }] : [],
    })),
  };
}

export function nativeRichTextValue(value: unknown): string {
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

export function isNativeRecord(value: unknown): value is NativeWhiteboardRecord {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as NativeWhiteboardRecord).id === "string" &&
      typeof (value as NativeWhiteboardRecord).typeName === "string",
  );
}

export function isNativeShape(value: unknown): value is NativeWhiteboardShape {
  if (!isNativeRecord(value) || value.typeName !== "shape") return false;
  const shape = value as Partial<NativeWhiteboardShape>;
  return Boolean(
    typeof shape.type === "string" &&
      typeof shape.x === "number" &&
      typeof shape.y === "number" &&
      typeof shape.parentId === "string" &&
      typeof shape.index === "string" &&
      shape.props &&
      typeof shape.props === "object",
  );
}

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function halfFloat(bits: number): number {
  const sign = bits & 0x8000 ? -1 : 1;
  const exponent = (bits >>> 10) & 0x1f;
  const fraction = bits & 0x03ff;
  if (exponent === 0) return sign * fraction * 2 ** -24;
  if (exponent === 0x1f) return fraction ? Number.NaN : sign * Number.POSITIVE_INFINITY;
  return sign * (1 + fraction / 1024) * 2 ** (exponent - 15);
}

function decodeBase64(value: string): Uint8Array {
  const binary = globalThis.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/** Reads historical compact paths without importing the previous canvas SDK. */
export function decodeLegacyDrawPath(path: string, dimensions: 2 | 3 = 3): NativePoint[] {
  if (!path) return [];
  try {
    const bytes = decodeBase64(path);
    const firstBytes = dimensions === 2 ? 8 : 12;
    const deltaBytes = dimensions === 2 ? 4 : 6;
    if (bytes.byteLength < firstBytes || (bytes.byteLength - firstBytes) % deltaBytes !== 0) {
      return [];
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let x = view.getFloat32(0, true);
    let y = view.getFloat32(4, true);
    let z = dimensions === 3 ? view.getFloat32(8, true) : 0.5;
    const points: NativePoint[] = [{ x, y, z }];
    for (let offset = firstBytes; offset < bytes.byteLength; offset += deltaBytes) {
      x += halfFloat(view.getUint16(offset, true));
      y += halfFloat(view.getUint16(offset + 2, true));
      if (dimensions === 3) z += halfFloat(view.getUint16(offset + 4, true));
      points.push({ x, y, z });
    }
    return points;
  } catch {
    return [];
  }
}

export function nativeDrawPoints(shape: NativeWhiteboardShape): NativePoint[] {
  if (Array.isArray(shape.props.points)) {
    return shape.props.points.filter((point): point is NativePoint =>
      Boolean(
        point &&
          typeof point === "object" &&
          Number.isFinite((point as NativePoint).x) &&
          Number.isFinite((point as NativePoint).y),
      ),
    );
  }
  if (!Array.isArray(shape.props.segments)) return [];
  const cached = legacyPointCache.get(shape);
  if (cached) return cached;
  const points = shape.props.segments.flatMap((segment) => {
    if (!segment || typeof segment !== "object") return [];
    const record = segment as Record<string, unknown>;
    if (Array.isArray(record.points)) {
      return record.points.filter((point): point is NativePoint =>
        Boolean(
          point &&
            typeof point === "object" &&
            Number.isFinite((point as NativePoint).x) &&
            Number.isFinite((point as NativePoint).y),
        ),
      );
    }
    if (typeof record.path !== "string") return [];
    return decodeLegacyDrawPath(record.path, record.dim === 2 ? 2 : 3);
  });
  legacyPointCache.set(shape, points);
  return points;
}

export function nativeBezierAnchors(shape: NativeWhiteboardShape): NativeBezierAnchor[] {
  if (!Array.isArray(shape.props.anchors)) return [];
  const validPoint = (value: unknown): value is NativePoint => Boolean(
    value && typeof value === "object" &&
    Number.isFinite((value as NativePoint).x) && Number.isFinite((value as NativePoint).y),
  );
  return shape.props.anchors.filter((anchor): anchor is NativeBezierAnchor => Boolean(
    validPoint(anchor) &&
    validPoint((anchor as NativeBezierAnchor).in) &&
    validPoint((anchor as NativeBezierAnchor).out),
  ));
}

function cubicRange(start: number, out: number, incoming: number, end: number): [number, number] {
  const a = -start + 3 * out - 3 * incoming + end;
  const b = 3 * start - 6 * out + 3 * incoming;
  const c = -3 * start + 3 * out;
  const evaluate = (t: number) => ((a * t + b) * t + c) * t + start;
  const candidates = [start, end];
  const derivativeA = 3 * a;
  const derivativeB = 2 * b;
  if (Math.abs(derivativeA) < 1e-10) {
    if (Math.abs(derivativeB) > 1e-10) {
      const t = -c / derivativeB;
      if (t > 0 && t < 1) candidates.push(evaluate(t));
    }
  } else {
    const discriminant = derivativeB ** 2 - 4 * derivativeA * c;
    if (discriminant >= 0) {
      const root = Math.sqrt(discriminant);
      for (const t of [(-derivativeB - root) / (2 * derivativeA), (-derivativeB + root) / (2 * derivativeA)]) {
        if (t > 0 && t < 1) candidates.push(evaluate(t));
      }
    }
  }
  return [Math.min(...candidates), Math.max(...candidates)];
}

export function nativeShapeBounds(shape: NativeWhiteboardShape): NativeBounds {
  const scale = Math.max(0.01, Math.abs(finite(shape.props.scale, 1)));
  const scaleX = Math.max(0.01, Math.abs(finite(shape.props.scaleX, 1)));
  const scaleY = Math.max(0.01, Math.abs(finite(shape.props.scaleY, 1)));
  let width = Math.abs(finite(shape.props.w, 160)) * scale * scaleX;
  let height = Math.abs(finite(shape.props.h, 100)) * scale * scaleY;
  if (shape.type === "note") {
    width = 200 * scale * scaleX;
    height = 200 * scale * scaleY;
  } else if (shape.type === "text") {
    const text = nativeRichTextValue(shape.props.richText);
    const fontSize = ({ s: 14, m: 18, l: 24, xl: 32 } as Record<string, number>)[String(shape.props.size)] ?? 18;
    width = Math.abs(finite(shape.props.w, 240)) * scale * scaleX;
    height = Math.abs(finite(
      shape.props.h,
      Math.max(40, text.split(/\r?\n/u).length * fontSize * 1.35 + 32),
    )) * scale * scaleY;
  } else if (shape.type === "bezier") {
    const anchors = nativeBezierAnchors(shape);
    if (anchors.length) {
      let minX = anchors[0]!.x;
      let minY = anchors[0]!.y;
      let maxX = minX;
      let maxY = minY;
      const count = shape.props.isClosed === true && anchors.length > 2
        ? anchors.length
        : anchors.length - 1;
      for (let index = 0; index < count; index += 1) {
        const from = anchors[index]!;
        const to = anchors[(index + 1) % anchors.length]!;
        const [lowX, highX] = cubicRange(from.x, from.out.x, to.in.x, to.x);
        const [lowY, highY] = cubicRange(from.y, from.out.y, to.in.y, to.y);
        minX = Math.min(minX, lowX);
        minY = Math.min(minY, lowY);
        maxX = Math.max(maxX, highX);
        maxY = Math.max(maxY, highY);
      }
      const x = shape.x + minX * scale * scaleX;
      const y = shape.y + minY * scale * scaleY;
      width = Math.max(1, (maxX - minX) * scale * scaleX);
      height = Math.max(1, (maxY - minY) * scale * scaleY);
      return { x, y, w: width, h: height, width, height, center: { x: x + width / 2, y: y + height / 2 } };
    }
  } else if (shape.type === "draw") {
    const points = nativeDrawPoints(shape);
    if (points.length) {
      let extent = drawExtentCache.get(shape);
      if (!extent) {
        extent = {
          minX: Math.min(...points.map((point) => point.x)),
          minY: Math.min(...points.map((point) => point.y)),
          maxX: Math.max(...points.map((point) => point.x)),
          maxY: Math.max(...points.map((point) => point.y)),
        };
        drawExtentCache.set(shape, extent);
      }
      const { minX, minY, maxX, maxY } = extent;
      const x = shape.x + minX * scale * scaleX;
      const y = shape.y + minY * scale * scaleY;
      width = Math.max(1, (maxX - minX) * scale * scaleX);
      height = Math.max(1, (maxY - minY) * scale * scaleY);
      return { x, y, w: width, h: height, width, height, center: { x: x + width / 2, y: y + height / 2 } };
    }
  } else if (shape.type === "arrow") {
    const start = shape.props.start as NativePoint | undefined;
    const end = shape.props.end as NativePoint | undefined;
    if (start && end) {
      const x = shape.x + Math.min(start.x, end.x) * scale * scaleX;
      const y = shape.y + Math.min(start.y, end.y) * scale * scaleY;
      width = Math.max(1, Math.abs(end.x - start.x) * scale * scaleX);
      height = Math.max(1, Math.abs(end.y - start.y) * scale * scaleY);
      return { x, y, w: width, h: height, width, height, center: { x: x + width / 2, y: y + height / 2 } };
    }
  }
  const x = shape.x;
  const y = shape.y;
  return { x, y, w: width, h: height, width, height, center: { x: x + width / 2, y: y + height / 2 } };
}

export function nativeShapeVisualBounds(shape: NativeWhiteboardShape): NativeBounds {
  const bounds = nativeShapeBounds(shape);
  const rotation = finite(shape.rotation, 0) * Math.PI / 180;
  if (Math.abs(rotation) < 0.000001) return bounds;
  const cosine = Math.abs(Math.cos(rotation));
  const sine = Math.abs(Math.sin(rotation));
  const width = Math.max(1, bounds.w * cosine + bounds.h * sine);
  const height = Math.max(1, bounds.w * sine + bounds.h * cosine);
  const x = bounds.center.x - width / 2;
  const y = bounds.center.y - height / 2;
  return {
    x,
    y,
    w: width,
    h: height,
    width,
    height,
    center: bounds.center,
  };
}

export function nativeArrowEndpoints(shape: NativeWhiteboardShape): {
  start: NativePoint;
  end: NativePoint;
} | undefined {
  if (shape.type !== "arrow") return undefined;
  const start = shape.props.start as Partial<NativePoint> | undefined;
  const end = shape.props.end as Partial<NativePoint> | undefined;
  if (!start || !end) return undefined;
  const scale = Math.max(0.01, Math.abs(finite(shape.props.scale, 1)));
  const scaleX = Math.max(0.01, Math.abs(finite(shape.props.scaleX, 1)));
  const scaleY = Math.max(0.01, Math.abs(finite(shape.props.scaleY, 1)));
  const visualStart = {
    x: shape.x + finite(start.x, 0) * scale * scaleX,
    y: shape.y + finite(start.y, 0) * scale * scaleY,
  };
  const visualEnd = {
    x: shape.x + finite(end.x, 0) * scale * scaleX,
    y: shape.y + finite(end.y, 0) * scale * scaleY,
  };
  const rotation = finite(shape.rotation, 0) * Math.PI / 180;
  if (Math.abs(rotation) < 0.000001) return { start: visualStart, end: visualEnd };
  const center = nativeShapeBounds(shape).center;
  const rotate = (point: NativePoint): NativePoint => {
    const x = point.x - center.x;
    const y = point.y - center.y;
    return {
      x: center.x + x * Math.cos(rotation) - y * Math.sin(rotation),
      y: center.y + x * Math.sin(rotation) + y * Math.cos(rotation),
    };
  };
  return { start: rotate(visualStart), end: rotate(visualEnd) };
}

export function nativePageId(snapshot: WhiteboardSnapshot): string {
  const current = snapshot.session && typeof snapshot.session === "object" &&
    "currentPageId" in snapshot.session && typeof snapshot.session.currentPageId === "string"
    ? snapshot.session.currentPageId
    : undefined;
  if (current && snapshot.document.store[current]?.typeName === "page") return current;
  return Object.values(snapshot.document.store).find((record) => record.typeName === "page")?.id ?? DEFAULT_PAGE_ID;
}

export function createNativeWhiteboardSnapshot(): WhiteboardSnapshot {
  return {
    engine: "moki-native",
    document: {
      schema: { engine: "moki-native", schemaVersion: 1 },
      store: {
        [DEFAULT_PAGE_ID]: {
          id: DEFAULT_PAGE_ID,
          typeName: "page",
          name: "页面 1",
          index: "a1",
          meta: {},
        },
      },
    },
    session: { currentPageId: DEFAULT_PAGE_ID, camera: { x: 0, y: 0, zoom: 1 } },
  };
}

export function markNativeSnapshot(snapshot: WhiteboardSnapshot): WhiteboardSnapshot {
  return {
    ...snapshot,
    engine: "moki-native",
    document: {
      ...snapshot.document,
      schema: { engine: "moki-native", schemaVersion: 1 },
    },
  };
}

export function nextNativeIndex(records: NativeWhiteboardRecord[], parentId: string): string {
  const nextSequence = records.reduce((largest, record) => {
    if (!isNativeShape(record) || record.parentId !== parentId) return largest;
    const match = /^a(\d+)$/u.exec(record.index);
    return match ? Math.max(largest, Number(match[1])) : largest;
  }, 0) + 1;
  return `a${String(nextSequence).padStart(8, "0")}`;
}
