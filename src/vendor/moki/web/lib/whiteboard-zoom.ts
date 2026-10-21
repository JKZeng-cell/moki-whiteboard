// Continuous scale, with numerical guardrails far beyond the previous 10–400%.
// These keep canvas transforms and hit-testing finite at extreme magnification.
export const WHITEBOARD_MIN_ZOOM = 0.0001;
export const WHITEBOARD_MAX_ZOOM = 10000;

export function clampWhiteboardZoom(zoom: number): number {
  if (Number.isNaN(zoom)) return 1;
  return Math.min(WHITEBOARD_MAX_ZOOM, Math.max(WHITEBOARD_MIN_ZOOM, zoom));
}

export function zoomWhiteboardAt(
  camera: { x: number; y: number; zoom: number },
  zoom: number,
  point: { x: number; y: number },
) {
  const next = clampWhiteboardZoom(zoom);
  return {
    x: camera.x + point.x / camera.zoom - point.x / next,
    y: camera.y + point.y / camera.zoom - point.y / next,
    zoom: next,
  };
}

export function whiteboardWheelZoom(zoom: number, deltaY: number, deltaMode: number, height: number): number {
  if (!Number.isFinite(deltaY)) return zoom;
  const pixels = deltaY * (deltaMode === 1 ? 16 : deltaMode === 2 ? height : 1);
  return clampWhiteboardZoom(zoom * Math.exp(Math.max(-2, Math.min(2, -pixels * 0.002))));
}

export function formatWhiteboardZoom(zoom: number): string {
  return (zoom * 100).toLocaleString("zh-CN", { maximumFractionDigits: 2 });
}
