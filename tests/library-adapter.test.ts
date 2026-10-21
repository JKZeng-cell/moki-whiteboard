// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { importLocalLibrary } from "../src/web/library-adapter.js";

const api = vi.hoisted(() => ({ fetch: vi.fn() }));

vi.mock("../src/vendor/moki/web/lib/api-fetch.js", () => ({
  apiFetch: api.fetch,
}));

describe("importLocalLibrary", () => {
  beforeEach(() => {
    api.fetch.mockReset();
    window.mokiDesktop = {
      captureWhiteboardLinkPreview: vi.fn().mockResolvedValue(null),
      selectLocalFile: vi.fn(),
      selectLocalFolder: vi.fn(),
    } as unknown as NonNullable<Window["mokiDesktop"]>;
  });

  it("returns the local file item created from the desktop picker", async () => {
    vi.mocked(window.mokiDesktop!.selectLocalFile!).mockResolvedValue("C:\\素材\\方案.pdf");
    const item = {
      id: "file:new",
      parentId: null,
      kind: "local_file",
      name: "方案.pdf",
      target: "C:\\素材\\方案.pdf",
      tags: [],
      sortOrder: 0,
      createdAt: "2026-09-16T00:00:00.000Z",
      updatedAt: "2026-09-16T00:00:00.000Z",
    };
    api.fetch.mockResolvedValue({ ok: true, json: async () => item });

    await expect(importLocalLibrary(false)).resolves.toEqual([item]);
    expect(api.fetch).toHaveBeenCalledWith("/api/library/items", expect.objectContaining({
      method: "POST",
      body: expect.stringContaining("方案.pdf"),
    }));
  });

  it("returns no items when the desktop folder picker is cancelled", async () => {
    vi.mocked(window.mokiDesktop!.selectLocalFolder!).mockResolvedValue(null);

    await expect(importLocalLibrary(true)).resolves.toEqual([]);
    expect(api.fetch).not.toHaveBeenCalled();
  });
});
