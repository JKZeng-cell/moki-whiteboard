import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";

type InlineSegment =
  | { kind: "text"; text: string }
  | { kind: "bold"; text: string }
  | { kind: "code"; text: string }
  | { kind: "strike"; text: string }
  | { kind: "link"; label: string; href: string };

function safeHttpUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol)
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

function splitAutolink(value: string): { value: string; trailing: string } {
  let end = value.length;
  while (end > 0 && /[.,!?;:，。！？；：、）》】]/u.test(value[end - 1] ?? "")) end -= 1;
  return { value: value.slice(0, end), trailing: value.slice(end) };
}

function trimTableCell(value: string) {
  return value.trim().replace(/^\\\|/u, "|").replace(/\\\|$/u, "|");
}

function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/u, "").replace(/\|$/u, "");
  return trimmed.split(/(?<!\\)\|/u).map(trimTableCell);
}

function isTableDivider(line: string): boolean {
  return /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/u.test(
    line,
  );
}

function isTableRow(line: string): boolean {
  return line.includes("|") && splitTableRow(line).length >= 2;
}

function parseInline(text: string): InlineSegment[] {
  const segments: InlineSegment[] = [];
  const pattern =
    /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|(\*\*([^*]+)\*\*)|(~~([^~]+)~~)|(`([^`]+)`)|(https?:\/\/[-A-Za-z0-9._~:\/?#@!$&'()*+,;=%]+)|(www\.[-A-Za-z0-9._~:\/?#@!$&'()*+,;=%]+)/giu;
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > cursor) {
      segments.push({ kind: "text", text: text.slice(cursor, index) });
    }

    const raw = match[0];
    if (match[1] && match[2]) {
      const href = safeHttpUrl(match[2]);
      segments.push(
        href
          ? { kind: "link", label: match[1], href }
          : { kind: "text", text: raw },
      );
    } else if (match[4]) {
      segments.push({ kind: "bold", text: match[4] });
    } else if (match[6]) {
      segments.push({ kind: "strike", text: match[6] });
    } else if (match[8]) {
      segments.push({ kind: "code", text: match[8] });
    } else if (match[9] || match[10]) {
      const autolink = splitAutolink(match[9] ?? match[10] ?? "");
      const href = safeHttpUrl(match[10] ? `https://${autolink.value}` : autolink.value);
      segments.push(
        href
          ? { kind: "link", label: autolink.value, href }
          : { kind: "text", text: raw },
      );
      if (href && autolink.trailing) {
        segments.push({ kind: "text", text: autolink.trailing });
      }
    } else {
      segments.push({ kind: "text", text: raw });
    }
    cursor = index + raw.length;
  }
  if (cursor < text.length) {
    segments.push({ kind: "text", text: text.slice(cursor) });
  }
  return segments;
}

function renderInline(text: string): ReactNode {
  return parseInline(text).map((segment, index) => {
    if (segment.kind === "bold") {
      return (
        <strong key={`${segment.text}-${index}`}>
          {segment.text}
        </strong>
      );
    }
    if (segment.kind === "code") {
      return (
        <code
          key={`${segment.text}-${index}`}
          className="break-all whitespace-pre-wrap rounded-md bg-black/5 px-1 py-0.5 font-mono text-[0.72em]"
        >
          {segment.text}
        </code>
      );
    }
    if (segment.kind === "strike") {
      return (
        <span
          key={`${segment.text}-${index}`}
          className="line-through decoration-current/60"
        >
          {segment.text}
        </span>
      );
    }
    if (segment.kind === "link") {
      return (
        <a
          key={`${segment.href}-${index}`}
          href={segment.href}
          target="_blank"
          rel="noopener noreferrer"
          className="break-all font-extrabold text-[#625bc5] underline decoration-current/30 underline-offset-2 hover:decoration-current"
        >
          {segment.label}
        </a>
      );
    }
    return <span key={`${segment.text}-${index}`}>{segment.text}</span>;
  });
}

export function MarkdownRenderer({
  content,
  className = "",
  onOpenLink,
  inline = false,
}: {
  content: string;
  className?: string;
  onOpenLink?: (href: string) => void;
  inline?: boolean;
}) {
  const handleLinkClick = onOpenLink ? (event: ReactMouseEvent<HTMLElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
    if (!anchor) return;
    const href = safeHttpUrl(anchor.href);
    if (!href) return;
    event.preventDefault();
    onOpenLink(href);
  } : undefined;
  if (inline) {
    return <p className={className} onClick={handleLinkClick}>{renderInline(content)}</p>;
  }
  const lines = content.split(/\r?\n/u);
  const nodes: ReactNode[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();
    if (!trimmed) {
      nodes.push(<div key={`blank-${index}`} className="h-1" />);
      continue;
    }
    if (
      isTableRow(line) &&
      lines[index + 1] &&
      isTableDivider(lines[index + 1]!)
    ) {
      const headers = splitTableRow(line);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && isTableRow(lines[index] ?? "")) {
        rows.push(splitTableRow(lines[index]!));
        index += 1;
      }
      index -= 1;
      nodes.push(
        <div
          key={`table-${index}`}
          className="my-2 overflow-x-auto rounded-xl border border-[#e5e7f0]"
        >
          <table className="min-w-full border-collapse text-left text-[0.6875rem]">
            <thead className="bg-[#f5f6fb] text-[#5f6577]">
              <tr>
                {headers.map((header, cellIndex) => (
                  <th
                    key={`${header}-${cellIndex}`}
                    className="border-b border-[#e5e7f0] px-2 py-1.5 font-extrabold"
                  >
                    {renderInline(header)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={rowIndex} className="odd:bg-white even:bg-[#fafbfe]">
                  {headers.map((_, cellIndex) => (
                    <td
                      key={cellIndex}
                      className="border-b border-[#eef0f5] px-2 py-1.5 align-top last:border-b-0"
                    >
                      {renderInline(row[cellIndex] ?? "")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (/^#{1,3}\s/u.test(trimmed)) {
      const level = trimmed.match(/^#+/u)?.[0].length ?? 1;
      const text = trimmed.replace(/^#{1,3}\s/u, "");
      const Tag = level === 1 ? "h3" : level === 2 ? "h4" : "h5";
      nodes.push(
        <Tag
          key={`heading-${index}`}
          className="mt-2 first:mt-0 font-black text-[#252a3e]"
        >
          {renderInline(text)}
        </Tag>,
      );
      continue;
    }
    if (/^>\s/u.test(trimmed)) {
      nodes.push(
        <blockquote
          key={`quote-${index}`}
          className="rounded-lg border-l-2 border-[#8b84dd] bg-[#f3f2ff] px-2.5 py-1.5 text-[#625bc5]"
        >
          {renderInline(trimmed.replace(/^>\s/u, ""))}
        </blockquote>,
      );
      continue;
    }
    if (/^(?:[-*]|\d+[.)、])\s/u.test(trimmed)) {
      nodes.push(
        <p key={`list-${index}`} className="pl-3">
          <span className="-ml-3 mr-1 font-black text-[#625bc5]">•</span>
          {renderInline(
            trimmed.replace(/^(?:[-*]|\d+[.)、])\s/u, ""),
          )}
        </p>,
      );
      continue;
    }
    if (/^-{3,}$/u.test(trimmed)) {
      nodes.push(
        <hr key={`hr-${index}`} className="my-2 border-[#e8eaf2]" />,
      );
      continue;
    }
    nodes.push(<p key={`p-${index}`}>{renderInline(trimmed)}</p>);
  }
  return (
    <div
      className={`min-w-0 max-w-full space-y-1.5 break-words [overflow-wrap:anywhere] ${className}`}
      onClick={handleLinkClick}
    >
      {nodes}
    </div>
  );
}
