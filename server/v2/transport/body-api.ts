import { Hono } from "hono";
import { BodyRefSchema } from "../../../shared/contracts-v2/entities.js";
import { V2_RELATIVE_PATHS } from "../../../shared/contracts-v2/transport.js";
import type { BlobStorePort, GarbageCollectionPort, LoggerPort } from "../application/ports.js";
import { InvalidArgumentError, OperationAbortedError, PayloadLimitExceededError } from "../domain/errors.js";
import { domainErrorResponse } from "./domain-error-response.js";
import { assertDeclaredContentLengthWithinLimit } from "./request-content-length.js";

export interface BodyApiDependencies {
  blobs: BlobStorePort;
  garbageCollection: GarbageCollectionPort;
  logger?: Pick<LoggerPort, "error">;
  maxUploadBytes?: number;
  cleanupTimeoutMs?: number;
}

async function settleCleanupWithin(cleanup: Promise<unknown>, timeoutMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      cleanup.then(
        () => true,
        () => true,
      ),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function observeCleanup(operation: () => Promise<unknown> | unknown): void {
  try {
    void Promise.resolve(operation()).catch(() => undefined);
  } catch {
    // The request outcome remains authoritative after cleanup starts.
  }
}

const ABORTED = Symbol("body upload aborted");

async function awaitWithAbort<Result>(
  operation: PromiseLike<Result> | Result,
  signal: AbortSignal,
  disposeLateResult?: (result: Result) => Promise<unknown> | unknown,
): Promise<Result> {
  const observed = Promise.resolve(operation).then(
    (value) => ({ status: "fulfilled" as const, value }),
    (error: unknown) => ({ status: "rejected" as const, error }),
  );
  if (signal.aborted) {
    if (disposeLateResult) {
      void observed.then((late) => {
        if (late.status === "fulfilled") observeCleanup(() => disposeLateResult(late.value));
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
          if (late.status === "fulfilled") observeCleanup(() => disposeLateResult(late.value));
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

function releaseReaderLock(reader: ReadableStreamDefaultReader<Uint8Array>): void {
  try {
    reader.releaseLock();
  } catch {
    // A non-conforming request may leave its read pending after abort.
  }
}

function releaseWriterLock(writer: WritableStreamDefaultWriter<Uint8Array> | undefined): void {
  if (!writer) return;
  try {
    writer.releaseLock();
  } catch {
    // A non-conforming store may leave its write pending after abort.
  }
}

export function createBodyApi(dependencies: BodyApiDependencies): Hono {
  const app = new Hono();
  const maxUploadBytes = dependencies.maxUploadBytes ?? 512 * 1024 * 1024;
  const cleanupTimeoutMs = dependencies.cleanupTimeoutMs ?? 5_000;
  if (!Number.isSafeInteger(maxUploadBytes) || maxUploadBytes < 1) {
    throw new TypeError("maxUploadBytes must be a positive safe integer");
  }
  if (!Number.isSafeInteger(cleanupTimeoutMs) || cleanupTimeoutMs < 1) {
    throw new TypeError("cleanupTimeoutMs must be a positive safe integer");
  }
  app.onError(domainErrorResponse);

  app.post(V2_RELATIVE_PATHS.bodies, async (context) => {
    assertDeclaredContentLengthWithinLimit(context, maxUploadBytes);
    if (!context.req.raw.body) throw new InvalidArgumentError("A raw body is required");

    const signal = context.req.raw.signal;
    const reader = context.req.raw.body.getReader();
    let session: Awaited<ReturnType<BlobStorePort["beginWrite"]>> | undefined;
    let writer: WritableStreamDefaultWriter<Uint8Array> | undefined;
    let received = 0;
    try {
      session = await awaitWithAbort(
        dependencies.blobs.beginWrite(
          {
            mediaType: context.req.header("content-type") ?? null,
            contentEncoding: context.req.header("content-encoding") ?? null,
          },
          { signal },
        ),
        signal,
        (lateSession) => lateSession.abort(signal.reason),
      );
      writer = session.writable.getWriter();
      while (true) {
        if (signal.aborted) throw new OperationAbortedError(undefined, signal.reason);
        const { done, value } = await awaitWithAbort(reader.read(), signal);
        if (done) break;
        received += value.byteLength;
        if (received > maxUploadBytes) throw new PayloadLimitExceededError(maxUploadBytes, received);
        await awaitWithAbort(writer.write(value), signal);
      }
      await awaitWithAbort(writer.close(), signal);
      const ref = BodyRefSchema.parse(await awaitWithAbort(session.commit({ signal }), signal));
      if (dependencies.garbageCollection.pinPending) {
        await awaitWithAbort(dependencies.garbageCollection.pinPending(ref, { signal }), signal);
      }
      void dependencies.garbageCollection.schedule().catch((error) => {
        dependencies.logger?.error("Failed to schedule garbage collection after a body upload", { error });
      });
      return context.json(ref, 201);
    } catch (error) {
      const cleanup = Promise.allSettled([
        Promise.resolve().then(() => reader.cancel(error)),
        ...(writer ? [Promise.resolve().then(() => writer?.abort(error))] : []),
        ...(session ? [Promise.resolve().then(() => session?.abort(error))] : []),
      ]);
      if (!(await settleCleanupWithin(cleanup, cleanupTimeoutMs))) {
        try {
          dependencies.logger?.error("Body upload cleanup did not settle before its deadline", {
            cleanupTimeoutMs,
          });
        } catch {
          // Diagnostics must not replace the original upload failure.
        }
      }
      throw error;
    } finally {
      releaseReaderLock(reader);
      releaseWriterLock(writer);
    }
  });

  return app;
}
