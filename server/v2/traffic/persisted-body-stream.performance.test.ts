import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { BodyRefSchema } from "../../../shared/contracts-v2/entities.js";
import type { BlobWriteSessionPort } from "../application/ports.js";
import { createPersistedBodyStream } from "./persisted-body-stream.js";

const MEBIBYTE = 1024 * 1024;

describe("large persisted responses", () => {
  it("streams 256 MiB through delivery and storage with bounded in-flight chunks", async () => {
    const chunk = new Uint8Array(MEBIBYTE);
    chunk.fill(0xa5);
    const chunks = 256;
    let produced = 0;
    let consumed = 0;
    let maximumQueuedChunks = 0;
    let activeWrites = 0;
    let maximumActiveWrites = 0;
    let storedBytes = 0;
    const hash = createHash("sha256");

    const source = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (produced === chunks) {
          controller.close();
          return;
        }
        produced += 1;
        maximumQueuedChunks = Math.max(maximumQueuedChunks, produced - consumed);
        controller.enqueue(chunk);
      },
    });
    const writable = new WritableStream<Uint8Array>({
      async write(value) {
        activeWrites += 1;
        maximumActiveWrites = Math.max(maximumActiveWrites, activeWrites);
        hash.update(value);
        storedBytes += value.byteLength;
        await Promise.resolve();
        activeWrites -= 1;
      },
    });
    const session: BlobWriteSessionPort = {
      writable,
      commit: vi.fn(async () =>
        BodyRefSchema.parse({
          sha256: hash.digest("hex"),
          size: storedBytes,
          mediaType: "application/octet-stream",
          contentEncoding: null,
        }),
      ),
      abort: vi.fn(),
    };
    const pipeline = createPersistedBodyStream(source, session, { completeOnCancel: true });
    const reader = pipeline.body.getReader();
    let deliveredBytes = 0;

    while (true) {
      const result = await reader.read();
      if (result.done) break;
      deliveredBytes += result.value.byteLength;
      consumed += 1;
    }
    const ref = await pipeline.completion;

    expect(deliveredBytes).toBe(256 * MEBIBYTE);
    expect(storedBytes).toBe(deliveredBytes);
    expect(ref.size).toBe(deliveredBytes);
    expect(maximumActiveWrites).toBe(1);
    expect(maximumQueuedChunks).toBeLessThanOrEqual(2);
    expect(session.commit).toHaveBeenCalledOnce();
  });
});
