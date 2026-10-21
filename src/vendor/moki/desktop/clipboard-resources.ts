import { existsSync, statSync } from "node:fs";
import { basename, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import type { DesktopClipboardResource } from "../shared/desktop-clipboard-contract.js";

export type ClipboardReader = {
  availableFormats(type?: "selection" | "clipboard"): string[];
  read(format: string): string;
  readBuffer(format: string): Buffer;
  readText(type?: "selection" | "clipboard"): string;
};

function nulSeparated(value: string): string[] {
  return value.split("\0").map((entry) => entry.trim()).filter(Boolean);
}

export function decodeWindowsDropFiles(buffer: Buffer): string[] {
  if (buffer.length < 2 || buffer.length > 4 * 1024 * 1024) return [];
  if (buffer.length >= 20) {
    const offset = buffer.readUInt32LE(0);
    const wide = buffer.readUInt32LE(16) !== 0;
    if (offset >= 20 && offset < buffer.length) {
      return nulSeparated(buffer.subarray(offset).toString(wide ? "utf16le" : "latin1"));
    }
  }
  const wideFallback = buffer.length % 2 === 0 ? nulSeparated(buffer.toString("utf16le")) : [];
  if (wideFallback.some((value) => /^[A-Za-z]:[\\/]|^\\\\/u.test(value))) return wideFallback;
  return nulSeparated(buffer.toString("utf8"));
}

export function clipboardTextTargets(text: string): Array<{ type: "path" | "url"; target: string }> {
  const results: Array<{ type: "path" | "url"; target: string }> = [];
  const seen = new Set<string>();
  for (const rawLine of text.split(/\r?\n|\0/u)) {
    let target = rawLine.trim().replace(/^(["'])(.*)\1$/u, "$2").trim();
    if (!target || target.startsWith("#")) continue;
    let type: "path" | "url" | undefined;
    if (/^file:\/\//iu.test(target)) {
      try {
        target = fileURLToPath(target);
        type = "path";
      } catch {
        continue;
      }
    } else if (/^https?:\/\//iu.test(target)) {
      type = "url";
    } else if (isAbsolute(target) || /^[A-Za-z]:[\\/]|^\\\\/u.test(target)) {
      type = "path";
    }
    if (!type) continue;
    const key = `${type}:${target.toLocaleLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({ type, target });
  }
  return results;
}

export function readDesktopClipboardResources(reader: ClipboardReader): DesktopClipboardResource[] {
  const formats = reader.availableFormats("clipboard");
  const textSources: string[] = [];
  for (const format of formats) {
    const normalized = format.toLocaleLowerCase();
    try {
      if (normalized === "cf_hdrop") {
        textSources.push(decodeWindowsDropFiles(reader.readBuffer(format)).join("\n"));
      } else if (normalized === "filenamew") {
        textSources.push(nulSeparated(reader.readBuffer(format).toString("utf16le")).join("\n"));
      } else if (normalized === "filename") {
        textSources.push(nulSeparated(reader.readBuffer(format).toString("latin1")).join("\n"));
      } else if (normalized === "text/uri-list") {
        textSources.push(reader.read(format));
      }
    } catch {
      // One unsupported native format must not hide other clipboard sources.
    }
  }
  try {
    textSources.push(reader.readText("clipboard"));
  } catch {
    // Native file formats can still provide usable entries.
  }
  const resources: DesktopClipboardResource[] = [];
  const seen = new Set<string>();
  for (const candidate of clipboardTextTargets(textSources.join("\n"))) {
    const key = `${candidate.type}:${candidate.target.toLocaleLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (candidate.type === "url") {
      const url = new URL(candidate.target);
      let decodedName = url.pathname.split("/").filter(Boolean).at(-1) ?? "";
      try {
        decodedName = decodeURIComponent(decodedName);
      } catch {
        // Keep the encoded path segment when a URL contains malformed escapes.
      }
      resources.push({ kind: "url", name: decodedName || url.hostname, target: candidate.target });
      continue;
    }
    if (!existsSync(candidate.target)) continue;
    try {
      const metadata = statSync(candidate.target);
      if (!metadata.isFile() && !metadata.isDirectory()) continue;
      resources.push({
        kind: metadata.isDirectory() ? "local_folder" : "local_file",
        name: basename(candidate.target) || candidate.target,
        target: candidate.target,
      });
    } catch {
      // The path may disappear between clipboard capture and paste.
    }
  }
  return resources;
}
