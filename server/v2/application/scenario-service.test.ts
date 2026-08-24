import { describe, expect, it } from "vitest";
import { RecordingDraftSchema } from "../../../shared/contracts-v2/entities.js";
import { V2_SCHEMA_VERSION } from "../../../shared/contracts-v2/primitives.js";
import { EntityAlreadyExistsError } from "../domain/errors.js";
import type { BlobStorePort } from "./ports.js";
import { ApplicationQueryService } from "./query-service.js";
import { RecordingService } from "./recording-service.js";
import { ScenarioService } from "./scenario-service.js";
import {
  applicationTestIds,
  CapturingLogger,
  catalogFixture,
  FakeEventHub,
  FakeGarbageCollection,
  FixedClock,
  MemoryCatalogRepository,
  MemoryManifestRepository,
  MemoryRecordingCommit,
  MutexWriteCoordinator,
  manifestFixture,
  recordingFixture,
  SequentialIds,
} from "./test-doubles.js";

function service(catalog = catalogFixture(), manifests = new MemoryManifestRepository([manifestFixture()])) {
  const catalogs = new MemoryCatalogRepository(catalog);
  const events = new FakeEventHub();
  const logger = new CapturingLogger();
  return {
    catalogs,
    manifests,
    events,
    logger,
    subject: new ScenarioService({
      catalogs,
      manifests,
      events,
      logger,
      writes: new MutexWriteCoordinator(),
      ids: new SequentialIds(),
      clock: new FixedClock(),
    }),
  };
}

describe("ScenarioService", () => {
  it("creates the manifest before exposing the scenario in the catalog", async () => {
    const harness = service(catalogFixture({ includeScenario: false }), new MemoryManifestRepository());

    const result = await harness.subject.create({
      protocolVersion: 2,
      commandId: applicationTestIds.command,
      type: "scenario.create",
      expectedRevision: harness.catalogs.snapshot.revision,
      folderId: applicationTestIds.folder,
      name: "Created",
    });

    expect(await harness.manifests.read(result.scenario.id)).toMatchObject({ revision: 0, recordings: [] });
    expect(harness.catalogs.snapshot.scenarios).toContainEqual(result.scenario);
    expect(harness.events.published).toEqual([
      expect.objectContaining({
        type: "scenario.upserted",
        revision: 1,
        payload: { scenario: { id: result.scenario.id, folderId: applicationTestIds.folder, name: "Created" } },
      }),
    ]);
  });

  it("keeps the recording ETag stable across rename and permits the next recording commit", async () => {
    const harness = service(catalogFixture({ includeScenario: false }), new MemoryManifestRepository());
    const created = await harness.subject.create({
      protocolVersion: V2_SCHEMA_VERSION,
      commandId: applicationTestIds.command,
      type: "scenario.create",
      expectedRevision: harness.catalogs.snapshot.revision,
      folderId: applicationTestIds.folder,
      name: "Before",
    });
    expect(created.scenario.revision).toBe(0);

    const renamed = await harness.subject.rename({
      protocolVersion: V2_SCHEMA_VERSION,
      commandId: applicationTestIds.command,
      type: "scenario.rename",
      expectedRevision: created.revision,
      scenarioId: created.scenario.id,
      name: "After",
    });
    expect(renamed.scenario).toMatchObject({ name: "After", revision: 0 });

    const blobs = {
      exists: async () => true,
      open: async () => new Blob([]).stream(),
    } as unknown as BlobStorePort;
    const queries = new ApplicationQueryService({
      blobs,
      catalogs: harness.catalogs,
      manifests: harness.manifests,
      folderExports: { prepare: async () => Promise.reject(new Error("unused folder export")) },
      recordingExports: { prepareRecording: async () => Promise.reject(new Error("unused recording export")) },
      bodyDownloads: { prepareBody: async () => Promise.reject(new Error("unused body download")) },
      runtimeId: applicationTestIds.runtime,
      version: "2.0.0-test",
    });
    const [getResult, listResult] = await Promise.all([
      queries.getScenario({
        protocolVersion: V2_SCHEMA_VERSION,
        type: "scenario.get",
        scenarioId: created.scenario.id,
      }),
      queries.listScenarios({ protocolVersion: V2_SCHEMA_VERSION, type: "scenario.list" }),
    ]);
    expect(getResult).toMatchObject({ revision: 2, scenario: { id: created.scenario.id, revision: 0 } });
    expect(listResult.scenarios).toContainEqual(expect.objectContaining({ id: created.scenario.id, revision: 0 }));

    const commits = new MemoryRecordingCommit(harness.catalogs, harness.manifests);
    const recordings = new RecordingService({
      blobs,
      catalogs: harness.catalogs,
      manifests: harness.manifests,
      commits,
      garbageCollection: new FakeGarbageCollection(),
      writes: new MutexWriteCoordinator(),
      events: harness.events,
      ids: new SequentialIds(),
      clock: new FixedClock(),
      logger: harness.logger,
    });
    const recorded = await recordings.create({
      protocolVersion: V2_SCHEMA_VERSION,
      commandId: applicationTestIds.command,
      type: "recording.create",
      scenarioId: created.scenario.id,
      expectedScenarioRevision: renamed.scenario.revision,
      filename: "after-rename.json",
      recording: RecordingDraftSchema.parse({
        route: "/after-rename",
        method: "GET",
        request: { pathParams: {}, query: [], headers: [], body: null },
        response: { status: 200, statusText: "OK", headers: [], body: null },
      }),
    });

    expect(recorded.scenarioRevision).toBe(1);
    expect((await harness.manifests.read(created.scenario.id)).revision).toBe(1);
    expect(harness.catalogs.snapshot.scenarios[0]?.revision).toBe(1);
  });

  it("duplicates metadata with new stable IDs while retaining immutable body references", async () => {
    const sourceRecording = recordingFixture();
    const harness = service(
      catalogFixture({ includeOtherFolder: true, recordingsCount: 1 }),
      new MemoryManifestRepository([manifestFixture([sourceRecording])]),
    );

    const result = await harness.subject.duplicate({
      protocolVersion: 2,
      commandId: applicationTestIds.command,
      type: "scenario.duplicate",
      expectedRevision: harness.catalogs.snapshot.revision,
      scenarioId: applicationTestIds.scenario,
      destinationFolderId: applicationTestIds.otherFolder,
      name: "Copy",
    });

    const duplicate = await harness.manifests.read(result.scenario.id);
    expect(duplicate.recordings).toHaveLength(1);
    expect(duplicate.recordings[0]).toMatchObject({
      scenarioId: result.scenario.id,
      revision: 0,
      response: { body: sourceRecording.response.body },
    });
    expect(duplicate.recordings[0]?.id).not.toBe(sourceRecording.id);
    expect(harness.events.published).toEqual([
      expect.objectContaining({
        type: "scenario.upserted",
        revision: 1,
        payload: expect.objectContaining({
          scenario: { id: result.scenario.id, folderId: applicationTestIds.otherFolder, name: "Copy" },
          recordingsInvalidated: true,
        }),
      }),
    ]);
  });

  it("clears a deleted current scenario in the same catalog commit and schedules its manifest for GC", async () => {
    const harness = service();

    const result = await harness.subject.delete({
      protocolVersion: 2,
      commandId: applicationTestIds.command,
      type: "scenario.delete",
      expectedRevision: harness.catalogs.snapshot.revision,
      scenarioId: applicationTestIds.scenario,
    });

    expect(result.revision).toBe(1);
    expect(harness.catalogs.snapshot.currentScenarioId).toBeNull();
    expect(harness.catalogs.snapshot.scenarios).toEqual([]);
    expect(harness.manifests.garbage).toEqual(new Set([applicationTestIds.scenario]));
    expect(harness.events.published).toHaveLength(1);
    expect(harness.events.published[0]).toMatchObject({ type: "scenario.deleted" });
  });

  it("enforces canonical name uniqueness and garbage-collects a manifest orphaned by catalog CAS failure", async () => {
    const duplicateName = service();
    await expect(
      duplicateName.subject.create({
        protocolVersion: 2,
        commandId: applicationTestIds.command,
        type: "scenario.create",
        expectedRevision: duplicateName.catalogs.snapshot.revision,
        folderId: applicationTestIds.folder,
        name: "SCENARIO",
      }),
    ).rejects.toBeInstanceOf(EntityAlreadyExistsError);

    const orphan = service(catalogFixture({ includeScenario: false }), new MemoryManifestRepository());
    orphan.catalogs.failure = new Error("catalog fsync failed");
    await expect(
      orphan.subject.create({
        protocolVersion: 2,
        commandId: applicationTestIds.command,
        type: "scenario.create",
        expectedRevision: orphan.catalogs.snapshot.revision,
        folderId: applicationTestIds.folder,
        name: "Orphan",
      }),
    ).rejects.toThrow("catalog fsync failed");

    expect(orphan.manifests.garbage).toEqual(new Set(["scn_0000000000000001"]));
  });
});
