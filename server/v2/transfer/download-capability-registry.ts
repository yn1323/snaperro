import { createHash, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import { Readable } from "node:stream";
import type { BodyRef } from "../../../shared/contracts-v2/entities.js";
import { DownloadTicketSchema } from "../../../shared/contracts-v2/transfers.js";
import { DOWNLOAD_CAPABILITY_BASE_PATH } from "../../../shared/contracts-v2/transport.js";
import type { BlobPinHandlePort, BlobStorePort, OperationContext } from "../application/ports.js";
import { EntityNotFoundError, OperationAbortedError } from "../domain/errors.js";
import type { TransferDownload } from "../transport/transfer-api.js";

const DEFAULT_DOWNLOAD_TTL_MS = 60_000;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 5_000;

export interface FileDownloadRecord {
  kind: "file";
  filePath: string;
  filename: string;
  mediaType: string;
  contentEncoding: null;
  size: number;
}

export interface BodyDownloadRecord {
  kind: "body";
  body: BodyRef;
  filename: string;
  mediaType: string;
  contentEncoding: string | null;
  size: number;
}

export type DownloadRecord = FileDownloadRecord | BodyDownloadRecord;

interface CapabilityRecord {
  download: DownloadRecord;
  pin?: BlobPinHandlePort;
  expiresAt: number;
  timer: ReturnType<typeof setTimeout>;
}

interface ActiveBodyDownload {
  cancel: (reason: unknown) => Promise<void>;
  finish: () => void;
}

export interface DownloadCapabilityRegistryOptions {
  blobs: BlobStorePort;
  ttlMs?: number;
  shutdownTimeoutMs?: number;
  now?: () => number;
  capabilityBytes?: () => Uint8Array;
}

function assertNotAborted(context?: OperationContext): void {
  if (context?.signal?.aborted) throw new OperationAbortedError(undefined, context.signal.reason);
}

function capabilityHash(capability: string): string {
  return createHash("sha256").update(capability).digest("hex");
}

function errorValue(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function cleanupOperation(operation: () => Promise<unknown> | unknown): Promise<void> {
  return Promise.resolve()
    .then(operation)
    .then(() => undefined);
}

function releasePinBestEffort(pin: BlobPinHandlePort | undefined): void {
  if (!pin) return;
  try {
    void pin.release().catch(() => undefined);
  } catch {
    // Pin records expire on their own; cleanup failure may over-retain data but
    // must not retain a request or hide its primary error.
  }
}

function cancelStreamBestEffort(stream: ReadableStream<Uint8Array>, reason: unknown): void {
  try {
    void stream.cancel(reason).catch(() => undefined);
  } catch {
    // A late body adapter must not retain a closed capability claim.
  }
}

const ABORTED = Symbol("download operation aborted");

async function awaitWithAbort<Result>(
  operation: PromiseLike<Result>,
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

async function settleCleanupWithin(
  operations: readonly Promise<void>[],
  timeoutMs: number,
): Promise<PromiseSettledResult<void>[] | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), timeoutMs);
    timer.unref?.();
  });
  try {
    return await Promise.race([Promise.allSettled(operations), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export class DownloadCapabilityRegistry {
  readonly #ttlMs: number;
  readonly #shutdownTimeoutMs: number;
  readonly #now: () => number;
  readonly #capabilityBytes: () => Uint8Array;
  readonly #capabilities = new Map<string, CapabilityRecord>();
  readonly #activeFileDownloads = new Map<string, ReturnType<typeof createReadStream>>();
  readonly #activeBodyDownloads = new Set<ActiveBodyDownload>();
  readonly #claimingBodyPins = new Set<BlobPinHandlePort>();
  readonly #lifetime = new AbortController();
  #closed = false;
  #closePromise: Promise<void> | undefined;

  constructor(private readonly options: DownloadCapabilityRegistryOptions) {
    this.#ttlMs = options.ttlMs ?? DEFAULT_DOWNLOAD_TTL_MS;
    this.#shutdownTimeoutMs = options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;
    this.#now = options.now ?? Date.now;
    this.#capabilityBytes = options.capabilityBytes ?? (() => randomBytes(32));
    if (![this.#ttlMs, this.#shutdownTimeoutMs].every((value) => Number.isSafeInteger(value) && value > 0)) {
      throw new TypeError("Download capability timeouts must be positive safe integers");
    }
  }

  async issue(download: DownloadRecord, context: OperationContext = {}) {
    assertNotAborted(context);
    if (this.#closed) throw new OperationAbortedError("Download capabilities are closed");
    let pin: BlobPinHandlePort | undefined;
    try {
      if (download.kind === "body") {
        // Acquire before checking existence. GC uses the same visibility fence,
        // so a successful check remains valid until the ticket is consumed.
        pin = await this.options.blobs.pin(download.body, context);
        if (!(await this.options.blobs.exists(download.body, context))) {
          throw new EntityNotFoundError("body", download.body.sha256);
        }
      }
      assertNotAborted(context);
      if (this.#closed) throw new OperationAbortedError("Download capabilities are closed");
      return this.#store(download, pin);
    } catch (error) {
      releasePinBestEffort(pin);
      throw error;
    }
  }

  #store(download: DownloadRecord, pin: BlobPinHandlePort | undefined) {
    const expiresAt = this.#now() + this.#ttlMs;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const material = this.#capabilityBytes();
      if (material.byteLength !== 32) throw new TypeError("capabilityBytes must return exactly 32 bytes");
      const capability = Buffer.from(material).toString("base64url");
      const key = capabilityHash(capability);
      if (this.#capabilities.has(key)) continue;
      const ticket = DownloadTicketSchema.parse({
        downloadPath: `${DOWNLOAD_CAPABILITY_BASE_PATH}/${capability}`,
        expiresAt: new Date(expiresAt).toISOString(),
        filename: download.filename,
        mediaType: download.mediaType,
        size: download.size,
      });
      const record = {} as CapabilityRecord;
      record.download = download;
      record.pin = pin;
      record.expiresAt = expiresAt;
      record.timer = setTimeout(() => {
        if (this.#capabilities.get(key) === record) void this.#discard(key, record);
      }, this.#ttlMs);
      record.timer.unref?.();
      this.#capabilities.set(key, record);
      return ticket;
    }
    throw new Error("Could not allocate a unique download capability");
  }

  async open(capability: string, context: OperationContext = {}): Promise<TransferDownload> {
    assertNotAborted(context);
    if (this.#closed) throw new EntityNotFoundError("download", "capability");
    const key = capabilityHash(capability);
    const claimed = this.#capabilities.get(key);
    if (!claimed || claimed.expiresAt <= this.#now()) {
      if (claimed) await this.#discard(key, claimed);
      throw new EntityNotFoundError("download", "capability");
    }

    // Burn before any asynchronous body/file open so concurrent claimers cannot both win.
    this.#capabilities.delete(key);
    clearTimeout(claimed.timer);
    const download = claimed.download;
    if (download.kind === "body") {
      const ticketPin = claimed.pin;
      if (ticketPin) this.#claimingBodyPins.add(ticketPin);
      const signal = context.signal ? AbortSignal.any([context.signal, this.#lifetime.signal]) : this.#lifetime.signal;
      const operation = { ...context, signal };
      let source: ReadableStream<Uint8Array>;
      try {
        // BlobStore.open takes ownership through its own stream-lifetime pin.
        // Keep the ticket pin until that hand-off has completed.
        source = await awaitWithAbort(this.options.blobs.open(download.body, operation), operation, (lateSource) =>
          cancelStreamBestEffort(lateSource, signal.reason),
        );
        if (this.#closed) {
          cancelStreamBestEffort(source, new OperationAbortedError("Download capabilities are closing"));
          throw new EntityNotFoundError("download", "capability");
        }
      } catch (error) {
        if (this.#closed) throw new EntityNotFoundError("download", "capability");
        throw error;
      } finally {
        if (ticketPin) {
          this.#claimingBodyPins.delete(ticketPin);
          releasePinBestEffort(ticketPin);
        }
      }
      const reader = source.getReader();
      let finished = false;
      const active = {} as ActiveBodyDownload;
      const releaseLock = () => {
        try {
          reader.releaseLock();
        } catch {
          // A pending read keeps the lock until cancellation settles. The
          // cancellation observer below retries the release.
        }
      };
      const finish = () => {
        if (finished) return;
        finished = true;
        this.#activeBodyDownloads.delete(active);
        releaseLock();
      };
      const cancel = (reason: unknown): Promise<void> => {
        let cancellation: Promise<void>;
        try {
          cancellation = reader.cancel(reason);
        } catch (error) {
          finish();
          return Promise.reject(error);
        }
        finish();
        void cancellation.then(releaseLock, releaseLock);
        return cancellation;
      };
      active.cancel = cancel;
      active.finish = finish;
      this.#activeBodyDownloads.add(active);
      return {
        ...download,
        stream: new ReadableStream<Uint8Array>({
          async pull(controller) {
            try {
              const chunk = await reader.read();
              if (chunk.done) {
                finish();
                controller.close();
              } else {
                controller.enqueue(chunk.value);
              }
            } catch (error) {
              finish();
              controller.error(error);
            }
          },
          cancel(reason) {
            void cancel(reason).catch(() => undefined);
          },
        }),
      };
    }

    const source = createReadStream(download.filePath);
    this.#activeFileDownloads.set(download.filePath, source);
    const abort = () => source.destroy();
    source.once("close", () => {
      context.signal?.removeEventListener("abort", abort);
      this.#activeFileDownloads.delete(download.filePath);
      void fs.unlink(download.filePath).catch(() => undefined);
    });
    const stream = Readable.toWeb(source) as ReadableStream<Uint8Array>;
    context.signal?.addEventListener("abort", abort, { once: true });
    if (context.signal?.aborted) abort();
    return { ...download, stream };
  }

  close(): Promise<void> {
    if (this.#closePromise) return this.#closePromise;
    this.#closed = true;
    this.#lifetime.abort(new OperationAbortedError("Download capabilities are closing"));
    this.#closePromise = this.#close();
    return this.#closePromise;
  }

  async #close(): Promise<void> {
    const pending = [...this.#capabilities.values()];
    this.#capabilities.clear();
    for (const capability of pending) clearTimeout(capability.timer);
    const claimingBodyPins = [...this.#claimingBodyPins];
    this.#claimingBodyPins.clear();
    const active = [...this.#activeFileDownloads.entries()];
    this.#activeFileDownloads.clear();
    const activeBodies = [...this.#activeBodyDownloads];
    this.#activeBodyDownloads.clear();
    const paths = [
      ...pending
        .map((capability) => capability.download)
        .filter((download): download is FileDownloadRecord => download.kind === "file")
        .map((download) => download.filePath),
      ...active.map(([filePath]) => filePath),
    ];
    const reason = new OperationAbortedError("Download capabilities are closing");
    const operations = [
      ...active.map(([, source]) => cleanupOperation(() => source.destroy())),
      ...activeBodies.map((activeBody) => cleanupOperation(() => activeBody.cancel(reason))),
      ...activeBodies.map((activeBody) => cleanupOperation(() => activeBody.finish())),
      ...[...pending.map((capability) => capability.pin), ...claimingBodyPins]
        .filter((pin): pin is BlobPinHandlePort => pin !== undefined)
        .map((pin) => cleanupOperation(() => pin.release())),
      ...paths.map((filePath) => cleanupOperation(() => fs.unlink(filePath).catch(() => undefined))),
    ];
    const results = await settleCleanupWithin(operations, this.#shutdownTimeoutMs);
    if (!results) {
      throw new Error(`Download capability cleanup did not settle within ${this.#shutdownTimeoutMs}ms`);
    }
    const errors = results
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result) => errorValue(result.reason));
    if (errors.length > 0) throw new AggregateError(errors, "Download capability shutdown failed");
  }

  async #discard(key: string, capability: CapabilityRecord): Promise<void> {
    if (this.#capabilities.get(key) === capability) this.#capabilities.delete(key);
    clearTimeout(capability.timer);
    releasePinBestEffort(capability.pin);
    if (capability.download.kind === "file") {
      await settleCleanupWithin(
        [fs.unlink(capability.download.filePath).catch(() => undefined)],
        this.#shutdownTimeoutMs,
      );
    }
  }
}
