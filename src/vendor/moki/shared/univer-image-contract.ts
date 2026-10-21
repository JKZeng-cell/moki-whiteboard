export const UNIVER_LIBRARY_IMAGE_EXTENSIONS = [
  "png",
  "jpg",
  "jpeg",
  "jpe",
  "jfif",
  "gif",
  "webp",
  "svg",
  "bmp",
  "avif",
  "tif",
  "tiff",
] as const;

export const UNIVER_LIBRARY_IMAGE_FORMATS_LABEL = "PNG、JPEG/JFIF、GIF、WebP、SVG、BMP、AVIF 和 TIFF";

const UNIVER_LIBRARY_IMAGE_EXTENSION_SET = new Set<string>(UNIVER_LIBRARY_IMAGE_EXTENSIONS);

export function isUniverLibraryImageName(value: string): boolean {
  const extension = value.trim().toLowerCase().match(/\.([a-z0-9]+)$/u)?.[1];
  return Boolean(extension && UNIVER_LIBRARY_IMAGE_EXTENSION_SET.has(extension));
}
