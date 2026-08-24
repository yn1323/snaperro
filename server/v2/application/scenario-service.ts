import type { CommandOf, CommandResult } from "../../../shared/contracts-v2/commands.js";
import {
  type CatalogSnapshot,
  CatalogSnapshotSchema,
  RecordingSchema,
  type Scenario,
  ScenarioManifestSchema,
  ScenarioSchema,
} from "../../../shared/contracts-v2/entities.js";
import { nextRevision, V2_SCHEMA_VERSION } from "../../../shared/contracts-v2/primitives.js";
import { assertCatalogSerializedLimit, assertScenarioManifestSerializedLimit } from "../domain/aggregate-limits.js";
import { EntityAlreadyExistsError, EntityNotFoundError } from "../domain/errors.js";
import type {
  CatalogRepositoryPort,
  ClockPort,
  EventHubPort,
  IdGeneratorPort,
  LoggerPort,
  OperationContext,
  ScenarioManifestRepositoryPort,
  WriteCoordinatorPort,
} from "./ports.js";
import {
  assertCatalogCapacity,
  assertExpectedCatalogRevision,
  canonicalName,
  publishCommittedEvent,
  runBestEffortPostCommit,
} from "./service-support.js";

type CreateScenarioCommand = CommandOf<"scenario.create">;
type RenameScenarioCommand = CommandOf<"scenario.rename">;
type DuplicateScenarioCommand = CommandOf<"scenario.duplicate">;
type DeleteScenarioCommand = CommandOf<"scenario.delete">;

export interface ScenarioServiceDependencies {
  catalogs: CatalogRepositoryPort;
  manifests: ScenarioManifestRepositoryPort;
  writes: WriteCoordinatorPort;
  events: EventHubPort;
  ids: IdGeneratorPort;
  clock: ClockPort;
  logger: LoggerPort;
}

function assertFolderExists(catalog: CatalogSnapshot, folderId: Scenario["folderId"]): void {
  if (!catalog.folders.some((folder) => folder.id === folderId)) {
    throw new EntityNotFoundError("folder", folderId);
  }
}

function assertScenarioNameAvailable(
  catalog: CatalogSnapshot,
  folderId: Scenario["folderId"],
  name: string,
  exceptScenarioId?: Scenario["id"],
): void {
  if (
    catalog.scenarios.some(
      (scenario) =>
        scenario.folderId === folderId &&
        scenario.id !== exceptScenarioId &&
        canonicalName(scenario.name) === canonicalName(name),
    )
  ) {
    throw new EntityAlreadyExistsError("scenario", `${folderId}/${name}`);
  }
}

export class ScenarioService {
  constructor(private readonly dependencies: ScenarioServiceDependencies) {}

  async create(
    command: CreateScenarioCommand,
    context: OperationContext = {},
  ): Promise<CommandResult<"scenario.create">> {
    let orphanedScenarioId: Scenario["id"] | undefined;

    try {
      const result = await this.dependencies.writes.withCatalogWrite(async () => {
        const current = await this.dependencies.catalogs.read(context);
        assertExpectedCatalogRevision(current, command.expectedRevision);
        assertFolderExists(current, command.folderId);
        assertScenarioNameAvailable(current, command.folderId, command.name);
        assertCatalogCapacity(current, { scenarios: 1 });

        const now = this.dependencies.clock.now();
        const scenario = ScenarioSchema.parse({
          id: this.dependencies.ids.nextScenarioId(),
          folderId: command.folderId,
          name: command.name.normalize("NFC"),
          revision: 0,
          recordingsCount: 0,
          createdAt: now,
          updatedAt: now,
        });
        const manifestValue = {
          schemaVersion: V2_SCHEMA_VERSION,
          scenarioId: scenario.id,
          revision: 0,
          recordings: [],
        };
        assertScenarioManifestSerializedLimit(manifestValue);
        const manifest = ScenarioManifestSchema.parse(manifestValue);

        await this.dependencies.manifests.create(manifest, context);
        orphanedScenarioId = scenario.id;
        const next = await this.#commitCatalog(
          current,
          { ...current, scenarios: [...current.scenarios, scenario] },
          context,
        );
        orphanedScenarioId = undefined;
        await publishCommittedEvent(
          this.dependencies.events,
          this.dependencies.logger,
          {
            type: "scenario.upserted",
            revision: next.revision,
            correlationId: command.commandId,
            payload: { scenario: { id: scenario.id, folderId: scenario.folderId, name: scenario.name } },
          },
          context,
        );
        return { revision: next.revision, scenario };
      }, context);

      return result;
    } catch (error) {
      if (orphanedScenarioId) await this.#markForGarbageCollection(orphanedScenarioId, context);
      throw error;
    }
  }

  async rename(
    command: RenameScenarioCommand,
    context: OperationContext = {},
  ): Promise<CommandResult<"scenario.rename">> {
    return this.dependencies.writes.withCatalogWrite(async () => {
      const current = await this.dependencies.catalogs.read(context);
      assertExpectedCatalogRevision(current, command.expectedRevision);
      const existing = current.scenarios.find((scenario) => scenario.id === command.scenarioId);
      if (!existing) throw new EntityNotFoundError("scenario", command.scenarioId);
      assertScenarioNameAvailable(current, existing.folderId, command.name, existing.id);

      const normalizedName = command.name.normalize("NFC");
      if (existing.name === normalizedName) return { revision: current.revision, scenario: existing };

      const scenario = ScenarioSchema.parse({
        ...existing,
        name: normalizedName,
        updatedAt: this.dependencies.clock.now(),
      });
      const next = await this.#commitCatalog(
        current,
        {
          ...current,
          scenarios: current.scenarios.map((candidate) => (candidate.id === scenario.id ? scenario : candidate)),
        },
        context,
      );
      await publishCommittedEvent(
        this.dependencies.events,
        this.dependencies.logger,
        {
          type: "scenario.upserted",
          revision: next.revision,
          correlationId: command.commandId,
          payload: { scenario: { id: scenario.id, folderId: scenario.folderId, name: scenario.name } },
        },
        context,
      );
      return { revision: next.revision, scenario };
    }, context);
  }

  async duplicate(
    command: DuplicateScenarioCommand,
    context: OperationContext = {},
  ): Promise<CommandResult<"scenario.duplicate">> {
    let orphanedScenarioId: Scenario["id"] | undefined;

    try {
      const result = await this.dependencies.writes.withCatalogWrite(
        () =>
          this.dependencies.writes.withScenarioWrite(
            command.scenarioId,
            async () => {
              const current = await this.dependencies.catalogs.read(context);
              assertExpectedCatalogRevision(current, command.expectedRevision);
              const source = current.scenarios.find((scenario) => scenario.id === command.scenarioId);
              if (!source) throw new EntityNotFoundError("scenario", command.scenarioId);
              assertFolderExists(current, command.destinationFolderId);
              assertScenarioNameAvailable(current, command.destinationFolderId, command.name);
              assertCatalogCapacity(current, { scenarios: 1 });

              const sourceManifest = await this.dependencies.manifests.read(source.id, context);
              const now = this.dependencies.clock.now();
              const scenario = ScenarioSchema.parse({
                id: this.dependencies.ids.nextScenarioId(),
                folderId: command.destinationFolderId,
                name: command.name.normalize("NFC"),
                revision: 0,
                recordingsCount: sourceManifest.recordings.length,
                createdAt: now,
                updatedAt: now,
              });
              const recordings = sourceManifest.recordings.map((sourceRecording) =>
                RecordingSchema.parse({
                  ...sourceRecording,
                  id: this.dependencies.ids.nextRecordingId(),
                  scenarioId: scenario.id,
                  revision: 0,
                  createdAt: now,
                  updatedAt: now,
                }),
              );
              const manifestValue = {
                schemaVersion: V2_SCHEMA_VERSION,
                scenarioId: scenario.id,
                revision: 0,
                recordings,
              };
              assertScenarioManifestSerializedLimit(manifestValue);
              const manifest = ScenarioManifestSchema.parse(manifestValue);
              await this.dependencies.manifests.create(manifest, context);
              orphanedScenarioId = scenario.id;
              const next = await this.#commitCatalog(
                current,
                { ...current, scenarios: [...current.scenarios, scenario] },
                context,
              );
              orphanedScenarioId = undefined;
              await publishCommittedEvent(
                this.dependencies.events,
                this.dependencies.logger,
                {
                  type: "scenario.upserted",
                  revision: next.revision,
                  correlationId: command.commandId,
                  payload: {
                    scenario: { id: scenario.id, folderId: scenario.folderId, name: scenario.name },
                    recordingsInvalidated: true,
                  },
                },
                context,
              );
              return { revision: next.revision, scenario };
            },
            context,
          ),
        context,
      );

      return result;
    } catch (error) {
      if (orphanedScenarioId) await this.#markForGarbageCollection(orphanedScenarioId, context);
      throw error;
    }
  }

  async delete(
    command: DeleteScenarioCommand,
    context: OperationContext = {},
  ): Promise<CommandResult<"scenario.delete">> {
    const result = await this.dependencies.writes.withCatalogWrite(async () => {
      const current = await this.dependencies.catalogs.read(context);
      assertExpectedCatalogRevision(current, command.expectedRevision);
      if (!current.scenarios.some((scenario) => scenario.id === command.scenarioId)) {
        throw new EntityNotFoundError("scenario", command.scenarioId);
      }

      const next = await this.#commitCatalog(
        current,
        {
          ...current,
          scenarios: current.scenarios.filter((scenario) => scenario.id !== command.scenarioId),
          currentScenarioId: current.currentScenarioId === command.scenarioId ? null : current.currentScenarioId,
        },
        context,
      );
      await publishCommittedEvent(
        this.dependencies.events,
        this.dependencies.logger,
        {
          type: "scenario.deleted",
          revision: next.revision,
          correlationId: command.commandId,
          payload: { scenarioId: command.scenarioId },
        },
        context,
      );
      return { revision: next.revision, scenarioId: command.scenarioId };
    }, context);

    await this.#markForGarbageCollection(command.scenarioId, context);
    return result;
  }

  async #commitCatalog(
    current: CatalogSnapshot,
    candidate: CatalogSnapshot,
    context: OperationContext,
  ): Promise<CatalogSnapshot> {
    const value = { ...candidate, revision: nextRevision(current.revision) };
    assertCatalogSerializedLimit(value);
    const next = CatalogSnapshotSchema.parse(value);
    return this.dependencies.catalogs.compareAndSwap(current.revision, next, context);
  }

  async #markForGarbageCollection(scenarioId: Scenario["id"], context: OperationContext): Promise<void> {
    await runBestEffortPostCommit(
      () => this.dependencies.manifests.markForGarbageCollection(scenarioId, context),
      this.dependencies.logger,
      "Failed to mark a scenario manifest for garbage collection",
      { scenarioId },
    );
  }
}
