export type CanvasTextMeasurer = { measureText(text: string): { width: number } };
export type CanvasTextLine = { text: string; start: number; end: number };
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Retain offsets into the original text across visual wrapping and truncation. */
export function wrapCanvasTextLines(
  context: CanvasTextMeasurer,
  text: string,
  maxWidth: number,
  maxLines = Number.POSITIVE_INFINITY,
): CanvasTextLine[] {
  if (!text || maxLines <= 0) return [];
  const width = Math.max(1, maxWidth);
  const lines: CanvasTextLine[] = [];
  let offset = 0;
  for (const paragraph of text.split(/\r?\n/u)) {
    let start = offset;
    let current = "";
    const push = () => {
      const line = current.trimEnd();
      lines.push({ text: line, start, end: start + line.length });
    };
    for (const { segment: character } of graphemes.segment(paragraph)) {
      const candidate = current + character;
      if (current && context.measureText(candidate).width > width) {
        push();
        current = /^\s$/u.test(character) ? "" : character;
        start = current ? offset : offset + character.length;
      } else {
        if (!current) start = offset;
        current = candidate;
      }
      offset += character.length;
    }
    push();
    offset += text[offset] === "\r" ? 2 : 1;
  }
  if (lines.length <= maxLines) return lines;
  const visible = lines.slice(0, maxLines);
  const last = visible.at(-1)!;
  let content = last.text;
  const segments = Array.from(graphemes.segment(content));
  while (content && context.measureText(content + "…").width > width) {
    content = content.slice(0, segments.pop()!.index);
  }
  visible[visible.length - 1] = { text: content + "…", start: last.start, end: last.start + content.length };
  return visible;
}

export function canvasTextCaretOffset(context: CanvasTextMeasurer, line: CanvasTextLine, distance: number): number {
  if (distance <= 0) return line.start;
  const content = line.text.slice(0, line.end - line.start);
  let previousWidth = 0;
  for (const { index, segment } of graphemes.segment(content)) {
    const width = context.measureText(content.slice(0, index + segment.length)).width;
    if (distance < (previousWidth + width) / 2) return line.start + index;
    previousWidth = width;
  }
  return line.end;
}
