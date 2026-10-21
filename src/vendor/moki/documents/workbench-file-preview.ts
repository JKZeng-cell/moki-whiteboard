import { parseXlsxPreview } from "./xlsx-preview.js";
import type { SpreadsheetPreviewSheet } from "../shared/spreadsheet-preview.js";
import { extname } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { extractText, getDocumentProxy } from "unpdf";

export type WorkbenchOfficePreview =
  | { kind: "document"; paragraphs: string[]; html: string }
  | {
      kind: "presentation";
      slides: Array<{ number: number; paragraphs: string[] }>;
    }
  | {
      kind: "spreadsheet";
      sheets: SpreadsheetPreviewSheet[];
    };

export type WorkbenchPdfPreview = {
  kind: "pdf";
  totalPages: number;
  pages: Array<{ number: number; text: string }>;
  text: string;
};

const TEXT_PREVIEW_EXTENSIONS = new Set([
  ".txt", ".md", ".markdown", ".log", ".json", ".csv", ".tsv",
  ".html", ".htm", ".xml", ".yaml", ".yml", ".js", ".jsx", ".ts",
  ".tsx", ".css", ".scss", ".less", ".py", ".java", ".c", ".cpp",
  ".h", ".hpp", ".cs", ".go", ".rs", ".sql", ".sh", ".ps1",
]);

const TEXT_PREVIEW_MEDIA_TYPES = new Set([
  "application/json",
  "application/ld+json",
  "application/xml",
  "application/yaml",
  "application/x-yaml",
  "application/javascript",
]);

function decodeXmlText(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/giu, (_match, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/gu, (_match, decimal: string) =>
      String.fromCodePoint(Number.parseInt(decimal, 10)),
    )
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'")
    .replace(/&amp;/gu, "&");
}

function xmlTextNodes(value: string, tag = "(?:w:t|a:t|t)"): string[] {
  return [...value.matchAll(
    new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:${tag})>`, "gu"),
  )].map((match) => decodeXmlText((match[1] ?? "").replace(/<[^>]+>/gu, "")));
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function wordRunHtml(run: string): string {
  const text = xmlTextNodes(run, "w:t").join("");
  if (!text && !/<w:br\b/u.test(run)) return "";
  let value = escapeHtml(text).replaceAll("\n", "<br>");
  if (/<w:br\b/u.test(run)) value += "<br>";
  const properties = run.match(/<w:rPr(?:\s[^>]*)?>([\s\S]*?)<\/w:rPr>/u)?.[1] ?? "";
  if (/<w:b(?:\s[^>]*)?\/?>(?![\s\S]*?<w:b\b[^>]*w:val="(?:0|false|off)")/u.test(properties)) value = `<strong>${value}</strong>`;
  if (/<w:i(?:\s[^>]*)?\/?>(?![\s\S]*?<w:i\b[^>]*w:val="(?:0|false|off)")/u.test(properties)) value = `<em>${value}</em>`;
  if (/<w:u\b(?![^>]*w:val="none")[^>]*\/?\s*>/u.test(properties)) value = `<u>${value}</u>`;
  const size = Number(properties.match(/<w:sz\b[^>]*w:val="(\d+)"/u)?.[1] ?? 0) / 2;
  const font = properties.match(/<w:rFonts\b[^>]*(?:w:eastAsia|w:ascii)="([^"]+)"/u)?.[1];
  const color = properties.match(/<w:color\b[^>]*w:val="([0-9A-Fa-f]{6})"/u)?.[1];
  const styles = [
    size > 0 ? `font-size:${size}pt` : "",
    font ? `font-family:${escapeHtml(font)}` : "",
    color ? `color:#${color}` : "",
  ].filter(Boolean).join(";");
  return styles ? `<span style="${styles}">${value}</span>` : value;
}

function wordParagraphHtml(paragraph: string): string {
  const content = [...paragraph.matchAll(/<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/gu)]
    .map((match) => wordRunHtml(match[0]))
    .join("") || escapeHtml(xmlTextNodes(paragraph, "w:t").join(""));
  const alignment = paragraph.match(/<w:jc\b[^>]*w:val="(left|center|right|both)"/u)?.[1];
  const bottomBorder = paragraph.match(/<w:pBdr\b[\s\S]*?<w:bottom\b([^>]*)\/?>(?:[\s\S]*?<\/w:pBdr>)?/u)?.[1];
  const color = bottomBorder?.match(/w:color="([0-9A-F]{6})"/iu)?.[1] ?? "CDD0D8";
  const borderWidth = Number(bottomBorder?.match(/w:sz="(\d+)"/u)?.[1] ?? 8) / 8;
  if (bottomBorder && !content) {
    return `<hr style="border:0;border-top:${Math.max(1, borderWidth)}pt solid #${color};margin:10px 0">`;
  }
  const styles = [
    alignment ? `text-align:${alignment === "both" ? "justify" : alignment}` : "",
    bottomBorder ? `border-bottom:${Math.max(1, borderWidth)}pt solid #${color}` : "",
  ].filter(Boolean).join(";");
  const style = styles ? ` style="${styles}"` : "";
  return `<p${style}>${content || "<br>"}</p>`;
}

function wordTableHtml(table: string): string {
  const rows = [...table.matchAll(/<w:tr(?:\s[^>]*)?>[\s\S]*?<\/w:tr>/gu)].map((rowMatch) => {
    const cells = [...rowMatch[0].matchAll(/<w:tc(?:\s[^>]*)?>[\s\S]*?<\/w:tc>/gu)].map((cellMatch) => {
      const paragraphs = [...cellMatch[0].matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/gu)]
        .map((paragraphMatch) => wordParagraphHtml(paragraphMatch[0]))
        .join("");
      return `<td>${paragraphs || "<p><br></p>"}</td>`;
    }).join("");
    return `<tr>${cells}</tr>`;
  }).join("");
  return `<table><tbody>${rows}</tbody></table>`;
}

function wordDocumentHtml(document: string): string {
  const body = document.match(/<w:body(?:\s[^>]*)?>([\s\S]*?)<\/w:body>/u)?.[1] ?? document;
  return [...body.matchAll(/<w:tbl(?:\s[^>]*)?>[\s\S]*?<\/w:tbl>|<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/gu)]
    .map((match) => match[0].startsWith("<w:tbl") ? wordTableHtml(match[0]) : wordParagraphHtml(match[0]))
    .join("");
}

function parseDelimitedRows(contents: Uint8Array, delimiter: "," | "\t"): string[][] {
  const source = Buffer.from(contents).toString("utf8").replace(/^\uFEFF/u, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!;
    if (character === '"') {
      if (quoted && source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === delimiter && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && source[index + 1] === "\n") index += 1;
      row.push(cell);
      rows.push(row.slice(0, 200));
      row = [];
      cell = "";
      if (rows.length >= 5_000) break;
    } else {
      cell += character;
    }
  }
  if (rows.length < 5_000 && (cell || row.length || source.length === 0)) {
    row.push(cell);
    rows.push(row.slice(0, 200));
  }
  return rows;
}

export function parseOfficePreview(
  contents: Uint8Array,
  extension: string,
): WorkbenchOfficePreview {
  if (extension === ".csv" || extension === ".tsv") {
    return {
      kind: "spreadsheet",
      sheets: [{
        name: "工作表1",
        rows: parseDelimitedRows(contents, extension === ".tsv" ? "\t" : ","),
      }],
    };
  }
  const archive = unzipSync(contents);
  const text = (path: string) => archive[path] ? strFromU8(archive[path]!) : "";
  if (extension === ".docx") {
    const document = text("word/document.xml");
    if (!document) throw new Error("Word 文档结构不完整");
    const paragraphXml = document.split(/<\/w:p>/u).filter((paragraph) => /<w:p\b/u.test(paragraph));
    const paragraphs = paragraphXml
      .map((paragraph) => xmlTextNodes(paragraph, "w:t").join(""))
      .filter((paragraph) => paragraph.trim());
    return {
      kind: "document",
      paragraphs,
      html: wordDocumentHtml(document),
    };
  }
  if (extension === ".pptx") {
    const slidePaths = Object.keys(archive)
      .filter((path) => /^ppt\/slides\/slide\d+\.xml$/u.test(path))
      .sort((left, right) =>
        Number(left.match(/slide(\d+)/u)?.[1] ?? 0) -
        Number(right.match(/slide(\d+)/u)?.[1] ?? 0),
      );
    return {
      kind: "presentation",
      slides: slidePaths.map((path, index) => ({
        number: index + 1,
        paragraphs: text(path)
          .split(/<\/a:p>/u)
          .map((paragraph) => xmlTextNodes(paragraph, "a:t").join(""))
          .filter(Boolean),
      })),
    };
  }
  if (extension === ".xlsx") {
    return { kind: "spreadsheet", sheets: parseXlsxPreview(archive) };
  }
  throw new Error("当前 Office 格式不支持结构化预览");
}

export async function parsePdfPreview(
  contents: Uint8Array,
): Promise<WorkbenchPdfPreview> {
  const document = await getDocumentProxy(new Uint8Array(contents));
  try {
    const result = await extractText(document, { mergePages: false });
    const pageTexts = Array.isArray(result.text) ? result.text : [result.text];
    const pages = pageTexts.map((text, index) => ({
      number: index + 1,
      text: text.replace(/\u0000/gu, "").trim(),
    }));
    return {
      kind: "pdf",
      totalPages: result.totalPages,
      pages,
      text: pages.map((page) => page.text).filter(Boolean).join("\n\n"),
    };
  } finally {
    const destroy = (document as unknown as { destroy?: () => void | Promise<void> }).destroy;
    await destroy?.call(document);
  }
}

function officePreviewText(preview: WorkbenchOfficePreview): string {
  if (preview.kind === "document") return preview.paragraphs.join("\n");
  if (preview.kind === "presentation") {
    return preview.slides
      .map((slide) => [`第 ${slide.number} 页`, ...slide.paragraphs].join("\n"))
      .join("\n\n");
  }
  return preview.sheets
    .map((sheet) => [
      `工作表：${sheet.name}`,
      ...sheet.rows.map((row) => row.join("\t")),
    ].join("\n"))
    .join("\n\n");
}

export function extractWorkbenchFilePreviewText(
  contents: Uint8Array,
  fileName: string,
  mediaType: string,
): string | undefined {
  const extension = extname(fileName).toLowerCase();
  let content: string | undefined;
  if ([".docx", ".xlsx", ".pptx"].includes(extension)) {
    try {
      content = officePreviewText(parseOfficePreview(contents, extension));
    } catch {
      return undefined;
    }
  } else if (
    mediaType.toLowerCase().startsWith("text/") ||
    TEXT_PREVIEW_MEDIA_TYPES.has(mediaType.toLowerCase()) ||
    TEXT_PREVIEW_EXTENSIONS.has(extension)
  ) {
    content = Buffer.from(contents).toString("utf8");
  }
  const normalized = content
    ?.replace(/^\uFEFF/u, "")
    .replace(/\u0000/gu, "")
    .trim();
  return normalized || undefined;
}
