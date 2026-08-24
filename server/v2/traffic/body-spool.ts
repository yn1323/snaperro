import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import fs, { type FileHandle } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

export class BodyLimitExceededError extends Error {
  constructor(
    readonly limit: number,
    readonly received: number,
  ) {
    super(`Request body exceeds the ${limit} byte limit`);
    this.name = "BodyLimitExceededError";
  }
}

export interface SpoolBodyOptions {
  directory: string;
  maxBytes: number;
  cleanupTimeoutMs?: number;
  signal?: AbortSignal;
}

const DEFAULT_CLEANUP_TIMEOUT_MS = 5_000;
const ABORTED = Symbol("body spool aborted");

export class BodySpool {
  #disposed = false;

  constructor(
    readonly filePath: string | null,
    readonly size: number,
    readonly sha256: string,
    private readonly cleanupTimeoutMs = DEFAULT_CLEANUP_TIMEOUT_MS,
  ) {}

  createReadStream(): Readable | undefined {
    if (this.#disposed) throw new Error("Body spool is disposed");
    return this.filePath ? createReadStream(this.filePath) : undefined;
  }

  createWebStream(): ReadableStream<Uint8Array> | null {
    const stream = this.createReadStream();
    return stream ? (Readable.toWeb(stream) as ReadableStream<Uint8Array>) : null;
  }

  async bytes(): Promise<Uint8Array> {
    if (this.#disposed) throw new Error("Body spool is disposed");
    return this.filePath ? fs.readFile(this.filePath) : new Uint8Array();
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    if (this.filePath) {
      await settlesWithin(
        cleanupOperation(() => fs.unlink(this.filePath as string)),
        this.cleanupTimeoutMs,
      );
    }
  }
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new DOMException("The operation was aborted", "AbortError");
}

function cancelBestEffort(reader: ReadableStreamDefaultReader<Uint8Array>, reason: unknown): void {
  try {
    void reader.cancel(reason).catch(() => undefined);
  } catch {
    // The spool error remains authoritative after cancellation starts.
  }
}

function cleanupOperation(operation: () => Promise<unknown> | unknown): Promise<void> {
  try {
    return Promise.resolve(operation()).then(
      () => undefined,
      () => undefined,
    );
  } catch {
    return Promise.resolve();
  }
}

async function settlesWithin(operation: Promise<unknown>, timeoutMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const settled = operation.then(
    () => true,
    () => true,
  );
  try {
    return await Promise.race([
      settled,
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function awaitAbortable<Result>(
  operation: PromiseLike<Result> | Result,
  signal: AbortSignal | undefined,
  aborted: Promise<typeof ABORTED>,
  disposeLateResult?: (result: Result) => Promise<unknown> | unknown,
): Promise<Result> {
  const observed = Promise.resolve(operation).then(
    (value) => ({ status: "fulfilled" as const, value }),
    (error: unknown) => ({ status: "rejected" as const, error }),
  );
  if (!signal) {
    const result = await observed;
    if (result.status === "rejected") throw result.error;
    return result.value;
  }
  if (signal.aborted) {
    if (disposeLateResult) {
      void observed.then((late) => {
        if (late.status === "fulfilled") void cleanupOperation(() => disposeLateResult(late.value));
      });
    }
    throw abortError(signal);
  }
  const result = await Promise.race([observed, aborted]);
  if (result === ABORTED) {
    if (disposeLateResult) {
      void observed.then((late) => {
        if (late.status === "fulfilled") void cleanupOperation(() => disposeLateResult(late.value));
      });
    }
    throw abortError(signal);
  }
  if (result.status === "rejected") throw result.error;
  return result.value;
}

function releaseReaderLock(reader: ReadableStreamDefaultReader<Uint8Array>): void {
  try {
    reader.releaseLock();
  } catch {
    // A non-conforming source may leave a read pending after cancellation.
    // The caller must still be released from the aborted request.
  }
}

async function writeAll(handle: FileHandle, bytes: Uint8Array): Promise<void> {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const { bytesWritten } = await handle.write(bytes, offset, bytes.byteLength - offset);
    if (bytesWritten === 0) throw new Error("Could not make progress while writing the request body spool");
    offset += bytesWritten;
  }
}

export async function spoolBody(
  stream: ReadableStream<Uint8Array> | null,
  options: SpoolBodyOptions,
): Promise<BodySpool> {
  if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes <= 0) {
    throw new Error("maxBytes must be a positive safe integer");
  }
  const cleanupTimeoutMs = options.cleanupTimeoutMs ?? DEFAULT_CLEANUP_TIMEOUT_MS;
  if (!Number.isSafeInteger(cleanupTimeoutMs) || cleanupTimeoutMs < 1) {
    throw new Error("cleanupTimeoutMs must be a positive safe integer");
  }

  const emptyDigest = createHash("sha256").digest("hex");
  if (!stream) return new BodySpool(null, 0, emptyDigest, cleanupTimeoutMs);
  if (options.signal?.aborted) throw abortError(options.signal);

  const filePath = path.join(options.directory, `body-${process.pid}-${randomUUID()}.tmp`);
  const hash = createHash("sha256");
  const reader = stream.getReader();
  let handle: FileHandle | undefined;
  let size = 0;
  let resolveAborted: (result: typeof ABORTED) => void = () => undefined;
  const aborted = new Promise<typeof ABORTED>((resolve) => {
    resolveAborted = resolve;
  });
  const onAbort = () => {
    cancelBestEffort(reader, options.signal?.reason);
    resolveAborted(ABORTED);
  };
  options.signal?.addEventListener("abort", onAbort, { once: true });
  if (options.signal?.aborted) onAbort();

  try {
    await awaitAbortable(fs.mkdir(options.directory, { recursive: true }), options.signal, aborted);
    handle = await awaitAbortable(fs.open(filePath, "wx", 0o600), options.signal, aborted, (lateHandle) => {
      const closing = cleanupOperation(() => lateHandle.close());
      void cleanupOperation(() => fs.unlink(filePath));
      return closing.then(() => cleanupOperation(() => fs.unlink(filePath)));
    });
    while (true) {
      if (options.signal?.aborted) throw abortError(options.signal);
      const { done, value } = await awaitAbortable(reader.read(), options.signal, aborted);
      if (options.signal?.aborted) throw abortError(options.signal);
      if (done) break;
      size += value.byteLength;
      if (size > options.maxBytes) throw new BodyLimitExceededError(options.maxBytes, size);
      hash.update(value);
      await awaitAbortable(writeAll(handle, value), options.signal, aborted);
    }
    await awaitAbortable(handle.sync(), options.signal, aborted);
    await awaitAbortable(handle.close(), options.signal, aborted);
    handle = undefined;
    return new BodySpool(filePath, size, hash.digest("hex"), cleanupTimeoutMs);
  } catch (error) {
    // Reject a limit/abort failure promptly even when an untrusted request
    // stream never settles its underlying cancel algorithm.
    cancelBestEffort(reader, error);
    const closing = handle ? cleanupOperation(() => handle?.close()) : Promise.resolve();
    handle = undefined;
    const unlinking = cleanupOperation(() => fs.unlink(filePath));
    const retryingUnlink = closing.then(() => cleanupOperation(() => fs.unlink(filePath)));
    await settlesWithin(Promise.allSettled([closing, unlinking, retryingUnlink]), cleanupTimeoutMs);
    throw error;
  } finally {
    options.signal?.removeEventListener("abort", onAbort);
    releaseReaderLock(reader);
  }
}
