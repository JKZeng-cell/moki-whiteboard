/** Images drawn without CORS permission permanently taint their destination canvas. */
export class CanvasImageUnavailableError extends Error {
  constructor() {
    super("部分图片暂时无法生成截图。请等待图片加载完成；若图片来源限制跨域访问，请下载后作为本地图片重新置入。");
    this.name = "CanvasImageUnavailableError";
  }
}

const checked = new WeakMap<HTMLImageElement, boolean>();

export function isCanvasImageReadable(image: HTMLImageElement): boolean {
  const previous = checked.get(image);
  if (previous !== undefined) return previous;
  const probe = document.createElement("canvas");
  probe.width = probe.height = 1;
  const context = probe.getContext("2d");
  if (!context) return false;
  try {
    context.drawImage(image, 0, 0, 1, 1);
    context.getImageData(0, 0, 1, 1);
    checked.set(image, true);
    return true;
  } catch {
    checked.set(image, false);
    return false;
  }
}

export function loadCanvasImage(source: string): Promise<HTMLImageElement | undefined> {
  return new Promise((resolve) => {
    const image = new Image();
    // This must precede src, including same-origin URLs that may redirect elsewhere.
    image.crossOrigin = "anonymous";
    image.decoding = "async";
    let settled = false;
    const finish = (loaded = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      image.onload = image.onerror = null;
      resolve(loaded && image.naturalWidth > 0 && isCanvasImageReadable(image) ? image : undefined);
    };
    const timer = setTimeout(() => finish(), 7_000);
    image.onload = () => finish(true);
    image.onerror = () => finish();
    image.src = source;
    if (image.complete) queueMicrotask(() => finish(image.naturalWidth > 0));
  });
}
