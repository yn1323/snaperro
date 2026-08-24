import type { CommandOf, CommandResult } from "../../../shared/contracts-v2/commands.js";
import {
  CatalogSnapshotSchema,
  FolderSchema,
  MAX_CATALOG_SCENARIOS,
  type RecordingDraft,
  RecordingDraftSchema,
  RecordingSchema,
  type ScenarioManifest,
  ScenarioManifestSchema,
  ScenarioSchema,
} from "../../../shared/contracts-v2/entities.js";
import type { CommandId, TransferId } from "../../../shared/contracts-v2/primitives.js";
import { nextRevision, V2_SCHEMA_VERSION } from "../../../shared/contracts-v2/primitives.js";
import { assertCatalogSerializedLimit, assertScenarioManifestSerializedLimit } from "../domain/aggregate-limits.js";
import { EntityAlreadyExistsError, InvalidArgumentError, isDomainError } from "../domain/errors.js";
import { normalizeRecordingRepresentation } from "../domain/http-representation.js";
import { type FingerprintedRecordingDraft, fingerprintRecordingDraft } from "../domain/request-fingerprint.js";
import type { FolderImportCommandHandlerPort } from "./bus.js";
import type {
  BlobStorePort,
  CatalogRepositoryPort,
  ClockPort,
  EventHubPort,
  GarbageCollectionPort,
  IdGeneratorPort,
  LoggerPort,
  OperationContext,
  ScenarioManifestRepositoryPort,
  WriteCoordinatorPort,
} from "./ports.js";
import {
  assertAggregateLimit,
  assertCatalogCapacity,
  assertExpectedCatalogRevision,
  canonicalName,
  publishCommittedEvent,
  runBestEffortPostCommit,
} from "./service-support.js";

export interface ImportedArchiveRecording {
  filename: string;
  matchable: boolean;
  recording: RecordingDraft;
}

export interface ImportedArchiveScenario {
  name: string;
  recordings: ImportedArchiveRecording[];
}

export interface ImportedFolderArchive {
  folderName: string;
  scenarios: ImportedArchiveScenario[];
}

interface PreparedImportedFolderArchive {
  folderName: string;
  scenarios: Array<{
    name: string;
    recordings: Array<{ filename: string; matchable: boolean; recording: FingerprintedRecordingDraft }>;
  }>;
}

export interface FolderImportSourcePort {
  claim(transferId: TransferId, claimId: CommandId, context?: OperationContext): Promise<ImportedFolderArchive>;
  materializeBlobs(transferId: TransferId, claimId: CommandId, context?: OperationContext): Promise<void>;
  complete(transferId: TransferId, claimId: CommandId): Promise<void>;
  release(transferId: TransferId, claimId: CommandId): Promise<void>;
}

export interface FolderImportServiceDependencies {
  blobs: BlobStorePort;
  catalogs: CatalogRepositoryPort;
  manifests: ScenarioManifestRepositoryPort;
  imports: FolderImportSourcePort;
  writes: WriteCoordinatorPort;
  events: EventHubPort;
  garbageCollection: GarbageCollectionPort;
  ids: IdGeneratorPort;
  clock: ClockPort;
  logger: LoggerPort;
}

export class FolderImportService implements FolderImportCommandHandlerPort {
  constructor(private readonly dependencies: FolderImportServiceDependencies) {}

  async execute(
    command: CommandOf<"folder.import">,
    context: OperationContext = {},
  ): Promise<CommandResult<"folder.import">> {
    const archive = await this.dependencies.imports.claim(command.transferId, command.commandId, context);
    let stagedArtifacts = false;

    let result: CommandResult<"folder.import">;
    try {
      assertAggregateLimit("folder archive scenarios", MAX_CATALOG_SCENARIOS, archive.scenarios.length);
      const preflightCatalog = await this.dependencies.catalogs.read(context);
      assertExpectedCatalogRevision(preflightCatalog, command.expectedRevision);
      assertCatalogCapacity(preflightCatalog, { folders: 1, scenarios: archive.scenarios.length });
      // Blob sessions acquire their own non-reentrant filesystem lease. Finish
      // promotion before the catalog transaction acquires the outer store
      // lease; recent unreferenced blobs are protected by the GC grace period.
      stagedArtifacts = true;
      await this.dependencies.imports.materializeBlobs(command.transferId, command.commandId, context);
      await this.#assertBodyRefsAvailable(archive, context);
      const preparedArchive = await this.#prepareArchive(archive, context);
      result = await this.dependencies.writes.withCatalogWrite(async () => {
        const catalog = await this.dependencies.catalogs.read(context);
        assertExpectedCatalogRevision(catalog, command.expectedRevision);
        assertCatalogCapacity(catalog, { folders: 1, scenarios: preparedArchive.scenarios.length });
        if (catalog.folders.some((folder) => canonicalName(folder.name) === canonicalName(command.name))) {
          throw new EntityAlreadyExistsError("folder", command.name);
        }

        const scenarioNames = new Set<string>();
        for (const scenario of preparedArchive.scenarios) {
          const name = canonicalName(scenario.name);
          if (scenarioNames.has(name)) throw new EntityAlreadyExistsError("scenario", scenario.name);
          scenarioNames.add(name);
        }

        const now = this.dependencies.clock.now();
        const folder = FolderSchema.parse({
          id: this.dependencies.ids.nextFolderId(),
          name: command.name,
          revision: 0,
          createdAt: now,
          updatedAt: now,
        });
        const scenarios = [];
        const manifests: ScenarioManifest[] = [];
        for (const importedScenario of preparedArchive.scenarios) {
          const scenario = ScenarioSchema.parse({
            id: this.dependencies.ids.nextScenarioId(),
            folderId: folder.id,
            name: importedScenario.name,
            revision: 0,
            recordingsCount: importedScenario.recordings.length,
            createdAt: now,
            updatedAt: now,
          });
          scenarios.push(scenario);
          const manifestValue = {
            schemaVersion: V2_SCHEMA_VERSION,
            scenarioId: scenario.id,
            revision: 0,
            recordings: importedScenario.recordings.map((imported) =>
              RecordingSchema.parse({
                ...imported.recording,
                matchable: imported.matchable,
                id: this.dependencies.ids.nextRecordingId(),
                scenarioId: scenario.id,
                filename: imported.filename,
                revision: 0,
                createdAt: now,
                updatedAt: now,
              }),
            ),
          };
          assertScenarioManifestSerializedLimit(manifestValue);
          manifests.push(ScenarioManifestSchema.parse(manifestValue));
        }
        // New manifests are invisible until the catalog CAS exposes their
        // scenarios. A failed CAS can therefore leave only collectable orphans.
        for (const manifest of manifests) await this.dependencies.manifests.create(manifest, context);
        const nextCatalogValue = {
          ...catalog,
          revision: nextRevision(catalog.revision),
          folders: [...catalog.folders, folder],
          scenarios: [...catalog.scenarios, ...scenarios],
        };
        assertCatalogSerializedLimit(nextCatalogValue);
        const nextCatalog = CatalogSnapshotSchema.parse(nextCatalogValue);
        await this.dependencies.catalogs.compareAndSwap(catalog.revision, nextCatalog, context);
        await publishCommittedEvent(
          this.dependencies.events,
          this.dependencies.logger,
          {
            type: "folder.upserted",
            revision: nextCatalog.revision,
            correlationId: command.commandId,
            payload: {
              folder: { id: folder.id, name: folder.name },
              recordingsInvalidated: true,
            },
          },
          context,
        );
        return { revision: nextCatalog.revision, folder, recordingsInvalidated: true };
      }, context);
    } catch (error) {
      await runBestEffortPostCommit(
        () =>
          isDomainError(error) && error.retryable
            ? this.dependencies.imports.release(command.transferId, command.commandId)
            : this.dependencies.imports.complete(command.transferId, command.commandId),
        this.dependencies.logger,
        "Failed to finalize an unsuccessful folder import claim",
        { transferId: command.transferId },
      );
      if (stagedArtifacts) {
        await runBestEffortPostCommit(
          () => this.dependencies.garbageCollection.schedule(),
          this.dependencies.logger,
          "Failed to schedule garbage collection after an aborted folder import",
          { transferId: command.transferId },
        );
      }
      throw error;
    }

    await runBestEffortPostCommit(
      () => this.dependencies.imports.complete(command.transferId, command.commandId),
      this.dependencies.logger,
      "Committed folder import could not remove its staged transfer",
      { transferId: command.transferId },
    );
    await runBestEffortPostCommit(
      () => this.dependencies.garbageCollection.schedule(),
      this.dependencies.logger,
      "Failed to schedule garbage collection after folder import",
    );
    return result;
  }

  async #assertBodyRefsAvailable(archive: ImportedFolderArchive, context: OperationContext): Promise<void> {
    const checked = new Set<string>();
    for (const scenario of archive.scenarios) {
      for (const imported of scenario.recordings) {
        for (const ref of [imported.recording.request.body, imported.recording.response.body]) {
          if (!ref) continue;
          const identity = `${ref.sha256}:${ref.size}`;
          if (checked.has(identity)) continue;
          checked.add(identity);
          if (!(await this.dependencies.blobs.exists(ref, context))) {
            throw new InvalidArgumentError("Folder import references a body that is no longer available", {
              sha256: ref.sha256,
            });
          }
        }
      }
    }
  }

  async #prepareArchive(
    archive: ImportedFolderArchive,
    context: OperationContext,
  ): Promise<PreparedImportedFolderArchive> {
    const scenarios: PreparedImportedFolderArchive["scenarios"] = [];
    // Fingerprint JSON bodies one at a time. Each body is individually bounded,
    // and sequential processing also bounds aggregate import memory.
    for (const scenario of archive.scenarios) {
      const recordings: PreparedImportedFolderArchive["scenarios"][number]["recordings"] = [];
      for (const imported of scenario.recordings) {
        recordings.push({
          filename: imported.filename,
          matchable: imported.matchable,
          recording: await fingerprintRecordingDraft(
            normalizeRecordingRepresentation(RecordingDraftSchema.parse(imported.recording)),
            (body) => this.dependencies.blobs.open(body, context),
            context.signal,
          ),
        });
      }
      scenarios.push({ name: scenario.name, recordings });
    }
    return { folderName: archive.folderName, scenarios };
  }
}
