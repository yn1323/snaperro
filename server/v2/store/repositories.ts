import fs from "node:fs/promises";
import {
  type CatalogSnapshot,
  CatalogSnapshotSchema,
  type ScenarioManifest,
  ScenarioManifestSchema,
} from "../../../shared/contracts-v2/entities.js";
import {
  nextRevision,
  type Revision,
  RevisionSchema,
  type ScenarioId,
} from "../../../shared/contracts-v2/primitives.js";
import type {
  CatalogRepositoryPort,
  OperationContext,
  RecordingCommit,
  RecordingCommitPort,
  RecordingCommitResult,
  ScenarioManifestRepositoryPort,
  VisibilityFencePort,
} from "../application/ports.js";
import {
  assertCatalogSerializedLimit,
  assertPersistedCatalogSerializedLimit,
  assertScenarioManifestSerializedLimit,
} from "../domain/aggregate-limits.js";
import {
  EntityAlreadyExistsError,
  EntityNotFoundError,
  InvariantViolationError,
  RevisionConflictError,
} from "../domain/errors.js";
import { atomicWriteFile, atomicWriteFileWithCommitFence, atomicWriteJson } from "./atomic.js";
import {
  catalogSnapshot,
  readManifestGeneration,
  readPersistedCatalog,
  StoreLayout,
  serializePersistedCatalog,
  stageManifestGeneration,
  throwIfAborted,
} from "./layout.js";
import type { PersistedCatalog } from "./types.js";

abstract class FilesystemRepository {
  protected readonly layout: StoreLayout;

  constructor(
    root: string | StoreLayout,
    private readonly visibilityFence?: VisibilityFencePort,
  ) {
    this.layout = typeof root === "string" ? new StoreLayout(root) : root;
  }

  protected async run<Result>(context: OperationContext, operation: () => Promise<Result>): Promise<Result> {
    throwIfAborted(context);
    const fence = this.visibilityFence;
    if (!fence) return operation();

    // CAS validation and its visibility-changing rename must share one lease.
    // Fencing only the final rename allows two direct repository callers to
    // validate the same revision and then overwrite each other sequentially.
    return fence.withVisibilityFence(async () => {
      throwIfAborted(context);
      return operation();
    }, context);
  }

  protected async commitCatalog(catalog: PersistedCatalog, context: OperationContext): Promise<void> {
    // Perform validation and serialization before the fence so ownership is
    // checked as close as possible to the visibility-changing rename.
    assertPersistedCatalogSerializedLimit(catalog);
    const serialized = serializePersistedCatalog(catalog);
    throwIfAborted(context);
    const fence = this.visibilityFence;
    if (fence) {
      await atomicWriteFileWithCommitFence(this.layout.catalogPath, serialized, (commit) =>
        fence.withVisibilityFence(async () => {
          throwIfAborted(context);
          await commit();
        }, context),
      );
      return;
    }
    await atomicWriteFile(this.layout.catalogPath, serialized);
  }
}

// Application writes run inside WriteCoordinatorPort, whose outer catalog
// critical section owns FilesystemStoreLease. The visibility fence reuses that
// scoped handle; direct repository callers acquire a short implicit lease.

function assertNextRevision(expected: Revision, actual: Revision, label: string): void {
  if (actual !== nextRevision(expected)) {
    throw new InvariantViolationError(`${label} must advance by exactly one revision`, { expected, actual });
  }
}

async function pointersForCatalogChange(
  layout: StoreLayout,
  current: PersistedCatalog,
  next: CatalogSnapshot,
): Promise<Record<string, Revision>> {
  const pointers: Record<string, Revision> = {};
  for (const scenario of next.scenarios) {
    const currentPointer = current.manifestRevisions[scenario.id];
    if (currentPointer !== undefined) {
      pointers[scenario.id] = currentPointer;
      continue;
    }

    const initialRevision = RevisionSchema.parse(0);
    const initialManifest = await readManifestGeneration(layout, scenario.id, initialRevision);
    if (initialManifest.recordings.length !== scenario.recordingsCount) {
      throw new InvariantViolationError("New scenario count does not match its staged manifest", {
        scenarioId: scenario.id,
      });
    }
    pointers[scenario.id] = initialRevision;
  }
  return pointers;
}

export class FilesystemCatalogRepository extends FilesystemRepository implements CatalogRepositoryPort {
  async read(context: OperationContext = {}): Promise<CatalogSnapshot> {
    throwIfAborted(context);
    return catalogSnapshot(await readPersistedCatalog(this.layout));
  }

  async compareAndSwap(
    expectedRevision: Revision,
    next: CatalogSnapshot,
    context: OperationContext = {},
  ): Promise<CatalogSnapshot> {
    assertCatalogSerializedLimit(next);
    const parsedNext = CatalogSnapshotSchema.parse(next);
    return this.run(context, async () => {
      const current = await readPersistedCatalog(this.layout);
      if (current.revision !== expectedRevision) throw new RevisionConflictError(expectedRevision, current.revision);
      assertNextRevision(expectedRevision, parsedNext.revision, "Catalog");

      const persisted: PersistedCatalog = {
        ...parsedNext,
        manifestRevisions: await pointersForCatalogChange(this.layout, current, parsedNext),
      };
      await this.commitCatalog(persisted, context);
      return catalogSnapshot(persisted);
    });
  }
}

export class FilesystemScenarioManifestRepository
  extends FilesystemRepository
  implements ScenarioManifestRepositoryPort
{
  async read(scenarioId: ScenarioId, context: OperationContext = {}): Promise<ScenarioManifest> {
    throwIfAborted(context);
    const catalog = await readPersistedCatalog(this.layout);
    const revision = catalog.manifestRevisions[scenarioId];
    if (revision === undefined) throw new EntityNotFoundError("scenario", scenarioId);
    return readManifestGeneration(this.layout, scenarioId, revision);
  }

  async readAtRevision(
    scenarioId: ScenarioId,
    expectedCatalogRevision: Revision,
    expectedScenarioRevision: Revision,
    context: OperationContext = {},
  ): Promise<ScenarioManifest> {
    return this.run(context, async () => {
      const catalog = await readPersistedCatalog(this.layout);
      if (catalog.revision !== expectedCatalogRevision) {
        throw new RevisionConflictError(expectedCatalogRevision, catalog.revision);
      }
      const revision = catalog.manifestRevisions[scenarioId];
      if (revision === undefined) throw new EntityNotFoundError("scenario", scenarioId);
      if (revision !== expectedScenarioRevision) {
        throw new RevisionConflictError(expectedScenarioRevision, revision);
      }
      return readManifestGeneration(this.layout, scenarioId, revision);
    });
  }

  async create(manifest: ScenarioManifest, context: OperationContext = {}): Promise<void> {
    assertScenarioManifestSerializedLimit(manifest);
    const parsed = ScenarioManifestSchema.parse(manifest);
    if (parsed.revision !== 0) {
      throw new InvariantViolationError("A new scenario manifest must start at revision zero");
    }
    await this.run(context, async () => {
      const target = this.layout.manifestPath(parsed.scenarioId, parsed.revision);
      try {
        await fs.access(target);
        throw new EntityAlreadyExistsError("scenarioManifest", parsed.scenarioId);
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      }
      await stageManifestGeneration(this.layout, parsed);
    });
  }

  async markForGarbageCollection(scenarioId: ScenarioId, context: OperationContext = {}): Promise<void> {
    await this.run(context, async () => {
      await atomicWriteJson(this.layout.manifestGarbageMarker(scenarioId), {
        schemaVersion: 1,
        scenarioId,
        markedAt: new Date().toISOString(),
      });
    });
  }
}

function assertRecordingCommitScope(current: CatalogSnapshot, next: CatalogSnapshot, scenarioId: ScenarioId): void {
  if (current.mode !== next.mode || current.currentScenarioId !== next.currentScenarioId) {
    throw new InvariantViolationError("A recording commit cannot change catalog selection or mode");
  }
  if (JSON.stringify(current.folders) !== JSON.stringify(next.folders)) {
    throw new InvariantViolationError("A recording commit cannot change folders");
  }
  const currentIds = current.scenarios.map((scenario) => scenario.id).sort();
  const nextIds = next.scenarios.map((scenario) => scenario.id).sort();
  if (JSON.stringify(currentIds) !== JSON.stringify(nextIds)) {
    throw new InvariantViolationError("A recording commit cannot add or remove scenarios");
  }
  for (const scenario of current.scenarios) {
    if (scenario.id === scenarioId) continue;
    const nextScenario = next.scenarios.find((candidate) => candidate.id === scenario.id);
    if (JSON.stringify(scenario) !== JSON.stringify(nextScenario)) {
      throw new InvariantViolationError("A recording commit cannot change another scenario", {
        scenarioId: scenario.id,
      });
    }
  }
  const currentScenario = current.scenarios.find((scenario) => scenario.id === scenarioId);
  const nextScenario = next.scenarios.find((scenario) => scenario.id === scenarioId);
  if (!currentScenario || !nextScenario) throw new EntityNotFoundError("scenario", scenarioId);
  if (
    currentScenario.folderId !== nextScenario.folderId ||
    currentScenario.name !== nextScenario.name ||
    currentScenario.createdAt !== nextScenario.createdAt
  ) {
    throw new InvariantViolationError("A recording commit cannot change scenario identity fields");
  }
  if (nextScenario.revision !== nextRevision(currentScenario.revision)) {
    throw new InvariantViolationError("A recording commit must advance the scenario revision by one");
  }
}

export class FilesystemRecordingCommitRepository extends FilesystemRepository implements RecordingCommitPort {
  async compareAndSwap(commit: RecordingCommit, context: OperationContext = {}): Promise<RecordingCommitResult> {
    assertCatalogSerializedLimit(commit.catalog);
    assertScenarioManifestSerializedLimit(commit.manifest);
    const nextCatalog = CatalogSnapshotSchema.parse(commit.catalog);
    const nextManifest = ScenarioManifestSchema.parse(commit.manifest);
    if (nextManifest.scenarioId !== commit.scenarioId) {
      throw new InvariantViolationError("Recording commit manifest belongs to another scenario");
    }
    assertNextRevision(commit.expectedCatalogRevision, nextCatalog.revision, "Catalog");
    assertNextRevision(commit.expectedScenarioRevision, nextManifest.revision, "Scenario manifest");

    return this.run(context, async () => {
      const current = await readPersistedCatalog(this.layout);
      if (current.revision !== commit.expectedCatalogRevision) {
        throw new RevisionConflictError(commit.expectedCatalogRevision, current.revision);
      }
      const actualManifestRevision = current.manifestRevisions[commit.scenarioId];
      if (actualManifestRevision === undefined) throw new EntityNotFoundError("scenario", commit.scenarioId);
      if (actualManifestRevision !== commit.expectedScenarioRevision) {
        throw new RevisionConflictError(commit.expectedScenarioRevision, actualManifestRevision);
      }

      const currentSnapshot = catalogSnapshot(current);
      assertRecordingCommitScope(currentSnapshot, nextCatalog, commit.scenarioId);
      const nextScenario = nextCatalog.scenarios.find((scenario) => scenario.id === commit.scenarioId);
      if (!nextScenario) throw new EntityNotFoundError("scenario", commit.scenarioId);
      if (nextScenario.recordingsCount !== nextManifest.recordings.length) {
        throw new InvariantViolationError("Scenario count does not match the next manifest");
      }

      // A failure after staging but before the catalog marker leaves N+1 at a
      // deterministic path. Because the outer lease has just revalidated that
      // N is still visible, a differing N+1 is an unreferenced crash orphan and
      // can be replaced for an immediate retry. The visible generation is
      // never eligible for replacement.
      await stageManifestGeneration(this.layout, nextManifest, {
        replaceCrashOrphanAfter: actualManifestRevision,
      });
      throwIfAborted(context);
      await this.commitCatalog(
        {
          ...nextCatalog,
          manifestRevisions: {
            ...current.manifestRevisions,
            [commit.scenarioId]: nextManifest.revision,
          },
        },
        context,
      );
      return { catalog: nextCatalog, manifest: nextManifest };
    });
  }
}
