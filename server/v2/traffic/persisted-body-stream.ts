import type { BodyRef } from "../../../shared/contracts-v2/entities.js";
import type { BlobWriteSessionPort, OperationContext } from "../application/ports.js";
import { OperationAbortedError } from "../domain/errors.js";

export interface PersistedBodyStreamOptions extends OperationContext {
  completeOnCancel: boolean;
  onCommitted?: (ref: BodyRef) => Promise<void>;
}

export interface PersistedBodyStream {
  body: ReadableStream<Uint8Array>;
  completion: Promise<BodyRef>;
}

interface Deferred<Value> {
  promise: Promise<Value>;
  resolve(value: Value): void;
  reject(reason: unknown): void;
}

function deferred<Value>(): Deferred<Value> {
  let resolve!: (value: Value) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Value>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

/**
 * Couples delivery and persistence one chunk at a time. While the consumer is
 * connected, the source cannot outrun either the client or the blob writer. If
 * the client disconnects and completion is enabled, the remaining source is
 * drained directly to storage without buffering it in memory.
 */
export function createPersistedBodyStream(
  source: ReadableStream<Uint8Array>,
  session: BlobWriteSessionPort,
  options: PersistedBodyStreamOptions,
): PersistedBodyStream {
  const sourceReader = source.getReader();
  let blobWriter: WritableStreamDefaultWriter<Uint8Array>;
  try {
    blobWriter = session.writable.getWriter();
  } catch (error) {
    sourceReader.releaseLock();
    throw error;
  }
  const result = deferred<BodyRef>();
  // Completion is commonly observed after the Response has been returned. A
  // no-op rejection observer prevents a cancellation race from becoming an
  // unhandled rejection while preserving the rejecting promise for callers.
  void result.promise.catch(() => undefined);

  let state: "streaming" | "delivery-only" | "committing" | "completed" | "failed" = "streaming";
  let finalizePromise: Promise<BodyRef> | undefined;
  let sourceReleased = false;
  let writerReleased = false;

  const awaitWithSignal = async <Value>(operation: PromiseLike<Value> | Value): Promise<Value> => {
    const observed = Promise.resolve(operation).then(
      (value) => ({ status: "fulfilled" as const, value }),
      (error: unknown) => ({ status: "rejected" as const, error }),
    );
    const signal = options.signal;
    if (!signal) {
      const result = await observed;
      if (result.status === "rejected") throw result.error;
      return result.value;
    }
    if (signal.aborted) throw new OperationAbortedError(undefined, signal.reason);
    const abortedToken = Symbol("persisted body aborted");
    let resolveAborted: (value: typeof abortedToken) => void = () => undefined;
    const aborted = new Promise<typeof abortedToken>((resolve) => {
      resolveAborted = resolve;
    });
    const onAbort = () => resolveAborted(abortedToken);
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
    try {
      const result = await Promise.race([observed, aborted]);
      if (result === abortedToken) throw new OperationAbortedError(undefined, signal.reason);
      if (result.status === "rejected") throw result.error;
      return result.value;
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  };

  const releaseSource = () => {
    if (sourceReleased) return;
    sourceReleased = true;
    try {
      sourceReader.releaseLock();
    } catch {
      // Cancellation may race a pending read. Lifecycle settlement is still
      // more important than retaining this wrapper lock indefinitely.
    }
  };

  const releaseWriter = () => {
    if (writerReleased) return;
    writerReleased = true;
    try {
      blobWriter.releaseLock();
    } catch {
      // A non-conforming sink must not retain capture completion.
    }
  };

  const observeCleanup = (operation: () => Promise<unknown> | unknown): void => {
    try {
      void Promise.resolve(operation()).catch(() => undefined);
    } catch {
      // The terminal delivery/capture outcome remains authoritative.
    }
  };

  const cleanupPersistence = (error: unknown): void => {
    observeCleanup(() => blobWriter.abort(error));
    observeCleanup(() => session.abort(error));
    releaseWriter();
  };

  const abandonPersistence = (error: unknown): void => {
    if (state !== "streaming") return;
    state = "delivery-only";
    // Storage cleanup must never add latency or another failure to delivery.
    cleanupPersistence(error);
    result.reject(error);
  };

  const abortDelivery = (error: unknown): void => {
    if (state === "completed" || state === "failed") return;
    const persistenceActive = state === "streaming" || state === "committing";
    state = "failed";
    observeCleanup(() => sourceReader.cancel(error));
    if (persistenceActive) cleanupPersistence(error);
    result.reject(error);
    releaseSource();
  };

  const finalize = (): Promise<BodyRef> => {
    if (finalizePromise) return finalizePromise;
    state = "committing";
    finalizePromise = (async () => {
      try {
        await awaitWithSignal(blobWriter.close());
        const ref = await awaitWithSignal(session.commit(options));
        if (options.onCommitted) await awaitWithSignal(options.onCommitted(ref));
        state = "completed";
        result.resolve(ref);
        return ref;
      } catch (error) {
        observeCleanup(() => session.abort(error));
        state = "failed";
        result.reject(error);
        throw error;
      } finally {
        releaseWriter();
      }
    })();
    return finalizePromise;
  };

  const drain = async (): Promise<void> => {
    try {
      while (true) {
        if (options.signal?.aborted) {
          throw new OperationAbortedError(undefined, options.signal.reason);
        }
        const { done, value } = await awaitWithSignal(sourceReader.read());
        if (done) {
          releaseSource();
          break;
        }
        await awaitWithSignal(blobWriter.write(value));
      }
      await finalize();
    } catch (error) {
      abortDelivery(error);
      throw error;
    }
  };

  return {
    completion: result.promise,
    body: new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (state === "committing" || state === "completed" || state === "failed") return;
        try {
          if (options.signal?.aborted) {
            throw new OperationAbortedError(undefined, options.signal.reason);
          }
          const { done, value } = await awaitWithSignal(sourceReader.read());
          if (done) {
            releaseSource();
            controller.close();
            if (state === "streaming") void finalize().catch(() => undefined);
            return;
          }
          if (state === "streaming") {
            try {
              await awaitWithSignal(blobWriter.write(value));
            } catch (error) {
              if (options.signal?.aborted) {
                throw new OperationAbortedError(undefined, options.signal.reason);
              }
              abandonPersistence(error);
            }
          }
          controller.enqueue(value);
        } catch (error) {
          abortDelivery(error);
          controller.error(error);
        }
      },
      async cancel(reason) {
        if (state === "completed" || state === "failed") return;
        if (options.completeOnCancel && state === "streaming") {
          await drain();
          return;
        }
        abortDelivery(new OperationAbortedError("Response persistence was cancelled", reason));
      },
    }),
  };
}
