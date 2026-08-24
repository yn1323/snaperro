import { Mutex } from "async-mutex";
import {
  type CatalogSnapshot,
  CatalogSnapshotSchema,
  type Recording,
  RecordingSchema,
  type ScenarioManifest,
  ScenarioManifestSchema,
} from "../../../shared/contracts-v2/entities.js";
import type { EventDraft, EventOf, EventType } from "../../../shared/contracts-v2/events.js";
import {
  CommandIdSchema,
  EventSequenceSchema,
  FolderIdSchema,
  RecordingIdSchema,
  RequestIdSchema,
  RevisionSchema,
  RuntimeIdSchema,
  ScenarioIdSchema,
  TransferIdSchema,
  V2_SCHEMA_VERSION,
} from "../../../shared/contracts-v2/primitives.js";
import { EntityAlreadyExistsError, EntityNotFoundError, RevisionConflictError } from "../domain/errors.js";
import type {
  CatalogRepositoryPort,
  ClockPort,
  EventHubPort,
  EventListener,
  EventSubscription,
  EventWatermark,
  GarbageCollectionPort,
  IdGeneratorPort,
  LoggerPort,
  OperationContext,
  RecordingCommit,
  RecordingCommitPort,
  RecordingCommitResult,
  ScenarioManifestRepositoryPort,
  StructuredLogFields,
  Unsubscribe,
  WriteCoordinatorPort,
} from "./ports.js";

export const applicationTestIds = {
  folder: FolderIdSchema.parse("fld_aaaaaaaaaaaaaaaa"),
  otherFolder: FolderIdSchema.parse("fld_bbbbbbbbbbbbbbbb"),
  scenario: ScenarioIdSchema.parse("scn_aaaaaaaaaaaaaaaa"),
  otherScenario: ScenarioIdSchema.parse("scn_bbbbbbbbbbbbbbbb"),
  recording: RecordingIdSchema.parse("rec_aaaaaaaaaaaaaaaa"),
  otherRecording: RecordingIdSchema.parse("rec_bbbbbbbbbbbbbbbb"),
  command: CommandIdSchema.parse("cmd_aaaaaaaaaaaaaaaa"),
  runtime: RuntimeIdSchema.parse("run_aaaaaaaaaaaaaaaa"),
};

export const APPLICATION_TEST_NOW = "2026-08-24T00:00:00.000Z" as const;

export function recordingFixture(overrides: Partial<Recording> = {}, fingerprintCharacter = "a"): Recording {
  return RecordingSchema.parse({
    id: applicationTestIds.recording,
    scenarioId: applicationTestIds.scenario,
    filename: "users.json",
    revision: 0,
    createdAt: APPLICATION_TEST_NOW,
    updatedAt: APPLICATION_TEST_NOW,
    route: "/users/:id",
    method: "GET",
    requestFingerprint: fingerprintCharacter.repeat(64),
    request: {
      pathParams: { id: "1" },
      query: [],
      headers: [],
      body: null,
    },
    response: {
      status: 200,
      statusText: "OK",
      headers: [["content-type", "application/json"]],
      body: {
        sha256: "b".repeat(64),
        size: 12,
        mediaType: "application/json",
        contentEncoding: null,
      },
    },
    ...overrides,
  });
}

export function catalogFixture(
  options: {
    revision?: number;
    includeScenario?: boolean;
    includeOtherFolder?: boolean;
    currentScenarioId?: CatalogSnapshot["currentScenarioId"];
    recordingsCount?: number;
  } = {},
): CatalogSnapshot {
  const folders = [
    {
      id: applicationTestIds.folder,
      name: "Folder",
      revision: RevisionSchema.parse(0),
      createdAt: APPLICATION_TEST_NOW,
      updatedAt: APPLICATION_TEST_NOW,
    },
  ];
  if (options.includeOtherFolder) {
    folders.push({
      id: applicationTestIds.otherFolder,
      name: "Other",
      revision: RevisionSchema.parse(0),
      createdAt: APPLICATION_TEST_NOW,
      updatedAt: APPLICATION_TEST_NOW,
    });
  }
  const includeScenario = options.includeScenario ?? true;
  return CatalogSnapshotSchema.parse({
    schemaVersion: V2_SCHEMA_VERSION,
    revision: options.revision ?? 0,
    mode: "smart",
    currentScenarioId:
      options.currentScenarioId === undefined
        ? includeScenario
          ? applicationTestIds.scenario
          : null
        : options.currentScenarioId,
    folders,
    scenarios: includeScenario
      ? [
          {
            id: applicationTestIds.scenario,
            folderId: applicationTestIds.folder,
            name: "Scenario",
            revision: 0,
            recordingsCount: options.recordingsCount ?? 0,
            createdAt: APPLICATION_TEST_NOW,
            updatedAt: APPLICATION_TEST_NOW,
          },
        ]
      : [],
  });
}

export function manifestFixture(recordings: Recording[] = []): ScenarioManifest {
  return ScenarioManifestSchema.parse({
    schemaVersion: V2_SCHEMA_VERSION,
    scenarioId: applicationTestIds.scenario,
    revision: 0,
    recordings,
  });
}

export class MemoryCatalogRepository implements CatalogRepositoryPort {
  compareAndSwapCalls = 0;
  failure: Error | undefined;

  constructor(public snapshot: CatalogSnapshot) {}

  async read(): Promise<CatalogSnapshot> {
    return this.snapshot;
  }

  async compareAndSwap(expectedRevision: CatalogSnapshot["revision"], next: CatalogSnapshot): Promise<CatalogSnapshot> {
    this.compareAndSwapCalls += 1;
    if (this.failure) throw this.failure;
    if (this.snapshot.revision !== expectedRevision) {
      throw new RevisionConflictError(expectedRevision, this.snapshot.revision);
    }
    this.snapshot = CatalogSnapshotSchema.parse(next);
    return this.snapshot;
  }

  replace(expectedRevision: CatalogSnapshot["revision"], next: CatalogSnapshot): void {
    if (this.snapshot.revision !== expectedRevision) {
      throw new RevisionConflictError(expectedRevision, this.snapshot.revision);
    }
    this.snapshot = CatalogSnapshotSchema.parse(next);
  }
}

export class MemoryManifestRepository implements ScenarioManifestRepositoryPort {
  readonly manifests = new Map<string, ScenarioManifest>();
  readonly garbage = new Set<string>();

  constructor(initial: ScenarioManifest[] = []) {
    for (const manifest of initial) this.manifests.set(manifest.scenarioId, manifest);
  }

  async read(scenarioId: ScenarioManifest["scenarioId"]): Promise<ScenarioManifest> {
    const manifest = this.manifests.get(scenarioId);
    if (!manifest) throw new EntityNotFoundError("scenario manifest", scenarioId);
    return manifest;
  }

  async readAtRevision(
    scenarioId: ScenarioManifest["scenarioId"],
    _expectedCatalogRevision: ScenarioManifest["revision"],
    expectedScenarioRevision: ScenarioManifest["revision"],
  ): Promise<ScenarioManifest> {
    const manifest = await this.read(scenarioId);
    if (manifest.revision !== expectedScenarioRevision) {
      throw new RevisionConflictError(expectedScenarioRevision, manifest.revision);
    }
    return manifest;
  }

  async create(manifest: ScenarioManifest): Promise<void> {
    if (this.manifests.has(manifest.scenarioId)) {
      throw new EntityAlreadyExistsError("scenario manifest", manifest.scenarioId);
    }
    this.manifests.set(manifest.scenarioId, ScenarioManifestSchema.parse(manifest));
  }

  async markForGarbageCollection(scenarioId: ScenarioManifest["scenarioId"]): Promise<void> {
    this.garbage.add(scenarioId);
  }

  replace(
    scenarioId: ScenarioManifest["scenarioId"],
    expectedRevision: ScenarioManifest["revision"],
    next: ScenarioManifest,
  ): void {
    const current = this.manifests.get(scenarioId);
    if (!current) throw new EntityNotFoundError("scenario manifest", scenarioId);
    if (current.revision !== expectedRevision) throw new RevisionConflictError(expectedRevision, current.revision);
    this.manifests.set(scenarioId, ScenarioManifestSchema.parse(next));
  }
}

export class MemoryRecordingCommit implements RecordingCommitPort {
  readonly calls: RecordingCommit[] = [];
  failure: Error | undefined;

  constructor(
    private readonly catalogs: MemoryCatalogRepository,
    private readonly manifests: MemoryManifestRepository,
  ) {}

  async compareAndSwap(commit: RecordingCommit): Promise<RecordingCommitResult> {
    this.calls.push(commit);
    if (this.failure) throw this.failure;

    const currentManifest = await this.manifests.read(commit.scenarioId);
    if (this.catalogs.snapshot.revision !== commit.expectedCatalogRevision) {
      throw new RevisionConflictError(commit.expectedCatalogRevision, this.catalogs.snapshot.revision);
    }
    if (currentManifest.revision !== commit.expectedScenarioRevision) {
      throw new RevisionConflictError(commit.expectedScenarioRevision, currentManifest.revision);
    }

    // Validate both preconditions before replacing either side: tests observe the same atomic boundary as an adapter.
    this.catalogs.replace(commit.expectedCatalogRevision, commit.catalog);
    this.manifests.replace(commit.scenarioId, commit.expectedScenarioRevision, commit.manifest);
    return { catalog: commit.catalog, manifest: commit.manifest };
  }
}

export class MutexWriteCoordinator implements WriteCoordinatorPort {
  readonly #catalog = new Mutex();
  readonly #scenarios = new Map<string, Mutex>();

  withCatalogWrite<Result>(operation: () => Promise<Result>): Promise<Result> {
    return this.#catalog.runExclusive(operation);
  }

  withScenarioWrite<Result>(
    scenarioId: ScenarioManifest["scenarioId"],
    operation: () => Promise<Result>,
  ): Promise<Result> {
    let mutex = this.#scenarios.get(scenarioId);
    if (!mutex) {
      mutex = new Mutex();
      this.#scenarios.set(scenarioId, mutex);
    }
    return mutex.runExclusive(operation);
  }
}

export class FakeEventHub implements EventHubPort {
  readonly published: EventDraft[] = [];
  fail = false;
  beforePublish: ((draft: EventDraft) => Promise<void>) | undefined;
  #watermark: EventWatermark = {
    runtimeId: applicationTestIds.runtime,
    sequence: EventSequenceSchema.parse(0),
    revision: RevisionSchema.parse(0),
  };

  watermark(): EventWatermark {
    return this.#watermark;
  }

  async publish<Type extends EventType>(draft: EventDraft<Type>): Promise<EventOf<Type>> {
    await this.beforePublish?.(draft);
    if (this.fail) throw new Error("event transport unavailable");
    this.published.push(draft);
    this.#watermark = {
      ...this.#watermark,
      sequence: EventSequenceSchema.parse(this.#watermark.sequence + 1),
      revision: draft.revision,
    };
    return undefined as unknown as EventOf<Type>;
  }

  async subscribe(_listener: EventListener, _options?: OperationContext): Promise<Unsubscribe> {
    return async () => {};
  }

  async subscribeWithWatermark(_listener: EventListener, _options?: OperationContext): Promise<EventSubscription> {
    return { watermark: this.watermark(), unsubscribe: async () => {} };
  }

  async close(): Promise<void> {}
}

export class FakeGarbageCollection implements GarbageCollectionPort {
  scheduled = 0;
  failure: Error | undefined;

  async schedule(): Promise<void> {
    this.scheduled += 1;
    if (this.failure) throw this.failure;
  }
}

export class FixedClock implements ClockPort {
  now() {
    return APPLICATION_TEST_NOW;
  }
}

export class SequentialIds implements IdGeneratorPort {
  #folder = 0;
  #scenario = 0;
  #recording = 0;
  #runtime = 0;
  #command = 0;
  #request = 0;
  #transfer = 0;

  nextFolderId() {
    return FolderIdSchema.parse(`fld_${String(++this.#folder).padStart(16, "0")}`);
  }
  nextScenarioId() {
    return ScenarioIdSchema.parse(`scn_${String(++this.#scenario).padStart(16, "0")}`);
  }
  nextRecordingId() {
    return RecordingIdSchema.parse(`rec_${String(++this.#recording).padStart(16, "0")}`);
  }
  nextRuntimeId() {
    return RuntimeIdSchema.parse(`run_${String(++this.#runtime).padStart(16, "0")}`);
  }
  nextCommandId() {
    return CommandIdSchema.parse(`cmd_${String(++this.#command).padStart(16, "0")}`);
  }
  nextRequestId() {
    return RequestIdSchema.parse(`req_${String(++this.#request).padStart(16, "0")}`);
  }
  nextTransferId() {
    return TransferIdSchema.parse(`xfer_${String(++this.#transfer).padStart(16, "0")}`);
  }
}

export class CapturingLogger implements LoggerPort {
  readonly errors: Array<{ message: string; fields?: StructuredLogFields }> = [];
  debug(_message: string, _fields?: StructuredLogFields): void {}
  info(_message: string, _fields?: StructuredLogFields): void {}
  warn(_message: string, _fields?: StructuredLogFields): void {}
  error(message: string, fields?: StructuredLogFields): void {
    this.errors.push({ message, fields });
  }
}
