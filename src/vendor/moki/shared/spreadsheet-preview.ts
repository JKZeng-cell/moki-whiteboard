export type SpreadsheetPreviewSheet = {
  name: string;
  rows: string[][];
  layout?: {
    columnCount: number;
    merges: Array<{ row: number; column: number; rowSpan: number; colSpan: number }>;
    columnWidths: Record<number, number>;
    rowHeights: Record<number, number>;
    hiddenRows: number[];
    hiddenColumns: number[];
    formulas?: Record<string, string>;
    defaultRowHeight?: number;
    defaultColumnWidth?: number;
    hidden?: boolean;
    truncated?: boolean;
  };
};

export function spreadsheetCellPosition(ref: string): { row: number; column: number } | undefined {
  const match = /^\$?([A-Z]{1,3})\$?([1-9]\d*)$/iu.exec(ref);
  if (!match) return undefined;
  let column = 0;
  for (const letter of match[1]!.toUpperCase()) column = column * 26 + letter.charCodeAt(0) - 64;
  const row = Number(match[2]) - 1;
  return row < 1_048_576 && column <= 16_384 ? { row, column: column - 1 } : undefined;
}
