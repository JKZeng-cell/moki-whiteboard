import { withFileEdit } from "./file-edit-guard.js";
import { assertOfficeExport } from './office-quality.js';
import { randomUUID } from "node:crypto";
import { rename, rm, stat, writeFile, readFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { parseFragment, type DefaultTreeAdapterMap } from "parse5";
import {
  ResourceLibraryOfficeContentUpdateSchema,
  type ResourceLibraryOfficeContentUpdate,
} from "../shared/resource-library-contract.js";
import { parseOfficePreview, type WorkbenchOfficePreview } from "./workbench-file-preview.js";

const OFFICE_EDIT_EXTENSIONS = new Set([".docx", ".xlsx", ".pptx"]);
type HtmlChildNode = DefaultTreeAdapterMap["childNode"];
type HtmlElement = DefaultTreeAdapterMap["element"];

export type UniverDocumentParagraphBorder = {
  paragraphIndex: number;
  color?: string;
  width?: number;
  padding?: number;
  dashStyle?: number;
};

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function columnName(index: number): string {
  let value = index + 1;
  let result = "";
  while (value > 0) {
    result = String.fromCharCode(65 + ((value - 1) % 26)) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

function replaceArchiveText(
  archive: Record<string, Uint8Array>,
  path: string,
  transform: (source: string) => string,
): void {
  const entry = archive[path];
  if (!entry) throw new Error(`Office 文件缺少 ${path}`);
  archive[path] = strToU8(transform(strFromU8(entry)));
}

function wordParagraphBorderXml(border: UniverDocumentParagraphBorder): string {
  const color = border.color?.replace(/^#/u, "").toUpperCase();
  const normalizedColor = color && /^[0-9A-F]{6}$/u.test(color) ? color : "CDD0D8";
  const width = Math.max(2, Math.min(96, Math.round((border.width ?? 1) * 8)));
  const space = Math.max(0, Math.min(31, Math.round(border.padding ?? 5)));
  const style = border.dashStyle === 2 ? "dotted" : border.dashStyle === 3 ? "dashed" : "single";
  return `<w:pBdr><w:bottom w:val="${style}" w:sz="${width}" w:space="${space}" w:color="${normalizedColor}"/></w:pBdr>`;
}

function addWordParagraphBorder(paragraph: string, border: UniverDocumentParagraphBorder): string {
  if (/<w:pBdr\b/u.test(paragraph)) return paragraph;
  const borderXml = wordParagraphBorderXml(border);
  const paragraphProperties = paragraph.match(/<w:pPr\b[^>]*>[\s\S]*?<\/w:pPr>/u)?.[0];
  if (paragraphProperties) {
    return paragraph.replace(paragraphProperties, paragraphProperties.replace("</w:pPr>", `${borderXml}</w:pPr>`));
  }
  const selfClosingProperties = paragraph.match(/<w:pPr\b([^>]*)\/>/u);
  if (selfClosingProperties) {
    return paragraph.replace(selfClosingProperties[0], `<w:pPr${selfClosingProperties[1]}>${borderXml}</w:pPr>`);
  }
  if (/\/>$/u.test(paragraph)) {
    return paragraph.replace(/\/>$/u, `><w:pPr>${borderXml}</w:pPr></w:p>`);
  }
  return paragraph.replace(/^(<w:p\b[^>]*>)/u, `$1<w:pPr>${borderXml}</w:pPr>`);
}

/**
 * dsh-univer-office 0.2.x currently exports paragraph text but drops the
 * paragraph bottom border used by its horizontal-divider command. Reapply
 * those borders to the exported DOCX so save/reopen remains lossless.
 */
export function preserveUniverDocumentParagraphBorders(
  contents: Uint8Array,
  borders: readonly UniverDocumentParagraphBorder[],
): Buffer<ArrayBuffer> {
  if (!borders.length) return Buffer.from(contents);
  const archive = Object.fromEntries(
    Object.entries(unzipSync(contents)).map(([path, value]) => [path.replace(/^\/+/, ""), value]),
  );
  const documentEntry = archive["word/document.xml"];
  if (!documentEntry) throw new Error("Word 文档结构不完整");
  const bordersByIndex = new Map(borders.map((border) => [border.paragraphIndex, border]));
  let paragraphIndex = 0;
  const documentXml = strFromU8(documentEntry).replace(
    /<w:p\b[^>]*\/>|<w:p\b[^>]*>[\s\S]*?<\/w:p>/gu,
    (paragraph) => {
      const border = bordersByIndex.get(paragraphIndex);
      paragraphIndex += 1;
      return border ? addWordParagraphBorder(paragraph, border) : paragraph;
    },
  );
  archive["word/document.xml"] = strToU8(documentXml);
  return Buffer.from(zipSync(archive, { level: 6 }));
}

export function readWordDocumentParagraphBorders(
  contents: Uint8Array,
): UniverDocumentParagraphBorder[] {
  const documentEntry = unzipSync(contents)["word/document.xml"];
  if (!documentEntry) throw new Error("Word 文档结构不完整");
  return [...strFromU8(documentEntry).matchAll(
    /<w:p\b[^>]*\/>|<w:p\b[^>]*>[\s\S]*?<\/w:p>/gu,
  )].flatMap((match, paragraphIndex) => {
    const bottom = match[0].match(/<w:pBdr\b[\s\S]*?<w:bottom\b([^>]*)\/?>(?:[\s\S]*?<\/w:pBdr>)?/u)?.[1];
    if (!bottom) return [];
    const color = bottom.match(/w:color="([0-9A-F]{6})"/iu)?.[1];
    const size = Number(bottom.match(/w:sz="(\d+)"/u)?.[1]);
    const space = Number(bottom.match(/w:space="(\d+)"/u)?.[1]);
    const value = bottom.match(/w:val="([^"]+)"/u)?.[1];
    return [{
      paragraphIndex,
      ...(color ? { color: `#${color.toUpperCase()}` } : {}),
      ...(Number.isFinite(size) ? { width: size / 8 } : {}),
      ...(Number.isFinite(space) ? { padding: space } : {}),
      ...(value === "dotted" ? { dashStyle: 2 } : value === "dashed" ? { dashStyle: 3 } : { dashStyle: 1 }),
    }];
  });
}

function htmlElement(node: HtmlChildNode): node is HtmlElement {
  return "tagName" in node;
}

function htmlAttribute(element: HtmlElement, name: string): string {
  return element.attrs.find((attribute) => attribute.name === name)?.value ?? "";
}

function htmlStyle(element: HtmlElement): Map<string, string> {
  return new Map(htmlAttribute(element, "style").split(";").map((entry) => {
    const separator = entry.indexOf(":");
    return separator < 0
      ? ["", ""] as const
      : [entry.slice(0, separator).trim().toLowerCase(), entry.slice(separator + 1).trim()] as const;
  }).filter(([name]) => Boolean(name)));
}

type RichRun = {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  font?: string;
  size?: number;
  color?: string;
};

function richRunProperties(format: RichRun): string {
  const properties = [
    format.bold ? "<w:b/>" : "",
    format.italic ? "<w:i/>" : "",
    format.underline ? '<w:u w:val="single"/>' : "",
    format.font ? `<w:rFonts w:ascii="${escapeXml(format.font)}" w:eastAsia="${escapeXml(format.font)}"/>` : "",
    format.size ? `<w:sz w:val="${Math.max(2, Math.round(format.size * 2))}"/><w:szCs w:val="${Math.max(2, Math.round(format.size * 2))}"/>` : "",
    format.color ? `<w:color w:val="${format.color.replace(/^#/u, "").toUpperCase()}"/>` : "",
  ].filter(Boolean).join("");
  return properties ? `<w:rPr>${properties}</w:rPr>` : "";
}

function richRuns(nodes: HtmlChildNode[], inherited: RichRun = {}): string {
  return nodes.map((node) => {
    if (node.nodeName === "#text") {
      const value = "value" in node ? node.value : "";
      return value ? `<w:r>${richRunProperties(inherited)}<w:t xml:space="preserve">${escapeXml(value)}</w:t></w:r>` : "";
    }
    if (!htmlElement(node)) return "";
    if (node.tagName === "br") return "<w:r><w:br/></w:r>";
    const styles = htmlStyle(node);
    const next: RichRun = {
      ...inherited,
      ...(["strong", "b"].includes(node.tagName) || ["bold", "600", "700", "800", "900"].includes(styles.get("font-weight") ?? "") ? { bold: true } : {}),
      ...(["em", "i"].includes(node.tagName) || styles.get("font-style") === "italic" ? { italic: true } : {}),
      ...(node.tagName === "u" || (styles.get("text-decoration") ?? "").includes("underline") ? { underline: true } : {}),
    };
    const font = styles.get("font-family")?.split(",")[0]?.replace(/["']/gu, "").trim();
    const legacyFont = node.tagName === "font" ? htmlAttribute(node, "face") : "";
    const size = Number.parseFloat(styles.get("font-size") ?? "");
    const legacySize = node.tagName === "font" ? Number(htmlAttribute(node, "size")) : 0;
    const color = styles.get("color")?.match(/#[0-9a-f]{6}/iu)?.[0]
      ?? (node.tagName === "font" ? htmlAttribute(node, "color").match(/#[0-9a-f]{6}/iu)?.[0] : undefined);
    if (font || legacyFont) next.font = font || legacyFont;
    if (Number.isFinite(size) && size > 0) next.size = size;
    else if (legacySize > 0) {
      const normalizedSize = [8, 10, 12, 14, 18, 24, 32][Math.min(7, legacySize) - 1];
      if (normalizedSize !== undefined) next.size = normalizedSize;
    }
    if (color) next.color = color;
    return richRuns(node.childNodes, next);
  }).join("");
}

function richParagraph(element: HtmlElement, prefix = ""): string {
  const styles = htmlStyle(element);
  const alignment = styles.get("text-align");
  const headingSize = /^h([1-6])$/u.test(element.tagName)
    ? 28 - (Number(element.tagName.slice(1)) - 1) * 2
    : undefined;
  const paragraphProperties = alignment && ["left", "center", "right", "justify"].includes(alignment)
    ? `<w:pPr><w:jc w:val="${alignment === "justify" ? "both" : alignment}"/></w:pPr>`
    : "";
  const prefixRun = prefix ? `<w:r><w:t xml:space="preserve">${escapeXml(prefix)}</w:t></w:r>` : "";
  return `<w:p>${paragraphProperties}${prefixRun}${richRuns(element.childNodes, {
    ...(/^h[1-6]$/u.test(element.tagName) ? { bold: true } : {}),
    ...(headingSize ? { size: headingSize } : {}),
  }) || "<w:r><w:t></w:t></w:r>"}</w:p>`;
}

function richTable(element: HtmlElement): string {
  const rows: HtmlElement[] = [];
  const visit = (nodes: HtmlChildNode[]) => {
    for (const node of nodes) {
      if (!htmlElement(node)) continue;
      if (node.tagName === "tr") rows.push(node);
      else visit(node.childNodes);
    }
  };
  visit(element.childNodes);
  const rowXml = rows.map((row) => {
    const cells = row.childNodes.filter((node): node is HtmlElement => htmlElement(node) && ["td", "th"].includes(node.tagName));
    return `<w:tr>${cells.map((cell) => {
      const blocks = cell.childNodes.filter((node): node is HtmlElement => htmlElement(node) && ["p", "div", "h1", "h2", "h3", "h4", "h5", "h6"].includes(node.tagName));
      const contents = blocks.length ? blocks.map((block) => richParagraph(block)).join("") : `<w:p>${richRuns(cell.childNodes)}</w:p>`;
      return `<w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/></w:tcPr>${contents}</w:tc>`;
    }).join("")}</w:tr>`;
  }).join("");
  return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders><w:top w:val="single" w:sz="4" w:color="B8BDC9"/><w:left w:val="single" w:sz="4" w:color="B8BDC9"/><w:bottom w:val="single" w:sz="4" w:color="B8BDC9"/><w:right w:val="single" w:sz="4" w:color="B8BDC9"/><w:insideH w:val="single" w:sz="4" w:color="D9DCE5"/><w:insideV w:val="single" w:sz="4" w:color="D9DCE5"/></w:tblBorders></w:tblPr>${rowXml}</w:tbl>`;
}

function richDocumentBody(html: string): string {
  const fragment = parseFragment(html);
  let orderedIndex = 0;
  const blocks: string[] = [];
  const append = (nodes: HtmlChildNode[], listKind?: "ul" | "ol") => {
    for (const node of nodes) {
      if (node.nodeName === "#text") {
        const value = "value" in node ? node.value.trim() : "";
        if (value) blocks.push(`<w:p><w:r><w:t xml:space="preserve">${escapeXml(value)}</w:t></w:r></w:p>`);
        continue;
      }
      if (!htmlElement(node)) continue;
      if (node.tagName === "table") {
        blocks.push(richTable(node));
      } else if (node.tagName === "ul" || node.tagName === "ol") {
        orderedIndex = 0;
        append(node.childNodes, node.tagName);
      } else if (node.tagName === "li") {
        orderedIndex += 1;
        blocks.push(richParagraph(node, listKind === "ol" ? `${orderedIndex}. ` : "• "));
      } else if (["p", "div", "h1", "h2", "h3", "h4", "h5", "h6"].includes(node.tagName)) {
        blocks.push(richParagraph(node));
      } else {
        append(node.childNodes, listKind);
      }
    }
  };
  append(fragment.childNodes);
  return blocks.join("") || "<w:p><w:r><w:t></w:t></w:r></w:p>";
}

function updateRichDocument(
  archive: Record<string, Uint8Array>,
  html: string,
): void {
  replaceArchiveText(archive, "word/document.xml", (document) => {
    const bodyMatch = document.match(/<w:body(?:\s[^>]*)?>([\s\S]*?)<\/w:body>/u);
    if (!bodyMatch) throw new Error("Word 文档正文结构不完整");
    const section = bodyMatch[1]!.match(/<w:sectPr(?:\s[^>]*)?>[\s\S]*?<\/w:sectPr>/u)?.[0] ?? "";
    return document.replace(bodyMatch[0], `<w:body>${richDocumentBody(html)}${section}</w:body>`);
  });
}

function updateDocument(
  archive: Record<string, Uint8Array>,
  input: Extract<ResourceLibraryOfficeContentUpdate, { kind: "document" }>,
): void {
  if (input.html !== undefined) {
    updateRichDocument(archive, input.html);
    return;
  }
  replaceArchiveText(archive, "word/document.xml", (document) => {
    let paragraphIndex = 0;
    const replaced = document.replace(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/gu, (paragraphXml) => {
      const textNodes = [...paragraphXml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/gu)];
      if (!textNodes.length || !textNodes.some((match) => (match[1] ?? "").trim())) return paragraphXml;
      const value = input.paragraphs[paragraphIndex++] ?? "";
      let wroteValue = false;
      return paragraphXml.replace(/<w:t(\s[^>]*)?>[\s\S]*?<\/w:t>/gu, (_match, attributes: string | undefined) => {
        if (wroteValue) return `<w:t${attributes ?? ""}></w:t>`;
        wroteValue = true;
        return `<w:t${attributes ?? ""}>${escapeXml(value)}</w:t>`;
      });
    });
    if (paragraphIndex >= input.paragraphs.length) return replaced;
    const extras = input.paragraphs.slice(paragraphIndex)
      .map((paragraph) => `<w:p><w:r><w:t xml:space="preserve">${escapeXml(paragraph)}</w:t></w:r></w:p>`)
      .join("");
    const insertionPoint = replaced.lastIndexOf("<w:sectPr");
    if (insertionPoint >= 0) return `${replaced.slice(0, insertionPoint)}${extras}${replaced.slice(insertionPoint)}`;
    const bodyEnd = replaced.lastIndexOf("</w:body>");
    if (bodyEnd < 0) throw new Error("Word 文档正文结构不完整");
    return `${replaced.slice(0, bodyEnd)}${extras}${replaced.slice(bodyEnd)}`;
  });
}

function workbookSheetPaths(archive: Record<string, Uint8Array>): string[] {
  const workbook = archive["xl/workbook.xml"] ? strFromU8(archive["xl/workbook.xml"]!) : "";
  const relationsXml = archive["xl/_rels/workbook.xml.rels"]
    ? strFromU8(archive["xl/_rels/workbook.xml.rels"]!)
    : "";
  const relations = new Map(
    [...relationsXml.matchAll(/<Relationship[^>]+Id="([^"]+)"[^>]+Target="([^"]+)"[^>]*\/>/gu)]
      .map((match) => [match[1]!, match[2]!.replace(/^\//u, "").replace(/^xl\//u, "")] as const),
  );
  return [...workbook.matchAll(/<sheet[^>]+r:id="([^"]+)"[^>]*\/>/gu)]
    .map((match, index) => {
      const target = relations.get(match[1]!);
      return target ? `xl/${target}` : `xl/worksheets/sheet${index + 1}.xml`;
    });
}

function removePartOverride(contentTypes: string, partName: string): string {
  return contentTypes.replace(
    new RegExp(`<Override\\b(?=[^>]*\\bPartName="${partName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}")[^>]*/>`, "gu"),
    "",
  );
}

function appendPartOverride(contentTypes: string, partName: string, contentType: string): string {
  if (contentTypes.includes(`PartName="${partName}"`)) return contentTypes;
  return contentTypes.replace("</Types>", `<Override PartName="${partName}" ContentType="${contentType}"/></Types>`);
}

function syncSpreadsheetStructure(
  archive: Record<string, Uint8Array>,
  desiredCount: number,
): string[] {
  const existingPaths = workbookSheetPaths(archive);
  if (existingPaths.length === desiredCount) return existingPaths;
  const workbookEntry = archive["xl/workbook.xml"];
  const relationsEntry = archive["xl/_rels/workbook.xml.rels"];
  const contentTypesEntry = archive["[Content_Types].xml"];
  if (!workbookEntry || !relationsEntry || !contentTypesEntry || !existingPaths.length) {
    throw new Error("当前 Excel 文件缺少增删工作表所需的结构");
  }
  const workbook = strFromU8(workbookEntry);
  const relations = strFromU8(relationsEntry);
  let contentTypes = strFromU8(contentTypesEntry);
  const relationshipByTarget = new Map(
    [...relations.matchAll(/<Relationship\b(?=[^>]*\bId="([^"]+)")(?=[^>]*\bType="[^"]*\/worksheet")(?=[^>]*\bTarget="([^"]+)")[^>]*\/>/gu)]
      .map((match) => [match[2]!.replace(/^\//u, "").replace(/^xl\//u, ""), match[1]!] as const),
  );
  const keptPaths = existingPaths.slice(0, desiredCount);
  const usedNumbers = new Set(existingPaths.map((path) => Number(path.match(/sheet(\d+)\.xml$/u)?.[1] ?? 0)));
  let nextNumber = Math.max(0, ...usedNumbers) + 1;
  while (keptPaths.length < desiredCount) {
    while (usedNumbers.has(nextNumber)) nextNumber += 1;
    const path = `xl/worksheets/sheet${nextNumber}.xml`;
    usedNumbers.add(nextNumber);
    keptPaths.push(path);
    archive[path] = strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData></sheetData></worksheet>');
    contentTypes = appendPartOverride(contentTypes, `/${path}`, "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml");
    nextNumber += 1;
  }
  for (const path of existingPaths.slice(desiredCount)) {
    delete archive[path];
    delete archive[path.replace("xl/worksheets/", "xl/worksheets/_rels/") + ".rels"];
    contentTypes = removePartOverride(contentTypes, `/${path}`);
  }
  const nonWorksheetRelations = relations.replace(/<Relationship\b(?=[^>]*\bType="[^"]*\/worksheet")[^>]*\/>/gu, "");
  const usedRelationshipIds = new Set([...nonWorksheetRelations.matchAll(/\bId="([^"]+)"/gu)].map((match) => match[1]!));
  const sheetRelations = keptPaths.map((path, index) => {
    let id = relationshipByTarget.get(path.replace(/^xl\//u, "")) ?? `rIdMokiSheet${index + 1}`;
    while (usedRelationshipIds.has(id)) id = `${id}x`;
    usedRelationshipIds.add(id);
    relationshipByTarget.set(path.replace(/^xl\//u, ""), id);
    return `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="${path.replace(/^xl\//u, "")}"/>`;
  }).join("");
  const nextRelations = nonWorksheetRelations.replace("</Relationships>", `${sheetRelations}</Relationships>`);
  const originalSheets = [...workbook.matchAll(/<sheet\b[^>]*\/>/gu)].map((match) => match[0]);
  const nextSheets = keptPaths.map((path, index) => {
    const original = originalSheets[index];
    const name = original?.match(/\bname="([^"]*)"/u)?.[1] ?? `Sheet${index + 1}`;
    const sheetId = original?.match(/\bsheetId="([^"]*)"/u)?.[1] ?? String(index + 1);
    return `<sheet name="${name}" sheetId="${sheetId}" r:id="${relationshipByTarget.get(path.replace(/^xl\//u, ""))}"/>`;
  }).join("");
  const nextWorkbook = workbook.replace(/<sheets(?:\s[^>]*)?>[\s\S]*?<\/sheets>/u, `<sheets>${nextSheets}</sheets>`);
  archive["xl/workbook.xml"] = strToU8(nextWorkbook);
  archive["xl/_rels/workbook.xml.rels"] = strToU8(nextRelations);
  archive["[Content_Types].xml"] = strToU8(contentTypes);
  return keptPaths;
}

function updateSpreadsheet(
  archive: Record<string, Uint8Array>,
  input: Extract<ResourceLibraryOfficeContentUpdate, { kind: "spreadsheet" }>,
): void {
  const paths = syncSpreadsheetStructure(archive, input.sheets.length);
  const sheetNames = input.sheets.map((sheet) => sheet.name.trim());
  if (sheetNames.some((name) => !name || name.length > 31 || /[\\/*?:\[\]]/u.test(name))) {
    throw new Error("工作表名称需为 1 至 31 个字符，且不能包含 \\ / * ? : [ ]");
  }
  if (new Set(sheetNames.map((name) => name.toLocaleLowerCase())).size !== sheetNames.length) {
    throw new Error("工作表名称不能重复");
  }
  replaceArchiveText(archive, "xl/workbook.xml", (workbook) => {
    let index = 0;
    return workbook.replace(/<sheet\b[^>]*\/>/gu, (sheetXml) => {
      const name = sheetNames[index++];
      return name === undefined
        ? sheetXml
        : sheetXml.replace(/\bname="[^"]*"/u, `name="${escapeXml(name)}"`);
    });
  });
  const previousPreview = parseOfficePreview(zipSync(archive, { level: 0 }), ".xlsx");
  input.sheets.forEach((sheet, index) => {
    replaceArchiveText(archive, paths[index]!, (worksheet) => {
      const existingSheetData = worksheet.match(/<sheetData(?:\s[^>]*)?>([\s\S]*?)<\/sheetData>/u)?.[1];
      if (existingSheetData === undefined) throw new Error(`工作表 ${sheet.name} 结构不完整`);
      const existingRows = new Map([...existingSheetData.matchAll(/<row\b[^>]*?(?:\/>|>[\s\S]*?<\/row>)/gu)].map((match, index) => [Number(match[0].match(/\br="(\d+)"/u)?.[1] ?? index + 1) - 1, match[0]]));
      const previousSheet = previousPreview.kind === "spreadsheet" ? previousPreview.sheets[index] : undefined;
      const previousRows = previousSheet?.rows ?? [];
      const rows = sheet.rows.map((values, rowIndex) => {
        const existingRow = existingRows.get(rowIndex);
        const existingCells = new Map(existingRow
          ? [...existingRow.matchAll(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/gu)].map((match, index) => [match[0].match(/\br="([^"]+)"/u)?.[1] ?? `${columnName(index)}${rowIndex + 1}`, match[0]])
          : []);
        const cells = values.map((value, columnIndex) => {
          const existingCell = existingCells.get(`${columnName(columnIndex)}${rowIndex + 1}`);
          const previousValue = previousRows[rowIndex]?.[columnIndex] ?? "";
          const previousFormula = previousSheet?.layout?.formulas?.[`${rowIndex}:${columnIndex}`];
          if (existingCell && (previousValue === String(value ?? "") || previousFormula === String(value ?? ""))) return existingCell;
          const ref = `${columnName(columnIndex)}${rowIndex + 1}`;
          const style = existingCell?.match(/\ss="([^"]+)"/u)?.[1];
          const styleAttribute = style ? ` s="${style}"` : "";
          if (value === null) return `<c r="${ref}"${styleAttribute}/>`;
          if (typeof value === "number") return `<c r="${ref}"${styleAttribute}><v>${value}</v></c>`;
          if (typeof value === "boolean") return `<c r="${ref}"${styleAttribute} t="b"><v>${value ? 1 : 0}</v></c>`;
          if (value.startsWith("=") && value.length > 1) {
            return `<c r="${ref}"${styleAttribute}><f>${escapeXml(value.slice(1))}</f><v>0</v></c>`;
          }
          return `<c r="${ref}"${styleAttribute} t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
        }).join("");
        const rowAttributes = existingRow?.match(/^<row(\s[^>]*)?>/u)?.[1] ?? ` r="${rowIndex + 1}"`;
        return `<row${rowAttributes}>${cells}</row>`;
      }).join("");
      const sheetData = `<sheetData>${rows}</sheetData>`;
      if (!/<sheetData(?:\s[^>]*)?>[\s\S]*?<\/sheetData>/u.test(worksheet)) {
        throw new Error(`工作表 ${sheet.name} 结构不完整`);
      }
      return worksheet.replace(/<sheetData(?:\s[^>]*)?>[\s\S]*?<\/sheetData>/u, sheetData);
    });
  });
}

function replaceSlideParagraphs(source: string, paragraphs: string[]): string {
  let index = 0;
  const replaced = source.replace(/<a:p(?:\s[^>]*)?>[\s\S]*?<\/a:p>/gu, (paragraphXml) => {
    if (!/<a:t(?:\s[^>]*)?>[\s\S]*?<\/a:t>/u.test(paragraphXml)) return paragraphXml;
    const value = paragraphs[index++] ?? "";
    let wroteValue = false;
    return paragraphXml.replace(/<a:t(\s[^>]*)?>[\s\S]*?<\/a:t>/gu, (_match, attributes: string | undefined) => {
      if (wroteValue) return `<a:t${attributes ?? ""}></a:t>`;
      wroteValue = true;
      return `<a:t${attributes ?? ""}>${escapeXml(value)}</a:t>`;
    });
  });
  if (index >= paragraphs.length) return replaced;
  const extras = paragraphs.slice(index)
    .map((value) => `<a:p><a:r><a:t>${escapeXml(value)}</a:t></a:r><a:endParaRPr/></a:p>`)
    .join("");
  const lastTextBody = replaced.lastIndexOf("</p:txBody>");
  return lastTextBody < 0
    ? replaced
    : `${replaced.slice(0, lastTextBody)}${extras}${replaced.slice(lastTextBody)}`;
}

function syncPresentationStructure(
  archive: Record<string, Uint8Array>,
  desiredCount: number,
): string[] {
  const existingPaths = Object.keys(archive)
    .filter((path) => /^ppt\/slides\/slide\d+\.xml$/u.test(path))
    .sort((left, right) => Number(left.match(/slide(\d+)/u)?.[1] ?? 0) - Number(right.match(/slide(\d+)/u)?.[1] ?? 0));
  if (existingPaths.length === desiredCount) return existingPaths;
  const presentationEntry = archive["ppt/presentation.xml"];
  const relationsEntry = archive["ppt/_rels/presentation.xml.rels"];
  const contentTypesEntry = archive["[Content_Types].xml"];
  if (!presentationEntry || !relationsEntry || !contentTypesEntry || !existingPaths.length) {
    throw new Error("当前 PowerPoint 文件缺少增删幻灯片所需的结构");
  }
  let contentTypes = strFromU8(contentTypesEntry);
  const templatePath = existingPaths[existingPaths.length - 1]!;
  const template = archive[templatePath]!;
  const templateRelationships = archive[templatePath.replace("ppt/slides/", "ppt/slides/_rels/") + ".rels"];
  const keptPaths = existingPaths.slice(0, desiredCount);
  let nextNumber = Math.max(...existingPaths.map((path) => Number(path.match(/slide(\d+)\.xml$/u)?.[1] ?? 0))) + 1;
  while (keptPaths.length < desiredCount) {
    const path = `ppt/slides/slide${nextNumber}.xml`;
    keptPaths.push(path);
    archive[path] = template.slice();
    if (templateRelationships) archive[path.replace("ppt/slides/", "ppt/slides/_rels/") + ".rels"] = templateRelationships.slice();
    contentTypes = appendPartOverride(contentTypes, `/${path}`, "application/vnd.openxmlformats-officedocument.presentationml.slide+xml");
    nextNumber += 1;
  }
  for (const path of existingPaths.slice(desiredCount)) {
    delete archive[path];
    delete archive[path.replace("ppt/slides/", "ppt/slides/_rels/") + ".rels"];
    contentTypes = removePartOverride(contentTypes, `/${path}`);
  }
  const relations = strFromU8(relationsEntry);
  const nonSlideRelations = relations.replace(/<Relationship\b(?=[^>]*\bType="[^"]*\/slide")[^>]*\/>/gu, "");
  const usedRelationshipIds = new Set([...nonSlideRelations.matchAll(/\bId="([^"]+)"/gu)].map((match) => match[1]!));
  const slideIds: string[] = [];
  const slideRelations = keptPaths.map((path, index) => {
    let id = `rIdMokiSlide${index + 1}`;
    while (usedRelationshipIds.has(id)) id = `${id}x`;
    usedRelationshipIds.add(id);
    slideIds.push(`<p:sldId id="${256 + index}" r:id="${id}"/>`);
    return `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="${path.replace(/^ppt\//u, "")}"/>`;
  }).join("");
  const nextRelations = nonSlideRelations.replace("</Relationships>", `${slideRelations}</Relationships>`);
  const presentation = strFromU8(presentationEntry);
  const nextPresentation = presentation.replace(/<p:sldIdLst(?:\s[^>]*)?>[\s\S]*?<\/p:sldIdLst>/u, `<p:sldIdLst>${slideIds.join("")}</p:sldIdLst>`);
  archive["ppt/presentation.xml"] = strToU8(nextPresentation);
  archive["ppt/_rels/presentation.xml.rels"] = strToU8(nextRelations);
  archive["[Content_Types].xml"] = strToU8(contentTypes);
  return keptPaths;
}

function updatePresentation(
  archive: Record<string, Uint8Array>,
  input: Extract<ResourceLibraryOfficeContentUpdate, { kind: "presentation" }>,
): void {
  const paths = syncPresentationStructure(archive, input.slides.length);
  input.slides.forEach((slide, index) => {
    replaceArchiveText(archive, paths[index]!, (source) => replaceSlideParagraphs(source, slide.paragraphs));
  });
}

export function applyOfficeContentUpdate(
  contents: Uint8Array,
  extension: string,
  rawInput: ResourceLibraryOfficeContentUpdate,
): Buffer {
  const input = ResourceLibraryOfficeContentUpdateSchema.parse(rawInput);
  const normalizedExtension = extension.toLowerCase();
  const expectedKind = normalizedExtension === ".docx"
    ? "document"
    : normalizedExtension === ".xlsx"
      ? "spreadsheet"
      : normalizedExtension === ".pptx"
        ? "presentation"
        : undefined;
  if (!expectedKind || !OFFICE_EDIT_EXTENSIONS.has(normalizedExtension)) {
    throw new Error("当前格式不支持 Office 编辑");
  }
  if (input.kind !== expectedKind) throw new Error("编辑内容与 Office 文件格式不匹配");
  const archive = Object.fromEntries(
    Object.entries(unzipSync(contents)).map(([path, value]) => [path.replace(/^\/+/, ""), value]),
  );
  if (input.kind === "document") updateDocument(archive, input);
  if (input.kind === "spreadsheet") updateSpreadsheet(archive, input);
  if (input.kind === "presentation") updatePresentation(archive, input);
  return Buffer.from(zipSync(archive, { level: 6 }));
}

export async function replaceFileAtomically(path: string, contents: Buffer): Promise<void> {
  const suffix = randomUUID();
  const temporary = join(dirname(path), `.${suffix}.moki-office.tmp`);
  const backup = join(dirname(path), `.${suffix}.moki-office.backup`);
  await writeFile(temporary, contents, { flag: "wx" });
  try {
    await rename(path, backup);
    try {
      await rename(temporary, path);
    } catch (error) {
      await rename(backup, path);
      throw error;
    }
    await rm(backup, { force: true });
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function saveOfficeContentUpdate(
  path: string,
  input: ResourceLibraryOfficeContentUpdate,
  expectedVersion?: string,
): Promise<{ preview: WorkbenchOfficePreview; size: number; updatedAt: string }> {
  const extension = extname(path).toLowerCase();
  return withFileEdit(path, expectedVersion, async (original, canonicalPath) => {
    const updated = applyOfficeContentUpdate(original, extension, input);
    assertOfficeExport(updated, extension);
    const preview = parseOfficePreview(updated, extension);
    await replaceFileAtomically(canonicalPath, updated);
    const metadata = await stat(canonicalPath);
    return { preview, size: metadata.size, updatedAt: metadata.mtime.toISOString() };
  });
}
