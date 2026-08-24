import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { BodyRefSchema } from "../../../shared/contracts-v2/entities.js";
import type { BlobWriteSessionPort } from "../application/ports.js";
import { OperationAbortedError } from "../domain/errors.js";
import { createPersistedBodyStream } from "./persisted-body-stream.js";

function session() {
  const chunks: Uint8Array[] = [];
  let aborted: unknown;
  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      chunks.push(chunk.slice());
    },
  });
  const value: BlobWriteSessionPort = {
    writable,
    commit: vi.fn(async () => {
      const bytes = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
      return BodyRefSchema.parse({
        sha256: createHash("sha256").update(bytes).digest("hex"),
        size: bytes.byteLength,
        mediaType: "application/octet-stream",
        contentEncoding: null,
      });
    }),
    abort: vi.fn(async (reason) => {
      aborted = reason;
    }),
  };
  return { value, chunks, aborted: () => aborted };
}

function chunkedSource(chunks: number[][], cancelled = vi.fn()) {
  let index = 0;
  return {
    source: new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = chunks[index++];
        if (chunk) controller.enqueue(new Uint8Array(chunk));
        else controller.close();
      },
      cancel: cancelled,
    }),
    reads: () => index,
  };
}

describe("createPersistedBodyStream", () => {
  it("persists exactly the bytes delivered to the consumer", async () => {
    const target = session();
    const onCommitted = vi.fn();
    const pipeline = createPersistedBodyStream(
      chunkedSource([
        [0, 1],
        [2, 255],
      ]).source,
      target.value,
      {
        completeOnCancel: true,
        onCommitted,
      },
    );

    const delivered = new Uint8Array(await new Response(pipeline.body).arrayBuffer());
    const ref = await pipeline.completion;

    expect(delivered).toEqual(new Uint8Array([0, 1, 2, 255]));
    expect(Buffer.concat(target.chunks.map((chunk) => Buffer.from(chunk)))).toEqual(Buffer.from(delivered));
    expect(ref.size).toBe(4);
    expect(target.value.commit).toHaveBeenCalledOnce();
    expect(onCommitted).toHaveBeenCalledWith(ref);
  });

  it("drains the upstream to storage after a consumer cancellation when configured", async () => {
    const target = session();
    const pipeline = createPersistedBodyStream(chunkedSource([[1], [2], [3]]).source, target.value, {
      completeOnCancel: true,
    });
    const reader = pipeline.body.getReader();

    expect((await reader.read()).value).toEqual(new Uint8Array([1]));
    await reader.cancel("gone");
    const ref = await pipeline.completion;

    expect(ref.size).toBe(3);
    expect(Buffer.concat(target.chunks.map((chunk) => Buffer.from(chunk)))).toEqual(Buffer.from([1, 2, 3]));
  });

  it("aborts persistence when completion after cancellation is disabled", async () => {
    const target = session();
    const source = chunkedSource([[1], [2]]).source;
    const pipeline = createPersistedBodyStream(source, target.value, {
      completeOnCancel: false,
    });
    const reader = pipeline.body.getReader();
    await reader.read();
    await reader.cancel("gone");

    await expect(pipeline.completion).rejects.toBeInstanceOf(OperationAbortedError);
    expect(target.value.abort).toHaveBeenCalledOnce();
    expect(target.aborted()).toBeInstanceOf(OperationAbortedError);

    const sourceReader = source.getReader();
    sourceReader.releaseLock();
    const blobWriter = target.value.writable.getWriter();
    void blobWriter.closed.catch(() => undefined);
    blobWriter.releaseLock();
  });

  it("settles cancellation without waiting for source or storage cleanup", async () => {
    const never = new Promise<void>(() => undefined);
    const cancelSource = vi.fn(() => never);
    const abortSession = vi.fn(() => never);
    const abortWritable = vi.fn(() => never);
    const pipeline = createPersistedBodyStream(
      chunkedSource([[1], [2]], cancelSource).source,
      {
        writable: new WritableStream<Uint8Array>({ abort: abortWritable }),
        commit: vi.fn(),
        abort: abortSession,
      },
      { completeOnCancel: false },
    );
    const reader = pipeline.body.getReader();

    await reader.read();
    await expect(reader.cancel("gone")).resolves.toBeUndefined();
    await expect(pipeline.completion).rejects.toBeInstanceOf(OperationAbortedError);
    expect(cancelSource).toHaveBeenCalledOnce();
    expect(abortWritable).toHaveBeenCalledOnce();
    expect(abortSession).toHaveBeenCalledOnce();
  });

  it("delivers every upstream byte when the blob writer fails", async () => {
    let writes = 0;
    const abort = vi.fn(async () => undefined);
    const pipeline = createPersistedBodyStream(
      chunkedSource([[1], [2], [3]]).source,
      {
        writable: new WritableStream<Uint8Array>({
          write() {
            writes += 1;
            if (writes === 2) throw new Error("disk write failed");
          },
        }),
        commit: vi.fn(async () => {
          throw new Error("commit must not run");
        }),
        abort,
      },
      { completeOnCancel: true },
    );

    await expect(new Response(pipeline.body).arrayBuffer()).resolves.toEqual(new Uint8Array([1, 2, 3]).buffer);
    await expect(pipeline.completion).rejects.toThrow("disk write failed");
    expect(abort).toHaveBeenCalledOnce();
  });

  it("closes the proxy body normally when the final blob commit fails", async () => {
    const target = session();
    vi.mocked(target.value.commit).mockRejectedValueOnce(new Error("blob commit failed"));
    const pipeline = createPersistedBodyStream(chunkedSource([[1], [2], [3]]).source, target.value, {
      completeOnCancel: true,
    });

    await expect(new Response(pipeline.body).arrayBuffer()).resolves.toEqual(new Uint8Array([1, 2, 3]).buffer);
    await expect(pipeline.completion).rejects.toThrow("blob commit failed");
    expect(target.value.abort).toHaveBeenCalledOnce();
  });

  it("aborts a pending upstream read without awaiting source cleanup", async () => {
    const controller = new AbortController();
    let markPullStarted: (() => void) | undefined;
    const pullStarted = new Promise<void>((resolve) => {
      markPullStarted = resolve;
    });
    const cancel = vi.fn(() => new Promise<void>(() => undefined));
    const source = new ReadableStream<Uint8Array>({
      pull() {
        markPullStarted?.();
        return new Promise<void>(() => undefined);
      },
      cancel,
    });
    const target = session();
    const pipeline = createPersistedBodyStream(source, target.value, {
      completeOnCancel: true,
      signal: controller.signal,
    });
    const reader = pipeline.body.getReader();
    const reading = reader.read();
    await pullStarted;
    controller.abort(new Error("generation stopped"));

    await expect(reading).rejects.toBeInstanceOf(OperationAbortedError);
    await expect(pipeline.completion).rejects.toBeInstanceOf(OperationAbortedError);
    expect(cancel).toHaveBeenCalled();
  });

  it("settles capture when shutdown interrupts a pending blob commit", async () => {
    const controller = new AbortController();
    let markCommitStarted: (() => void) | undefined;
    const commitStarted = new Promise<void>((resolve) => {
      markCommitStarted = resolve;
    });
    const abort = vi.fn(() => new Promise<void>(() => undefined));
    const pipeline = createPersistedBodyStream(
      chunkedSource([[1]]).source,
      {
        writable: new WritableStream<Uint8Array>(),
        commit: vi.fn(() => {
          markCommitStarted?.();
          return new Promise<ReturnType<typeof BodyRefSchema.parse>>(() => undefined);
        }),
        abort,
      },
      { completeOnCancel: true, signal: controller.signal },
    );

    await expect(new Response(pipeline.body).arrayBuffer()).resolves.toEqual(Uint8Array.of(1).buffer);
    await commitStarted;
    controller.abort(new Error("generation stopped"));

    await expect(pipeline.completion).rejects.toBeInstanceOf(OperationAbortedError);
    expect(abort).toHaveBeenCalled();
  });
});
