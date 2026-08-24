import fs from "node:fs/promises";
import path from "node:path";
import type {
  BodyRef,
  CatalogSnapshot,
  Recording,
  RecordingDraft,
  ScenarioManifest,
} from "../../../shared/contracts-v2/entities.js";
import {
  type CommandId,
  DisplayNameSchema,
  Sha256Schema,
  type TransferId,
} from "../../../shared/contracts-v2/primitives.js";
import type {
  FolderImportUploadMetadata,
  RecordingImportUploadMetadata,
  StagedFolderImport,
  StagedRecordingImport,
} from "../../../shared/contracts-v2/transfers.js";
import type { FolderImportSourcePort, ImportedFolderArchive } from "../application/folder-import-service.js";
import type {
  BlobPinHandlePort,
  BlobStorePort,
  ClockPort,
  IdGeneratorPort,
  OperationContext,
  ScenarioManifestRepositoryPort,
} from "../application/ports.js";
import type {
  BodyDownloadQueryPort,
  FolderExportQueryPort,
  RecordingExportQueryPort,
} from "../application/query-service.js";
import type { ImportedRecordingArchive, RecordingImportSourcePort } from "../application/recording-import-service.js";
import { EntityNotFoundError, OperationAbortedError, PayloadLimitExceededError } from "../domain/errors.js";
import type { CapabilityDownloadPort, FolderTransferPort, TransferDownload } from "../transport/transfer-api.js";
import {
  ArchiveCodec,
  FOLDER_MANIFEST_ENTRY,
  MAX_ARCHIVE_ENTRIES,
  MAX_MANIFEST_BYTES,
  RECORDING_MANIFEST_ENTRY,
  uniqueBodyRefs,
} from "./archive-codec.js";
import { type FolderArchive, type RecordingArchive, RecordingArchiveSchema } from "./archive-format.js";
import { DownloadCapabilityRegistry } from "./download-capability-registry.js";
import { StagedImportRegistry } from "./staged-import-registry.js";

const DEFAULT_SHUTDOWN_TIMEOUT_MS = 5_000;

export interface FilesystemTransferServiceOptions {
  root: string;
  maxUploadBytes: number;
  maxExpandedBytes?: number;
  downloadTtlMs?: number;
  importTtlMs?: number;
  shutdownTimeoutMs?: number;
  maxPendingImports?: number;
  maxPendingImportBytes?: number;
  now?: () => number;
  capabilityBytes?: () => Uint8Array;
  blobs: BlobStorePort;
  manifests: ScenarioManifestRepositoryPort;
  ids: IdGeneratorPort;
  clock: ClockPort;
}

function assertNotAborted(context?: OperationContext): void {
  if (context?.signal?.aborted) throw new OperationAbortedError(undefined, context.signal.reason);
}

function errorValue(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

async function releasePinWithin(pin: BlobPinHandlePort | undefined, timeoutMs: number): Promise<void> {
  if (!pin) return;
  let cleanup: Promise<void>;
  try {
    cleanup = pin.release().then(
      () => undefined,
      () => undefined,
    );
  } catch {
    // Pin records expire automatically. Archive completion or its primary
    // failure must not be retained by best-effort metadata cleanup.
    return;
  }
  await settleCleanupWithin([cleanup], timeoutMs);
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

function recordingDraft(recording: Recording): RecordingDraft {
  const {
    id: _id,
    scenarioId: _scenarioId,
    filename: _filename,
    revision: _revision,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    requestFingerprint: _requestFingerprint,
    matchable: _matchable,
    ...draft
  } = recording;
  return draft;
}

function suggestedFolderName(filename: string): string {
  const basename = filename.replaceAll("\\", "/").split("/").at(-1) ?? filename;
  return DisplayNameSchema.parse(basename.replace(/\.zip$/iu, "") || "Imported");
}

function safeAttachmentFilename(logicalName: string, suffix: string): string {
  let sanitized = "";
  const limit = 255 - suffix.length;
  for (const character of logicalName.trim()) {
    const codePoint = character.codePointAt(0);
    const safe =
      character === "/" || character === "\\" || codePoint === undefined || codePoint < 0x20 || codePoint === 0x7f
        ? "_"
        : character;
    if (sanitized.length + safe.length > limit) break;
    sanitized += safe;
  }
  return `${sanitized || "snaperro"}${suffix}`;
}

function recordingArchiveFilename(filename: string): string {
  return safeAttachmentFilename(filename.replace(/\.json$/iu, ""), ".snaperro.zip");
}

export class FilesystemTransferService
  implements
    FolderTransferPort,
    FolderExportQueryPort,
    RecordingExportQueryPort,
    BodyDownloadQueryPort,
    FolderImportSourcePort,
    RecordingImportSourcePort,
    CapabilityDownloadPort
{
  readonly #directory: string;
  readonly #codec: ArchiveCodec;
  readonly #downloads: DownloadCapabilityRegistry;
  readonly #staging: StagedImportRegistry;
  readonly #lifetime = new AbortController();
  readonly #activeExports = new Set<Promise<number>>();
  readonly #shutdownTimeoutMs: number;
  #closed = false;
  #closePromise: Promise<void> | undefined;

  constructor(private readonly options: FilesystemTransferServiceOptions) {
    const maxExpandedBytes = options.maxExpandedBytes ?? options.maxUploadBytes;
    this.#shutdownTimeoutMs = options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;
    if (!Number.isSafeInteger(options.maxUploadBytes) || options.maxUploadBytes < 1)
      throw new TypeError("maxUploadBytes must be a positive safe integer");
    if (!Number.isSafeInteger(maxExpandedBytes) || maxExpandedBytes < 1)
      throw new TypeError("maxExpandedBytes must be a positive safe integer");
    if (!Number.isSafeInteger(this.#shutdownTimeoutMs) || this.#shutdownTimeoutMs < 1)
      throw new TypeError("shutdownTimeoutMs must be a positive safe integer");
    this.#directory = path.join(path.resolve(options.root), "transfers");
    this.#codec = new ArchiveCodec(options.blobs, maxExpandedBytes, options.maxUploadBytes, this.#shutdownTimeoutMs);
    this.#downloads = new DownloadCapabilityRegistry({
      blobs: options.blobs,
      ttlMs: options.downloadTtlMs,
      shutdownTimeoutMs: this.#shutdownTimeoutMs,
      now: options.now,
      capabilityBytes: options.capabilityBytes,
    });
    this.#staging = new StagedImportRegistry({
      directory: this.#directory,
      maxUploadBytes: options.maxUploadBytes,
      codec: this.#codec,
      ids: options.ids,
      ttlMs: options.importTtlMs,
      shutdownTimeoutMs: this.#shutdownTimeoutMs,
      maxPendingImports: options.maxPendingImports,
      maxPendingBytes: options.maxPendingImportBytes,
    });
  }

  async ready(): Promise<void> {
    await this.#staging.ready();
    this.#assertOpen();
  }

  async prepare(
    folderId: CatalogSnapshot["folders"][number]["id"],
    catalog: CatalogSnapshot,
    context: OperationContext = {},
  ) {
    const operation = this.#operationContext(context);
    const folder = catalog.folders.find((candidate) => candidate.id === folderId);
    if (!folder) throw new EntityNotFoundError("folder", folderId);
    const scenarios = catalog.scenarios.filter((scenario) => scenario.folderId === folderId);
    const archive: FolderArchive = {
      format: "snaperro-folder",
      formatVersion: 2,
      exportedAt: this.options.clock.now(),
      folderName: folder.name,
      scenarios: [],
    };
    let manifestBytes = Buffer.byteLength(`${JSON.stringify(archive)}\n`, "utf8");
    for (const scenario of scenarios) {
      assertNotAborted(operation);
      const manifest = await this.options.manifests.readAtRevision(
        scenario.id,
        catalog.revision,
        scenario.revision,
        operation,
      );
      const archiveScenario: FolderArchive["scenarios"][number] = {
        name: scenario.name,
        recordings: manifest.recordings.map((recording) => ({
          filename: recording.filename,
          matchable: recording.matchable,
          recording: recordingDraft(recording),
        })),
      };
      const scenarioBytes = Buffer.byteLength(JSON.stringify(archiveScenario), "utf8");
      const projectedBytes = manifestBytes + scenarioBytes + (archive.scenarios.length === 0 ? 0 : 1);
      if (projectedBytes > MAX_MANIFEST_BYTES) {
        throw new PayloadLimitExceededError(MAX_MANIFEST_BYTES, projectedBytes);
      }
      archive.scenarios.push(archiveScenario);
      manifestBytes = projectedBytes;
    }
    const download = await this.#prepareArchive(
      FOLDER_MANIFEST_ENTRY,
      archive,
      safeAttachmentFilename(folder.name, ".zip"),
      context,
      async (validationContext) => {
        for (const scenario of scenarios) {
          await this.options.manifests.readAtRevision(
            scenario.id,
            catalog.revision,
            scenario.revision,
            validationContext,
          );
        }
      },
    );
    return { revision: catalog.revision, download };
  }

  async prepareRecording(
    recording: Recording,
    revision: CatalogSnapshot["revision"],
    scenarioRevision: ScenarioManifest["revision"],
    context: OperationContext = {},
  ) {
    const archive = RecordingArchiveSchema.parse({
      format: "snaperro-recording",
      formatVersion: 2,
      exportedAt: this.options.clock.now(),
      filename: recording.filename,
      recording: recordingDraft(recording),
    });
    const download = await this.#prepareArchive(
      RECORDING_MANIFEST_ENTRY,
      archive,
      recordingArchiveFilename(recording.filename),
      context,
      async (validationContext) => {
        await this.options.manifests.readAtRevision(
          recording.scenarioId,
          revision,
          scenarioRevision,
          validationContext,
        );
      },
    );
    return { revision, download };
  }

  async prepareBody(
    body: BodyRef,
    filename: string,
    revision: CatalogSnapshot["revision"],
    context: OperationContext = {},
  ) {
    const operation = this.#operationContext(context);
    const download = await this.#downloads.issue(
      {
        kind: "body",
        body,
        filename,
        mediaType: body.mediaType ?? "application/octet-stream",
        contentEncoding: body.contentEncoding,
        size: body.size,
      },
      operation,
    );
    return { revision, download };
  }

  openCapability(capability: string, context: OperationContext = {}): Promise<TransferDownload> {
    return this.#downloads.open(capability, this.#operationContext(context));
  }

  async stageImport(
    stream: ReadableStream<Uint8Array>,
    metadata: FolderImportUploadMetadata,
    context: OperationContext = {},
  ): Promise<StagedFolderImport> {
    const operation = this.#operationContext(context);
    const staged = await this.#staging.stage("folder", stream, operation);
    this.#assertOpen(operation);
    return {
      transferId: staged.transferId,
      suggestedName: suggestedFolderName(metadata.filename),
      scenariosCount: staged.archive.scenarios.length,
      size: staged.size,
      sha256: Sha256Schema.parse(staged.sha256),
    };
  }

  async stageRecordingImport(
    stream: ReadableStream<Uint8Array>,
    _metadata: RecordingImportUploadMetadata,
    context: OperationContext = {},
  ): Promise<StagedRecordingImport> {
    const operation = this.#operationContext(context);
    const staged = await this.#staging.stage("recording", stream, operation);
    this.#assertOpen(operation);
    return {
      transferId: staged.transferId,
      filename: staged.archive.filename,
      size: staged.size,
      sha256: Sha256Schema.parse(staged.sha256),
    };
  }

  async claim(
    transferId: TransferId,
    claimId: CommandId,
    context: OperationContext = {},
  ): Promise<ImportedFolderArchive> {
    const staged = this.#staging.claim(transferId, "folder", claimId, this.#operationContext(context));
    return {
      folderName: staged.archive.folderName,
      scenarios: staged.archive.scenarios.map((scenario) => ({ name: scenario.name, recordings: scenario.recordings })),
    };
  }

  async claimRecording(
    transferId: TransferId,
    claimId: CommandId,
    context: OperationContext = {},
  ): Promise<ImportedRecordingArchive> {
    const staged = this.#staging.claim(transferId, "recording", claimId, this.#operationContext(context));
    return { filename: staged.archive.filename, recording: staged.archive.recording };
  }

  materializeBlobs(transferId: TransferId, claimId: CommandId, context: OperationContext = {}): Promise<void> {
    return this.#staging.materialize(transferId, "folder", claimId, this.#operationContext(context));
  }

  materializeRecordingBlobs(transferId: TransferId, claimId: CommandId, context: OperationContext = {}): Promise<void> {
    return this.#staging.materialize(transferId, "recording", claimId, this.#operationContext(context));
  }

  complete(transferId: TransferId, claimId: CommandId): Promise<void> {
    return this.#staging.complete(transferId, "folder", claimId);
  }

  completeRecording(transferId: TransferId, claimId: CommandId): Promise<void> {
    return this.#staging.complete(transferId, "recording", claimId);
  }

  async release(transferId: TransferId, claimId: CommandId): Promise<void> {
    this.#staging.release(transferId, "folder", claimId);
  }

  async releaseRecording(transferId: TransferId, claimId: CommandId): Promise<void> {
    this.#staging.release(transferId, "recording", claimId);
  }

  close(): Promise<void> {
    if (this.#closePromise) return this.#closePromise;
    this.#closed = true;
    this.#lifetime.abort(new OperationAbortedError("Filesystem transfers are closing"));
    this.#closePromise = this.#close();
    return this.#closePromise;
  }

  async #close(): Promise<void> {
    const exportsSettled = Promise.allSettled([...this.#activeExports]).then(() => undefined);
    const operations = [exportsSettled, this.#staging.close(), this.#downloads.close()];
    const results = await settleCleanupWithin(operations, this.#shutdownTimeoutMs);
    if (!results) {
      throw new Error(`Filesystem transfer cleanup did not settle within ${this.#shutdownTimeoutMs}ms`);
    }
    // Export rejection is the expected result of aborting the shared lifetime;
    // only nested cleanup failures make an otherwise settled close fail.
    const errors = results
      .slice(1)
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result) => errorValue(result.reason));
    if (errors.length > 0) throw new AggregateError(errors, "Filesystem transfer shutdown failed");
  }

  async #prepareArchive(
    manifestEntry: string,
    archive: FolderArchive | RecordingArchive,
    filename: string,
    context: OperationContext,
    revalidateView: (context: OperationContext) => Promise<void>,
  ) {
    this.#assertOpen(context);
    const operation = this.#operationContext(context);
    await this.#staging.ready(operation);
    const transferId = this.options.ids.nextTransferId();
    const partialPath = path.join(this.#directory, `${transferId}.partial`);
    const filePath = path.join(this.#directory, `${transferId}.zip`);
    const writing = this.#writePinnedArchive(partialPath, filePath, manifestEntry, archive, operation, revalidateView);
    this.#activeExports.add(writing);
    try {
      const size = await writing;
      this.#assertOpen(operation);
      return await this.#downloads.issue(
        {
          kind: "file",
          filePath,
          filename,
          mediaType: "application/zip",
          contentEncoding: null,
          size,
        },
        operation,
      );
    } catch (error) {
      await settleCleanupWithin([fs.unlink(filePath).catch(() => undefined)], this.#shutdownTimeoutMs);
      throw error;
    } finally {
      this.#activeExports.delete(writing);
    }
  }

  async #writePinnedArchive(
    partialPath: string,
    filePath: string,
    manifestEntry: string,
    archive: FolderArchive | RecordingArchive,
    context: OperationContext,
    revalidateView: (context: OperationContext) => Promise<void>,
  ): Promise<number> {
    const refsByDigest = uniqueBodyRefs(archive);
    if (refsByDigest.size + 1 > MAX_ARCHIVE_ENTRIES) {
      throw new PayloadLimitExceededError(MAX_ARCHIVE_ENTRIES, refsByDigest.size + 1);
    }
    const refs = [...refsByDigest.values()];
    let pin: BlobPinHandlePort | undefined;
    try {
      // Production pinMany acquires the complete set under one store fence.
      // Revalidating afterwards distinguishes an already-deleted view from a
      // view whose blobs are now protected against later deletion/GC.
      pin = await this.options.blobs.pinMany(refs, context);
      await revalidateView(context);
      return await this.#codec.write(partialPath, filePath, manifestEntry, archive, context);
    } finally {
      // Preserve the normal completion contract (the pin is gone before the
      // archive result is visible), but bound a stalled filesystem cleanup.
      await releasePinWithin(pin, this.#shutdownTimeoutMs);
    }
  }

  #operationContext(context: OperationContext): OperationContext {
    this.#assertOpen(context);
    return {
      signal: context.signal ? AbortSignal.any([context.signal, this.#lifetime.signal]) : this.#lifetime.signal,
    };
  }

  #assertOpen(context: OperationContext = {}): void {
    assertNotAborted(context);
    if (this.#closed || this.#lifetime.signal.aborted) {
      throw new OperationAbortedError("Filesystem transfers are closed", this.#lifetime.signal.reason);
    }
  }
}
