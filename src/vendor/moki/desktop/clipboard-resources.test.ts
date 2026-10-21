// @vitest-environment node

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { clipboardTextTargets, decodeWindowsDropFiles, readDesktopClipboardResources } from "./clipboard-resources.js";

describe("desktop clipboard resources", () => {
  it("parses URLs, file URLs, quoted Windows paths and ignores ordinary text", () => {
    expect(clipboardTextTargets('https://example.com/a.docx\n"C:\\资料\\方案.md"\nordinary text'))
      .toEqual([
        { type: "url", target: "https://example.com/a.docx" },
        { type: "path", target: "C:\\资料\\方案.md" },
      ]);
  });

  it("decodes a wide CF_HDROP payload containing multiple paths", () => {
    const list = Buffer.from("C:\\A.txt\0C:\\Folder\0\0", "utf16le");
    const header = Buffer.alloc(20);
    header.writeUInt32LE(20, 0);
    header.writeUInt32LE(1, 16);
    expect(decodeWindowsDropFiles(Buffer.concat([header, list]))).toEqual(["C:\\A.txt", "C:\\Folder"]);
  });

  it("classifies existing files and folders and keeps links", () => {
    const root = mkdtempSync(join(tmpdir(), "moki-clipboard-"));
    const file = join(root, "方案.md");
    const folder = join(root, "资料夹");
    writeFileSync(file, "content", "utf8");
    mkdirSync(folder);
    try {
      const resources = readDesktopClipboardResources({
        availableFormats: () => ["text/uri-list"],
        read: () => "https://example.com/reference",
        readBuffer: () => Buffer.alloc(0),
        readText: () => `${file}\n${folder}`,
      });
      expect(resources).toEqual(expect.arrayContaining([
        { kind: "local_file", name: "方案.md", target: file },
        { kind: "local_folder", name: "资料夹", target: folder },
        { kind: "url", name: "reference", target: "https://example.com/reference" },
      ]));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
