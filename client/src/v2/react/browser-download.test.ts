import { describe, expect, it, vi } from "vitest";

import { createBrowserDownloadPort } from "./browser-download";

const downloadPath = `/__snaperro__/downloads/${"a".repeat(43)}`;

function ticket(overrides: Record<string, unknown> = {}) {
  return {
    downloadPath,
    expiresAt: "2026-08-24T00:05:00.000Z",
    filename: "recording.zip",
    mediaType: "application/zip",
    size: 65 * 1024 * 1024,
    ...overrides,
  };
}

describe("native capability downloads", () => {
  it("creates a same-origin anchor with referrer suppression in the browser adapter", () => {
    const anchor = {
      href: "",
      download: "",
      rel: "",
      referrerPolicy: "",
      click: vi.fn(),
      remove: vi.fn(),
    };
    const appendChild = vi.fn();
    const createElement = vi.fn(() => anchor);
    vi.stubGlobal("document", { createElement, body: { appendChild } });
    try {
      createBrowserDownloadPort().ticket(ticket());

      expect(createElement).toHaveBeenCalledWith("a");
      expect(anchor).toMatchObject({
        href: downloadPath,
        download: "recording.zip",
        rel: "noopener noreferrer",
        referrerPolicy: "no-referrer",
      });
      expect(appendChild).toHaveBeenCalledWith(anchor);
      expect(anchor.click).toHaveBeenCalledOnce();
      expect(anchor.remove).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("passes a valid same-origin capability directly to the native anchor platform", () => {
    const clickDownload = vi.fn();
    const downloads = createBrowserDownloadPort({ platform: { clickDownload } });

    downloads.ticket(ticket());

    expect(clickDownload).toHaveBeenCalledWith(downloadPath, "recording.zip");
  });

  it("uses the native path for a 65 MiB download without a Blob or File System Access fallback", () => {
    const clickDownload = vi.fn();
    const downloads = createBrowserDownloadPort({ platform: { clickDownload } });

    downloads.ticket(ticket({ size: 65 * 1024 * 1024 }));

    expect(clickDownload).toHaveBeenCalledOnce();
  });

  it.each([
    ["absolute URL", { downloadPath: `https://example.test${downloadPath}` }],
    ["path traversal", { downloadPath: "/__snaperro__/downloads/../secret" }],
    ["unsafe filename", { filename: "../recording.zip" }],
    ["unknown field", { bearerToken: "must-not-be-accepted" }],
  ])("rejects a malformed %s ticket before creating an anchor", (_name, override) => {
    const clickDownload = vi.fn();
    const downloads = createBrowserDownloadPort({ platform: { clickDownload } });

    expect(() => downloads.ticket(ticket(override))).toThrow("Download ticket did not match the v2 contract");
    expect(clickDownload).not.toHaveBeenCalled();
  });

  it("delegates expiry to the authoritative server when the browser clock may be skewed", () => {
    const clickDownload = vi.fn();
    const downloads = createBrowserDownloadPort({ platform: { clickDownload } });

    downloads.ticket(ticket({ expiresAt: "2026-08-23T23:59:59.999Z" }));

    expect(clickDownload).toHaveBeenCalledWith(downloadPath, "recording.zip");
  });
});
