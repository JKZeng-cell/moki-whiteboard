import { posix } from "node:path";
import { strFromU8 } from "fflate";
import { spreadsheetCellPosition, type SpreadsheetPreviewSheet } from "../shared/spreadsheet-preview.js";

const MAX_ROWS = 5_000;
const MAX_COLUMNS = 200;
function decode(value: string): string {
  return value.replace(/&#x([\da-f]+);/giu, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#(\d+);/gu, (_, n: string) => String.fromCodePoint(Number(n)))
    .replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&apos;", "'").replaceAll("&amp;", "&");
}
function attributes(xml: string): Record<string, string> {
  return Object.fromEntries([...xml.matchAll(/([\w:]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/gu)].map(m => [m[1]!, decode(m[2] ?? m[3] ?? "")]));
}
function textRuns(xml: string): string {
  return [...xml.replace(/<rPh\b[^>]*>[\s\S]*?<\/rPh>/gu, "").matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gu)].map(m => decode(m[1]!)).join("");
}
const widthPixels = (width: number) => Math.max(1, Math.round(width * 7 + 5));

function cellDisplayValue(type: string | undefined, raw: string, body: string, shared: string[]): string {
  if (type === "s") return shared[Number(raw)] ?? decode(raw);
  if (type === "inlineStr") return textRuns(body);
  if (type === "b") return raw === "1" ? "TRUE" : raw === "0" ? "FALSE" : decode(raw);
  return decode(raw);
}

export function parseXlsxPreview(archive: Record<string, Uint8Array>): SpreadsheetPreviewSheet[] {
  const text = (path: string) => archive[path] ? strFromU8(archive[path]!) : "";
  const shared = [...text("xl/sharedStrings.xml").matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/gu)].map(m => textRuns(m[1]!));
  const relations = new Map([...text("xl/_rels/workbook.xml.rels").matchAll(/<Relationship\b([^>]*)\/?\s*>/gu)].map(m => {
    const a = attributes(m[1]!);
    return [a.Id, a.TargetMode === "External" ? "" : a.Target?.startsWith("/") ? a.Target.slice(1) : posix.normalize(`xl/${a.Target ?? ""}`)];
  }));
  return [...text("xl/workbook.xml").matchAll(/<sheet\b([^>]*)\/?\s*>/gu)].slice(0, 20).map((m, index) => {
    const a = attributes(m[1]!);
    const path = relations.get(a["r:id"]) ?? `xl/worksheets/sheet${index + 1}.xml`;
    const xml = text(path);
    if (!xml) throw new Error(`工作表 ${a.name ?? index + 1} 结构不完整`);
    const rows: string[][] = [];
    const layout: NonNullable<SpreadsheetPreviewSheet["layout"]> = { columnCount: 0, merges: [], columnWidths: {}, rowHeights: {}, hiddenRows: [], hiddenColumns: [] };
    const formulas: Record<string, string> = {};
    const includeExtent = (row: number, column: number) => {
      if (row >= MAX_ROWS || column >= MAX_COLUMNS) layout.truncated = true;
      while (rows.length <= Math.min(row, MAX_ROWS - 1)) rows.push([]);
      layout.columnCount = Math.max(layout.columnCount, Math.min(column + 1, MAX_COLUMNS));
    };
    let nextRow = 0;
    for (const rowMatch of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/gu)) {
      const ra = attributes(rowMatch[1]!);
      const rowIndex = ra.r ? Number(ra.r) - 1 : nextRow;
      if (!Number.isInteger(rowIndex) || rowIndex < 0) continue;
      nextRow = rowIndex + 1;
      includeExtent(rowIndex, -1);
      if (rowIndex >= MAX_ROWS) continue;
      if (ra.ht && Number(ra.ht) > 0) layout.rowHeights[rowIndex] = Number(ra.ht) * 4 / 3;
      if (ra.hidden === "1" || ra.hidden === "true") layout.hiddenRows.push(rowIndex);
      let nextColumn = 0;
      for (const cm of (rowMatch[2] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/gu)) {
        const ca = attributes(cm[1]!);
        const position = ca.r ? spreadsheetCellPosition(ca.r) : { row: rowIndex, column: nextColumn };
        if (!position) continue;
        const { row, column } = position;
        nextColumn = column + 1;
        includeExtent(row, column);
        if (row >= MAX_ROWS || column >= MAX_COLUMNS) continue;
        const cells = rows[row]!;
        while (cells.length <= column) cells.push("");
        const body = cm[2] ?? "";
        const formulaMatch = body.match(/<f\b[^>]*?(?:\/>|>([\s\S]*?)<\/f>)/u);
        const formula = formulaMatch?.[1] ? `=${decode(formulaMatch[1])}` : undefined;
        const valueMatch = body.match(/<v\b[^>]*?(?:\/>|>([\s\S]*?)<\/v>)/u);
        const raw = valueMatch?.[1] ?? "";
        if (formula) formulas[`${row}:${column}`] = formula;
        cells[column] = formulaMatch && !valueMatch
          ? formula ?? ""
          : cellDisplayValue(ca.t, raw, body, shared);
      }
    }
    const dimension = attributes(xml.match(/<dimension\b([^>]*)/u)?.[1] ?? "").ref;
    const end = dimension && spreadsheetCellPosition(dimension.split(":").at(-1)!);
    if (end) includeExtent(end.row, end.column);
    for (const mm of xml.matchAll(/<mergeCell\b([^>]*)/gu)) {
      const ref = attributes(mm[1]!).ref?.split(":");
      const start = ref && spreadsheetCellPosition(ref[0]!);
      const end = ref && spreadsheetCellPosition(ref[1] ?? ref[0]!);
      if (!start || !end || end.row < start.row || end.column < start.column) continue;
      includeExtent(end.row, end.column);
      if (start.row >= MAX_ROWS || start.column >= MAX_COLUMNS) continue;
      layout.merges.push({ ...start, rowSpan: Math.min(end.row + 1, MAX_ROWS) - start.row, colSpan: Math.min(end.column + 1, MAX_COLUMNS) - start.column });
    }
    for (const cm of xml.matchAll(/<col\b([^>]*)/gu)) {
      const ca = attributes(cm[1]!);
      for (let c = Math.max(0, Number(ca.min) - 1); c < Math.min(MAX_COLUMNS, Number(ca.max)); c++) {
        if (Number(ca.width) > 0) layout.columnWidths[c] = widthPixels(Number(ca.width));
        if (ca.hidden === "1" || ca.hidden === "true") layout.hiddenColumns.push(c);
      }
    }
    const defaults = attributes(xml.match(/<sheetFormatPr\b([^>]*)/u)?.[1] ?? "");
    if (Number(defaults.defaultRowHeight) > 0) layout.defaultRowHeight = Number(defaults.defaultRowHeight) * 4 / 3;
    if (Number(defaults.defaultColWidth) > 0) layout.defaultColumnWidth = widthPixels(Number(defaults.defaultColWidth));
    if (a.state === "hidden" || a.state === "veryHidden") layout.hidden = true;
    if (Object.keys(formulas).length) layout.formulas = formulas;
    const hasLayout = dimension || layout.merges.length || Object.keys(layout.columnWidths).length || Object.keys(layout.rowHeights).length || layout.hiddenRows.length || layout.hiddenColumns.length || layout.formulas || layout.defaultRowHeight || layout.defaultColumnWidth || layout.hidden || layout.truncated;
    return { name: a.name ?? `Sheet${index + 1}`, rows, ...(hasLayout ? { layout } : {}) };
  });
}
