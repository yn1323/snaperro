import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CatalogSnapshotSchema,
  FolderSchema,
  MAX_CATALOG_SERIALIZED_BYTES,
  MAX_SCENARIO_MANIFEST_BYTES,
  RecordingDraftSchema,
  RecordingSchema,
  ScenarioManifestSchema,
  ScenarioSchema,
} from "../../../shared/contracts-v2/entities.js";
import {
  CommandIdSchema,
  RequestFingerprintSchema,
  RevisionSchema,
  RuntimeIdSchema,
  V2_SCHEMA_VERSION,
} from "../../../shared/contracts-v2/primitives.js";
import type { EventHubPort, LoggerPort, VisibilityFencePort } from "../application/ports.js";
import { RecordingService } from "../application/recording-service.js";
import { StoreLockedError } from "../domain/errors.js";
import { ProcessWriteCoordinator, RandomIdGenerator, SystemClock } from "../runtime/system-adapters.js";
import { atomicWriteFile } from "./atomic.js";
import { writeBlobBytes } from "./blob-store.js";
import {
  MAX_BLOB_METADATA_BYTES,
  MAX_MIGRATION_RECEIPT_BYTES,
  MAX_PIN_RECORD_BYTES,
  MAX_STORE_METADATA_BYTES,
} from "./bounded-file.js";
import { FilesystemStore } from "./filesystem-store.js";
import { newFolderId, newRecordingId, newScenarioId, sha256 } from "./ids.js";
import { readManifestGeneration, stageManifestGeneration } from "./layout.js";
import { FileLease, LeaseBusyError } from "./lease.js";
import { MIGRATION_RECEIPT_FILE, readMigrationReceipt } from "./migration-receipt.js";
import { FilesystemCatalogRepository, FilesystemRecordingCommitRepository } from "./repositories.js";
import { FilesystemStoreLease } from "./store-lease.js";

const NOW = "2026-08-24T00:00:00.000Z";

async function readStream(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of stream) {
    chunks.push(chunk);
    size += chunk.byteLength;
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

describe("FilesystemStore ports", () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "snaperro-v2-store-"));
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("initializes canonical catalog, versioned manifests, and streaming blobs", async () => {
    const root = path.join(tempRoot, "store");
    const store = new FilesystemStore(root);
    const metadata = await store.initialize();
    expect(metadata).toMatchObject({ schemaVersion: 2, catalogFile: "catalog.json", manifestDirectory: "manifests" });

    const bytes = Buffer.from("a\0large-compatible-body", "utf8");
    const ref = await writeBlobBytes(store.blobs, bytes, {
      mediaType: "application/octet-stream",
      contentEncoding: "gzip",
    });
    expect(ref).toMatchObject({ sha256: sha256(bytes), size: bytes.byteLength });
    expect(Buffer.from(await readStream(await store.blobs.open(ref)))).toEqual(bytes);
    const byDigest = await store.blobs.openByDigest(ref.sha256);
    expect(byDigest.ref).toMatchObject({ sha256: ref.sha256, size: ref.size, mediaType: null });
    expect(Buffer.from(await readStream(byDigest.stream))).toEqual(bytes);

    expect(await store.catalogs.read()).toMatchObject({ revision: 0, folders: [], scenarios: [] });
    expect(await fs.stat(path.join(root, "store.json"))).toBeDefined();
    expect(await fs.stat(path.join(root, "catalog.json"))).toBeDefined();
  });

  it("removes only request and blob spools whose writer process is known to be gone", async () => {
    const root = path.join(tempRoot, "store");
    const spoolRoot = path.join(root, "tmp");
    const blobTempRoot = path.join(root, ".tmp", "blobs");
    const suffix = "01234567-89ab-4cde-8fab-0123456789ab.tmp";
    const dead = path.join(spoolRoot, `body-111-${suffix}`);
    const live = path.join(spoolRoot, `body-222-${suffix}`);
    const deadBlob = path.join(blobTempRoot, `111.${suffix}`);
    const liveBlob = path.join(blobTempRoot, `222.${suffix}`);
    const unrelated = path.join(spoolRoot, "keep-me.tmp");
    const matchingDirectory = path.join(spoolRoot, `body-333-${suffix}`);
    await fs.mkdir(matchingDirectory, { recursive: true });
    await fs.mkdir(blobTempRoot, { recursive: true });
    await Promise.all([
      fs.writeFile(dead, "dead writer"),
      fs.writeFile(live, "live writer"),
      fs.writeFile(deadBlob, "dead blob writer"),
      fs.writeFile(liveBlob, "live blob writer"),
      fs.writeFile(unrelated, "other"),
    ]);
    const processAlive = vi.fn((pid: number) => pid === 222);

    await new FilesystemStore(root, { orphanedFileProcessAlive: processAlive }).initialize();

    await expect(fs.access(dead)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.access(live)).resolves.toBeUndefined();
    await expect(fs.access(deadBlob)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.access(liveBlob)).resolves.toBeUndefined();
    await expect(fs.access(unrelated)).resolves.toBeUndefined();
    await expect(fs.stat(matchingDirectory)).resolves.toMatchObject({});
    expect(processAlive.mock.calls.flat()).toEqual(expect.arrayContaining([111, 222]));
    expect(processAlive).not.toHaveBeenCalledWith(333);
  });

  it.each(["store.json", "catalog.json"])("fails closed when probing %s returns an I/O error", async (filename) => {
    const root = path.join(tempRoot, "store");
    await new FilesystemStore(root).initialize();
    const metadataPath = path.join(root, "store.json");
    const catalogPath = path.join(root, "catalog.json");
    const before = await Promise.all([fs.readFile(metadataPath), fs.readFile(catalogPath)]);
    const failedPath = path.join(root, filename);
    const accessError = Object.assign(new Error(`cannot probe ${filename}`), { code: "EIO" });
    const realAccess = fs.access.bind(fs);
    const access = vi.spyOn(fs, "access").mockImplementation(async (...args: Parameters<typeof fs.access>) => {
      if (String(args[0]) === failedPath) throw accessError;
      return realAccess(...args);
    });

    try {
      await expect(new FilesystemStore(root).initialize()).rejects.toBe(accessError);
    } finally {
      access.mockRestore();
    }
    await expect(Promise.all([fs.readFile(metadataPath), fs.readFile(catalogPath)])).resolves.toEqual(before);
  });

  it("resumes a crash between the initial catalog and metadata commit", async () => {
    const root = path.join(tempRoot, "store");
    await fs.mkdir(root, { recursive: true });
    await atomicWriteFile(
      path.join(root, "catalog.json"),
      `${JSON.stringify(
        {
          schemaVersion: 2,
          revision: 0,
          mode: "smart",
          currentScenarioId: null,
          folders: [],
          scenarios: [],
          manifestRevisions: {},
        },
        null,
        2,
      )}\n`,
    );

    const store = new FilesystemStore(root);
    await expect(store.initialize()).resolves.toMatchObject({ schemaVersion: 2 });
    await expect(store.verifyIntegrity()).resolves.toMatchObject({ ok: true });
  });

  it("uses immutable manifest generations and catalog CAS as the visibility marker", async () => {
    const root = path.join(tempRoot, "store");
    const store = new FilesystemStore(root, { garbageCollection: { minimumAgeMs: 0 } });
    await store.initialize();
    const visibilityFence = vi.spyOn(store.lease, "withVisibilityFence");
    const folderId = newFolderId();
    const scenarioId = newScenarioId();
    const recordingId = newRecordingId();
    const zero = RevisionSchema.parse(0);
    const one = RevisionSchema.parse(1);
    const two = RevisionSchema.parse(2);

    const initialManifest = ScenarioManifestSchema.parse({
      schemaVersion: V2_SCHEMA_VERSION,
      scenarioId,
      revision: zero,
      recordings: [],
    });
    await store.manifests.create(initialManifest);
    const folder = FolderSchema.parse({ id: folderId, name: "folder", revision: zero, createdAt: NOW, updatedAt: NOW });
    const scenario = ScenarioSchema.parse({
      id: scenarioId,
      folderId,
      name: "scenario",
      revision: zero,
      recordingsCount: 0,
      createdAt: NOW,
      updatedAt: NOW,
    });
    const initialCatalog = CatalogSnapshotSchema.parse({
      schemaVersion: V2_SCHEMA_VERSION,
      revision: one,
      mode: "smart",
      currentScenarioId: scenarioId,
      folders: [folder],
      scenarios: [scenario],
    });
    await store.catalogs.compareAndSwap(zero, initialCatalog);
    expect(visibilityFence).toHaveBeenCalledTimes(3);

    const responseRef = await writeBlobBytes(store.blobs, Buffer.from('{"ok":true}', "utf8"), {
      mediaType: "application/json",
      contentEncoding: null,
    });
    const recording = RecordingSchema.parse({
      id: recordingId,
      scenarioId,
      filename: "users_001.json",
      route: "/users",
      method: "GET",
      requestFingerprint: RequestFingerprintSchema.parse(sha256("request")),
      request: { pathParams: {}, query: [], headers: [], body: null },
      response: { status: 200, statusText: "OK", headers: [], body: responseRef },
      revision: zero,
      createdAt: NOW,
      updatedAt: NOW,
    });
    const nextManifest = ScenarioManifestSchema.parse({
      ...initialManifest,
      revision: one,
      recordings: [recording],
    });
    const nextScenario = ScenarioSchema.parse({ ...scenario, revision: one, recordingsCount: 1 });
    const nextCatalog = CatalogSnapshotSchema.parse({ ...initialCatalog, revision: two, scenarios: [nextScenario] });
    await store.commits.compareAndSwap({
      scenarioId,
      expectedCatalogRevision: one,
      expectedScenarioRevision: zero,
      catalog: nextCatalog,
      manifest: nextManifest,
    });
    expect(visibilityFence).toHaveBeenCalledTimes(5);

    expect(await store.manifests.read(scenarioId)).toEqual(nextManifest);
    expect(await store.catalogs.read()).toEqual(nextCatalog);
    const persistedCatalog = JSON.parse(await fs.readFile(path.join(root, "catalog.json"), "utf8"));
    expect(persistedCatalog.manifestRevisions).toEqual({ [scenarioId]: 1 });
    expect(await fs.stat(path.join(root, "manifests", scenarioId, "0000000000000000.json"))).toBeDefined();
    expect(await fs.stat(path.join(root, "manifests", scenarioId, "0000000000000001.json"))).toBeDefined();

    await expect(
      store.commits.compareAndSwap({
        scenarioId,
        expectedCatalogRevision: one,
        expectedScenarioRevision: zero,
        catalog: nextCatalog,
        manifest: nextManifest,
      }),
    ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });

    const orphanRef = await writeBlobBytes(store.blobs, Buffer.from("orphan", "utf8"), {
      mediaType: "text/plain",
      contentEncoding: null,
    });
    await store.garbageCollection.schedule();
    expect(await store.blobs.exists(responseRef)).toBe(true);
    expect(await store.blobs.exists(orphanRef)).toBe(false);
    await expect(fs.access(path.join(root, "manifests", scenarioId, "0000000000000000.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(await store.verifyIntegrity()).toMatchObject({
      ok: true,
      counts: { manifests: 1, orphanManifests: 0, orphanBlobs: 0 },
    });
  });

  it("does not expose a staged manifest until catalog points at it", async () => {
    const store = new FilesystemStore(path.join(tempRoot, "store"));
    await store.initialize();
    const folderId = newFolderId();
    const scenarioId = newScenarioId();
    const zero = RevisionSchema.parse(0);
    const one = RevisionSchema.parse(1);
    const initial = ScenarioManifestSchema.parse({
      schemaVersion: V2_SCHEMA_VERSION,
      scenarioId,
      revision: zero,
      recordings: [],
    });
    await store.manifests.create(initial);
    await store.catalogs.compareAndSwap(
      zero,
      CatalogSnapshotSchema.parse({
        schemaVersion: V2_SCHEMA_VERSION,
        revision: one,
        mode: "smart",
        currentScenarioId: null,
        folders: [FolderSchema.parse({ id: folderId, name: "folder", revision: zero, createdAt: NOW, updatedAt: NOW })],
        scenarios: [
          ScenarioSchema.parse({
            id: scenarioId,
            folderId,
            name: "scenario",
            revision: zero,
            recordingsCount: 0,
            createdAt: NOW,
            updatedAt: NOW,
          }),
        ],
      }),
    );
    const staged = ScenarioManifestSchema.parse({ ...initial, revision: one });
    await stageManifestGeneration(store.layout, staged);

    expect(await store.manifests.read(scenarioId)).toEqual(initial);
    expect(await store.verifyIntegrity()).toMatchObject({
      ok: true,
      counts: { manifests: 2, orphanManifests: 1 },
    });
  });

  it("replaces a differing crash-orphaned next manifest and keeps visible generations immutable", async () => {
    const root = path.join(tempRoot, "store");
    const store = new FilesystemStore(root);
    await store.initialize();
    const folderId = newFolderId();
    const scenarioId = newScenarioId();
    const zero = RevisionSchema.parse(0);
    const one = RevisionSchema.parse(1);
    const two = RevisionSchema.parse(2);
    const baseManifest = ScenarioManifestSchema.parse({
      schemaVersion: V2_SCHEMA_VERSION,
      scenarioId,
      revision: zero,
      recordings: [],
    });
    await store.manifests.create(baseManifest);
    const folder = FolderSchema.parse({
      id: folderId,
      name: "folder",
      revision: zero,
      createdAt: NOW,
      updatedAt: NOW,
    });
    const scenario = ScenarioSchema.parse({
      id: scenarioId,
      folderId,
      name: "scenario",
      revision: zero,
      recordingsCount: 0,
      createdAt: NOW,
      updatedAt: NOW,
    });
    const catalog = CatalogSnapshotSchema.parse({
      schemaVersion: V2_SCHEMA_VERSION,
      revision: one,
      mode: "smart",
      currentScenarioId: null,
      folders: [folder],
      scenarios: [scenario],
    });
    await store.catalogs.compareAndSwap(zero, catalog);

    const recording = (id: ReturnType<typeof newRecordingId>, filename: string, fingerprint: string) =>
      RecordingSchema.parse({
        id,
        scenarioId,
        filename,
        route: "/users",
        method: "GET",
        requestFingerprint: RequestFingerprintSchema.parse(fingerprint.repeat(64)),
        request: { pathParams: {}, query: [], headers: [], body: null },
        response: { status: 200, statusText: "OK", headers: [], body: null },
        revision: zero,
        createdAt: NOW,
        updatedAt: NOW,
      });
    const orphanManifest = ScenarioManifestSchema.parse({
      ...baseManifest,
      revision: one,
      recordings: [recording(newRecordingId(), "orphan.json", "a")],
    });
    const retryManifest = ScenarioManifestSchema.parse({
      ...baseManifest,
      revision: one,
      recordings: [recording(newRecordingId(), "retry.json", "b")],
    });
    const nextScenario = ScenarioSchema.parse({ ...scenario, revision: one, recordingsCount: 1 });
    const nextCatalog = CatalogSnapshotSchema.parse({ ...catalog, revision: two, scenarios: [nextScenario] });
    let fenceCalls = 0;
    const failingCommitFence: VisibilityFencePort = {
      withVisibilityFence: async (operation) => {
        fenceCalls += 1;
        if (fenceCalls === 2) throw new Error("catalog commit failed");
        return operation();
      },
    };
    const interrupted = new FilesystemRecordingCommitRepository(store.layout, failingCommitFence);
    await expect(
      interrupted.compareAndSwap({
        scenarioId,
        expectedCatalogRevision: one,
        expectedScenarioRevision: zero,
        catalog: nextCatalog,
        manifest: orphanManifest,
      }),
    ).rejects.toThrow("catalog commit failed");
    expect(await store.catalogs.read()).toEqual(catalog);
    expect(await readManifestGeneration(store.layout, scenarioId, one)).toEqual(orphanManifest);

    await store.commits.compareAndSwap({
      scenarioId,
      expectedCatalogRevision: one,
      expectedScenarioRevision: zero,
      catalog: nextCatalog,
      manifest: retryManifest,
    });
    expect(await store.catalogs.read()).toEqual(nextCatalog);
    expect(await store.manifests.read(scenarioId)).toEqual(retryManifest);

    await expect(
      stageManifestGeneration(store.layout, orphanManifest, { replaceCrashOrphanAfter: one }),
    ).rejects.toThrow("Immutable manifest generation already differs");
    expect(await store.manifests.read(scenarioId)).toEqual(retryManifest);
  });

  it("keeps fresh orphan blobs and manifests until the GC grace period expires", async () => {
    let gcNow = Date.now();
    const root = path.join(tempRoot, "store");
    const store = new FilesystemStore(root, {
      garbageCollection: { minimumAgeMs: 60 * 60 * 1_000, now: () => gcNow },
    });
    await store.initialize();
    const orphanRef = await writeBlobBytes(store.blobs, Buffer.from("staged", "utf8"), {
      mediaType: "text/plain",
      contentEncoding: null,
    });
    const scenarioId = newScenarioId();
    const orphanManifest = ScenarioManifestSchema.parse({
      schemaVersion: V2_SCHEMA_VERSION,
      scenarioId,
      revision: RevisionSchema.parse(0),
      recordings: [],
    });
    await store.manifests.create(orphanManifest);
    const manifestPath = path.join(root, "manifests", scenarioId, "0000000000000000.json");

    gcNow = Date.now();
    await store.garbageCollection.schedule();
    expect(await store.blobs.exists(orphanRef)).toBe(true);
    expect(await fs.stat(manifestPath)).toBeDefined();

    gcNow += 60 * 60 * 1_000 + 1;
    await store.garbageCollection.close();
    const reopened = new FilesystemStore(root, {
      garbageCollection: { minimumAgeMs: 60 * 60 * 1_000, now: () => gcNow },
    });
    await reopened.initialize();
    await reopened.garbageCollection.schedule();
    expect(await reopened.blobs.exists(orphanRef)).toBe(false);
    await expect(fs.access(manifestPath)).rejects.toMatchObject({ code: "ENOENT" });
    await reopened.garbageCollection.close();
  });

  it("rejects an oversized manifest generation before parsing its JSON", async () => {
    const store = new FilesystemStore(path.join(tempRoot, "store"));
    await store.initialize();
    const scenarioId = newScenarioId();
    const revision = RevisionSchema.parse(0);
    const manifestPath = store.layout.manifestPath(scenarioId, revision);
    await fs.mkdir(path.dirname(manifestPath), { recursive: true });
    await fs.writeFile(manifestPath, Buffer.alloc(MAX_SCENARIO_MANIFEST_BYTES + 1, 0x20));

    await expect(readManifestGeneration(store.layout, scenarioId, revision)).rejects.toThrow("read limit");
  });

  it("rejects an oversized catalog before allocating or parsing its contents", async () => {
    const store = new FilesystemStore(path.join(tempRoot, "store"));
    await store.initialize();
    await fs.truncate(store.layout.catalogPath, MAX_CATALOG_SERIALIZED_BYTES + 1);

    await expect(store.catalogs.read()).rejects.toMatchObject({
      code: "PERSISTENCE_FAILURE",
      message: expect.stringContaining("read limit"),
    });
  });

  it("bounds store metadata, blob sidecars, migration receipts, and GC pin records before parsing", async () => {
    const root = path.join(tempRoot, "store");
    const store = new FilesystemStore(root, { garbageCollection: { minimumAgeMs: 0 } });
    await store.initialize();
    const ref = await writeBlobBytes(store.blobs, Buffer.from("bounded metadata", "utf8"), {
      mediaType: "text/plain",
      contentEncoding: null,
    });

    await fs.truncate(store.layout.metadataPath, MAX_STORE_METADATA_BYTES + 1);
    await expect(store.readMetadata()).rejects.toMatchObject({
      code: "PERSISTENCE_FAILURE",
      message: expect.stringContaining("read limit"),
    });

    await fs.truncate(store.layout.blobMetadataPath(ref.sha256), MAX_BLOB_METADATA_BYTES + 1);
    await expect(store.blobs.openByDigest(ref.sha256)).rejects.toMatchObject({
      code: "PERSISTENCE_FAILURE",
      message: expect.stringContaining("read limit"),
    });

    const receiptPath = path.join(root, MIGRATION_RECEIPT_FILE);
    await fs.writeFile(receiptPath, "");
    await fs.truncate(receiptPath, MAX_MIGRATION_RECEIPT_BYTES + 1);
    await expect(readMigrationReceipt(root)).rejects.toMatchObject({
      code: "PERSISTENCE_FAILURE",
      message: expect.stringContaining("read limit"),
    });
    await fs.unlink(receiptPath);

    const pinPath = path.join(root, "gc", "blob-pins", "active.00000000-0000-0000-0000-000000000000.json");
    await fs.mkdir(path.dirname(pinPath), { recursive: true });
    await fs.writeFile(pinPath, "");
    await fs.truncate(pinPath, MAX_PIN_RECORD_BYTES + 1);
    await store.garbageCollection.schedule();
    await expect(fs.access(pinPath)).rejects.toMatchObject({ code: "ENOENT" });
    await store.garbageCollection.close();
  });

  it("runs a lifecycle-managed deferred sweep after the orphan grace period", async () => {
    let gcNow = Date.now();
    const root = path.join(tempRoot, "store");
    const store = new FilesystemStore(root, { garbageCollection: { minimumAgeMs: 20, now: () => gcNow } });
    await store.initialize();
    const orphanRef = await writeBlobBytes(store.blobs, Buffer.from("deferred orphan", "utf8"), {
      mediaType: "text/plain",
      contentEncoding: null,
    });
    gcNow = Math.max(
      (await fs.stat(store.layout.blobPath(orphanRef.sha256))).mtimeMs,
      (await fs.stat(store.layout.blobMetadataPath(orphanRef.sha256))).mtimeMs,
    );
    const collectGarbage = store.blobs.collectGarbage.bind(store.blobs);
    let sweeps = 0;
    vi.spyOn(store.blobs, "collectGarbage").mockImplementation(async (...arguments_) => {
      sweeps += 1;
      if (sweeps === 2) throw new Error("transient deferred sweep failure");
      return collectGarbage(...arguments_);
    });

    await store.garbageCollection.schedule();
    expect(await store.blobs.exists(orphanRef)).toBe(true);
    gcNow += 21;
    await vi.waitFor(async () => expect(await store.blobs.exists(orphanRef)).toBe(false), { timeout: 1000 });
    expect(sweeps).toBeGreaterThanOrEqual(3);
    await store.garbageCollection.close();
  });

  it("pins an uploaded draft body across the grace deadline until recording.create commits it", async () => {
    let gcNow = Date.now();
    const root = path.join(tempRoot, "store");
    const store = new FilesystemStore(root, {
      garbageCollection: { minimumAgeMs: 100, pendingPinTtlMs: 24 * 60 * 60 * 1_000, now: () => gcNow },
    });
    await store.initialize();
    const ref = await writeBlobBytes(store.blobs, Buffer.from("draft body", "utf8"), {
      mediaType: "text/plain",
      contentEncoding: null,
    });
    await store.garbageCollection.pinPending(ref);
    await store.garbageCollection.pinPending(ref);

    gcNow += 2 * 60 * 60 * 1_000;
    await store.garbageCollection.schedule();
    expect(await store.blobs.exists(ref)).toBe(true);

    const folderId = newFolderId();
    const scenarioId = newScenarioId();
    const zero = RevisionSchema.parse(0);
    const writes = new ProcessWriteCoordinator(store.lease);
    await writes.withCatalogWrite(async () => {
      await store.manifests.create(
        ScenarioManifestSchema.parse({ schemaVersion: V2_SCHEMA_VERSION, scenarioId, revision: zero, recordings: [] }),
      );
      const catalog = await store.catalogs.read();
      await store.catalogs.compareAndSwap(
        catalog.revision,
        CatalogSnapshotSchema.parse({
          ...catalog,
          revision: RevisionSchema.parse(1),
          folders: [
            FolderSchema.parse({ id: folderId, name: "Drafts", revision: zero, createdAt: NOW, updatedAt: NOW }),
          ],
          scenarios: [
            ScenarioSchema.parse({
              id: scenarioId,
              folderId,
              name: "Draft",
              revision: zero,
              recordingsCount: 0,
              createdAt: NOW,
              updatedAt: NOW,
            }),
          ],
        }),
      );
    });
    const runtimeId = RuntimeIdSchema.parse("run_0123456789abcdef");
    const recordings = new RecordingService({
      blobs: store.blobs,
      catalogs: store.catalogs,
      manifests: store.manifests,
      commits: store.commits,
      garbageCollection: store.garbageCollection,
      writes,
      events: { publish: vi.fn(), watermark: () => ({ runtimeId, sequence: 0, revision: 1 }) } as never as EventHubPort,
      ids: new RandomIdGenerator(),
      clock: new SystemClock(),
      logger: { error: vi.fn() } as never as LoggerPort,
    });

    const created = await recordings.create({
      protocolVersion: V2_SCHEMA_VERSION,
      type: "recording.create",
      commandId: CommandIdSchema.parse("cmd_0123456789abcdef"),
      scenarioId,
      expectedScenarioRevision: zero,
      filename: "draft.json",
      recording: RecordingDraftSchema.parse({
        route: "/draft",
        method: "GET",
        request: { pathParams: {}, query: [], headers: [], body: ref },
        response: { status: 200, statusText: "OK", headers: [], body: ref },
      }),
    });
    expect(created).toMatchObject({ recording: { request: { body: ref }, response: { body: ref } } });
    await recordings.delete({
      protocolVersion: V2_SCHEMA_VERSION,
      type: "recording.delete",
      commandId: CommandIdSchema.parse("cmd_fedcba9876543210"),
      scenarioId,
      recordingId: created.recording.id,
      expectedScenarioRevision: created.scenarioRevision,
      expectedContentRevision: created.recording.revision,
    });
    await store.garbageCollection.close();
    const reopened = new FilesystemStore(root, {
      garbageCollection: { minimumAgeMs: 100, pendingPinTtlMs: 24 * 60 * 60 * 1_000, now: () => gcNow },
    });
    await reopened.initialize();
    await reopened.garbageCollection.schedule();
    expect(await reopened.blobs.exists(ref)).toBe(true);
    await reopened.garbageCollection.close();
  });

  it("keeps an unreferenced blob alive until its active read stream closes", async () => {
    const store = new FilesystemStore(path.join(tempRoot, "store"), {
      garbageCollection: { minimumAgeMs: 0 },
    });
    await store.initialize();
    const ref = await writeBlobBytes(store.blobs, Buffer.alloc(256 * 1024, 7), {
      mediaType: "application/octet-stream",
      contentEncoding: null,
    });
    const stream = await store.blobs.open(ref);

    await store.garbageCollection.schedule();
    expect(await store.blobs.exists(ref)).toBe(true);
    expect((await new Response(stream).arrayBuffer()).byteLength).toBe(ref.size);

    await vi.waitFor(async () => {
      await store.garbageCollection.schedule();
      expect(await store.blobs.exists(ref)).toBe(false);
    });
    await store.garbageCollection.close();
  });

  it("fences an expired GC writer immediately before deleting an unreferenced blob", async () => {
    let leaseNow = Date.now();
    const root = path.join(tempRoot, "store");
    const leaseOptions = { ttlMs: 100, waitMs: 0, pollMs: 1, now: () => leaseNow };
    const store = new FilesystemStore(root, {
      lease: leaseOptions,
      garbageCollection: { minimumAgeMs: 0, now: () => leaseNow },
    });
    await store.initialize();
    const ref = await writeBlobBytes(store.blobs, Buffer.from("must survive stale GC", "utf8"), {
      mediaType: "text/plain",
      contentEncoding: null,
    });
    const original = store.blobs.collectGarbage.bind(store.blobs);
    let releaseDelete: (() => void) | undefined;
    const deleteReleased = new Promise<void>((resolve) => {
      releaseDelete = resolve;
    });
    let markDeleteReached: (() => void) | undefined;
    const deleteReached = new Promise<void>((resolve) => {
      markDeleteReached = resolve;
    });
    vi.spyOn(store.blobs, "collectGarbage").mockImplementation((referenced, context, options) =>
      original(referenced, context, {
        ...options,
        beforeDelete: async () => {
          markDeleteReached?.();
          await deleteReleased;
          await options?.beforeDelete?.();
        },
      }),
    );

    const collecting = store.garbageCollection.schedule();
    await deleteReached;
    leaseNow += 101;
    const replacement = await FileLease.acquire(root, leaseOptions);
    await replacement.release();
    releaseDelete?.();

    await expect(collecting).rejects.toMatchObject({ code: "STORE_LOCKED", retryable: true });
    expect(await store.blobs.exists(ref)).toBe(true);
    await store.garbageCollection.close();
  });

  it("coalesces concurrent garbage-collection requests into one sweep", async () => {
    const store = new FilesystemStore(path.join(tempRoot, "store"), {
      garbageCollection: { minimumAgeMs: 0 },
    });
    await store.initialize();
    const collect = vi.spyOn(store.blobs, "collectGarbage");

    await Promise.all([
      store.garbageCollection.schedule(),
      store.garbageCollection.schedule(),
      store.garbageCollection.schedule(),
    ]);

    expect(collect).toHaveBeenCalledOnce();
    await store.garbageCollection.close();
  });

  it("does not rescan for repeated schedules while a deferred sweep is armed", async () => {
    const store = new FilesystemStore(path.join(tempRoot, "store"), {
      garbageCollection: { minimumAgeMs: 10_000 },
    });
    await store.initialize();
    const collect = vi.spyOn(store.blobs, "collectGarbage");

    await store.garbageCollection.schedule();
    await Promise.all(Array.from({ length: 100 }, () => store.garbageCollection.schedule()));

    expect(collect).toHaveBeenCalledOnce();
    await store.garbageCollection.close();
  });

  it("re-arms when the deferred deadline is absorbed by a long immediate sweep", async () => {
    const store = new FilesystemStore(path.join(tempRoot, "store"), {
      garbageCollection: { minimumAgeMs: 50 },
    });
    await store.initialize();
    const collectGarbage = store.blobs.collectGarbage.bind(store.blobs);
    let releaseFirst: (() => void) | undefined;
    const firstReleased = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let calls = 0;
    vi.spyOn(store.blobs, "collectGarbage").mockImplementation(async (...arguments_) => {
      calls += 1;
      if (calls === 1) await firstReleased;
      return collectGarbage(...arguments_);
    });

    const scheduled = store.garbageCollection.schedule();
    await vi.waitFor(() => expect(calls).toBe(1));
    await new Promise<void>((resolve) => setTimeout(resolve, 75));
    releaseFirst?.();
    await scheduled;

    await vi.waitFor(() => expect(calls).toBeGreaterThanOrEqual(2), { timeout: 1000 });
    await store.garbageCollection.close();
  });

  it("detects corrupted referenced blobs without changing visibility", async () => {
    const root = path.join(tempRoot, "store");
    const store = new FilesystemStore(root);
    await store.initialize();
    const bytes = Buffer.from("immutable", "utf8");
    const ref = await writeBlobBytes(store.blobs, bytes, { mediaType: "text/plain", contentEncoding: null });
    const blobPath = path.join(root, "blobs", "sha256", ref.sha256.slice(0, 2), ref.sha256);
    await fs.writeFile(blobPath, "corrupt", "utf8");

    await expect(store.blobs.open(ref)).rejects.toThrow("size");
  });
});

describe("durability and lease primitives", () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "snaperro-v2-primitives-"));
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("replaces files atomically without leaving temp files", async () => {
    const target = path.join(tempRoot, "nested", "catalog.json");
    await atomicWriteFile(target, "before");
    await atomicWriteFile(target, "after");
    expect(await fs.readFile(target, "utf8")).toBe("after");
    expect((await fs.readdir(path.dirname(target))).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("excludes concurrent writers and reclaims expired or malformed leases", async () => {
    const lease = await FileLease.acquire(tempRoot, { waitMs: 0 });
    await expect(FileLease.acquire(tempRoot, { waitMs: 0 })).rejects.toBeInstanceOf(LeaseBusyError);
    await lease.release();

    const leasePath = path.join(tempRoot, ".store.lease");
    await fs.writeFile(leasePath, "partial", "utf8");
    const old = new Date("2000-01-01T00:00:00.000Z");
    await fs.utimes(leasePath, old, old);
    const reclaimed = await FileLease.acquire(tempRoot, { ttlMs: 1_000, waitMs: 0 });
    await reclaimed.release();
    await expect(fs.access(leasePath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("fails closed when an existing lease record cannot be read", async () => {
    const lease = await FileLease.acquire(tempRoot, { waitMs: 0 });
    const readError = Object.assign(new Error("lease read failed"), { code: "EIO" });
    const realOpen = fs.open.bind(fs);
    const open = vi.spyOn(fs, "open");
    open.mockImplementationOnce(realOpen);
    open.mockRejectedValueOnce(readError);

    try {
      await expect(FileLease.acquire(tempRoot, { waitMs: 0 })).rejects.toBe(readError);
    } finally {
      open.mockRestore();
    }
    await expect(lease.assertOwned()).resolves.toBeUndefined();
    await lease.release();
  });

  it("fails closed when a malformed lease cannot be inspected for safe reclamation", async () => {
    const leasePath = path.join(tempRoot, ".store.lease");
    await fs.writeFile(leasePath, "partial", "utf8");
    const inspectionError = Object.assign(new Error("lease stat failed"), { code: "EIO" });
    const stat = vi.spyOn(fs, "stat").mockRejectedValueOnce(inspectionError);

    await expect(
      FileLease.acquire(tempRoot, {
        ttlMs: 1_000,
        waitMs: 0,
        now: () => Date.parse("2100-01-01T00:00:00.000Z"),
      }),
    ).rejects.toBe(inspectionError);
    stat.mockRestore();
    await expect(fs.readFile(leasePath, "utf8")).resolves.toBe("partial");
  });

  it("bounds a stuck heartbeat renewal and still starts low-level lease release", async () => {
    const storeLease = new FilesystemStoreLease(tempRoot, {
      lease: { ttlMs: 1_000, waitMs: 0 },
      renewalTimeoutMs: 25,
    });
    const handle = await storeLease.acquire();
    const renew = vi.spyOn(FileLease.prototype, "renew").mockImplementation(() => new Promise(() => undefined));
    const release = vi.spyOn(FileLease.prototype, "release");

    try {
      await expect(handle.release()).rejects.toMatchObject({ code: "STORE_LOCKED", retryable: true });
      expect(renew).toHaveBeenCalled();
      expect(release).toHaveBeenCalledOnce();
    } finally {
      release.mockRestore();
      renew.mockRestore();
    }
  });

  it("does not recreate a released lease when a timed-out renewal writes its old file handle late", async () => {
    const storeLease = new FilesystemStoreLease(tempRoot, {
      lease: { ttlMs: 300, waitMs: 0 },
      renewalTimeoutMs: 25,
    });
    const handle = await storeLease.acquire();
    const leasePath = path.join(tempRoot, ".store.lease");
    let markRenewalStarted: () => void = () => undefined;
    const renewalStarted = new Promise<void>((resolve) => {
      markRenewalStarted = resolve;
    });
    let finishLateRenewal: () => void = () => undefined;
    const lateRenewalGate = new Promise<void>((resolve) => {
      finishLateRenewal = resolve;
    });
    let markLateWriteDone: () => void = () => undefined;
    const lateWriteDone = new Promise<void>((resolve) => {
      markLateWriteDone = resolve;
    });
    const realRenew = FileLease.prototype.renew;
    const renew = vi
      .spyOn(FileLease.prototype, "renew")
      .mockImplementationOnce(async function (this: FileLease) {
        const lateHandle = await fs.open(this.leasePath, "r+");
        markRenewalStarted();
        await lateRenewalGate;
        try {
          await lateHandle.write(Buffer.from("late"), 0, 4, 0);
          await lateHandle.sync();
        } finally {
          await lateHandle.close();
          markLateWriteDone();
        }
      })
      .mockImplementation(function (this: FileLease) {
        return realRenew.call(this);
      });

    try {
      await renewalStarted;
      await expect(handle.release()).rejects.toMatchObject({ code: "STORE_LOCKED", retryable: true });
      await vi.waitFor(() => expect(fs.access(leasePath)).rejects.toMatchObject({ code: "ENOENT" }));
      finishLateRenewal();
      await lateWriteDone;
      await expect(fs.access(leasePath)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      finishLateRenewal();
      renew.mockRestore();
    }
  });

  it("keeps the store operation failure primary when lease release also fails", async () => {
    const storeLease = new FilesystemStoreLease(tempRoot, { lease: { waitMs: 0 } });
    const primary = new Error("operation failed");
    const cleanup = new Error("release failed");
    const release = vi.spyOn(FileLease.prototype, "release").mockRejectedValue(cleanup);

    try {
      const failure = await storeLease.withVisibilityFence(async () => Promise.reject(primary)).catch((error) => error);
      expect(failure).toBe(primary);
      expect(release).toHaveBeenCalledOnce();
    } finally {
      release.mockRestore();
    }
  });

  it("does not let an expired owner release a replacement owner's lease", async () => {
    let leaseNow = Date.parse(NOW);
    const options = { ttlMs: 1_000, waitMs: 0, now: () => leaseNow };
    const expired = await FileLease.acquire(tempRoot, options);
    leaseNow += 1_001;
    const replacement = await FileLease.acquire(tempRoot, options);

    await expect(expired.release()).rejects.toBeInstanceOf(LeaseBusyError);
    await expect(replacement.assertOwned()).resolves.toBeUndefined();
    await replacement.release();
  });

  it("fences a writer when a stale reclaimer removes its newly acquired lease before catalog rename", async () => {
    const root = path.join(tempRoot, "store");
    const store = new FilesystemStore(root, { lease: { waitMs: 0 } });
    await store.initialize();
    const zero = RevisionSchema.parse(0);
    const one = RevisionSchema.parse(1);
    const folder = FolderSchema.parse({
      id: newFolderId(),
      name: "must-not-commit",
      revision: zero,
      createdAt: NOW,
      updatedAt: NOW,
    });
    const next = CatalogSnapshotSchema.parse({
      schemaVersion: V2_SCHEMA_VERSION,
      revision: one,
      mode: "smart",
      currentScenarioId: null,
      folders: [folder],
      scenarios: [],
    });
    let fenceCalls = 0;
    let replacement: FileLease | undefined;
    const staleReclaimerFence: VisibilityFencePort = {
      withVisibilityFence: async (operation, context) => {
        fenceCalls += 1;
        if (fenceCalls === 2) {
          await fs.unlink(path.join(root, ".store.lease"));
          replacement = await FileLease.acquire(root, { waitMs: 0 });
        }
        return store.lease.withVisibilityFence(operation, context);
      },
    };
    const repository = new FilesystemCatalogRepository(store.layout, staleReclaimerFence);
    const coordinator = new ProcessWriteCoordinator(store.lease);

    await expect(coordinator.withCatalogWrite(() => repository.compareAndSwap(zero, next))).rejects.toMatchObject({
      code: "STORE_LOCKED",
      retryable: true,
    });
    expect(await store.catalogs.read()).toMatchObject({ revision: zero, folders: [] });
    await replacement?.release();
  });

  it("implements the application store lease contract", async () => {
    const store = new FilesystemStore(path.join(tempRoot, "store"), { lease: { waitMs: 0 } });
    await store.initialize();
    const handle = await store.lease.acquire();
    expect(handle.owner).toMatch(/^[0-9a-f-]{36}$/u);
    await expect(store.lease.acquire()).rejects.toBeInstanceOf(StoreLockedError);
    await handle.release();
  });

  it("does not revive an expired application lease during the visibility check", async () => {
    let leaseNow = Date.parse(NOW);
    const store = new FilesystemStore(path.join(tempRoot, "store"), {
      lease: { ttlMs: 3_000, waitMs: 0, now: () => leaseNow },
    });
    await store.initialize();
    const handle = await store.lease.acquire();
    leaseNow += 3_001;

    await expect(handle.assertOwned()).rejects.toMatchObject({ code: "STORE_LOCKED", retryable: true });
    await expect(handle.release()).rejects.toMatchObject({ code: "STORE_LOCKED", retryable: true });
  });

  it("fences an expired writer before catalog visibility and preserves the replacement writer", async () => {
    const root = path.join(tempRoot, "store");
    let leaseNow = Date.parse(NOW);
    const lease = { ttlMs: 3_000, waitMs: 0, now: () => leaseNow };
    const storeA = new FilesystemStore(root, { lease });
    const storeB = new FilesystemStore(root, { lease });
    await storeA.initialize();

    let releaseGate: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    let reachedFence: (() => void) | undefined;
    const atFence = new Promise<void>((resolve) => {
      reachedFence = resolve;
    });
    const gatedFence: VisibilityFencePort = {
      withVisibilityFence: async (operation, context) => {
        reachedFence?.();
        await gate;
        return storeA.lease.withVisibilityFence(operation, context);
      },
    };
    const catalogA = new FilesystemCatalogRepository(storeA.layout, gatedFence);
    const coordinatorA = new ProcessWriteCoordinator(storeA.lease);
    const coordinatorB = new ProcessWriteCoordinator(storeB.lease);
    const zero = RevisionSchema.parse(0);
    const one = RevisionSchema.parse(1);
    const folderA = FolderSchema.parse({
      id: newFolderId(),
      name: "writer-a",
      revision: zero,
      createdAt: NOW,
      updatedAt: NOW,
    });
    const folderB = FolderSchema.parse({
      id: newFolderId(),
      name: "writer-b",
      revision: zero,
      createdAt: NOW,
      updatedAt: NOW,
    });
    const nextFor = (folder: typeof folderA) =>
      CatalogSnapshotSchema.parse({
        schemaVersion: V2_SCHEMA_VERSION,
        revision: one,
        mode: "smart",
        currentScenarioId: null,
        folders: [folder],
        scenarios: [],
      });

    const writerA = coordinatorA.withCatalogWrite(() => catalogA.compareAndSwap(zero, nextFor(folderA)));
    await atFence;
    leaseNow += 3_001;
    await coordinatorB.withCatalogWrite(() => storeB.catalogs.compareAndSwap(zero, nextFor(folderB)));
    releaseGate?.();

    await expect(writerA).rejects.toMatchObject({ code: "STORE_LOCKED", retryable: true });
    expect(await storeB.catalogs.read()).toEqual(nextFor(folderB));
    expect((await fs.readdir(root)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("serializes direct catalog CAS validation with its commit across repositories", async () => {
    const root = path.join(tempRoot, "store");
    const storeA = new FilesystemStore(root);
    const storeB = new FilesystemStore(root);
    await storeA.initialize();

    let releaseGate: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    let reachedFence: (() => void) | undefined;
    const atFence = new Promise<void>((resolve) => {
      reachedFence = resolve;
    });
    let fenceCalls = 0;
    const gatedFence: VisibilityFencePort = {
      withVisibilityFence: async (operation, context) => {
        fenceCalls += 1;
        if (fenceCalls === 1) {
          reachedFence?.();
          await gate;
        }
        return storeA.lease.withVisibilityFence(operation, context);
      },
    };
    const catalogA = new FilesystemCatalogRepository(storeA.layout, gatedFence);
    const zero = RevisionSchema.parse(0);
    const one = RevisionSchema.parse(1);
    const folderA = FolderSchema.parse({
      id: newFolderId(),
      name: "writer-a",
      revision: zero,
      createdAt: NOW,
      updatedAt: NOW,
    });
    const folderB = FolderSchema.parse({
      id: newFolderId(),
      name: "writer-b",
      revision: zero,
      createdAt: NOW,
      updatedAt: NOW,
    });
    const nextFor = (folder: typeof folderA) =>
      CatalogSnapshotSchema.parse({
        schemaVersion: V2_SCHEMA_VERSION,
        revision: one,
        mode: "smart",
        currentScenarioId: null,
        folders: [folder],
        scenarios: [],
      });

    const writerA = catalogA.compareAndSwap(zero, nextFor(folderA));
    await atFence;
    await storeB.catalogs.compareAndSwap(zero, nextFor(folderB));
    releaseGate?.();

    await expect(writerA).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    expect(await storeB.catalogs.read()).toEqual(nextFor(folderB));
  });
});
