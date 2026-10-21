import { apiFetch } from "./api-fetch.js";

export type VisualSelectionRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export function expandedVisualSelectionRect(
  rect: VisualSelectionRect,
  surface: { width: number; height: number },
): VisualSelectionRect {
  const horizontalPadding = Math.min(
    Math.max(48, rect.width * 0.35),
    Math.max(48, surface.width * 0.15),
  );
  const verticalPadding = Math.min(
    Math.max(48, rect.height * 0.35),
    Math.max(48, surface.height * 0.15),
  );
  const x = Math.max(0, rect.x - horizontalPadding);
  const y = Math.max(0, rect.y - verticalPadding);
  const right = Math.min(surface.width, rect.x + rect.width + horizontalPadding);
  const bottom = Math.min(surface.height, rect.y + rect.height + verticalPadding);
  const tidy = (value: number) => Math.round(value * 100) / 100;
  return {
    x: tidy(x),
    y: tidy(y),
    width: tidy(Math.max(1, right - x)),
    height: tidy(Math.max(1, bottom - y)),
  };
}

export type StoredVisualSelection = {
  id: string;
  name: string;
  imageSource: string;
  mediaType: string;
  size: number;
  width?: number;
  height?: number;
};

function imageElement(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("选区画面读取失败"));
    image.src = source;
  });
}

export async function cropVisualSelection(
  source: string,
  rect: VisualSelectionRect,
  surface: { width: number; height: number },
  options: { highlightRect?: VisualSelectionRect } = {},
): Promise<{ blob: Blob; width: number; height: number }> {
  const image = await imageElement(source);
  if (surface.width <= 0 || surface.height <= 0) throw new Error("选区尺寸无效");
  const scaleX = image.naturalWidth / surface.width;
  const scaleY = image.naturalHeight / surface.height;
  const sourceX = Math.max(0, Math.round(rect.x * scaleX));
  const sourceY = Math.max(0, Math.round(rect.y * scaleY));
  const sourceWidth = Math.max(1, Math.min(image.naturalWidth - sourceX, Math.round(rect.width * scaleX)));
  const sourceHeight = Math.max(1, Math.min(image.naturalHeight - sourceY, Math.round(rect.height * scaleY)));
  const outputScale = Math.min(1, 1_600 / sourceWidth, 1_600 / sourceHeight, Math.sqrt(3_000_000 / (sourceWidth * sourceHeight)));
  const width = Math.max(1, Math.round(sourceWidth * outputScale));
  const height = Math.max(1, Math.round(sourceHeight * outputScale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前设备无法生成选区图片");
  context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, width, height);
  if (options.highlightRect) {
    const highlight = options.highlightRect;
    const left = (highlight.x - rect.x) * scaleX * outputScale;
    const top = (highlight.y - rect.y) * scaleY * outputScale;
    const highlightWidth = highlight.width * scaleX * outputScale;
    const highlightHeight = highlight.height * scaleY * outputScale;
    context.save();
    context.fillStyle = "rgba(98, 91, 197, 0.10)";
    context.strokeStyle = "#625bc5";
    context.lineWidth = Math.max(2, Math.min(5, width / 320));
    context.fillRect(left, top, highlightWidth, highlightHeight);
    context.strokeRect(left, top, highlightWidth, highlightHeight);
    context.restore();
  }
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
    (value) => value ? resolve(value) : reject(new Error("选区图片生成失败")),
    "image/jpeg",
    0.82,
  ));
  return { blob, width, height };
}

export async function storeVisualSelectionImage(
  blob: Blob,
  input: { name: string; width?: number; height?: number },
): Promise<StoredVisualSelection> {
  if (!blob.size || !blob.type.startsWith("image/")) throw new Error("选区图片内容无效");
  const response = await apiFetch("/api/whiteboard/assets", {
    method: "POST",
    headers: {
      "content-type": "application/x-moki-whiteboard-asset",
      "x-moki-retryable-write": "true",
      "x-moki-asset-mime": blob.type,
      "x-moki-asset-name": encodeURIComponent(input.name.slice(0, 200)),
      ...(input.width ? { "x-moki-asset-width": String(Math.round(input.width)) } : {}),
      ...(input.height ? { "x-moki-asset-height": String(Math.round(input.height)) } : {}),
    },
    body: blob,
  });
  const result = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok || typeof result.src !== "string") {
    throw new Error(typeof result.error === "string" ? result.error : "选区图片保存失败");
  }
  return {
    id: result.src.split("/").at(-1) || `selection-${Date.now()}`,
    name: input.name.slice(0, 200),
    imageSource: result.src,
    mediaType: typeof result.mimeType === "string" ? result.mimeType : blob.type,
    size: typeof result.fileSize === "number" ? result.fileSize : blob.size,
    ...(typeof result.width === "number" ? { width: result.width } : input.width ? { width: input.width } : {}),
    ...(typeof result.height === "number" ? { height: result.height } : input.height ? { height: input.height } : {}),
  };
}
