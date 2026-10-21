import type { SpreadsheetPreviewSheet } from "../../shared/spreadsheet-preview.js";

function columnLabel(index: number): string {
  let label = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) label = String.fromCharCode(65 + (n - 1) % 26) + label;
  return label;
}

export function SpreadsheetPreview({ sheets, activeSheetIndex, onActiveSheetIndex }: {
  sheets: SpreadsheetPreviewSheet[];
  activeSheetIndex: number;
  onActiveSheetIndex: (index: number) => void;
}) {
  const sheet = sheets[activeSheetIndex]?.layout?.hidden
    ? sheets.find(candidate => !candidate.layout?.hidden)
    : sheets[activeSheetIndex] ?? sheets.find(candidate => !candidate.layout?.hidden);
  if (!sheet) return <div>没有可预览的工作表</div>;
  const layout = sheet.layout;
  const columnCount = Math.max(1, layout?.columnCount ?? 0, ...sheet.rows.map(row => row.length));
  const hiddenRows = new Set(layout?.hiddenRows);
  const hiddenColumns = new Set(layout?.hiddenColumns);
  const columns = Array.from({ length: columnCount }, (_, index) => index).filter(c => !hiddenColumns.has(c));
  // Index merges once. Hidden anchor rows/columns still render their value at
  // the first visible cell of the original merged range.
  const merges = new Map<string, { anchorRow: number; anchorColumn: number; rowSpan: number; colSpan: number } | null>();
  for (const merge of layout?.merges ?? []) {
    const rows = Array.from({ length: merge.rowSpan }, (_, i) => merge.row + i).filter(r => !hiddenRows.has(r));
    const cols = Array.from({ length: merge.colSpan }, (_, i) => merge.column + i).filter(c => !hiddenColumns.has(c));
    for (const row of rows) for (const col of cols) merges.set(`${row}:${col}`, null);
    if (rows.length && cols.length) merges.set(`${rows[0]}:${cols[0]}`, { anchorRow: merge.row, anchorColumn: merge.column, rowSpan: rows.length, colSpan: cols.length });
  }
  const width = (c: number) => layout?.columnWidths[c] ?? layout?.defaultColumnWidth ?? 96;
  return <div className="flex size-full flex-col bg-white">
    <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-[#e2e4ed] bg-[#f6f7fa] p-2">
      {sheets.map((candidate, index) => candidate.layout?.hidden ? null : <button type="button" key={index} onClick={() => onActiveSheetIndex(index)} className={`rounded-lg px-3 py-1.5 text-xs font-bold ${candidate === sheet ? "bg-[#625bc5] text-white" : "text-[#62687a] hover:bg-white"}`}>{candidate.name}</button>)}
    </div>
    {layout?.truncated ? <p role="status" className="px-3 py-1 text-xs text-[#7c8294]">当前预览最多显示前 5000 行、200 列，完整内容请使用系统打开。</p> : null}
    <div className="min-h-0 flex-1 overflow-auto">
      <table aria-label={`${sheet.name} 表格预览`} className="border-collapse text-xs" style={{ tableLayout: "fixed", width: 40 + columns.reduce((sum, c) => sum + width(c), 0) }}>
        <colgroup><col style={{ width: 40 }}/>{columns.map(c => <col key={c} style={{ width: width(c) }}/>)}</colgroup>
        <thead><tr><th className="border border-[#e2e4ed] bg-[#f5f6f9]"/>{columns.map(c => <th key={c} scope="col" className="border border-[#e2e4ed] bg-[#f5f6f9] py-1 text-[#8a90a2]">{columnLabel(c)}</th>)}</tr></thead>
        <tbody>{sheet.rows.map((row, rowIndex) => hiddenRows.has(rowIndex) ? null : <tr key={rowIndex} style={{ height: layout?.rowHeights[rowIndex] ?? layout?.defaultRowHeight ?? 28 }}>
          <th scope="row" className="sticky left-0 border border-[#e2e4ed] bg-[#f5f6f9] px-2 text-[#8a90a2]">{rowIndex + 1}</th>
          {columns.map(column => {
            const merge = merges.get(`${rowIndex}:${column}`);
            if (merge === null) return null;
            const value = merge ? sheet.rows[merge.anchorRow]?.[merge.anchorColumn] : row[column];
            const formulaRow = merge?.anchorRow ?? rowIndex;
            const formulaColumn = merge?.anchorColumn ?? column;
            const formula = layout?.formulas?.[`${formulaRow}:${formulaColumn}`];
            return <td key={column} data-cell={`${columnLabel(column)}${rowIndex + 1}`} data-formula={formula} title={formula ? `公式：${formula}` : undefined} rowSpan={merge?.rowSpan} colSpan={merge?.colSpan} className="overflow-hidden whitespace-pre-wrap break-words border border-[#e2e4ed] px-2 align-middle">{value ?? ""}</td>;
          })}
        </tr>)}</tbody>
      </table>
    </div>
  </div>;
}
