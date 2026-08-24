import { describe, expect, it, vi } from "vitest";
import { readResponsePreview, responseHasBody } from "./response-preview";

describe("demo response preview", () => {
  it("cancels a declared oversized response before reading it", async () => {
    const cancel = vi.fn(() => new Promise<void>(() => undefined));
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new TextEncoder().encode("must not be read"));
      },
      cancel,
    });
    const response = new Response(body, { headers: { "content-length": "100" } });

    await expect(readResponsePreview(response, 10)).resolves.toEqual({
      text: "",
      bytesRead: 0,
      contentLength: 100,
      truncated: true,
    });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("keeps only the bounded prefix and cancels an unknown-length stream", async () => {
    const cancel = vi.fn(() => new Promise<void>(() => undefined));
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("1234"));
        controller.enqueue(new TextEncoder().encode("5678"));
      },
      cancel,
    });

    await expect(readResponsePreview(new Response(body), 6)).resolves.toEqual({
      text: "123456",
      bytesRead: 6,
      contentLength: null,
      truncated: true,
    });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("returns a small response without truncation", async () => {
    await expect(readResponsePreview(new Response('{"ok":true}'), 100)).resolves.toEqual({
      text: '{"ok":true}',
      bytesRead: 11,
      contentLength: null,
      truncated: false,
    });
  });

  it.each([204, 205, 304])("treats status %i as bodyless", (status) => {
    expect(responseHasBody(status)).toBe(false);
    expect(responseHasBody(200)).toBe(true);
  });
});
