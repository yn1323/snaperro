import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { BodyRefSchema } from "../../../shared/contracts-v2/entities.js";
import { OperationAbortedError } from "../domain/errors.js";
import type { BlobStorePort } from "./ports.js";
import { bodyContainsText } from "./stream-text-search.js";

function harness(chunks: string[], contentEncoding: string | null = null) {
  const bytes = new TextEncoder().encode(chunks.join(""));
  const ref = BodyRefSchema.parse({
    sha256: createHash("sha256").update(bytes).digest("hex"),
    size: bytes.byteLength,
    mediaType: "text/plain",
    contentEncoding,
  });
  const cancel = vi.fn();
  const open = vi.fn(async () => {
    let index = 0;
    return new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = chunks[index++];
        if (chunk === undefined) controller.close();
        else controller.enqueue(new TextEncoder().encode(chunk));
      },
      cancel,
    });
  });
  return { ref, cancel, blobs: { open } as unknown as BlobStorePort };
}

describe("bodyContainsText", () => {
  it("finds a case-insensitive match split across chunks without buffering the body", async () => {
    const { blobs, ref, cancel } = harness(["a".repeat(70_000), "Need", "le in a haystack", "tail"]);

    await expect(bodyContainsText(blobs, ref, "needle")).resolves.toBe(true);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("returns a match without waiting for stream cancellation cleanup", async () => {
    const { blobs, ref, cancel } = harness(["needle", "tail"]);
    cancel.mockReturnValue(new Promise<void>(() => undefined));

    await expect(bodyContainsText(blobs, ref, "needle")).resolves.toBe(true);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("scans through EOF when text is absent", async () => {
    const { blobs, ref, cancel } = harness(["first", "second"]);

    await expect(bodyContainsText(blobs, ref, "missing")).resolves.toBe(false);
    expect(cancel).not.toHaveBeenCalled();
  });

  it("does not interpret compressed bytes as text", async () => {
    const { blobs, ref } = harness(["needle"], "gzip");

    await expect(bodyContainsText(blobs, ref, "needle")).resolves.toBe(false);
    expect(blobs.open).not.toHaveBeenCalled();
  });

  it("releases an aborted search without awaiting a pending read cancellation", async () => {
    const bytes = new TextEncoder().encode("pending");
    const ref = BodyRefSchema.parse({
      sha256: createHash("sha256").update(bytes).digest("hex"),
      size: bytes.byteLength,
      mediaType: "text/plain",
      contentEncoding: null,
    });
    const controller = new AbortController();
    let markPullStarted: (() => void) | undefined;
    const pullStarted = new Promise<void>((resolve) => {
      markPullStarted = resolve;
    });
    const cancel = vi.fn(() => new Promise<void>(() => undefined));
    const blobs = {
      open: vi.fn(
        async () =>
          new ReadableStream<Uint8Array>({
            pull() {
              markPullStarted?.();
              return new Promise<void>(() => undefined);
            },
            cancel,
          }),
      ),
    } as unknown as BlobStorePort;

    const searching = bodyContainsText(blobs, ref, "needle", { signal: controller.signal });
    await pullStarted;
    controller.abort(new Error("server stopping"));

    await expect(searching).rejects.toBeInstanceOf(OperationAbortedError);
    expect(cancel).toHaveBeenCalled();
  });
});
