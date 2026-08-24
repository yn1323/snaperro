import { describe, expect, it } from "vitest";
import { RevisionSchema } from "../../../shared/contracts-v2/primitives.js";
import { RevisionConflictError } from "../domain/errors.js";
import { CatalogService } from "./catalog-service.js";
import {
  applicationTestIds,
  CapturingLogger,
  catalogFixture,
  FakeEventHub,
  FixedClock,
  MemoryCatalogRepository,
  MemoryManifestRepository,
  MutexWriteCoordinator,
  manifestFixture,
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
    subject: new CatalogService({
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

describe("CatalogService", () => {
  it("commits a command even when its post-commit event cannot be published", async () => {
    const harness = service(catalogFixture({ includeScenario: false }));
    harness.events.fail = true;

    const result = await harness.subject.createFolder({
      protocolVersion: 2,
      commandId: applicationTestIds.command,
      type: "folder.create",
      expectedRevision: harness.catalogs.snapshot.revision,
      name: "Committed",
    });

    expect(result.revision).toBe(1);
    expect(harness.catalogs.snapshot.folders.some((folder) => folder.name === "Committed")).toBe(true);
    expect(harness.logger.errors).toHaveLength(1);
  });

  it("deletes a folder as one cascade event and clears the current scenario atomically", async () => {
    const harness = service();

    const result = await harness.subject.deleteFolder({
      protocolVersion: 2,
      commandId: applicationTestIds.command,
      type: "folder.delete",
      expectedRevision: harness.catalogs.snapshot.revision,
      folderId: applicationTestIds.folder,
    });

    expect(result.deletedScenarioIds).toEqual([applicationTestIds.scenario]);
    expect(harness.catalogs.snapshot).toMatchObject({ currentScenarioId: null, folders: [], scenarios: [] });
    expect(harness.events.published).toEqual([
      expect.objectContaining({
        type: "folder.deleted",
        revision: 1,
        payload: { folderId: applicationTestIds.folder },
      }),
    ]);
    expect(harness.manifests.garbage).toEqual(new Set([applicationTestIds.scenario]));
  });

  it("serializes concurrent writes so a stale expected revision cannot overwrite the winner", async () => {
    const harness = service(catalogFixture({ includeScenario: false }));
    const command = {
      protocolVersion: 2 as const,
      commandId: applicationTestIds.command,
      type: "folder.create" as const,
      expectedRevision: harness.catalogs.snapshot.revision,
    };

    const results = await Promise.allSettled([
      harness.subject.createFolder({ ...command, name: "One" }),
      harness.subject.createFolder({ ...command, name: "Two" }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected).toMatchObject({ status: "rejected", reason: expect.any(RevisionConflictError) });
    expect(harness.catalogs.snapshot.revision).toBe(1);
    expect(harness.catalogs.snapshot.folders).toHaveLength(2);
  });

  it("keeps committed event order aligned with catalog revision order", async () => {
    const harness = service();
    let signalFirstPublish: (() => void) | undefined;
    let releaseFirstPublish: (() => void) | undefined;
    const firstPublishStarted = new Promise<void>((resolve) => {
      signalFirstPublish = resolve;
    });
    const firstPublishReleased = new Promise<void>((resolve) => {
      releaseFirstPublish = resolve;
    });
    harness.events.beforePublish = async (draft) => {
      if (draft.revision !== 1) return;
      signalFirstPublish?.();
      await firstPublishReleased;
    };

    const first = harness.subject.setMode({
      protocolVersion: 2,
      commandId: applicationTestIds.command,
      type: "mode.set",
      expectedRevision: harness.catalogs.snapshot.revision,
      mode: "record",
    });
    await firstPublishStarted;
    const second = harness.subject.selectScenario({
      protocolVersion: 2,
      commandId: applicationTestIds.command,
      type: "scenario.select",
      expectedRevision: RevisionSchema.parse(1),
      scenarioId: null,
    });
    releaseFirstPublish?.();

    await Promise.all([first, second]);
    expect(harness.events.published.map((event) => event.revision)).toEqual([1, 2]);
  });
});
