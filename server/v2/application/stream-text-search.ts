import type { BodyRef } from "../../../shared/contracts-v2/entities.js";
import { OperationAbortedError } from "../domain/errors.js";
import type { BlobStorePort, OperationContext } from "./ports.js";

function normalize(value: string): string {
  return value.normalize("NFC").toLocaleLowerCase("en-US");
}

function cancelBestEffort(reader: ReadableStreamDefaultReader<Uint8Array>, reason?: unknown): void {
  try {
    void reader.cancel(reason).catch(() => undefined);
  } catch {
    // A completed search must not wait on a non-conforming stream cleanup.
  }
}

function cancelStreamBestEffort(stream: ReadableStream<Uint8Array>, reason?: unknown): void {
  try {
    void stream.cancel(reason).catch(() => undefined);
  } catch {
    // Preserve the search outcome when a late stream cannot be cancelled.
  }
}

const ABORTED = Symbol("body search aborted");

async function awaitWithAbort<Result>(
  operation: PromiseLike<Result> | Result,
  context: OperationContext,
  disposeLateResult?: (result: Result) => void,
): Promise<Result> {
  const observed = Promise.resolve(operation).then(
    (value) => ({ status: "fulfilled" as const, value }),
    (error: unknown) => ({ status: "rejected" as const, error }),
  );
  const signal = context.signal;
  if (!signal) {
    const result = await observed;
    if (result.status === "rejected") throw result.error;
    return result.value;
  }
  if (signal.aborted) {
    if (disposeLateResult) {
      void observed.then((late) => {
        if (late.status === "fulfilled") disposeLateResult(late.value);
      });
    }
    throw new OperationAbortedError(undefined, signal.reason);
  }
  let resolveAborted: (value: typeof ABORTED) => void = () => undefined;
  const aborted = new Promise<typeof ABORTED>((resolve) => {
    resolveAborted = resolve;
  });
  const onAbort = () => resolveAborted(ABORTED);
  signal.addEventListener("abort", onAbort, { once: true });
  if (signal.aborted) onAbort();
  try {
    const result = await Promise.race([observed, aborted]);
    if (result === ABORTED) {
      if (disposeLateResult) {
        void observed.then((late) => {
          if (late.status === "fulfilled") disposeLateResult(late.value);
        });
      }
      throw new OperationAbortedError(undefined, signal.reason);
    }
    if (result.status === "rejected") throw result.error;
    return result.value;
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

/** Searches decoded UTF-8 incrementally so body size does not determine memory use. */
export async function bodyContainsText(
  blobs: BlobStorePort,
  body: BodyRef,
  text: string,
  context: OperationContext = {},
): Promise<boolean> {
  const needle = normalize(text);
  if (!needle || body.contentEncoding !== null) return false;

  const stream = await awaitWithAbort(blobs.open(body, context), context, (lateStream) =>
    cancelStreamBestEffort(lateStream, context.signal?.reason),
  );
  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = stream.getReader();
  } catch (error) {
    cancelStreamBestEffort(stream, error);
    throw error;
  }
  const decoder = new TextDecoder();
  const overlapLength = Math.max(needle.length * 2, 1_024);
  let overlap = "";
  let complete = false;
  try {
    while (true) {
      if (context.signal?.aborted) throw new OperationAbortedError(undefined, context.signal.reason);
      const { done, value } = await awaitWithAbort(reader.read(), context);
      if (done) {
        complete = true;
        const finalText = normalize(overlap + decoder.decode());
        return finalText.includes(needle);
      }

      const decoded = overlap + decoder.decode(value, { stream: true });
      if (normalize(decoded).includes(needle)) {
        cancelBestEffort(reader);
        complete = true;
        return true;
      }
      overlap = decoded.slice(-overlapLength);
    }
  } finally {
    if (!complete) cancelBestEffort(reader, context.signal?.reason);
    try {
      reader.releaseLock();
    } catch {
      // A non-conforming stream may retain a pending read after cancellation.
    }
  }
}
