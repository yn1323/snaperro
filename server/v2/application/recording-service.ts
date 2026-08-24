import type { CommandOf, CommandResult } from "../../../shared/contracts-v2/commands.js";
import {
  type CatalogSnapshot,
  CatalogSnapshotSchema,
  type Recording,
  type RecordingDraft,
  RecordingSchema,
  type Scenario,
  type ScenarioManifest,
  ScenarioManifestSchema,
  ScenarioSchema,
} from "../../../shared/contracts-v2/entities.js";
import { nextRevision } from "../../../shared/contracts-v2/primitives.js";
import { assertCatalogSerializedLimit, assertScenarioManifestSerializedLimit } from "../domain/aggregate-limits.js";
import { EntityAlreadyExistsError, EntityNotFoundError, InvalidArgumentError } from "../domain/errors.js";
import { normalizeRecordingRepresentation } from "../domain/http-representation.js";
import { type FingerprintedRecordingDraft, fingerprintRecordingDraft } from "../domain/request-fingerprint.js";
import type {
  BlobStorePort,
  CatalogRepositoryPort,
  ClockPort,
  EventHubPort,
  GarbageCollectionPort,
  IdGeneratorPort,
  LoggerPort,
  OperationContext,
  RecordingCommitPort,
  ScenarioManifestRepositoryPort,
  WriteCoordinatorPort,
} from "./ports.js";
import {
  assertExpectedRevision,
  canonicalName,
  publishCommittedEvent,
  runBestEffortPostCommit,
  toRecordingSummary,
} from "./service-support.js";

type CreateRecordingCommand = CommandOf<"recording.create">;
type UpdateRecordingCommand = CommandOf<"recording.update">;
type DeleteRecordingCommand = CommandOf<"recording.delete">;

export interface CaptureRecordingInput {
  scenarioId: Scenario["id"];
  recording: RecordingDraft;
}

export interface RecordingServiceDependencies {
  blobs: BlobStorePort;
  catalogs: CatalogRepositoryPort;
  manifests: ScenarioManifestRepositoryPort;
  commits: RecordingCommitPort;
  garbageCollection: GarbageCollectionPort;
  writes: WriteCoordinatorPort;
  events: EventHubPort;
  ids: IdGeneratorPort;
  clock: ClockPort;
  logger: LoggerPort;
}

interface CommittedRecordingChange {
  catalog: CatalogSnapshot;
  manifest: ScenarioManifest;
}

function findScenario(catalog: CatalogSnapshot, scenarioId: Scenario["id"]): Scenario {
  const scenario = catalog.scenarios.find((candidate) => candidate.id === scenarioId);
  if (!scenario) throw new EntityNotFoundError("scenario", scenarioId);
  return scenario;
}

function findRecording(manifest: ScenarioManifest, recordingId: Recording["id"]): Recording {
  const recording = manifest.recordings.find((candidate) => candidate.id === recordingId);
  if (!recording) throw new EntityNotFoundError("recording", recordingId);
  return recording;
}

function assertRecordingIdentityAvailable(
  manifest: ScenarioManifest,
  filename: string,
  requestFingerprint: string,
  matchable: boolean,
  exceptRecordingId?: Recording["id"],
): void {
  const duplicate = manifest.recordings.find(
    (recording) =>
      recording.id !== exceptRecordingId &&
      (canonicalName(recording.filename) === canonicalName(filename) ||
        (matchable && recording.matchable && recording.requestFingerprint === requestFingerprint)),
  );
  if (!duplicate) return;

  const identity =
    canonicalName(duplicate.filename) === canonicalName(filename) ? filename : `fingerprint:${requestFingerprint}`;
  throw new EntityAlreadyExistsError("recording", identity);
}

function compareCodeUnits(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function promoteFirstShadow(recordings: Recording[], requestFingerprint: string): Recording[] {
  const group = recordings.filter((recording) => recording.requestFingerprint === requestFingerprint);
  if (group.length === 0 || group.some((recording) => recording.matchable)) return recordings;

  const promoted = [...group].sort(
    (left, right) =>
      compareCodeUnits(left.filename.normalize("NFC"), right.filename.normalize("NFC")) ||
      compareCodeUnits(left.id, right.id),
  )[0];
  if (!promoted) return recordings;
  return recordings.map((recording) =>
    recording.id === promoted.id ? RecordingSchema.parse({ ...recording, matchable: true }) : recording,
  );
}

function captureFilenameStem(route: string): string {
  const stem = route
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9_-]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .slice(0, 180);
  return stem || "root";
}

function availableCaptureFilename(method: string, route: string, recordings: readonly Recording[]): string {
  const filenames = new Set(
    recordings.map((recording) => recording.filename.normalize("NFC").toLocaleLowerCase("en-US")),
  );
  const prefix = `${method.toLowerCase()}_${captureFilenameStem(route)}`;
  for (let sequence = 1; sequence <= 999_999; sequence += 1) {
    const candidate = `${prefix}_${String(sequence).padStart(3, "0")}.json`;
    if (!filenames.has(candidate.normalize("NFC").toLocaleLowerCase("en-US"))) return candidate;
  }
  throw new EntityAlreadyExistsError("recording filename", prefix);
}

export class RecordingService {
  constructor(private readonly dependencies: RecordingServiceDependencies) {}

  async capture(input: CaptureRecordingInput, context: OperationContext = {}): Promise<Recording> {
    const result = await this.#withScenarioCommit(input.scenarioId, context, async (catalog, scenario, manifest) => {
      const prepared = await this.#prepareRecording(input.recording, context);
      const existing = manifest.recordings.find(
        (recording) => recording.matchable && recording.requestFingerprint === prepared.requestFingerprint,
      );
      const now = this.dependencies.clock.now();
      const recording = RecordingSchema.parse(
        existing
          ? {
              ...prepared,
              id: existing.id,
              scenarioId: existing.scenarioId,
              filename: existing.filename,
              matchable: existing.matchable,
              revision: nextRevision(existing.revision),
              createdAt: existing.createdAt,
              updatedAt: now,
            }
          : {
              ...prepared,
              id: this.dependencies.ids.nextRecordingId(),
              scenarioId: input.scenarioId,
              filename: availableCaptureFilename(prepared.method, prepared.route, manifest.recordings),
              matchable: true,
              revision: 0,
              createdAt: now,
              updatedAt: now,
            },
      );
      const committed = await this.#commit(
        catalog,
        scenario,
        manifest,
        existing
          ? manifest.recordings.map((candidate) => (candidate.id === existing.id ? recording : candidate))
          : [...manifest.recordings, recording],
        now,
        context,
      );
      await publishCommittedEvent(
        this.dependencies.events,
        this.dependencies.logger,
        {
          type: "recording.upserted",
          revision: committed.catalog.revision,
          correlationId: this.dependencies.ids.nextCommandId(),
          payload: { recording: toRecordingSummary(recording), scenarioRevision: committed.manifest.revision },
        },
        context,
      );
      return recording;
    });
    await this.#scheduleGarbageCollection();
    return result;
  }

  async create(
    command: CreateRecordingCommand,
    context: OperationContext = {},
  ): Promise<CommandResult<"recording.create">> {
    const result = await this.#withScenarioCommit(command.scenarioId, context, async (catalog, scenario, manifest) => {
      assertExpectedRevision(manifest.revision, command.expectedScenarioRevision);
      const prepared = await this.#prepareRecording(command.recording, context);
      assertRecordingIdentityAvailable(manifest, command.filename, prepared.requestFingerprint, true);

      const now = this.dependencies.clock.now();
      const recording = RecordingSchema.parse({
        ...prepared,
        id: this.dependencies.ids.nextRecordingId(),
        scenarioId: command.scenarioId,
        filename: command.filename.normalize("NFC"),
        matchable: true,
        revision: 0,
        createdAt: now,
        updatedAt: now,
      });
      const recordingSummary = toRecordingSummary(recording);
      const committed = await this.#commit(
        catalog,
        scenario,
        manifest,
        [...manifest.recordings, recording],
        now,
        context,
      );
      await publishCommittedEvent(
        this.dependencies.events,
        this.dependencies.logger,
        {
          type: "recording.upserted",
          revision: committed.catalog.revision,
          correlationId: command.commandId,
          payload: { recording: recordingSummary, scenarioRevision: committed.manifest.revision },
        },
        context,
      );
      return {
        revision: committed.catalog.revision,
        scenarioRevision: committed.manifest.revision,
        recording,
      };
    });

    await this.#scheduleGarbageCollection();
    return result;
  }

  async update(
    command: UpdateRecordingCommand,
    context: OperationContext = {},
  ): Promise<CommandResult<"recording.update">> {
    const result = await this.#withScenarioCommit(command.scenarioId, context, async (catalog, scenario, manifest) => {
      assertExpectedRevision(manifest.revision, command.expectedScenarioRevision);
      const existing = findRecording(manifest, command.recordingId);
      assertExpectedRevision(existing.revision, command.expectedContentRevision);
      const prepared = await this.#prepareRecording(command.recording, context);
      const nextMatchable =
        existing.matchable ||
        !manifest.recordings.some(
          (recording) =>
            recording.id !== existing.id &&
            recording.matchable &&
            recording.requestFingerprint === prepared.requestFingerprint,
        );
      assertRecordingIdentityAvailable(
        manifest,
        command.filename,
        prepared.requestFingerprint,
        nextMatchable,
        existing.id,
      );

      const now = this.dependencies.clock.now();
      const recording = RecordingSchema.parse({
        ...prepared,
        id: existing.id,
        scenarioId: existing.scenarioId,
        filename: command.filename.normalize("NFC"),
        matchable: nextMatchable,
        revision: nextRevision(existing.revision),
        createdAt: existing.createdAt,
        updatedAt: now,
      });
      const recordingSummary = toRecordingSummary(recording);
      const updatedRecordings = manifest.recordings.map((candidate) =>
        candidate.id === recording.id ? recording : candidate,
      );
      const committed = await this.#commit(
        catalog,
        scenario,
        manifest,
        existing.requestFingerprint === recording.requestFingerprint
          ? updatedRecordings
          : promoteFirstShadow(updatedRecordings, existing.requestFingerprint),
        now,
        context,
      );
      await publishCommittedEvent(
        this.dependencies.events,
        this.dependencies.logger,
        {
          type: "recording.upserted",
          revision: committed.catalog.revision,
          correlationId: command.commandId,
          payload: { recording: recordingSummary, scenarioRevision: committed.manifest.revision },
        },
        context,
      );
      return {
        revision: committed.catalog.revision,
        scenarioRevision: committed.manifest.revision,
        recording,
      };
    });

    await this.#scheduleGarbageCollection();
    return result;
  }

  async delete(
    command: DeleteRecordingCommand,
    context: OperationContext = {},
  ): Promise<CommandResult<"recording.delete">> {
    const result = await this.#withScenarioCommit(command.scenarioId, context, async (catalog, scenario, manifest) => {
      assertExpectedRevision(manifest.revision, command.expectedScenarioRevision);
      const existing = findRecording(manifest, command.recordingId);
      assertExpectedRevision(existing.revision, command.expectedContentRevision);

      const remaining = manifest.recordings.filter((recording) => recording.id !== existing.id);
      const committed = await this.#commit(
        catalog,
        scenario,
        manifest,
        promoteFirstShadow(remaining, existing.requestFingerprint),
        this.dependencies.clock.now(),
        context,
      );
      await publishCommittedEvent(
        this.dependencies.events,
        this.dependencies.logger,
        {
          type: "recording.deleted",
          revision: committed.catalog.revision,
          correlationId: command.commandId,
          payload: {
            recordingId: existing.id,
            scenarioId: command.scenarioId,
            scenarioRevision: committed.manifest.revision,
          },
        },
        context,
      );
      return {
        revision: committed.catalog.revision,
        scenarioRevision: committed.manifest.revision,
        scenarioId: command.scenarioId,
        recordingId: existing.id,
      };
    });

    await this.#scheduleGarbageCollection();
    return result;
  }

  async #withScenarioCommit<Result>(
    scenarioId: Scenario["id"],
    context: OperationContext,
    operation: (catalog: CatalogSnapshot, scenario: Scenario, manifest: ScenarioManifest) => Promise<Result>,
  ): Promise<Result> {
    return this.dependencies.writes.withCatalogWrite(
      () =>
        this.dependencies.writes.withScenarioWrite(
          scenarioId,
          async () => {
            const catalog = await this.dependencies.catalogs.read(context);
            const scenario = findScenario(catalog, scenarioId);
            const manifest = await this.dependencies.manifests.read(scenarioId, context);
            return operation(catalog, scenario, manifest);
          },
          context,
        ),
      context,
    );
  }

  async #assertBodyRefsAvailable(recording: RecordingDraft, context: OperationContext): Promise<void> {
    const refs = [recording.request.body, recording.response.body].filter((ref) => ref !== null);
    const checked = new Set<string>();
    for (const ref of refs) {
      const identity = `${ref.sha256}:${ref.size}`;
      if (checked.has(identity)) continue;
      checked.add(identity);
      if (!(await this.dependencies.blobs.exists(ref, context))) {
        throw new InvalidArgumentError("Recording references a body that is no longer available", {
          sha256: ref.sha256,
        });
      }
    }
  }

  async #prepareRecording(recording: RecordingDraft, context: OperationContext): Promise<FingerprintedRecordingDraft> {
    const normalized = normalizeRecordingRepresentation(recording);
    await this.#assertBodyRefsAvailable(normalized, context);
    return fingerprintRecordingDraft(normalized, (body) => this.dependencies.blobs.open(body, context), context.signal);
  }

  async #commit(
    catalog: CatalogSnapshot,
    scenario: Scenario,
    manifest: ScenarioManifest,
    recordings: Recording[],
    now: Recording["updatedAt"],
    context: OperationContext,
  ): Promise<CommittedRecordingChange> {
    const nextManifestValue = {
      ...manifest,
      revision: nextRevision(manifest.revision),
      recordings,
    };
    assertScenarioManifestSerializedLimit(nextManifestValue);
    const nextManifest = ScenarioManifestSchema.parse(nextManifestValue);
    const nextScenario = ScenarioSchema.parse({
      ...scenario,
      revision: nextRevision(scenario.revision),
      recordingsCount: recordings.length,
      updatedAt: now,
    });
    const nextCatalogValue = {
      ...catalog,
      revision: nextRevision(catalog.revision),
      scenarios: catalog.scenarios.map((candidate) => (candidate.id === nextScenario.id ? nextScenario : candidate)),
    };
    assertCatalogSerializedLimit(nextCatalogValue);
    const nextCatalog = CatalogSnapshotSchema.parse(nextCatalogValue);

    await this.dependencies.commits.compareAndSwap(
      {
        scenarioId: scenario.id,
        expectedCatalogRevision: catalog.revision,
        expectedScenarioRevision: manifest.revision,
        catalog: nextCatalog,
        manifest: nextManifest,
      },
      context,
    );
    return { catalog: nextCatalog, manifest: nextManifest };
  }

  async #scheduleGarbageCollection(): Promise<void> {
    await runBestEffortPostCommit(
      () => this.dependencies.garbageCollection.schedule(),
      this.dependencies.logger,
      "Failed to schedule garbage collection after a recording commit",
    );
  }
}
