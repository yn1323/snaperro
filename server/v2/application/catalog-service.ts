import type { CommandOf } from "../../../shared/contracts-v2/commands.js";
import { type CatalogSnapshot, CatalogSnapshotSchema, type Folder } from "../../../shared/contracts-v2/entities.js";
import { nextRevision, RevisionSchema } from "../../../shared/contracts-v2/primitives.js";
import { assertCatalogSerializedLimit } from "../domain/aggregate-limits.js";
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

type SetModeCommand = CommandOf<"mode.set">;
type SelectScenarioCommand = CommandOf<"scenario.select">;
type CreateFolderCommand = CommandOf<"folder.create">;
type RenameFolderCommand = CommandOf<"folder.rename">;
type DeleteFolderCommand = CommandOf<"folder.delete">;

export interface CatalogServiceDependencies {
  catalogs: CatalogRepositoryPort;
  manifests: ScenarioManifestRepositoryPort;
  writes: WriteCoordinatorPort;
  events: EventHubPort;
  ids: IdGeneratorPort;
  clock: ClockPort;
  logger: LoggerPort;
}

export class CatalogService {
  constructor(private readonly dependencies: CatalogServiceDependencies) {}

  async setMode(command: SetModeCommand, context: OperationContext = {}) {
    return this.dependencies.writes.withCatalogWrite(async () => {
      const current = await this.dependencies.catalogs.read(context);
      assertExpectedCatalogRevision(current, command.expectedRevision);
      if (current.mode === command.mode) return { revision: current.revision, mode: current.mode };

      const next = await this.#commit(current, { ...current, mode: command.mode }, context);
      await publishCommittedEvent(
        this.dependencies.events,
        this.dependencies.logger,
        {
          type: "mode.changed",
          revision: next.revision,
          correlationId: command.commandId,
          payload: { mode: next.mode },
        },
        context,
      );
      return { revision: next.revision, mode: next.mode };
    }, context);
  }

  async selectScenario(command: SelectScenarioCommand, context: OperationContext = {}) {
    return this.dependencies.writes.withCatalogWrite(async () => {
      const current = await this.dependencies.catalogs.read(context);
      assertExpectedCatalogRevision(current, command.expectedRevision);
      if (command.scenarioId && !current.scenarios.some((scenario) => scenario.id === command.scenarioId)) {
        throw new EntityNotFoundError("scenario", command.scenarioId);
      }
      if (current.currentScenarioId === command.scenarioId) {
        return { revision: current.revision, currentScenarioId: current.currentScenarioId };
      }

      const next = await this.#commit(current, { ...current, currentScenarioId: command.scenarioId }, context);
      await publishCommittedEvent(
        this.dependencies.events,
        this.dependencies.logger,
        {
          type: "scenario.current-changed",
          revision: next.revision,
          correlationId: command.commandId,
          payload: { scenarioId: next.currentScenarioId },
        },
        context,
      );
      return { revision: next.revision, currentScenarioId: next.currentScenarioId };
    }, context);
  }

  async createFolder(command: CreateFolderCommand, context: OperationContext = {}) {
    return this.dependencies.writes.withCatalogWrite(async () => {
      const current = await this.dependencies.catalogs.read(context);
      assertExpectedCatalogRevision(current, command.expectedRevision);
      if (current.folders.some((folder) => canonicalName(folder.name) === canonicalName(command.name))) {
        throw new EntityAlreadyExistsError("folder", command.name);
      }
      assertCatalogCapacity(current, { folders: 1 });

      const now = this.dependencies.clock.now();
      const folder: Folder = {
        id: this.dependencies.ids.nextFolderId(),
        name: command.name.normalize("NFC"),
        revision: RevisionSchema.parse(0),
        createdAt: now,
        updatedAt: now,
      };
      const next = await this.#commit(current, { ...current, folders: [...current.folders, folder] }, context);
      await publishCommittedEvent(
        this.dependencies.events,
        this.dependencies.logger,
        {
          type: "folder.upserted",
          revision: next.revision,
          correlationId: command.commandId,
          payload: { folder: { id: folder.id, name: folder.name } },
        },
        context,
      );
      return { revision: next.revision, folder };
    }, context);
  }

  async renameFolder(command: RenameFolderCommand, context: OperationContext = {}) {
    return this.dependencies.writes.withCatalogWrite(async () => {
      const current = await this.dependencies.catalogs.read(context);
      assertExpectedCatalogRevision(current, command.expectedRevision);
      const existing = current.folders.find((folder) => folder.id === command.folderId);
      if (!existing) throw new EntityNotFoundError("folder", command.folderId);
      if (
        current.folders.some(
          (folder) => folder.id !== command.folderId && canonicalName(folder.name) === canonicalName(command.name),
        )
      ) {
        throw new EntityAlreadyExistsError("folder", command.name);
      }
      const normalizedName = command.name.normalize("NFC");
      if (existing.name === normalizedName) return { revision: current.revision, folder: existing };

      const folder: Folder = {
        ...existing,
        name: normalizedName,
        revision: nextRevision(existing.revision),
        updatedAt: this.dependencies.clock.now(),
      };
      const next = await this.#commit(
        current,
        { ...current, folders: current.folders.map((candidate) => (candidate.id === folder.id ? folder : candidate)) },
        context,
      );
      await publishCommittedEvent(
        this.dependencies.events,
        this.dependencies.logger,
        {
          type: "folder.upserted",
          revision: next.revision,
          correlationId: command.commandId,
          payload: { folder: { id: folder.id, name: folder.name } },
        },
        context,
      );
      return { revision: next.revision, folder };
    }, context);
  }

  async deleteFolder(command: DeleteFolderCommand, context: OperationContext = {}) {
    const result = await this.dependencies.writes.withCatalogWrite(async () => {
      const current = await this.dependencies.catalogs.read(context);
      assertExpectedCatalogRevision(current, command.expectedRevision);
      if (!current.folders.some((folder) => folder.id === command.folderId)) {
        throw new EntityNotFoundError("folder", command.folderId);
      }

      const deletedScenarioIds = current.scenarios
        .filter((scenario) => scenario.folderId === command.folderId)
        .map((scenario) => scenario.id);
      const deletedScenarioSet = new Set(deletedScenarioIds);
      const selectedScenarioWasDeleted =
        current.currentScenarioId !== null && deletedScenarioSet.has(current.currentScenarioId);
      const next = await this.#commit(
        current,
        {
          ...current,
          folders: current.folders.filter((folder) => folder.id !== command.folderId),
          scenarios: current.scenarios.filter((scenario) => !deletedScenarioSet.has(scenario.id)),
          currentScenarioId: selectedScenarioWasDeleted ? null : current.currentScenarioId,
        },
        context,
      );

      await publishCommittedEvent(
        this.dependencies.events,
        this.dependencies.logger,
        {
          type: "folder.deleted",
          revision: next.revision,
          correlationId: command.commandId,
          payload: { folderId: command.folderId },
        },
        context,
      );
      return { revision: next.revision, folderId: command.folderId, deletedScenarioIds };
    }, context);
    for (const scenarioId of result.deletedScenarioIds) {
      await runBestEffortPostCommit(
        () => this.dependencies.manifests.markForGarbageCollection(scenarioId, context),
        this.dependencies.logger,
        "Failed to mark a deleted scenario for garbage collection",
        { scenarioId },
      );
    }
    return result;
  }

  async #commit(
    current: CatalogSnapshot,
    candidate: CatalogSnapshot,
    context: OperationContext,
  ): Promise<CatalogSnapshot> {
    const value = { ...candidate, revision: nextRevision(current.revision) };
    assertCatalogSerializedLimit(value);
    const next = CatalogSnapshotSchema.parse(value);
    return this.dependencies.catalogs.compareAndSwap(current.revision, next, context);
  }
}
