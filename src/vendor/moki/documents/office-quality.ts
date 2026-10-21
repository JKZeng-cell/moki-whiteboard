import { posix } from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { parseOfficePreview } from './workbench-file-preview.js';

export type OfficeQualityReport = {
  format: string; valid: boolean; errors: string[]; warnings: string[];
  counts: { parts: number; slides?: number; sheets?: number; paragraphs?: number };
  limitations: string[];
};
const mainParts: Record<string, string> = { '.docx': 'word/document.xml', '.xlsx': 'xl/workbook.xml', '.pptx': 'ppt/presentation.xml' };
const attribute = (xml: string, name: string) => new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'u').exec(xml)?.[1];
const decode = (value: string) => value.replace(/&amp;/gu, '&').replace(/&quot;/gu, '"').replace(/&apos;/gu, "'").replace(/&lt;/gu, '<').replace(/&gt;/gu, '>');

/** Structural export check plus actionable content signals; not a visual/factual verdict. */
export function inspectOfficeQuality(contents: Uint8Array, extension: string): OfficeQualityReport {
  const format = extension.toLowerCase(), main = mainParts[format];
  const report: OfficeQualityReport = { format, valid: false, errors: [], warnings: [], counts: { parts: 0 }, limitations: ['结构检查不能替代截图中的排版复核、事实核实或公式重新计算。'] };
  if (!main) { report.errors.push('此检查支持 DOCX、XLSX、PPTX'); return report; }
  try {
    const archive = unzipSync(contents);
    report.counts.parts = Object.keys(archive).length;
    for (const required of ['[Content_Types].xml', '_rels/.rels', main]) {
      if (!archive[required]?.length) report.errors.push(`缺少必要部件：${required}`);
    }
    for (const [path, bytes] of Object.entries(archive)) {
      if (!path.endsWith('.rels')) continue;
      const owner = path === '_rels/.rels' ? '' : path.replace(/(^|\/)_rels\//u, '$1').replace(/\.rels$/u, '');
      for (const match of strFromU8(bytes).matchAll(/<Relationship\b[^>]*>/gu)) {
        if (attribute(match[0], 'TargetMode')?.toLowerCase() === 'external') continue;
        const rawTarget = attribute(match[0], 'Target');
        if (!rawTarget) { report.errors.push(`空资源引用：${path}`); continue; }
        const decoded = decodeURIComponent(decode(rawTarget).split('#')[0]!);
        const target = !decoded ? owner : posix.normalize(decoded.startsWith('/') ? decoded.slice(1) : posix.join(posix.dirname(owner), decoded));
        if (!archive[target]) report.errors.push(`资源引用缺失：${path} → ${target}`);
      }
    }
    if (!report.errors.length) {
      const preview = parseOfficePreview(contents, format);
      if (preview.kind === 'presentation') {
        report.counts.slides = preview.slides.length;
        for (const slide of preview.slides) {
          const text = slide.paragraphs.join('');
          if (!text.trim()) report.warnings.push(`第 ${slide.number} 页无可提取文字，请核对图片页或空白页是否符合预期`);
          else if (text.length > 900) report.warnings.push(`第 ${slide.number} 页文字较密集，请检查字号、换行并考虑拆页`);
        }
      } else if (preview.kind === 'document') {
        report.counts.paragraphs = preview.paragraphs.length;
        if (!preview.paragraphs.some(text => text.trim())) report.warnings.push('未提取到正文，请检查是否为空文档或以图片为主');
      } else {
        report.counts.sheets = preview.sheets.length;
        for (const [path, bytes] of Object.entries(archive)) {
          if (!/^xl\/worksheets\/[^/]+\.xml$/u.test(path)) continue;
          for (const match of strFromU8(bytes).matchAll(/<c\b[^>]*\bt=["']e["'][^>]*>[\s\S]*?<\/c>/gu)) {
            report.warnings.push(`${path} 单元格 ${attribute(match[0], 'r') ?? '?'} 包含公式错误，请检查公式和引用`);
          }
        }
      }
    }
  } catch (error) { report.errors.push(`导出文件无法解析：${error instanceof Error ? error.message : String(error)}`); }
  report.errors = [...new Set(report.errors)].slice(0, 40);
  report.warnings = report.warnings.slice(0, 40);
  report.valid = report.errors.length === 0;
  return report;
}

export function assertOfficeExport(contents: Uint8Array, extension: string): void {
  if (!mainParts[extension.toLowerCase()]) return;
  const report = inspectOfficeQuality(contents, extension);
  if (!report.valid) throw new Error(`Office 导出校验失败，保留原文件与草稿：${report.errors.join('；')}`);
}
