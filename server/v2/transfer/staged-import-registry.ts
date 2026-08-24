import { createHash } from "node:crypto";
import fs, { type FileHandle } from "node:fs/promises";
import path from "node:path";
import type { TransferId } from "../../../shared/contracts-v2/primitives.js";
import type { IdGeneratorPort, OperationContext } from "../application/ports.js";
import { EntityNotFoundError, OperationAbortedError, PayloadLimitExceededError } from "../domain/errors.js";
import type { Archive, ArchiveCodec, ImportKind } from "./archive-codec.js";
import type { FolderArchive, RecordingArchive } from "./archive-format.js";

const DEFAULT_IMPORT_TTL_MS = 5 * 60_000;
const DEFAULT_MAX_PENDING_IMPORTS = 16;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 5_000;
const ORPHANED_TRANSFER = /^xfer_[A-Za-z0-9_-]{16,128}\.(?:partial|zip|(?:folder|recording)\.import\.zip)$/u;

type ImportRecord =
  | {
      kind: "folder";
      filePath: string;
      archive: FolderArchive;
      materialized: boolean;
      size: number;
      timer: ReturnType<typeof setTimeout>;
      claimId?: string;
    }
  | {
      kind: "recording";
      filePath: string;
      archive: RecordingArchive;
      materialized: boolean;
      size: number;
      timer: ReturnType<typeof setTimeout>;
      claimId?: string;
    };

interface OrphanRecord {
  size: number;
  timer: ReturnType<typeof setTimeout>;
}

interface ActiveUpload {
  filePath: string;
  reader: ReadableStreamDefaultReader<Uint8Array>;
  handle?: FileHandle;
  done: Promise<void>;
  resolveDone: () => void;
}

type StreamReadResult = Awaited<ReturnType<ReadableStreamDefaultReader<Uint8Array>["read"]>>;

export interface StagedImportRegistryOptions {
  directory: string;
  maxUploadBytes: number;
  codec: ArchiveCodec;
  ids: IdGeneratorPort;
  ttlMs?: number;
  shutdownTimeoutMs?: number;
  maxPendingImports?: number;
  maxPendingBytes?: number;
}

function assertNotAborted(context?: OperationContext): void {
  if (context?.signal?.aborted) throw new OperationAbortedError(undefined, context.signal.reason);
}

async function writeAll(handle: FileHandle, chunk: Uint8Array, signal: AbortSignal): Promise<void> {
  let offset = 0;
  while (offset < chunk.byteLength) {
    const { bytesWritten } = await awaitWithAbort(handle.write(chunk, offset, chunk.byteLength - offset), signal);
    if (bytesWritten === 0) throw new Error("Could not make progress while writing a transfer");
    offset += bytesWritten;
  }
}

async function settlesWithin(promise: Promise<unknown>, timeoutMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const settled = promise.then(
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

function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>, reason: unknown): Promise<void> {
  try {
    return reader.cancel(reason).catch(() => undefined);
  } catch {
    return Promise.resolve();
  }
}

function closeHandle(handle: FileHandle | undefined): Promise<void> {
  if (!handle) return Promise.resolve();
  try {
    return handle.close().catch(() => undefined);
  } catch {
    return Promise.resolve();
  }
}

function releaseReaderLock(reader: ReadableStreamDefaultReader<Uint8Array>): void {
  try {
    reader.releaseLock();
  } catch {
    // An aborted read can retain the lock until the underlying source settles.
  }
}

function aborted(signal: AbortSignal): OperationAbortedError {
  return signal.reason instanceof OperationAbortedError
    ? signal.reason
    : new OperationAbortedError(undefined, signal.reason);
}

async function readWithAbort(reading: Promise<StreamReadResult>, signal: AbortSignal): Promise<StreamReadResult> {
  if (signal.aborted) throw aborted(signal);
  let onAbort: (() => void) | undefined;
  const cancellation = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(aborted(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
  try {
    return await Promise.race([reading, cancellation]);
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}

const ABORTED = Symbol("import staging operation aborted");

async function awaitWithAbort<Result>(
  operation: PromiseLike<Result>,
  signal: AbortSignal,
  disposeLateResult?: (result: Result) => void,
): Promise<Result> {
  const observed = Promise.resolve(operation).then(
    (value) => ({ status: "fulfilled" as const, value }),
    (error: unknown) => ({ status: "rejected" as const, error }),
  );
  let resolveAborted: (value: typeof ABORTED) => void = () => undefined;
  const cancellation = new Promise<typeof ABORTED>((resolve) => {
    resolveAborted = resolve;
  });
  const onAbort = () => resolveAborted(ABORTED);
  signal.addEventListener("abort", onAbort, { once: true });
  if (signal.aborted) onAbort();
  try {
    const result = await Promise.race([observed, cancellation]);
    if (result === ABORTED) {
      if (disposeLateResult) {
        void observed.then((late) => {
          if (late.status === "fulfilled") disposeLateResult(late.value);
        });
      }
      throw aborted(signal);
    }
    if (result.status === "rejected") throw result.error;
    return result.value;
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

function cleanupUpload(upload: ActiveUpload, reason: unknown): Promise<PromiseSettledResult<void>[]> {
  const cancellation = cancelReader(upload.reader, reason);
  const closing = closeHandle(upload.handle);
  // Unlink immediately where the platform permits it, then retry after the
  // handle closes for platforms that reject deletion of an open file.
  const unlinking = fs.unlink(upload.filePath).catch(() => undefined);
  const retryingUnlink = closing.then(() => fs.unlink(upload.filePath).catch(() => undefined));
  return Promise.allSettled([cancellation, closing, unlinking, retryingUnlink]);
}

export class StagedImportRegistry {
  readonly #ttlMs: number;
  readonly #orphanGraceMs: number;
  readonly #shutdownTimeoutMs: number;
  readonly #maxPendingImports: number;
  readonly #maxPendingBytes: number;
  readonly #imports = new Map<TransferId, ImportRecord>();
  readonly #orphans = new Map<string, OrphanRecord>();
  readonly #active = new Set<ActiveUpload>();
  readonly #lifetime = new AbortController();
  readonly #initialize: Promise<void>;
  #activeUploads = 0;
  #uploadBytes = 0;
  #storedBytes = 0;
  #orphanBytes = 0;
  #closed = false;
  #closePromise: Promise<void> | undefined;

  constructor(private readonly options: StagedImportRegistryOptions) {
    this.#ttlMs = options.ttlMs ?? DEFAULT_IMPORT_TTL_MS;
    this.#orphanGraceMs = Math.max(this.#ttlMs, 60_000);
    this.#shutdownTimeoutMs = options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;
    this.#maxPendingImports = options.maxPendingImports ?? DEFAULT_MAX_PENDING_IMPORTS;
    this.#maxPendingBytes = options.maxPendingBytes ?? Math.min(Number.MAX_SAFE_INTEGER, options.maxUploadBytes * 2);
    if (
      ![this.#ttlMs, this.#shutdownTimeoutMs, this.#maxPendingImports, this.#maxPendingBytes].every(
        (value) => Number.isSafeInteger(value) && value > 0,
      )
    ) {
      throw new TypeError("Import staging limits must be positive safe integers");
    }
    this.#initialize = this.#cleanOrphans();
  }

  async ready(context: OperationContext = {}): Promise<void> {
    const signal = context.signal ? AbortSignal.any([context.signal, this.#lifetime.signal]) : this.#lifetime.signal;
    await awaitWithAbort(this.#initialize, signal);
  }

  async stage(
    kind: "folder",
    stream: ReadableStream<Uint8Array>,
    context: OperationContext,
  ): Promise<{ transferId: TransferId; archive: FolderArchive; size: number; sha256: string }>;
  async stage(
    kind: "recording",
    stream: ReadableStream<Uint8Array>,
    context: OperationContext,
  ): Promise<{ transferId: TransferId; archive: RecordingArchive; size: number; sha256: string }>;
  async stage(
    kind: ImportKind,
    stream: ReadableStream<Uint8Array>,
    context: OperationContext,
  ): Promise<{ transferId: TransferId; archive: Archive; size: number; sha256: string }> {
    const signal = context.signal ? AbortSignal.any([context.signal, this.#lifetime.signal]) : this.#lifetime.signal;
    await awaitWithAbort(this.#initialize, signal);
    if (this.#closed) throw new OperationAbortedError("Import staging is closed");
    assertNotAborted({ signal });
    const pendingCount = this.#imports.size + this.#orphans.size + this.#activeUploads;
    if (pendingCount >= this.#maxPendingImports) {
      throw new PayloadLimitExceededError(this.#maxPendingImports, pendingCount + 1);
    }
    this.#activeUploads += 1;
    const transferId = this.options.ids.nextTransferId();
    const filePath = path.join(this.options.directory, `${transferId}.${kind}.import.zip`);
    const reader = stream.getReader();
    let resolveDone: () => void = () => undefined;
    const active: ActiveUpload = {
      filePath,
      reader,
      done: new Promise((resolve) => {
        resolveDone = resolve;
      }),
      resolveDone: () => resolveDone(),
    };
    this.#active.add(active);
    const hash = createHash("sha256");
    let handle: FileHandle | undefined;
    let pendingRead: Promise<StreamReadResult> | undefined;
    let size = 0;
    try {
      handle = await awaitWithAbort(fs.open(filePath, "wx", 0o600), signal, (lateHandle) => {
        void closeHandle(lateHandle);
        void fs.unlink(filePath).catch(() => undefined);
      });
      active.handle = handle;
      while (true) {
        assertNotAborted({ signal });
        const reading = reader.read();
        pendingRead = reading;
        void reading.then(
          () => {
            if (pendingRead === reading) pendingRead = undefined;
          },
          () => {
            if (pendingRead === reading) pendingRead = undefined;
          },
        );
        const { done, value } = await readWithAbort(reading, signal);
        assertNotAborted({ signal });
        if (done) break;
        const nextSize = size + value.byteLength;
        if (nextSize > this.options.maxUploadBytes) {
          throw new PayloadLimitExceededError(this.options.maxUploadBytes, nextSize);
        }
        const aggregateSize = this.#storedBytes + this.#orphanBytes + this.#uploadBytes + value.byteLength;
        if (aggregateSize > this.#maxPendingBytes) {
          throw new PayloadLimitExceededError(this.#maxPendingBytes, aggregateSize);
        }
        size = nextSize;
        this.#uploadBytes += value.byteLength;
        hash.update(value);
        await writeAll(handle, value, signal);
      }
      await awaitWithAbort(handle.sync(), signal);
      await awaitWithAbort(handle.close(), signal);
      handle = undefined;
      active.handle = undefined;
      const archive =
        kind === "folder"
          ? await this.options.codec.inspect(filePath, "folder", { ...context, signal })
          : await this.options.codec.inspect(filePath, "recording", { ...context, signal });
      assertNotAborted({ signal });
      const record = {} as ImportRecord;
      Object.assign(record, { kind, filePath, archive, materialized: false, size });
      record.timer = setTimeout(() => void this.#discard(transferId, record), this.#ttlMs);
      record.timer.unref?.();
      this.#imports.set(transferId, record);
      this.#storedBytes += size;
      return { transferId, archive, size, sha256: hash.digest("hex") };
    } catch (error) {
      await settlesWithin(cleanupUpload(active, error), this.#shutdownTimeoutMs);
      throw error;
    } finally {
      this.#activeUploads -= 1;
      this.#uploadBytes -= size;
      this.#active.delete(active);
      active.resolveDone();
      const lateRead = pendingRead;
      releaseReaderLock(reader);
      if (lateRead) {
        void lateRead.then(
          () => releaseReaderLock(reader),
          () => releaseReaderLock(reader),
        );
      }
    }
  }

  get<Kind extends ImportKind>(
    transferId: TransferId,
    kind: Kind,
    context: OperationContext,
  ): Extract<ImportRecord, { kind: Kind }> {
    assertNotAborted(context);
    const staged = this.#imports.get(transferId);
    if (!staged || staged.kind !== kind || staged.claimId !== undefined) {
      throw new EntityNotFoundError(`${kind} import`, transferId);
    }
    this.#touch(transferId, staged);
    return staged as Extract<ImportRecord, { kind: Kind }>;
  }

  claim<Kind extends ImportKind>(
    transferId: TransferId,
    kind: Kind,
    claimId: string,
    context: OperationContext,
  ): Extract<ImportRecord, { kind: Kind }> {
    const staged = this.get(transferId, kind, context);
    clearTimeout(staged.timer);
    staged.claimId = claimId;
    return staged as Extract<ImportRecord, { kind: Kind }>;
  }

  async materialize(
    transferId: TransferId,
    kind: ImportKind,
    claimId: string,
    context: OperationContext,
  ): Promise<void> {
    const staged = this.#owned(transferId, kind, claimId, context);
    if (staged.materialized) return;
    await this.options.codec.materialize(staged.filePath, staged.archive, context);
    staged.materialized = true;
  }

  async complete(transferId: TransferId, kind: ImportKind, claimId: string): Promise<void> {
    const staged = this.#owned(transferId, kind, claimId, {});
    await this.#discard(transferId, staged);
  }

  release(transferId: TransferId, kind: ImportKind, claimId: string): void {
    const staged = this.#owned(transferId, kind, claimId, {});
    staged.claimId = undefined;
    this.#touch(transferId, staged);
  }

  close(): Promise<void> {
    if (this.#closePromise) return this.#closePromise;
    this.#closed = true;
    this.#lifetime.abort(new OperationAbortedError("Import staging is closing"));
    this.#closePromise = this.#close();
    return this.#closePromise;
  }

  async #close(): Promise<void> {
    // Initialization participates in the same deadline. If it settles late,
    // #cleanOrphans observes #closed and removes files instead of registering
    // new timers after shutdown.
    const initialization = this.#initialize.catch(() => undefined);
    const active = [...this.#active];
    const staged = [...this.#imports.entries()];
    this.#imports.clear();
    this.#storedBytes = 0;
    const orphans = [...this.#orphans.entries()];
    this.#orphans.clear();
    this.#orphanBytes = 0;
    for (const [, record] of staged) clearTimeout(record.timer);
    for (const [, record] of orphans) clearTimeout(record.timer);
    const cleanupSettled = await settlesWithin(
      Promise.allSettled([
        initialization,
        ...active.map((upload) => cleanupUpload(upload, this.#lifetime.signal.reason)),
        ...active.map((upload) => upload.done),
        ...staged.map(([, record]) => fs.unlink(record.filePath).catch(() => undefined)),
        ...orphans.map(([filePath]) => fs.unlink(filePath).catch(() => undefined)),
      ]),
      this.#shutdownTimeoutMs,
    );
    if (!cleanupSettled) {
      throw new Error(`Import staging cleanup did not settle within ${this.#shutdownTimeoutMs}ms`);
    }
  }

  async #cleanOrphans(): Promise<void> {
    await fs.mkdir(this.options.directory, { recursive: true });
    const entries = await fs.readdir(this.options.directory, { withFileTypes: true });
    const now = Date.now();
    await Promise.all(
      entries
        .filter((entry) => entry.isFile() && ORPHANED_TRANSFER.test(entry.name))
        .map(async (entry) => {
          const filePath = path.join(this.options.directory, entry.name);
          const stat = await fs.stat(filePath).catch(() => undefined);
          if (!stat?.isFile()) return;
          const remainingMs = this.#orphanGraceMs - (now - stat.mtimeMs);
          if (remainingMs <= 0) {
            await fs.unlink(filePath).catch(() => undefined);
            return;
          }
          const orphan = {} as OrphanRecord;
          orphan.size = stat.size;
          if (this.#closed) {
            await fs.unlink(filePath).catch(() => undefined);
            return;
          }
          orphan.timer = setTimeout(() => void this.#discardOrphan(filePath, orphan), remainingMs + 1);
          orphan.timer.unref?.();
          this.#orphans.set(filePath, orphan);
          this.#orphanBytes += stat.size;
        }),
    );
  }

  async #discard(transferId: TransferId, staged: ImportRecord): Promise<void> {
    if (this.#imports.get(transferId) !== staged) return;
    this.#imports.delete(transferId);
    this.#storedBytes -= staged.size;
    clearTimeout(staged.timer);
    await settlesWithin(
      fs.unlink(staged.filePath).catch(() => undefined),
      this.#shutdownTimeoutMs,
    );
  }

  async #discardOrphan(filePath: string, orphan: OrphanRecord): Promise<void> {
    if (this.#orphans.get(filePath) !== orphan) return;
    const stat = await fs.stat(filePath).catch(() => undefined);
    if (stat?.isFile()) {
      const remainingMs = this.#orphanGraceMs - (Date.now() - stat.mtimeMs);
      if (remainingMs > 0) {
        this.#orphanBytes += stat.size - orphan.size;
        orphan.size = stat.size;
        orphan.timer = setTimeout(() => void this.#discardOrphan(filePath, orphan), remainingMs + 1);
        orphan.timer.unref?.();
        return;
      }
    }
    this.#orphans.delete(filePath);
    this.#orphanBytes -= orphan.size;
    clearTimeout(orphan.timer);
    await settlesWithin(
      fs.unlink(filePath).catch(() => undefined),
      this.#shutdownTimeoutMs,
    );
  }

  #owned(transferId: TransferId, kind: ImportKind, claimId: string, context: OperationContext): ImportRecord {
    assertNotAborted(context);
    const staged = this.#imports.get(transferId);
    if (!staged || staged.kind !== kind || staged.claimId !== claimId) {
      throw new EntityNotFoundError(`${kind} import`, transferId);
    }
    return staged;
  }

  #touch(transferId: TransferId, staged: ImportRecord): void {
    if (staged.claimId !== undefined) return;
    clearTimeout(staged.timer);
    staged.timer = setTimeout(() => void this.#discard(transferId, staged), this.#ttlMs);
    staged.timer.unref?.();
  }
}
