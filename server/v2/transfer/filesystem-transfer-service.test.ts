import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BodyRefSchema,
  CatalogSnapshotSchema,
  RecordingSchema,
  type ScenarioManifest,
  ScenarioManifestSchema,
} from "../../../shared/contracts-v2/entities.js";
import {
  CommandIdSchema,
  FolderIdSchema,
  RecordingIdSchema,
  RequestFingerprintSchema,
  RevisionSchema,
  ScenarioIdSchema,
  TransferIdSchema,
  V2_SCHEMA_VERSION,
} from "../../../shared/contracts-v2/primitives.js";
import type {
  BlobStorePort,
  ClockPort,
  IdGeneratorPort,
  ScenarioManifestRepositoryPort,
} from "../application/ports.js";
import { PayloadLimitExceededError } from "../domain/errors.js";
import { writeBlobBytes } from "../store/blob-store.js";
import { FilesystemStore } from "../store/filesystem-store.js";
import { ArchiveCodec, MAX_MANIFEST_BYTES } from "./archive-codec.js";
import { DownloadCapabilityRegistry } from "./download-capability-registry.js";
import { FilesystemTransferService } from "./filesystem-transfer-service.js";
import { StagedImportRegistry } from "./staged-import-registry.js";

const directories: string[] = [];
const folderId = FolderIdSchema.parse("fld_0123456789abcdef");
const scenarioId = ScenarioIdSchema.parse("scn_0123456789abcdef");
const recordingId = RecordingIdSchema.parse("rec_0123456789abcdef");
const shadowRecordingId = RecordingIdSchema.parse("rec_fedcba9876543210");
const exportId = TransferIdSchema.parse("xfer_0123456789abcdef");
const importId = TransferIdSchema.parse("xfer_fedcba9876543210");
const claimId = CommandIdSchema.parse("cmd_0123456789abcdef");
const timestamp = "2026-08-24T00:00:00.000Z";

async function tempDirectory(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(process.cwd(), ".transfer-service-"));
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

function memoryBlobs(initial: Uint8Array) {
  const values = new Map<string, Uint8Array>();
  const pinCounts = new Map<string, number>();
  const digest = createHash("sha256").update(initial).digest("hex");
  values.set(digest, initial);
  const acquirePins = (refs: readonly { sha256: string }[]) => {
    for (const ref of refs) pinCounts.set(ref.sha256, (pinCounts.get(ref.sha256) ?? 0) + 1);
    let released = false;
    return {
      release: vi.fn(async () => {
        if (released) return;
        released = true;
        for (const ref of refs) {
          const count = (pinCounts.get(ref.sha256) ?? 1) - 1;
          if (count === 0) pinCounts.delete(ref.sha256);
          else pinCounts.set(ref.sha256, count);
        }
      }),
    };
  };
  const store = {
    open: vi.fn(async (ref) => new Blob([values.get(ref.sha256) as Uint8Array<ArrayBuffer>]).stream()),
    exists: vi.fn(async (ref) => values.get(ref.sha256)?.byteLength === ref.size),
    pin: vi.fn(async (ref) => acquirePins([ref])),
    pinMany: vi.fn(async (refs) => acquirePins(refs)),
    beginWrite: vi.fn(async (metadata) => {
      const chunks: Uint8Array[] = [];
      return {
        writable: new WritableStream<Uint8Array>({
          write(chunk) {
            chunks.push(chunk.slice());
          },
        }),
        commit: vi.fn(async () => {
          const bytes = new Uint8Array(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))));
          const sha256 = createHash("sha256").update(bytes).digest("hex");
          values.set(sha256, bytes);
          return BodyRefSchema.parse({ sha256, size: bytes.byteLength, ...metadata });
        }),
        abort: vi.fn(),
      };
    }),
  } as unknown as BlobStorePort;
  return { store, digest, values, pinCounts };
}

function manifestRepository(manifest: ReturnType<typeof fixtures>["manifest"]): ScenarioManifestRepositoryPort {
  return {
    read: vi.fn(async () => manifest),
    readAtRevision: vi.fn(async (_scenarioId, _catalogRevision, expectedScenarioRevision) => {
      if (manifest.revision !== expectedScenarioRevision) throw new Error("unexpected scenario revision");
      return manifest;
    }),
  } as unknown as ScenarioManifestRepositoryPort;
}

function fixtures(digest: string, bytes: Uint8Array) {
  const body = BodyRefSchema.parse({
    sha256: digest,
    size: bytes.byteLength,
    mediaType: "application/octet-stream",
    contentEncoding: null,
  });
  const manifest = ScenarioManifestSchema.parse({
    schemaVersion: V2_SCHEMA_VERSION,
    scenarioId,
    revision: 0,
    recordings: [
      RecordingSchema.parse({
        id: recordingId,
        scenarioId,
        filename: "nested/binary.json",
        revision: 0,
        route: "/binary",
        method: "GET",
        requestFingerprint: RequestFingerprintSchema.parse("b".repeat(64)),
        request: { pathParams: {}, query: [], headers: [], body: null },
        response: { status: 200, statusText: "OK", headers: [], body },
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    ],
  });
  const catalog = CatalogSnapshotSchema.parse({
    schemaVersion: V2_SCHEMA_VERSION,
    revision: 0,
    mode: "proxy",
    currentScenarioId: scenarioId,
    folders: [{ id: folderId, name: "Team/API", revision: 0, createdAt: timestamp, updatedAt: timestamp }],
    scenarios: [
      {
        id: scenarioId,
        folderId,
        name: "Success",
        revision: 0,
        recordingsCount: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
  });
  return { manifest, catalog };
}

function largeFolderExportFixtures(payload: string, scenariosCount: number, recordingsPerScenario: number) {
  const base = fixtures("a".repeat(64), new Uint8Array([1]));
  const scenarios = Array.from({ length: scenariosCount }, (_, index) => {
    const id = ScenarioIdSchema.parse(`scn_${index.toString(16).padStart(16, "0")}`);
    return {
      id,
      folderId,
      name: `Scenario ${index}`,
      revision: RevisionSchema.parse(0),
      recordingsCount: recordingsPerScenario,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  });
  const manifests = new Map(
    scenarios.map((scenario, index) => {
      const recordings = Array.from({ length: recordingsPerScenario }, (_, recordingIndex) => {
        const identity = index * 1_000 + recordingIndex + 1;
        return RecordingSchema.parse({
          ...base.manifest.recordings[0],
          id: RecordingIdSchema.parse(`rec_${identity.toString(16).padStart(16, "0")}`),
          scenarioId: scenario.id,
          filename: `large_${recordingIndex.toString().padStart(4, "0")}.json`,
          requestFingerprint: RequestFingerprintSchema.parse(identity.toString(16).padStart(64, "0")),
          request: {
            ...base.manifest.recordings[0].request,
            headers: [["x-large-request", payload]],
            body: null,
          },
          response: {
            ...base.manifest.recordings[0].response,
            headers: [["x-large-response", payload]],
            body: null,
          },
        });
      });
      return [
        scenario.id,
        ScenarioManifestSchema.parse({
          schemaVersion: V2_SCHEMA_VERSION,
          scenarioId: scenario.id,
          revision: RevisionSchema.parse(0),
          recordings,
        }),
      ] as const;
    }),
  );
  const catalog = CatalogSnapshotSchema.parse({
    ...base.catalog,
    currentScenarioId: scenarios[0]?.id ?? null,
    scenarios,
  });
  return { catalog, manifests };
}

describe("FilesystemTransferService", () => {
  it("round-trips a folder archive and verifies raw blobs before materializing them", async () => {
    const root = await tempDirectory();
    const bytes = new Uint8Array([0, 255, 1, 2]);
    const blobs = memoryBlobs(bytes);
    const fixture = fixtures(blobs.digest, bytes);
    const shadow = RecordingSchema.parse({
      ...fixture.manifest.recordings[0],
      id: shadowRecordingId,
      filename: "nested/shadow.json",
      matchable: false,
    });
    const manifest = ScenarioManifestSchema.parse({
      ...fixture.manifest,
      recordings: [...fixture.manifest.recordings, shadow],
    });
    const catalog = CatalogSnapshotSchema.parse({
      ...fixture.catalog,
      scenarios: fixture.catalog.scenarios.map((scenario) => ({ ...scenario, recordingsCount: 2 })),
    });
    const ids = {
      nextTransferId: vi.fn().mockReturnValueOnce(exportId).mockReturnValueOnce(importId),
    } as unknown as IdGeneratorPort;
    const service = new FilesystemTransferService({
      root,
      maxUploadBytes: 1024 * 1024,
      blobs: blobs.store,
      manifests: manifestRepository(manifest),
      ids,
      clock: { now: () => timestamp } as ClockPort,
    });

    const exported = await service.prepare(folderId, catalog);
    expect(exported.download.filename).toBe("Team_API.zip");
    const capability = exported.download.downloadPath.split("/").at(-1) as string;
    const download = await service.openCapability(capability);
    const zipBytes = new Uint8Array(await new Response(download.stream).arrayBuffer());
    await expect(service.openCapability(capability)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await vi.waitFor(async () => {
      await expect(fs.access(path.join(root, "transfers", `${exportId}.zip`))).rejects.toMatchObject({
        code: "ENOENT",
      });
    });
    const staged = await service.stageImport(new Blob([zipBytes]).stream(), {
      filename: "Imported Team.zip",
      mediaType: "application/zip",
    });

    expect(staged).toMatchObject({ transferId: importId, suggestedName: "Imported Team", scenariosCount: 1 });
    expect(await service.claim(importId, claimId)).toMatchObject({
      folderName: "Team/API",
      scenarios: [
        {
          name: "Success",
          recordings: [
            { filename: "nested/binary.json", matchable: true },
            { filename: "nested/shadow.json", matchable: false },
          ],
        },
      ],
    });
    blobs.values.clear();
    await service.materializeBlobs(importId, claimId);
    expect(blobs.values.get(blobs.digest)).toEqual(bytes);
    await service.complete(importId, claimId);
    await expect(service.claim(importId, claimId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await service.close();
  });

  it("round-trips a recording archive with its blobs and rejects folder/recording type confusion", async () => {
    const sourceRoot = await tempDirectory();
    const destinationRoot = await tempDirectory();
    const bytes = new Uint8Array([7, 0, 255, 8]);
    const sourceBlobs = memoryBlobs(bytes);
    const destinationBlobs = memoryBlobs(bytes);
    destinationBlobs.values.clear();
    const { manifest, catalog } = fixtures(sourceBlobs.digest, bytes);
    const source = new FilesystemTransferService({
      root: sourceRoot,
      maxUploadBytes: 1024 * 1024,
      blobs: sourceBlobs.store,
      manifests: manifestRepository(manifest),
      ids: { nextTransferId: () => exportId } as unknown as IdGeneratorPort,
      clock: { now: () => timestamp } as ClockPort,
    });
    const destination = new FilesystemTransferService({
      root: destinationRoot,
      maxUploadBytes: 1024 * 1024,
      blobs: destinationBlobs.store,
      manifests: {} as ScenarioManifestRepositoryPort,
      ids: { nextTransferId: () => importId } as unknown as IdGeneratorPort,
      clock: { now: () => timestamp } as ClockPort,
    });

    const exported = await source.prepareRecording(manifest.recordings[0], catalog.revision, manifest.revision);
    expect(exported.download.filename).toBe("nested_binary.snaperro.zip");
    const capability = exported.download.downloadPath.split("/").at(-1) as string;
    const zipBytes = new Uint8Array(await new Response((await source.openCapability(capability)).stream).arrayBuffer());
    await expect(
      destination.stageImport(new Blob([zipBytes]).stream(), {
        filename: "binary.snaperro.zip",
        mediaType: "application/zip",
      }),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });

    const staged = await destination.stageRecordingImport(new Blob([zipBytes]).stream(), {
      filename: "binary.snaperro.zip",
      mediaType: "application/zip",
    });
    expect(staged).toMatchObject({ transferId: importId, filename: "nested/binary.json" });
    await expect(destination.claim(importId, claimId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await destination.claimRecording(importId, claimId)).toMatchObject({
      filename: "nested/binary.json",
      recording: { route: "/binary", response: { body: { sha256: sourceBlobs.digest, size: bytes.byteLength } } },
    });
    await destination.materializeRecordingBlobs(importId, claimId);
    expect(destinationBlobs.values.get(sourceBlobs.digest)).toEqual(bytes);
    await destination.completeRecording(importId, claimId);
    await expect(destination.claimRecording(importId, claimId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await Promise.all([source.close(), destination.close()]);
  });

  it("accepts one very large scenario while retaining only the bounded folder archive", async () => {
    const root = await tempDirectory();
    const blobs = memoryBlobs(new Uint8Array([1]));
    const fixture = largeFolderExportFixtures("x".repeat(6 * 1024), 1, 1_000);
    const readAtRevision = vi.fn(async (id) => fixture.manifests.get(id) as ScenarioManifest);
    const write = vi.spyOn(ArchiveCodec.prototype, "write").mockResolvedValue(1);
    const service = new FilesystemTransferService({
      root,
      maxUploadBytes: 32 * 1024 * 1024,
      blobs: blobs.store,
      manifests: { readAtRevision } as unknown as ScenarioManifestRepositoryPort,
      ids: { nextTransferId: () => exportId } as unknown as IdGeneratorPort,
      clock: { now: () => timestamp } as ClockPort,
    });

    await expect(service.prepare(folderId, fixture.catalog)).resolves.toMatchObject({
      download: { size: 1 },
    });
    expect(readAtRevision).toHaveBeenCalledTimes(2);
    expect(write).toHaveBeenCalledOnce();
    await service.close();
  });

  it("stops reading later manifests as soon as the exact folder manifest budget is exceeded", async () => {
    const root = await tempDirectory();
    const blobs = memoryBlobs(new Uint8Array([1]));
    const fixture = largeFolderExportFixtures("x".repeat(4 * 1024), 5, 500);
    const readAtRevision = vi.fn(async (id) => fixture.manifests.get(id) as ScenarioManifest);
    const write = vi.spyOn(ArchiveCodec.prototype, "write");
    const service = new FilesystemTransferService({
      root,
      maxUploadBytes: 32 * 1024 * 1024,
      blobs: blobs.store,
      manifests: { readAtRevision } as unknown as ScenarioManifestRepositoryPort,
      ids: { nextTransferId: () => exportId } as unknown as IdGeneratorPort,
      clock: { now: () => timestamp } as ClockPort,
    });

    await expect(service.prepare(folderId, fixture.catalog)).rejects.toMatchObject({
      code: "PAYLOAD_LIMIT_EXCEEDED",
      details: { limitBytes: MAX_MANIFEST_BYTES },
    });
    expect(readAtRevision).toHaveBeenCalledTimes(4);
    expect(write).not.toHaveBeenCalled();
    await service.close();
  });

  it("burns capabilities atomically and rejects expired capabilities without exposing the body", async () => {
    const root = await tempDirectory();
    const bytes = new Uint8Array([1, 2, 3]);
    const blobs = memoryBlobs(bytes);
    let now = Date.parse(timestamp);
    const service = new FilesystemTransferService({
      root,
      maxUploadBytes: 1024,
      downloadTtlMs: 60_000,
      now: () => now,
      capabilityBytes: () => new Uint8Array(32).fill(7),
      blobs: blobs.store,
      manifests: {} as ScenarioManifestRepositoryPort,
      ids: { nextTransferId: () => exportId } as unknown as IdGeneratorPort,
      clock: { now: () => timestamp } as ClockPort,
    });
    const body = BodyRefSchema.parse({
      sha256: blobs.digest,
      size: bytes.byteLength,
      mediaType: "application/octet-stream",
      contentEncoding: null,
    });
    const ticket = await service.prepareBody(body, "response.body", RevisionSchema.parse(0));
    const capability = ticket.download.downloadPath.split("/").at(-1) as string;
    const results = await Promise.allSettled([service.openCapability(capability), service.openCapability(capability)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);

    const expired = await service.prepareBody(body, "response.body", RevisionSchema.parse(0));
    now += 60_001;
    await expect(
      service.openCapability(expired.download.downloadPath.split("/").at(-1) as string),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(blobs.store.open).toHaveBeenCalledTimes(1);
    await service.close();
  });

  it("keeps an issued body ticket valid across recording deletion and immediate garbage collection", async () => {
    const root = await tempDirectory();
    const store = new FilesystemStore(root, { garbageCollection: { minimumAgeMs: 0 } });
    await store.initialize();
    const bytes = Buffer.from("ticket survives delete", "utf8");
    const body = await writeBlobBytes(store.blobs, bytes, { mediaType: "text/plain", contentEncoding: null });
    const fixture = fixtures(body.sha256, bytes);
    const zero = RevisionSchema.parse(0);
    const one = RevisionSchema.parse(1);
    const two = RevisionSchema.parse(2);
    const manifest = ScenarioManifestSchema.parse({
      ...fixture.manifest,
      recordings: [
        RecordingSchema.parse({
          ...fixture.manifest.recordings[0],
          response: { ...fixture.manifest.recordings[0].response, body },
        }),
      ],
    });
    await store.manifests.create(manifest);
    const catalog = CatalogSnapshotSchema.parse({ ...fixture.catalog, revision: one });
    await store.catalogs.compareAndSwap(zero, catalog);
    const service = new FilesystemTransferService({
      root,
      maxUploadBytes: 1024 * 1024,
      blobs: store.blobs,
      manifests: store.manifests,
      ids: { nextTransferId: () => exportId } as unknown as IdGeneratorPort,
      clock: { now: () => timestamp } as ClockPort,
    });

    const ticket = await service.prepareBody(body, "response.body", catalog.revision);
    await store.commits.compareAndSwap({
      scenarioId,
      expectedCatalogRevision: one,
      expectedScenarioRevision: zero,
      catalog: CatalogSnapshotSchema.parse({
        ...catalog,
        revision: two,
        scenarios: catalog.scenarios.map((scenario) => ({ ...scenario, revision: one, recordingsCount: 0 })),
      }),
      manifest: ScenarioManifestSchema.parse({ ...manifest, revision: one, recordings: [] }),
    });
    await store.garbageCollection.schedule();
    expect(await store.blobs.exists(body)).toBe(true);

    const capability = ticket.download.downloadPath.split("/").at(-1) as string;
    const downloaded = Buffer.from(await new Response((await service.openCapability(capability)).stream).arrayBuffer());
    expect(downloaded).toEqual(bytes);
    await store.garbageCollection.schedule();
    expect(await store.blobs.exists(body)).toBe(false);
    await Promise.all([service.close(), store.garbageCollection.close()]);
  });

  it("pins every folder-export blob before view revalidation so delete plus GC cannot truncate the archive", async () => {
    const root = await tempDirectory();
    const store = new FilesystemStore(root, { garbageCollection: { minimumAgeMs: 0 } });
    await store.initialize();
    const bytes = Buffer.from("archive survives delete", "utf8");
    const body = await writeBlobBytes(store.blobs, bytes, { mediaType: "text/plain", contentEncoding: null });
    const fixture = fixtures(body.sha256, bytes);
    const zero = RevisionSchema.parse(0);
    const one = RevisionSchema.parse(1);
    const two = RevisionSchema.parse(2);
    const manifest = ScenarioManifestSchema.parse({
      ...fixture.manifest,
      recordings: [
        RecordingSchema.parse({
          ...fixture.manifest.recordings[0],
          response: { ...fixture.manifest.recordings[0].response, body },
        }),
      ],
    });
    await store.manifests.create(manifest);
    const catalog = CatalogSnapshotSchema.parse({ ...fixture.catalog, revision: one });
    await store.catalogs.compareAndSwap(zero, catalog);
    let releaseValidated: (() => void) | undefined;
    const validationReleased = new Promise<void>((resolve) => {
      releaseValidated = resolve;
    });
    let markValidated: (() => void) | undefined;
    const validated = new Promise<void>((resolve) => {
      markValidated = resolve;
    });
    const readAtRevision = store.manifests.readAtRevision.bind(store.manifests);
    let reads = 0;
    vi.spyOn(store.manifests, "readAtRevision").mockImplementation(async (...arguments_) => {
      const result = await readAtRevision(...arguments_);
      reads += 1;
      if (reads === 2) {
        markValidated?.();
        await validationReleased;
      }
      return result;
    });
    const service = new FilesystemTransferService({
      root,
      maxUploadBytes: 1024 * 1024,
      blobs: store.blobs,
      manifests: store.manifests,
      ids: { nextTransferId: () => exportId } as unknown as IdGeneratorPort,
      clock: { now: () => timestamp } as ClockPort,
    });

    const exporting = service.prepare(folderId, catalog);
    await validated;
    await store.commits.compareAndSwap({
      scenarioId,
      expectedCatalogRevision: one,
      expectedScenarioRevision: zero,
      catalog: CatalogSnapshotSchema.parse({
        ...catalog,
        revision: two,
        scenarios: catalog.scenarios.map((scenario) => ({ ...scenario, revision: one, recordingsCount: 0 })),
      }),
      manifest: ScenarioManifestSchema.parse({ ...manifest, revision: one, recordings: [] }),
    });
    await store.garbageCollection.schedule();
    expect(await store.blobs.exists(body)).toBe(true);
    releaseValidated?.();

    const exported = await exporting;
    const capability = exported.download.downloadPath.split("/").at(-1) as string;
    const archive = await service.openCapability(capability);
    expect((await new Response(archive.stream).arrayBuffer()).byteLength).toBeGreaterThan(bytes.byteLength);
    await store.garbageCollection.schedule();
    expect(await store.blobs.exists(body)).toBe(false);
    await Promise.all([service.close(), store.garbageCollection.close()]);
  });

  it("enforces the compressed upload limit while streaming", async () => {
    const root = await tempDirectory();
    const blobs = memoryBlobs(new Uint8Array([1]));
    const service = new FilesystemTransferService({
      root,
      maxUploadBytes: 3,
      blobs: blobs.store,
      manifests: {} as ScenarioManifestRepositoryPort,
      ids: { nextTransferId: () => importId } as unknown as IdGeneratorPort,
      clock: { now: () => timestamp } as ClockPort,
    });

    await expect(
      service.stageImport(new Blob(["four"]).stream(), { filename: "Team.zip", mediaType: "application/zip" }),
    ).rejects.toBeInstanceOf(PayloadLimitExceededError);
  });

  it("aborts an in-flight archive export before closing download capabilities", async () => {
    const root = await tempDirectory();
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const blobs = memoryBlobs(bytes);
    const { manifest, catalog } = fixtures(blobs.digest, bytes);
    blobs.store.open = vi.fn(
      async (_ref, context) =>
        new Promise<ReadableStream<Uint8Array>>((_resolve, reject) => {
          context?.signal?.addEventListener("abort", () => reject(context.signal?.reason), { once: true });
        }),
    );
    const service = new FilesystemTransferService({
      root,
      maxUploadBytes: 1024 * 1024,
      blobs: blobs.store,
      manifests: manifestRepository(manifest),
      ids: { nextTransferId: () => exportId } as unknown as IdGeneratorPort,
      clock: { now: () => timestamp } as ClockPort,
    });

    const exporting = service.prepare(folderId, catalog);
    const settled = exporting.then(
      () => ({ status: "fulfilled" as const }),
      (error: unknown) => ({ status: "rejected" as const, error }),
    );
    await vi.waitFor(() => expect(blobs.store.open).toHaveBeenCalledOnce());
    await service.close();

    await expect(settled).resolves.toMatchObject({ status: "rejected", error: { code: "ABORTED" } });
    expect(await fs.readdir(path.join(root, "transfers"))).toEqual([]);
  });

  it("bounds a never-settling export while starting staging and download cleanup independently", async () => {
    const root = await tempDirectory();
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const blobs = memoryBlobs(bytes);
    const { manifest, catalog } = fixtures(blobs.digest, bytes);
    const write = vi.spyOn(ArchiveCodec.prototype, "write").mockImplementation(() => new Promise(() => undefined));
    const stagingClose = vi.spyOn(StagedImportRegistry.prototype, "close");
    const downloadClose = vi.spyOn(DownloadCapabilityRegistry.prototype, "close");
    const service = new FilesystemTransferService({
      root,
      maxUploadBytes: 1024 * 1024,
      shutdownTimeoutMs: 25,
      blobs: blobs.store,
      manifests: manifestRepository(manifest),
      ids: { nextTransferId: () => exportId } as unknown as IdGeneratorPort,
      clock: { now: () => timestamp } as ClockPort,
    });
    const exporting = service.prepare(folderId, catalog);
    void exporting.catch(() => undefined);
    await vi.waitFor(() => expect(write).toHaveBeenCalledOnce());
    vi.useFakeTimers();

    const closing = service.close();
    const concurrent = service.close();
    expect(concurrent).toBe(closing);
    const closeResult = closing.then(
      () => ({ status: "fulfilled" as const, error: undefined }),
      (error: unknown) => ({ status: "rejected" as const, error }),
    );
    await vi.advanceTimersByTimeAsync(25);

    await expect(closeResult).resolves.toMatchObject({
      status: "rejected",
      error: { message: "Filesystem transfer cleanup did not settle within 25ms" },
    });
    expect(stagingClose).toHaveBeenCalledOnce();
    expect(downloadClose).toHaveBeenCalledOnce();
  });

  it("bounds pin cleanup before returning a completed export", async () => {
    const root = await tempDirectory();
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const blobs = memoryBlobs(bytes);
    const { manifest, catalog } = fixtures(blobs.digest, bytes);
    const release = vi.fn(() => new Promise<void>(() => {}));
    blobs.store.pinMany = vi.fn(async () => ({ release }));
    vi.spyOn(ArchiveCodec.prototype, "write").mockResolvedValue(3);
    const service = new FilesystemTransferService({
      root,
      maxUploadBytes: 1024 * 1024,
      shutdownTimeoutMs: 25,
      blobs: blobs.store,
      manifests: manifestRepository(manifest),
      ids: { nextTransferId: () => exportId } as unknown as IdGeneratorPort,
      clock: { now: () => timestamp } as ClockPort,
    });

    await expect(service.prepare(folderId, catalog)).resolves.toMatchObject({
      download: { size: 3 },
    });
    expect(release).toHaveBeenCalledOnce();
    await service.close();
  });

  it("does not issue a completed archive when close wins the post-write race", async () => {
    const root = await tempDirectory();
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const blobs = memoryBlobs(bytes);
    const { manifest, catalog } = fixtures(blobs.digest, bytes);
    let markWritten: (() => void) | undefined;
    const written = new Promise<void>((resolve) => {
      markWritten = resolve;
    });
    let releaseWrite: (() => void) | undefined;
    const writeReleased = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    vi.spyOn(ArchiveCodec.prototype, "write").mockImplementation(async (_partialPath, filePath) => {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, "zip");
      markWritten?.();
      await writeReleased;
      return 3;
    });
    const service = new FilesystemTransferService({
      root,
      maxUploadBytes: 1024 * 1024,
      blobs: blobs.store,
      manifests: manifestRepository(manifest),
      ids: { nextTransferId: () => exportId } as unknown as IdGeneratorPort,
      clock: { now: () => timestamp } as ClockPort,
    });
    const settled = service.prepare(folderId, catalog).then(
      () => ({ status: "fulfilled" as const }),
      (error: unknown) => ({ status: "rejected" as const, error }),
    );
    await written;

    releaseWrite?.();
    const closing = service.close();
    await expect(settled).resolves.toMatchObject({ status: "rejected", error: { code: "ABORTED" } });
    await closing;
    expect(await fs.readdir(path.join(root, "transfers"))).toEqual([]);
  });

  it("does not issue a body ticket when close wins the existence-check race", async () => {
    const root = await tempDirectory();
    const bytes = new Uint8Array([1, 2, 3]);
    const blobs = memoryBlobs(bytes);
    let resolveExists: ((value: boolean) => void) | undefined;
    blobs.store.exists = vi.fn(
      async () =>
        new Promise<boolean>((resolve) => {
          resolveExists = resolve;
        }),
    );
    const service = new FilesystemTransferService({
      root,
      maxUploadBytes: 1024,
      blobs: blobs.store,
      manifests: {} as ScenarioManifestRepositoryPort,
      ids: { nextTransferId: () => exportId } as unknown as IdGeneratorPort,
      clock: { now: () => timestamp } as ClockPort,
    });
    const body = BodyRefSchema.parse({
      sha256: blobs.digest,
      size: bytes.byteLength,
      mediaType: "application/octet-stream",
      contentEncoding: null,
    });
    const settled = service.prepareBody(body, "response.body", RevisionSchema.parse(0)).then(
      () => ({ status: "fulfilled" as const }),
      (error: unknown) => ({ status: "rejected" as const, error }),
    );
    await vi.waitFor(() => expect(blobs.store.exists).toHaveBeenCalledOnce());

    resolveExists?.(true);
    await service.close();
    await expect(settled).resolves.toMatchObject({ status: "rejected", error: { code: "ABORTED" } });
    expect(blobs.pinCounts.size).toBe(0);
  });
});
