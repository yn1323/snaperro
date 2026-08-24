import { createHash, randomUUID } from "node:crypto";
import { createReadStream, type Dirent, type Stats } from "node:fs";
import fs, { type FileHandle } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { type BodyRef, BodyRefSchema } from "../../../shared/contracts-v2/entities.js";
import { type Sha256, Sha256Schema } from "../../../shared/contracts-v2/primitives.js";
import type {
  BlobPinHandlePort,
  BlobStorePort,
  BlobWriteMetadata,
  BlobWriteSessionPort,
  OperationContext,
  StoreLeaseHandlePort,
} from "../application/ports.js";
import { InvariantViolationError } from "../domain/errors.js";
import { atomicWriteJson, fsyncDirectory } from "./atomic.js";
import { BlobPinRegistry } from "./blob-pin-registry.js";
import { FileReadLimitError, MAX_BLOB_METADATA_BYTES, readFileBounded } from "./bounded-file.js";
import { StoreCorruptionError } from "./errors.js";
import { StoreLayout, throwIfAborted } from "./layout.js";
import type { LeaseOptions } from "./lease.js";
import { FilesystemStoreLease } from "./store-lease.js";

const DEFAULT_PIN_CLEANUP_TIMEOUT_MS = 5_000;

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error ? String(error.code) : undefined;
}

async function lstatIfExists(filePath: string): Promise<Stats | null> {
  try {
    return await fs.lstat(filePath);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return null;
    throw error;
  }
}

async function unlinkIfExists(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error;
  }
}

async function releasePinWithin(pin: BlobPinHandlePort, timeoutMs: number): Promise<void> {
  let cleanup: Promise<void>;
  try {
    cleanup = pin.release().then(
      () => undefined,
      () => undefined,
    );
  } catch {
    // Active pin records expire automatically. A stalled cleanup may retain a
    // blob temporarily, but must not retain a completed read or hide its error.
    return;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      cleanup,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const ABORTED = Symbol("blob operation aborted");

async function awaitWithAbort<Result>(operation: PromiseLike<Result>, context: OperationContext): Promise<Result> {
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
      throwIfAborted(context);
      throw new InvariantViolationError("Aborted blob operation did not expose an aborted signal");
    }
    if (result.status === "rejected") throw result.error;
    return result.value;
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

export async function readBlobMetadata(layout: StoreLayout, sha256: Sha256): Promise<BodyRef> {
  const digest = Sha256Schema.parse(sha256);
  let metadata: unknown;
  try {
    metadata = JSON.parse(
      (await readFileBounded(layout.blobMetadataPath(digest), MAX_BLOB_METADATA_BYTES)).toString("utf8"),
    );
  } catch (error) {
    if (error instanceof FileReadLimitError) {
      throw new StoreCorruptionError(`Blob metadata exceeds the read limit: ${digest}`, error);
    }
    throw new StoreCorruptionError(`Cannot read blob metadata: ${digest}`, error);
  }
  const ref = BodyRefSchema.safeParse(metadata);
  if (!ref.success) throw new StoreCorruptionError(`Blob metadata failed validation: ${digest}`);
  if (ref.data.sha256 !== digest) throw new StoreCorruptionError(`Blob metadata digest mismatch: ${digest}`);
  return ref.data;
}

async function hashFile(
  filePath: string,
  context: OperationContext,
  lease: StoreLeaseHandlePort,
  onProgress?: (bytesRead: number) => Promise<void>,
): Promise<{ sha256: Sha256; size: number }> {
  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of createReadStream(filePath)) {
    throwIfAborted(context);
    await lease.assertOwned();
    const bytes = chunk as Buffer;
    hash.update(bytes);
    size += bytes.byteLength;
    await onProgress?.(size);
    // A slow progress observer must not allow work to continue after another
    // process reclaimed the lease while the integrity check was suspended.
    await lease.assertOwned();
  }
  return { sha256: Sha256Schema.parse(hash.digest("hex")), size };
}

async function writeChunk(handle: FileHandle, chunk: Uint8Array): Promise<void> {
  let offset = 0;
  while (offset < chunk.byteLength) {
    const result = await handle.write(chunk, offset, chunk.byteLength - offset, null);
    if (result.bytesWritten <= 0) throw new StoreCorruptionError("Blob staging write made no progress");
    offset += result.bytesWritten;
  }
}

class FilesystemBlobWriteSession implements BlobWriteSessionPort {
  readonly writable: WritableStream<Uint8Array>;
  private readonly hash = createHash("sha256");
  private handle: FileHandle | null;
  private size = 0;
  private state: "open" | "closed" | "aborted" | "committed" = "open";
  private result?: BodyRef;

  constructor(
    private readonly layout: StoreLayout,
    private readonly tempPath: string,
    handle: FileHandle,
    private readonly metadata: BlobWriteMetadata,
    private readonly storeLease: FilesystemStoreLease,
    private readonly onExistingBlobHashProgress?: (bytesRead: number) => Promise<void>,
  ) {
    this.handle = handle;
    this.writable = new WritableStream<Uint8Array>({
      write: async (chunk) => {
        if (this.state !== "open" || !this.handle) throw new InvariantViolationError("Blob session is not writable");
        if (!(chunk instanceof Uint8Array)) throw new TypeError("Blob chunks must be Uint8Array values");
        await writeChunk(this.handle, chunk);
        this.hash.update(chunk);
        this.size += chunk.byteLength;
        if (!Number.isSafeInteger(this.size)) throw new RangeError("Blob size exceeds the safe integer range");
      },
      close: async () => {
        if (this.state !== "open" || !this.handle) return;
        await this.handle.sync();
        await this.handle.close();
        this.handle = null;
        this.state = "closed";
      },
      abort: async (reason) => {
        await this.abort(reason);
      },
    });
  }

  async commit(context: OperationContext = {}): Promise<BodyRef> {
    if (this.result) return this.result;
    if (this.state !== "closed") throw new InvariantViolationError("Close the blob writable before committing it");
    throwIfAborted(context);

    // Keep the original hash state intact until the whole promotion succeeds,
    // so callers may safely retry a commit interrupted after linking the blob.
    const digest = Sha256Schema.parse(this.hash.copy().digest("hex"));
    const ref = BodyRefSchema.parse({
      sha256: digest,
      size: this.size,
      mediaType: this.metadata.mediaType,
      contentEncoding: this.metadata.contentEncoding,
    });
    const target = this.layout.blobPath(digest);
    const lease = await this.storeLease.acquire(context);
    try {
      throwIfAborted(context);
      await lease.assertOwned();
      await fs.mkdir(path.dirname(target), { recursive: true });
      try {
        await fs.link(this.tempPath, target);
        await fsyncDirectory(path.dirname(target));
      } catch (error) {
        if (errorCode(error) !== "EEXIST") throw error;
        const existing = await hashFile(target, context, lease, this.onExistingBlobHashProgress);
        if (existing.sha256 !== digest || existing.size !== this.size) {
          throw new StoreCorruptionError(`Existing blob failed integrity validation: ${digest}`);
        }
      }

      await lease.assertOwned();
      // Digest-only lookup cannot recover contextual HTTP metadata, so the
      // canonical sidecar intentionally records neutral metadata.
      await atomicWriteJson(this.layout.blobMetadataPath(digest), {
        sha256: digest,
        size: this.size,
        mediaType: null,
        contentEncoding: null,
      });
      await lease.assertOwned();
      const committed = await fs.stat(target).catch((error: unknown) => {
        throw new StoreCorruptionError(`Committed blob is missing: ${digest}`, error);
      });
      if (!committed.isFile() || committed.size !== this.size) {
        throw new StoreCorruptionError(`Committed blob failed integrity validation: ${digest}`);
      }
      await lease.assertOwned();
    } finally {
      await lease.release();
    }
    // Keep the staged source until the lease has released cleanly. If release
    // detects lost ownership, commit remains retryable through the EEXIST path.
    await fs.unlink(this.tempPath).catch(() => undefined);
    this.state = "committed";
    this.result = ref;
    return ref;
  }

  async abort(_reason?: unknown): Promise<void> {
    if (this.state === "aborted" || this.state === "committed") return;
    this.state = "aborted";
    const handle = this.handle;
    this.handle = null;
    await handle?.close().catch(() => undefined);
    await fs.unlink(this.tempPath).catch(() => undefined);
  }
}

export interface FilesystemBlobStoreOptions {
  lease?: LeaseOptions;
  pins?: BlobPinRegistry;
  pendingPinTtlMs?: number;
  activePinTtlMs?: number;
  pinCleanupTimeoutMs?: number;
  now?: () => number;
  /** @internal Deterministic observability hook for long existing-blob checks. */
  onExistingBlobHashProgress?: (bytesRead: number) => Promise<void>;
}

export interface BlobGarbageCollectionOptions {
  minimumAgeMs?: number;
  now?: () => number;
  onProgress?: () => Promise<void>;
  beforeDelete?: () => Promise<void>;
}

export class FilesystemBlobStore implements BlobStorePort {
  private readonly layout: StoreLayout;
  private readonly storeLease: FilesystemStoreLease;
  private readonly onExistingBlobHashProgress?: (bytesRead: number) => Promise<void>;
  private readonly pins: BlobPinRegistry;
  private readonly pinCleanupTimeoutMs: number;

  constructor(root: string | StoreLayout, options: FilesystemBlobStoreOptions = {}) {
    this.layout = typeof root === "string" ? new StoreLayout(root) : root;
    this.storeLease = new FilesystemStoreLease(this.layout, { lease: options.lease });
    this.pinCleanupTimeoutMs = options.pinCleanupTimeoutMs ?? DEFAULT_PIN_CLEANUP_TIMEOUT_MS;
    if (!Number.isSafeInteger(this.pinCleanupTimeoutMs) || this.pinCleanupTimeoutMs < 1) {
      throw new TypeError("pinCleanupTimeoutMs must be a positive safe integer");
    }
    this.pins =
      options.pins ??
      new BlobPinRegistry(this.layout, {
        lease: options.lease,
        pendingTtlMs: options.pendingPinTtlMs,
        activeTtlMs: options.activePinTtlMs,
        now: options.now,
      });
    this.onExistingBlobHashProgress = options.onExistingBlobHashProgress;
  }

  async beginWrite(metadata: BlobWriteMetadata, context: OperationContext = {}): Promise<BlobWriteSessionPort> {
    throwIfAborted(context);
    const validMetadata = BodyRefSchema.pick({ mediaType: true, contentEncoding: true }).parse(metadata);
    await fs.mkdir(this.layout.blobTempRoot, { recursive: true });
    const tempPath = path.join(this.layout.blobTempRoot, `${process.pid}.${randomUUID()}.tmp`);
    const handle = await fs.open(tempPath, "wx", 0o600);
    return new FilesystemBlobWriteSession(
      this.layout,
      tempPath,
      handle,
      validMetadata,
      this.storeLease,
      this.onExistingBlobHashProgress,
    );
  }

  async open(body: BodyRef, context: OperationContext = {}): Promise<ReadableStream<Uint8Array>> {
    throwIfAborted(context);
    const ref = BodyRefSchema.parse(body);
    const pin = await this.pins.pinActive(ref, context);
    const blobPath = this.layout.blobPath(ref.sha256);
    let stat: Awaited<ReturnType<typeof fs.stat>>;
    try {
      stat = await awaitWithAbort(fs.stat(blobPath), context);
    } catch (error) {
      await releasePinWithin(pin, this.pinCleanupTimeoutMs);
      throwIfAborted(context);
      throw new StoreCorruptionError(`Cannot open blob: ${ref.sha256}`, error);
    }
    if (!stat.isFile() || stat.size !== ref.size) {
      await releasePinWithin(pin, this.pinCleanupTimeoutMs);
      throw new StoreCorruptionError(`Blob size does not match its reference: ${ref.sha256}`);
    }

    let source: ReturnType<typeof createReadStream>;
    try {
      // The signal may have changed while stat was pending. Check before
      // allocating a stream, then check once more after listener registration
      // to close the remaining check/register race.
      throwIfAborted(context);
      source = createReadStream(blobPath);
    } catch (error) {
      await releasePinWithin(pin, this.pinCleanupTimeoutMs);
      throw error;
    }
    const abort = () => source.destroy(context.signal?.reason);
    context.signal?.addEventListener("abort", abort, { once: true });
    const removeAbortListener = () => context.signal?.removeEventListener("abort", abort);
    source.once("close", removeAbortListener);
    try {
      throwIfAborted(context);
    } catch (error) {
      removeAbortListener();
      // No web-stream error listener exists yet. Destroy without an error and
      // propagate the already-captured abort through this open call instead.
      source.destroy();
      await releasePinWithin(pin, this.pinCleanupTimeoutMs);
      throw error;
    }
    let reader: ReadableStreamDefaultReader<Uint8Array>;
    try {
      reader = (Readable.toWeb(source) as ReadableStream<Uint8Array>).getReader();
    } catch (error) {
      removeAbortListener();
      source.destroy();
      await releasePinWithin(pin, this.pinCleanupTimeoutMs);
      throw error;
    }
    let finishPromise: Promise<void> | undefined;
    const releaseLock = () => {
      try {
        reader.releaseLock();
      } catch {
        // A pending read retains the lock until cancellation settles. The
        // cancellation observer below retries without retaining the caller.
      }
    };
    const finish = (): Promise<void> => {
      if (finishPromise) return finishPromise;
      removeAbortListener();
      releaseLock();
      finishPromise = releasePinWithin(pin, this.pinCleanupTimeoutMs);
      return finishPromise;
    };
    return new ReadableStream<Uint8Array>({
      pull: async (controller) => {
        try {
          const result = await reader.read();
          if (result.done) {
            await finish();
            controller.close();
          } else {
            controller.enqueue(result.value);
          }
        } catch (error) {
          await finish();
          controller.error(error);
        }
      },
      cancel: (reason) => {
        let cancellation: Promise<void>;
        try {
          cancellation = reader.cancel(reason);
        } catch {
          void finish();
          return;
        }
        void finish();
        void cancellation.then(releaseLock, releaseLock);
      },
    });
  }

  pin(body: BodyRef, context: OperationContext = {}): Promise<BlobPinHandlePort> {
    return this.pins.pinActive(BodyRefSchema.parse(body), context);
  }

  pinMany(bodies: readonly BodyRef[], context: OperationContext = {}): Promise<BlobPinHandlePort> {
    return this.pins.pinActiveMany(
      bodies.map((body) => BodyRefSchema.parse(body)),
      context,
    );
  }

  async openByDigest(
    sha256: Sha256,
    context: OperationContext = {},
  ): Promise<{ ref: BodyRef; stream: ReadableStream<Uint8Array> }> {
    throwIfAborted(context);
    const digest = Sha256Schema.parse(sha256);
    const pin = await this.pins.pinDigest(digest, context);
    try {
      const ref = await readBlobMetadata(this.layout, digest);
      return { ref, stream: await this.open(ref, context) };
    } finally {
      await releasePinWithin(pin, this.pinCleanupTimeoutMs);
    }
  }

  async exists(body: BodyRef, context: OperationContext = {}): Promise<boolean> {
    throwIfAborted(context);
    const ref = BodyRefSchema.parse(body);
    try {
      const stat = await fs.stat(this.layout.blobPath(ref.sha256));
      return stat.isFile() && stat.size === ref.size;
    } catch (error) {
      if (errorCode(error) === "ENOENT") return false;
      throw error;
    }
  }

  async collectGarbage(
    referenced: ReadonlySet<string>,
    context: OperationContext = {},
    options: BlobGarbageCollectionOptions = {},
  ): Promise<number> {
    throwIfAborted(context);
    const minimumAgeMs = options.minimumAgeMs ?? 0;
    if (!Number.isSafeInteger(minimumAgeMs) || minimumAgeMs < 0) {
      throw new RangeError("Blob garbage-collection minimum age must be a non-negative safe integer");
    }
    const now = options.now ?? Date.now;
    const validReferenced = new Set([...referenced].map((digest) => Sha256Schema.parse(digest)));
    let removed = 0;
    let prefixes: Dirent<string>[];
    try {
      prefixes = await fs.readdir(this.layout.blobRoot, { withFileTypes: true });
    } catch (error) {
      if (errorCode(error) === "ENOENT") return 0;
      throw error;
    }
    for (const prefix of prefixes) {
      throwIfAborted(context);
      await options.onProgress?.();
      if (!prefix.isDirectory() || !/^[a-f0-9]{2}$/u.test(prefix.name)) continue;
      const directory = path.join(this.layout.blobRoot, prefix.name);
      for (const [index, entry] of (await fs.readdir(directory, { withFileTypes: true })).entries()) {
        if (index % 100 === 0) await options.onProgress?.();
        const digest = Sha256Schema.safeParse(entry.name);
        if (!entry.isFile()) continue;
        if (!digest.success) {
          const metadataDigest = Sha256Schema.safeParse(entry.name.replace(/\.meta\.json$/u, ""));
          if (
            !entry.name.endsWith(".meta.json") ||
            !metadataDigest.success ||
            validReferenced.has(metadataDigest.data)
          ) {
            continue;
          }
          const dataPath = path.join(directory, metadataDigest.data);
          const dataExists = (await lstatIfExists(dataPath)) !== null;
          const metadataPath = path.join(directory, entry.name);
          const metadataStat = await lstatIfExists(metadataPath);
          if (
            dataExists ||
            !metadataStat?.isFile() ||
            (minimumAgeMs > 0 && now() - metadataStat.mtimeMs < minimumAgeMs)
          ) {
            continue;
          }
          await options.beforeDelete?.();
          await unlinkIfExists(metadataPath);
          continue;
        }
        if (validReferenced.has(digest.data)) continue;

        const blobPath = path.join(directory, entry.name);
        const metadataPath = `${blobPath}.meta.json`;
        const [blobStat, metadataStat] = await Promise.all([lstatIfExists(blobPath), lstatIfExists(metadataPath)]);
        if (!blobStat?.isFile()) continue;
        const newestWrite = Math.max(blobStat.mtimeMs, metadataStat?.isFile() ? metadataStat.mtimeMs : 0);
        if (minimumAgeMs > 0 && now() - newestWrite < minimumAgeMs) continue;

        await options.beforeDelete?.();
        await unlinkIfExists(blobPath);
        await options.beforeDelete?.();
        await unlinkIfExists(metadataPath);
        removed += 1;
      }
    }
    return removed;
  }
}

export async function writeBlobBytes(
  store: BlobStorePort,
  bytes: Uint8Array,
  metadata: BlobWriteMetadata,
  context: OperationContext = {},
): Promise<BodyRef> {
  const session = await store.beginWrite(metadata, context);
  try {
    const writer = session.writable.getWriter();
    await writer.write(bytes);
    await writer.close();
    return await session.commit(context);
  } catch (error) {
    await session.abort(error);
    throw error;
  }
}
