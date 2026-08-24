import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import fs, { type FileHandle } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import archiver from "archiver";
import unzipper, { type File as ZipEntry } from "unzipper";
import { type BodyRef, MAX_CATALOG_SCENARIOS, MAX_SCENARIO_RECORDINGS } from "../../../shared/contracts-v2/entities.js";
import { type Sha256, Sha256Schema } from "../../../shared/contracts-v2/primitives.js";
import type { BlobStorePort, OperationContext } from "../application/ports.js";
import {
  AggregateLimitExceededError,
  InvalidArgumentError,
  isDomainError,
  OperationAbortedError,
  PayloadLimitExceededError,
} from "../domain/errors.js";
import {
  type FolderArchive,
  FolderArchiveSchema,
  type RecordingArchive,
  RecordingArchiveSchema,
} from "./archive-format.js";

export const FOLDER_MANIFEST_ENTRY = "snaperro-folder.json";
export const RECORDING_MANIFEST_ENTRY = "snaperro-recording.json";
const BLOB_ENTRY = /^blobs\/([a-f0-9]{64})$/u;
export const MAX_MANIFEST_BYTES = 16 * 1024 * 1024;
export const MAX_ARCHIVE_ENTRIES = 100_000;
export const MAX_CENTRAL_DIRECTORY_BYTES = 16 * 1024 * 1024;
const DEFAULT_CLEANUP_TIMEOUT_MS = 5_000;
const ZIP_END_SIGNATURE = 0x0605_4b50;
const ZIP64_END_SIGNATURE = 0x0606_4b50;
const ZIP64_LOCATOR_SIGNATURE = 0x0706_4b50;
const ZIP_END_MIN_BYTES = 22;
const ZIP_MAX_COMMENT_BYTES = 0xffff;

export type Archive = FolderArchive | RecordingArchive;
export type ImportKind = "folder" | "recording";

function assertNotAborted(context?: OperationContext): void {
  if (context?.signal?.aborted) throw new OperationAbortedError(undefined, context.signal.reason);
}

function assertFolderAggregateCounts(value: unknown): void {
  if (!value || typeof value !== "object" || !("scenarios" in value) || !Array.isArray(value.scenarios)) return;
  if (value.scenarios.length > MAX_CATALOG_SCENARIOS) {
    throw new AggregateLimitExceededError("folder archive scenarios", MAX_CATALOG_SCENARIOS, value.scenarios.length);
  }
  for (const scenario of value.scenarios) {
    if (!scenario || typeof scenario !== "object" || !("recordings" in scenario) || !Array.isArray(scenario.recordings))
      continue;
    if (scenario.recordings.length > MAX_SCENARIO_RECORDINGS) {
      throw new AggregateLimitExceededError(
        "scenario manifest recordings",
        MAX_SCENARIO_RECORDINGS,
        scenario.recordings.length,
      );
    }
  }
}

function bodyRefs(archive: Archive): BodyRef[] {
  const recordings =
    archive.format === "snaperro-folder"
      ? archive.scenarios.flatMap((scenario) => scenario.recordings.map((item) => item.recording))
      : [archive.recording];
  return recordings.flatMap((recording) =>
    [recording.request.body, recording.response.body].filter((body): body is BodyRef => body !== null),
  );
}

export function uniqueBodyRefs(archive: Archive): Map<Sha256, BodyRef> {
  const refs = new Map<Sha256, BodyRef>();
  for (const ref of bodyRefs(archive)) {
    const previous = refs.get(ref.sha256);
    if (previous && previous.size !== ref.size) {
      throw new InvalidArgumentError("A body digest has conflicting sizes in the archive", { digest: ref.sha256 });
    }
    refs.set(ref.sha256, ref);
  }
  return refs;
}

function safeZipEntryPath(entryPath: string): boolean {
  if (!entryPath || entryPath.includes("\0") || entryPath.includes("\\") || entryPath.startsWith("/")) return false;
  return !entryPath.split("/").some((segment) => !segment || segment === "." || segment === "..");
}

function assertExpandedLimit(manifestSize: number, refs: Map<Sha256, BodyRef>, limit: number): void {
  let expandedSize = manifestSize;
  for (const ref of refs.values()) {
    expandedSize += ref.size;
    if (!Number.isSafeInteger(expandedSize) || expandedSize > limit) {
      throw new PayloadLimitExceededError(limit, expandedSize);
    }
  }
}

async function readExact(
  handle: FileHandle,
  length: number,
  position: number,
  context: OperationContext,
): Promise<Buffer> {
  if (!Number.isSafeInteger(position) || position < 0)
    throw new InvalidArgumentError("ZIP directory offset is invalid");
  const bytes = Buffer.alloc(length);
  let received = 0;
  while (received < length) {
    const result = await awaitWithAbort(handle.read(bytes, received, length - received, position + received), context);
    if (result.bytesRead === 0) throw new InvalidArgumentError("ZIP directory is truncated");
    received += result.bytesRead;
  }
  return bytes;
}

function safeZipCount(value: bigint): number {
  return Number(value > BigInt(Number.MAX_SAFE_INTEGER) ? BigInt(Number.MAX_SAFE_INTEGER) : value);
}

function cleanupOperation(operation: () => Promise<unknown> | unknown): Promise<void> {
  try {
    return Promise.resolve(operation()).then(
      () => undefined,
      () => undefined,
    );
  } catch {
    // Preserve the terminal import error when cleanup is non-conforming.
    return Promise.resolve();
  }
}

function observeCleanup(operation: () => Promise<unknown> | unknown): void {
  void cleanupOperation(operation);
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

type Observed<Result> = { status: "fulfilled"; value: Result } | { status: "rejected"; error: unknown };
const ABORTED = Symbol("archive operation aborted");

async function awaitWithAbort<Result>(
  operation: PromiseLike<Result> | Result,
  context: OperationContext,
  disposeLateResult?: (result: Result) => Promise<unknown> | unknown,
): Promise<Result> {
  const observed: Promise<Observed<Result>> = Promise.resolve(operation).then(
    (value) => ({ status: "fulfilled", value }),
    (error: unknown) => ({ status: "rejected", error }),
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
        if (late.status === "fulfilled") observeCleanup(() => disposeLateResult(late.value));
      });
    }
    throw new OperationAbortedError(undefined, signal.reason);
  }

  let resolveAborted: (result: typeof ABORTED) => void = () => undefined;
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

function releaseReaderLock(reader: ReadableStreamDefaultReader<Uint8Array> | undefined): void {
  if (!reader) return;
  try {
    reader.releaseLock();
  } catch {
    // An aborted read may remain pending in a non-conforming source.
  }
}

function releaseWriterLock(writer: WritableStreamDefaultWriter<Uint8Array> | undefined): void {
  if (!writer) return;
  try {
    writer.releaseLock();
  } catch {
    // An aborted write may remain pending in a non-conforming destination.
  }
}

/** Rejects a ZIP64 entry-count bomb before unzipper allocates one object per entry. */
async function assertZipEntryCount(
  filePath: string,
  context: OperationContext,
  cleanupTimeoutMs: number,
): Promise<void> {
  const handle = await awaitWithAbort(fs.open(filePath, "r"), context, (lateHandle) => lateHandle.close());
  try {
    const stat = await awaitWithAbort(handle.stat(), context);
    if (!stat.isFile() || stat.size < ZIP_END_MIN_BYTES) {
      throw new InvalidArgumentError("The uploaded file is not a readable ZIP archive");
    }
    const tailLength = Math.min(stat.size, ZIP_END_MIN_BYTES + ZIP_MAX_COMMENT_BYTES);
    const tailStart = stat.size - tailLength;
    const tail = await readExact(handle, tailLength, tailStart, context);
    let endOffset = -1;
    for (let offset = tail.length - ZIP_END_MIN_BYTES; offset >= 0; offset -= 1) {
      if (tail.readUInt32LE(offset) !== ZIP_END_SIGNATURE) continue;
      const commentLength = tail.readUInt16LE(offset + 20);
      if (offset + ZIP_END_MIN_BYTES + commentLength === tail.length) {
        endOffset = offset;
        break;
      }
    }
    if (endOffset < 0) throw new InvalidArgumentError("The uploaded file is not a readable ZIP archive");

    const disk = tail.readUInt16LE(endOffset + 4);
    const directoryDisk = tail.readUInt16LE(endOffset + 6);
    const entriesOnDisk = tail.readUInt16LE(endOffset + 8);
    const totalEntries = tail.readUInt16LE(endOffset + 10);
    let directorySize = BigInt(tail.readUInt32LE(endOffset + 12));
    let directoryOffset = BigInt(tail.readUInt32LE(endOffset + 16));
    if (disk !== 0 || directoryDisk !== 0 || entriesOnDisk !== totalEntries) {
      throw new InvalidArgumentError("Multi-disk ZIP archives are not supported");
    }

    const endAbsoluteOffset = tailStart + endOffset;
    const locatorOffset = endAbsoluteOffset - 20;
    let zip64Entries: bigint | undefined;
    let directoryEnd = BigInt(endAbsoluteOffset);
    if (locatorOffset >= 0) {
      const locator = await readExact(handle, 20, locatorOffset, context);
      if (locator.readUInt32LE(0) === ZIP64_LOCATOR_SIGNATURE) {
        if (locator.readUInt32LE(4) !== 0 || locator.readUInt32LE(16) !== 1) {
          throw new InvalidArgumentError("Multi-disk ZIP archives are not supported");
        }
        const zip64Offset = locator.readBigUInt64LE(8);
        if (zip64Offset > BigInt(Number.MAX_SAFE_INTEGER)) {
          throw new InvalidArgumentError("ZIP64 directory offset is invalid");
        }
        const zip64End = await readExact(handle, 56, Number(zip64Offset), context);
        if (zip64End.readUInt32LE(0) !== ZIP64_END_SIGNATURE || zip64End.readBigUInt64LE(4) < 44n) {
          throw new InvalidArgumentError("ZIP64 directory is invalid");
        }
        const zip64Disk = zip64End.readUInt32LE(16);
        const zip64DirectoryDisk = zip64End.readUInt32LE(20);
        const zip64EntriesOnDisk = zip64End.readBigUInt64LE(24);
        zip64Entries = zip64End.readBigUInt64LE(32);
        directorySize = zip64End.readBigUInt64LE(40);
        directoryOffset = zip64End.readBigUInt64LE(48);
        directoryEnd = zip64Offset;
        if (zip64Disk !== 0 || zip64DirectoryDisk !== 0 || zip64EntriesOnDisk !== zip64Entries) {
          throw new InvalidArgumentError("Multi-disk ZIP archives are not supported");
        }
      }
    }

    const zip64Required =
      totalEntries === 0xffff ||
      entriesOnDisk === 0xffff ||
      directorySize === 0xffff_ffffn ||
      directoryOffset === 0xffff_ffffn;
    if (zip64Required && zip64Entries === undefined) {
      throw new InvalidArgumentError("ZIP64 directory metadata is missing");
    }

    const observedEntries = zip64Entries ?? BigInt(totalEntries);
    if (observedEntries > BigInt(MAX_ARCHIVE_ENTRIES)) {
      throw new PayloadLimitExceededError(MAX_ARCHIVE_ENTRIES, safeZipCount(observedEntries));
    }
    if (directorySize > BigInt(MAX_CENTRAL_DIRECTORY_BYTES)) {
      throw new PayloadLimitExceededError(MAX_CENTRAL_DIRECTORY_BYTES, safeZipCount(directorySize));
    }
    if (directoryOffset + directorySize !== directoryEnd) {
      throw new InvalidArgumentError("ZIP central directory bounds are invalid");
    }
  } finally {
    await settlesWithin(
      cleanupOperation(() => handle.close()),
      cleanupTimeoutMs,
    );
  }
}

async function readZipEntryLimited(entry: ZipEntry, limit: number, context: OperationContext): Promise<Buffer> {
  const reader = (Readable.toWeb(entry.stream()) as ReadableStream<Uint8Array>).getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    while (true) {
      const { done, value } = await awaitWithAbort(reader.read(), context);
      if (done) break;
      received += value.byteLength;
      if (received > limit) throw new PayloadLimitExceededError(limit, received);
      chunks.push(value);
    }
    return Buffer.concat(chunks, received);
  } catch (error) {
    observeCleanup(() => reader.cancel(error));
    throw error;
  } finally {
    releaseReaderLock(reader);
  }
}

function entryCompleted(archive: archiver.Archiver): Promise<void> {
  return new Promise((resolve, reject) => {
    const onEntry = () => {
      cleanup();
      resolve();
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      archive.off("entry", onEntry);
      archive.off("error", onError);
    };
    archive.once("entry", onEntry);
    archive.once("error", onError);
  });
}

export class ArchiveCodec {
  constructor(
    private readonly blobs: BlobStorePort,
    private readonly maxExpandedBytes: number,
    private readonly maxArchiveBytes: number = maxExpandedBytes,
    private readonly cleanupTimeoutMs: number = DEFAULT_CLEANUP_TIMEOUT_MS,
  ) {
    if (!Number.isSafeInteger(cleanupTimeoutMs) || cleanupTimeoutMs < 1) {
      throw new TypeError("cleanupTimeoutMs must be a positive safe integer");
    }
  }

  async write(
    partialPath: string,
    filePath: string,
    manifestEntry: string,
    archive: Archive,
    context: OperationContext,
  ): Promise<number> {
    assertNotAborted(context);
    const manifest = Buffer.from(`${JSON.stringify(archive)}\n`);
    if (manifest.byteLength > MAX_MANIFEST_BYTES) {
      throw new PayloadLimitExceededError(MAX_MANIFEST_BYTES, manifest.byteLength);
    }
    const refs = uniqueBodyRefs(archive);
    if (refs.size + 1 > MAX_ARCHIVE_ENTRIES) throw new PayloadLimitExceededError(MAX_ARCHIVE_ENTRIES, refs.size + 1);
    assertExpandedLimit(manifest.byteLength, refs, this.maxExpandedBytes);

    const zip = archiver("zip", { zlib: { level: 6 } });
    const output = createWriteStream(partialPath, { flags: "wx", mode: 0o600 });
    const completed = pipeline(zip, output);
    // Observe immediately because the pipeline can fail while entry completion
    // or an external blob open is still pending.
    void completed.catch(() => undefined);
    let activeBlobStream: ReadableStream<Uint8Array> | undefined;
    let activeBlobNodeStream: Readable | undefined;
    const onAbort = () => {
      try {
        activeBlobNodeStream?.destroy();
      } catch {
        // Continue closing the archive even for a non-conforming adapter.
      }
      if (activeBlobStream) observeCleanup(() => activeBlobStream?.cancel(context.signal?.reason));
      try {
        zip.abort();
      } catch {
        // The operation-level abort remains authoritative.
      }
      try {
        output.destroy();
      } catch {
        // Continue the remaining cleanup even for a non-conforming stream.
      }
    };
    context.signal?.addEventListener("abort", onAbort, { once: true });
    if (context.signal?.aborted) onAbort();
    try {
      let entry = entryCompleted(zip);
      zip.append(manifest, { name: manifestEntry });
      await awaitWithAbort(entry, context);
      for (const [digest, ref] of refs) {
        assertNotAborted(context);
        entry = entryCompleted(zip);
        const stream = await awaitWithAbort(this.blobs.open(ref, context), context, (lateStream) =>
          lateStream.cancel(context.signal?.reason),
        );
        activeBlobStream = stream;
        activeBlobNodeStream = Readable.fromWeb(stream as never);
        zip.append(activeBlobNodeStream, { name: `blobs/${digest}`, store: true });
        await awaitWithAbort(entry, context);
        activeBlobStream = undefined;
        activeBlobNodeStream = undefined;
      }
      await awaitWithAbort(zip.finalize(), context);
      await awaitWithAbort(completed, context);
      const archiveSize = (await awaitWithAbort(fs.stat(partialPath), context)).size;
      if (archiveSize > this.maxArchiveBytes) {
        throw new PayloadLimitExceededError(this.maxArchiveBytes, archiveSize);
      }
      assertNotAborted(context);
      await awaitWithAbort(fs.rename(partialPath, filePath), context, () =>
        Promise.all([cleanupOperation(() => fs.unlink(partialPath)), cleanupOperation(() => fs.unlink(filePath))]),
      );
      assertNotAborted(context);
      return archiveSize;
    } catch (error) {
      onAbort();
      const pipelineCleanup = cleanupOperation(() => completed);
      const immediateUnlinks = [
        cleanupOperation(() => fs.unlink(partialPath)),
        cleanupOperation(() => fs.unlink(filePath)),
      ];
      const retryUnlinks = pipelineCleanup.then(() =>
        Promise.all([cleanupOperation(() => fs.unlink(partialPath)), cleanupOperation(() => fs.unlink(filePath))]),
      );
      await settlesWithin(
        Promise.allSettled([pipelineCleanup, ...immediateUnlinks, retryUnlinks]),
        this.cleanupTimeoutMs,
      );
      throw error;
    } finally {
      context.signal?.removeEventListener("abort", onAbort);
    }
  }

  async inspect(filePath: string, kind: "folder", context?: OperationContext): Promise<FolderArchive>;
  async inspect(filePath: string, kind: "recording", context?: OperationContext): Promise<RecordingArchive>;
  async inspect(filePath: string, kind: ImportKind, context: OperationContext = {}): Promise<Archive> {
    let directory: Awaited<ReturnType<typeof unzipper.Open.file>>;
    try {
      await assertZipEntryCount(filePath, context, this.cleanupTimeoutMs);
      directory = await awaitWithAbort(unzipper.Open.file(filePath), context);
    } catch (error) {
      if (isDomainError(error)) throw error;
      throw new InvalidArgumentError("The uploaded file is not a readable ZIP archive", {
        reason: error instanceof Error ? error.message : String(error),
      });
    }
    if (directory.files.length > MAX_ARCHIVE_ENTRIES) {
      throw new PayloadLimitExceededError(MAX_ARCHIVE_ENTRIES, directory.files.length);
    }
    let expandedSize = 0;
    const paths = new Set<string>();
    for (const entry of directory.files) {
      assertNotAborted(context);
      if (entry.type !== "File" || !safeZipEntryPath(entry.path) || paths.has(entry.path) || (entry.flags & 1) !== 0) {
        throw new InvalidArgumentError("Archive contains an unsafe, duplicate, or unknown entry", { path: entry.path });
      }
      if (entry.compressionMethod !== 0 && entry.compressionMethod !== 8) {
        throw new InvalidArgumentError("Archive uses an unsupported compression method", { path: entry.path });
      }
      expandedSize += entry.uncompressedSize;
      if (!Number.isSafeInteger(expandedSize) || expandedSize > this.maxExpandedBytes) {
        throw new PayloadLimitExceededError(this.maxExpandedBytes, expandedSize);
      }
      paths.add(entry.path);
    }
    const manifestPath = kind === "folder" ? FOLDER_MANIFEST_ENTRY : RECORDING_MANIFEST_ENTRY;
    const manifestEntry = directory.files.find((entry) => entry.path === manifestPath);
    if (!manifestEntry || manifestEntry.uncompressedSize > MAX_MANIFEST_BYTES) {
      throw new InvalidArgumentError(`${kind} archive manifest is missing or too large`);
    }
    let archive: Archive;
    try {
      const value = JSON.parse(
        (await readZipEntryLimited(manifestEntry, MAX_MANIFEST_BYTES, context)).toString("utf8"),
      );
      if (kind === "folder") assertFolderAggregateCounts(value);
      archive = kind === "folder" ? FolderArchiveSchema.parse(value) : RecordingArchiveSchema.parse(value);
    } catch (error) {
      if (isDomainError(error)) throw error;
      throw new InvalidArgumentError(`${kind} archive manifest is invalid`, {
        reason: error instanceof Error ? error.message : String(error),
      });
    }
    const refs = uniqueBodyRefs(archive);
    assertExpandedLimit(manifestEntry.uncompressedSize, refs, this.maxExpandedBytes);
    const blobEntries = new Map<Sha256, ZipEntry>();
    for (const entry of directory.files) {
      assertNotAborted(context);
      if (entry === manifestEntry) continue;
      const match = entry.path.match(BLOB_ENTRY);
      if (!match) throw new InvalidArgumentError("Archive contains an unknown entry", { path: entry.path });
      const digest = Sha256Schema.parse(match[1]);
      const ref = refs.get(digest);
      if (!ref || ref.size !== entry.uncompressedSize) {
        throw new InvalidArgumentError("Archive blob metadata does not match its manifest", { digest });
      }
      blobEntries.set(digest, entry);
    }
    for (const digest of refs.keys()) {
      if (!blobEntries.has(digest)) throw new InvalidArgumentError("Archive is missing a referenced blob", { digest });
    }
    return archive;
  }

  async materialize(filePath: string, archive: Archive, context: OperationContext): Promise<void> {
    const refs = uniqueBodyRefs(archive);
    await assertZipEntryCount(filePath, context, this.cleanupTimeoutMs);
    const directory = await awaitWithAbort(unzipper.Open.file(filePath), context);
    if (directory.files.length > MAX_ARCHIVE_ENTRIES) {
      throw new PayloadLimitExceededError(MAX_ARCHIVE_ENTRIES, directory.files.length);
    }
    const entries = new Map(
      directory.files
        .filter((entry) => entry.type === "File")
        .map((entry) => [entry.path.match(BLOB_ENTRY)?.[1], entry] as const)
        .filter((item): item is readonly [string, ZipEntry] => item[0] !== undefined),
    );
    for (const [digest, ref] of refs) {
      assertNotAborted(context);
      const entry = entries.get(digest);
      if (!entry) throw new InvalidArgumentError("Archive is missing a referenced blob", { digest });
      let session: Awaited<ReturnType<BlobStorePort["beginWrite"]>> | undefined;
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      let writer: WritableStreamDefaultWriter<Uint8Array> | undefined;
      const hash = createHash("sha256");
      let size = 0;
      try {
        session = await awaitWithAbort(
          this.blobs.beginWrite({ mediaType: ref.mediaType, contentEncoding: ref.contentEncoding }, context),
          context,
          (lateSession) => lateSession.abort(context.signal?.reason),
        );
        reader = (Readable.toWeb(entry.stream()) as ReadableStream<Uint8Array>).getReader();
        writer = session.writable.getWriter();
        while (true) {
          assertNotAborted(context);
          const { done, value } = await awaitWithAbort(reader.read(), context);
          if (done) break;
          size += value.byteLength;
          if (size > ref.size || size > this.maxExpandedBytes) {
            throw new PayloadLimitExceededError(Math.min(ref.size, this.maxExpandedBytes), size);
          }
          hash.update(value);
          await awaitWithAbort(writer.write(value), context);
        }
        const actualDigest = hash.digest("hex");
        if (size !== ref.size || actualDigest !== digest) {
          throw new InvalidArgumentError("Archive blob failed its integrity check", {
            digest,
            actualDigest,
            expectedSize: ref.size,
            actualSize: size,
          });
        }
        await awaitWithAbort(writer.close(), context);
        const committed = await awaitWithAbort(session.commit(context), context);
        if (committed.sha256 !== ref.sha256 || committed.size !== ref.size) {
          throw new InvalidArgumentError("Blob store returned a different imported body reference", { digest });
        }
      } catch (error) {
        // Import failure is already terminal. Cleanup is started synchronously
        // but cannot be allowed to retain the command indefinitely.
        if (reader) observeCleanup(() => reader?.cancel(error));
        if (writer) observeCleanup(() => writer?.abort(error));
        if (session) observeCleanup(() => session?.abort(error));
        throw error;
      } finally {
        releaseReaderLock(reader);
        releaseWriterLock(writer);
      }
    }
  }
}
