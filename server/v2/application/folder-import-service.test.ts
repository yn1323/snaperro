import { describe, expect, it, vi } from "vitest";
import {
  BodyRefSchema,
  CatalogSnapshotSchema,
  MAX_CATALOG_SCENARIOS,
  RecordingDraftSchema,
} from "../../../shared/contracts-v2/entities.js";
import {
  CommandIdSchema,
  FolderIdSchema,
  RecordingIdSchema,
  RuntimeIdSchema,
  ScenarioIdSchema,
  TransferIdSchema,
  V2_SCHEMA_VERSION,
} from "../../../shared/contracts-v2/primitives.js";
import { InvalidArgumentError } from "../domain/errors.js";
import { ProcessWriteCoordinator } from "../runtime/system-adapters.js";
import { FolderImportService, type FolderImportSourcePort } from "./folder-import-service.js";
import type {
  BlobStorePort,
  CatalogRepositoryPort,
  ClockPort,
  EventHubPort,
  GarbageCollectionPort,
  IdGeneratorPort,
  LoggerPort,
  ScenarioManifestRepositoryPort,
} from "./ports.js";

const folderId = FolderIdSchema.parse("fld_0123456789abcdef");
const scenarioId = ScenarioIdSchema.parse("scn_0123456789abcdef");
const recordingId = RecordingIdSchema.parse("rec_0123456789abcdef");
const otherRecordingId = RecordingIdSchema.parse("rec_fedcba9876543210");
const transferId = TransferIdSchema.parse("xfer_0123456789abcdef");
const commandId = CommandIdSchema.parse("cmd_0123456789abcdef");
const runtimeId = RuntimeIdSchema.parse("run_0123456789abcdef");
const timestamp = "2026-08-24T00:00:00.000Z";

function initialCatalog() {
  return CatalogSnapshotSchema.parse({
    schemaVersion: V2_SCHEMA_VERSION,
    revision: 0,
    mode: "proxy",
    currentScenarioId: null,
    folders: [],
    scenarios: [],
  });
}

function dependencies() {
  let current = initialCatalog();
  const catalogs = {
    read: vi.fn(async () => current),
    compareAndSwap: vi.fn(async (_expected, next) => {
      current = next;
      return next;
    }),
  } as CatalogRepositoryPort;
  const manifests = { create: vi.fn() } as unknown as ScenarioManifestRepositoryPort;
  let bodiesAvailable = true;
  const blobs = { exists: vi.fn(async () => bodiesAvailable) } as unknown as BlobStorePort;
  const body = BodyRefSchema.parse({
    sha256: "a".repeat(64),
    size: 2,
    mediaType: "application/json",
    contentEncoding: null,
  });
  const imports = {
    claim: vi.fn(async () => ({
      folderName: "Exported",
      scenarios: [
        {
          name: "Success",
          recordings: [
            {
              filename: "users.json",
              matchable: true,
              recording: RecordingDraftSchema.parse({
                route: "/users",
                method: "GET",
                request: { pathParams: {}, query: [], headers: [], body: null },
                response: { status: 200, statusText: "OK", headers: [], body },
              }),
            },
          ],
        },
      ],
    })),
    materializeBlobs: vi.fn(),
    complete: vi.fn(),
    release: vi.fn(),
  } as FolderImportSourcePort;
  const publish = vi.fn(async () => ({}) as never);
  const events = {
    publish,
    watermark: () => ({ runtimeId, sequence: 0 as never, revision: current.revision }),
  } as unknown as EventHubPort;
  return {
    catalogs,
    blobs,
    manifests,
    imports,
    events,
    publish,
    garbageCollection: { schedule: vi.fn() } as GarbageCollectionPort,
    ids: {
      nextFolderId: () => folderId,
      nextScenarioId: () => scenarioId,
      nextRecordingId: () => recordingId,
    } as unknown as IdGeneratorPort,
    clock: { now: () => timestamp } as ClockPort,
    logger: { error: vi.fn() } as unknown as LoggerPort,
    removeMaterializedBodies: () => {
      bodiesAvailable = false;
    },
    setCatalog: (catalog: ReturnType<typeof initialCatalog>) => {
      current = catalog;
    },
  };
}

describe("FolderImportService", () => {
  it("exposes imported catalog metadata with a bounded recording invalidation event", async () => {
    const deps = dependencies();
    const result = await new FolderImportService({
      ...deps,
      writes: new ProcessWriteCoordinator(),
    }).execute({
      protocolVersion: V2_SCHEMA_VERSION,
      type: "folder.import",
      commandId,
      expectedRevision: 0 as never,
      transferId,
      name: "Imported",
    });

    expect(result).toEqual(
      expect.objectContaining({
        revision: 1,
        folder: expect.objectContaining({ id: folderId, name: "Imported" }),
        recordingsInvalidated: true,
      }),
    );
    expect(result).not.toHaveProperty("scenarios");
    expect(deps.imports.materializeBlobs).toHaveBeenCalledBefore(deps.catalogs.compareAndSwap as never);
    expect(deps.manifests.create).toHaveBeenCalledOnce();
    expect(deps.publish).toHaveBeenCalledOnce();
    expect(deps.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "folder.upserted",
        revision: 1,
        payload: expect.objectContaining({
          recordingsInvalidated: true,
        }),
      }),
    );
    expect(deps.publish).toHaveBeenCalledWith(
      expect.objectContaining({ payload: expect.not.objectContaining({ scenarios: expect.anything() }) }),
    );
    expect(deps.publish).toHaveBeenCalledWith(
      expect.objectContaining({ payload: expect.not.objectContaining({ files: expect.anything() }) }),
    );
    expect(deps.imports.complete).toHaveBeenCalledWith(transferId, commandId);
  });

  it("holds the write order through event publication without nesting blob materialization", async () => {
    const deps = dependencies();
    const writes = new ProcessWriteCoordinator();
    let releasePublish: (() => void) | undefined;
    const publishReleased = new Promise<void>((resolve) => {
      releasePublish = resolve;
    });
    let markPublishStarted: (() => void) | undefined;
    const publishStarted = new Promise<void>((resolve) => {
      markPublishStarted = resolve;
    });
    deps.publish.mockImplementationOnce(async () => {
      markPublishStarted?.();
      await publishReleased;
      return {} as never;
    });

    const importing = new FolderImportService({ ...deps, writes }).execute({
      protocolVersion: V2_SCHEMA_VERSION,
      type: "folder.import",
      commandId,
      expectedRevision: 0 as never,
      transferId,
      name: "Imported",
    });
    await publishStarted;

    let nextWriteEntered = false;
    const nextWrite = writes.withCatalogWrite(async () => {
      nextWriteEntered = true;
    });
    await Promise.resolve();
    expect(deps.imports.materializeBlobs).toHaveBeenCalledOnce();
    expect(nextWriteEntered).toBe(false);

    releasePublish?.();
    await importing;
    await nextWrite;
    expect(nextWriteEntered).toBe(true);
  });

  it("does not expose an import when a materialized body was garbage-collected before commit", async () => {
    const deps = dependencies();
    deps.removeMaterializedBodies();

    await expect(
      new FolderImportService({ ...deps, writes: new ProcessWriteCoordinator() }).execute({
        protocolVersion: V2_SCHEMA_VERSION,
        type: "folder.import",
        commandId,
        expectedRevision: 0 as never,
        transferId,
        name: "Imported",
      }),
    ).rejects.toBeInstanceOf(InvalidArgumentError);

    expect(deps.manifests.create).not.toHaveBeenCalled();
    expect(deps.catalogs.compareAndSwap).not.toHaveBeenCalled();
    expect(deps.imports.complete).toHaveBeenCalledWith(transferId, commandId);
    expect(deps.imports.release).not.toHaveBeenCalled();
  });

  it("releases the claim after a retryable revision conflict", async () => {
    const deps = dependencies();

    await expect(
      new FolderImportService({ ...deps, writes: new ProcessWriteCoordinator() }).execute({
        protocolVersion: V2_SCHEMA_VERSION,
        type: "folder.import",
        commandId,
        expectedRevision: 1 as never,
        transferId,
        name: "Imported",
      }),
    ).rejects.toMatchObject({ code: "REVISION_CONFLICT", retryable: true });

    expect(deps.imports.release).toHaveBeenCalledWith(transferId, commandId);
    expect(deps.imports.complete).not.toHaveBeenCalled();
  });

  it("validates conflicting sizes independently when imported body references share a digest", async () => {
    const deps = dependencies();
    const archive = await deps.imports.claim(transferId, commandId);
    const valid = archive.scenarios[0]?.recordings[0]?.recording.response.body;
    if (!valid) throw new Error("Expected the fixture body");
    vi.mocked(deps.imports.claim).mockResolvedValue({
      ...archive,
      scenarios: archive.scenarios.map((scenario) => ({
        ...scenario,
        recordings: scenario.recordings.map((recording) => ({
          ...recording,
          recording: {
            ...recording.recording,
            request: { ...recording.recording.request, body: valid },
            response: { ...recording.recording.response, body: { ...valid, size: valid.size + 1 } },
          },
        })),
      })),
    });
    vi.mocked(deps.blobs.exists).mockImplementation(async (ref) => ref.size === valid.size);

    await expect(
      new FolderImportService({ ...deps, writes: new ProcessWriteCoordinator() }).execute({
        protocolVersion: V2_SCHEMA_VERSION,
        type: "folder.import",
        commandId,
        expectedRevision: 0 as never,
        transferId,
        name: "Imported",
      }),
    ).rejects.toBeInstanceOf(InvalidArgumentError);

    expect(deps.catalogs.compareAndSwap).not.toHaveBeenCalled();
  });

  it("rejects a legal archive when the shared catalog scenario limit is full without changing the catalog", async () => {
    const deps = dependencies();
    const existingFolderId = FolderIdSchema.parse("fld_fedcba9876543210");
    const fullCatalog = CatalogSnapshotSchema.parse({
      ...initialCatalog(),
      folders: [{ id: existingFolderId, name: "Existing", revision: 0, createdAt: timestamp, updatedAt: timestamp }],
      scenarios: Array.from({ length: MAX_CATALOG_SCENARIOS }, (_, index) => ({
        id: ScenarioIdSchema.parse(`scn_${index.toString(16).padStart(16, "0")}`),
        folderId: existingFolderId,
        name: `Scenario ${index}`,
        revision: 0,
        recordingsCount: 0,
        createdAt: timestamp,
        updatedAt: timestamp,
      })),
    });
    deps.setCatalog(fullCatalog);

    await expect(
      new FolderImportService({ ...deps, writes: new ProcessWriteCoordinator() }).execute({
        protocolVersion: V2_SCHEMA_VERSION,
        type: "folder.import",
        commandId,
        expectedRevision: fullCatalog.revision,
        transferId,
        name: "Imported",
      }),
    ).rejects.toMatchObject({ code: "PAYLOAD_LIMIT_EXCEEDED", retryable: false });

    expect(deps.imports.materializeBlobs).not.toHaveBeenCalled();
    expect(deps.manifests.create).not.toHaveBeenCalled();
    expect(deps.catalogs.compareAndSwap).not.toHaveBeenCalled();
    await expect(deps.catalogs.read()).resolves.toBe(fullCatalog);
  });

  it("preserves one matchable winner and its migrated duplicate shadow", async () => {
    const deps = dependencies();
    const archive = await deps.imports.claim(transferId, commandId);
    const imported = archive.scenarios[0]?.recordings[0];
    if (!imported) throw new Error("Expected an imported recording fixture");
    vi.mocked(deps.imports.claim).mockResolvedValue({
      ...archive,
      scenarios: [
        {
          ...archive.scenarios[0],
          recordings: [
            { ...imported, filename: "winner.json", matchable: true },
            { ...imported, filename: "shadow.json", matchable: false },
          ],
        },
      ],
    });
    deps.ids.nextRecordingId = vi.fn().mockReturnValueOnce(recordingId).mockReturnValueOnce(otherRecordingId);

    await new FolderImportService({ ...deps, writes: new ProcessWriteCoordinator() }).execute({
      protocolVersion: V2_SCHEMA_VERSION,
      type: "folder.import",
      commandId,
      expectedRevision: 0 as never,
      transferId,
      name: "Imported",
    });

    expect(deps.manifests.create).toHaveBeenCalledWith(
      expect.objectContaining({
        recordings: [expect.objectContaining({ matchable: true }), expect.objectContaining({ matchable: false })],
      }),
      expect.any(Object),
    );
  });

  it("rejects a sub-count-limit archive whose scenario manifest exceeds the serialized byte limit", async () => {
    const deps = dependencies();
    const archive = await deps.imports.claim(transferId, commandId);
    const imported = archive.scenarios[0]?.recordings[0];
    if (!imported) throw new Error("Expected an imported recording fixture");
    const fields = Array.from({ length: 32 }, (_, index) => [`x-${index}`, "a".repeat(8_000)] as [string, string]);
    const denseDraft = RecordingDraftSchema.parse({
      ...imported.recording,
      request: {
        ...imported.recording.request,
        pathParams: Object.fromEntries(fields),
        query: fields,
        headers: fields,
      },
      response: { ...imported.recording.response, headers: fields },
    });
    vi.mocked(deps.imports.claim).mockResolvedValue({
      ...archive,
      scenarios: [
        {
          ...archive.scenarios[0],
          recordings: Array.from({ length: 17 }, (_, index) => ({
            filename: `recording-${index}.json`,
            matchable: index === 0,
            recording: denseDraft,
          })),
        },
      ],
    });

    await expect(
      new FolderImportService({ ...deps, writes: new ProcessWriteCoordinator() }).execute({
        protocolVersion: V2_SCHEMA_VERSION,
        type: "folder.import",
        commandId,
        expectedRevision: 0 as never,
        transferId,
        name: "Imported",
      }),
    ).rejects.toMatchObject({ code: "PAYLOAD_LIMIT_EXCEEDED", retryable: false });

    expect(deps.manifests.create).not.toHaveBeenCalled();
    expect(deps.catalogs.compareAndSwap).not.toHaveBeenCalled();
    await expect(deps.catalogs.read()).resolves.toEqual(initialCatalog());
  });
});
