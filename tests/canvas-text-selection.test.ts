import { describe, expect, it } from 'vitest';
import { canvasTextCaretOffset, wrapCanvasTextLines } from '../src/vendor/moki/whiteboard/canvas-text-lines.js';

const measure = { measureText: (text: string) => ({ width: Array.from(text).length * 10 }) };

describe('canvas text selection offsets', () => {
 it('preserves original whitespace and paragraph breaks across wrapped lines', () => {
  const text = '甲乙 丙丁\r\n戊己';
  const lines = wrapCanvasTextLines(measure, text, 25);
  expect(lines.map(line => line.text)).toEqual(['甲乙', '丙丁', '戊己']);
  const start = canvasTextCaretOffset(measure, lines[0]!, 10);
  const end = canvasTextCaretOffset(measure, lines[2]!, 10);
  expect(text.slice(start, end)).toBe('乙 丙丁\r\n戊');
 });

 it('copies the visible source range without adding a truncation ellipsis', () => {
  const text = '甲乙丙丁';
  const [line] = wrapCanvasTextLines(measure, text, 20, 1);
  expect(line?.text).toBe('甲…');
  expect(text.slice(line!.start, canvasTextCaretOffset(measure, line!, 20))).toBe('甲');
 });

 it('keeps grapheme clusters intact during wrapping and selection', () => {
  const text = 'A👩‍💻B';
  const lines = wrapCanvasTextLines(measure, text, 30);
  expect(lines.map(line => line.text)).toEqual(['A', '👩‍💻', 'B']);
  expect(canvasTextCaretOffset(measure, lines[1]!, 12)).toBe(1);
  expect(canvasTextCaretOffset(measure, lines[1]!, 18)).toBe('A👩‍💻'.length);
 });
});
