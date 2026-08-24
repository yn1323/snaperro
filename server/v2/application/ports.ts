import type { CommandOf, CommandResult, CommandType } from "../../../shared/contracts-v2/commands.js";
import type { BodyRef, CatalogSnapshot, ScenarioManifest } from "../../../shared/contracts-v2/entities.js";
import type { Event, EventDraft, EventOf, EventType } from "../../../shared/contracts-v2/events.js";
import type {
  CommandId,
  EventSequence,
  FolderId,
  HeaderFields,
  HttpMethod,
  IsoDateTime,
  RecordingId,
  RequestId,
  Revision,
  RuntimeId,
  ScenarioId,
  Sha256,
  TransferId,
} from "../../../shared/contracts-v2/primitives.js";
import type { QueryOf, QueryResult, QueryType } from "../../../shared/contracts-v2/queries.js";

export interface OperationContext {
  signal?: AbortSignal;
}

export interface ClockPort {
  now(): IsoDateTime;
}

export interface IdGeneratorPort {
  nextFolderId(): FolderId;
  nextScenarioId(): ScenarioId;
  nextRecordingId(): RecordingId;
  nextRuntimeId(): RuntimeId;
  nextCommandId(): CommandId;
  nextRequestId(): RequestId;
  nextTransferId(): TransferId;
}

/** Compare-and-swap persistence for the single catalog commit boundary. */
export interface CatalogRepositoryPort {
  read(context?: OperationContext): Promise<CatalogSnapshot>;
  compareAndSwap(
    expectedRevision: Revision,
    next: CatalogSnapshot,
    context?: OperationContext,
  ): Promise<CatalogSnapshot>;
}

/** Existing manifests are read-only here; recording changes use RecordingCommitPort. */
export interface ScenarioManifestRepositoryPort {
  read(scenarioId: ScenarioId, context?: OperationContext): Promise<ScenarioManifest>;
  /**
   * Reads a manifest from the same catalog view already observed by a query.
   * Implementations must fence the pointer validation and manifest read, then
   * reject when either expected revision is no longer current.
   */
  readAtRevision(
    scenarioId: ScenarioId,
    expectedCatalogRevision: Revision,
    expectedScenarioRevision: Revision,
    context?: OperationContext,
  ): Promise<ScenarioManifest>;
  create(manifest: ScenarioManifest, context?: OperationContext): Promise<void>;
  markForGarbageCollection(scenarioId: ScenarioId, context?: OperationContext): Promise<void>;
}

export interface RecordingCommit {
  scenarioId: ScenarioId;
  expectedCatalogRevision: Revision;
  expectedScenarioRevision: Revision;
  catalog: CatalogSnapshot;
  manifest: ScenarioManifest;
}

export interface RecordingCommitResult {
  catalog: CatalogSnapshot;
  manifest: ScenarioManifest;
}

/**
 * Atomic visibility boundary for a recording change.
 *
 * An adapter stages the immutable next manifest first, then makes the catalog
 * pointer/count/global revision visible with one CAS commit marker. A staged
 * manifest that never reaches the marker is not observable by readers.
 */
export interface RecordingCommitPort {
  compareAndSwap(commit: RecordingCommit, context?: OperationContext): Promise<RecordingCommitResult>;
}

/** Best-effort cleanup of manifests and blobs no longer reachable from the catalog. */
export interface GarbageCollectionPort {
  schedule(context?: OperationContext): Promise<void>;
  pinPending?(body: BodyRef, context?: OperationContext): Promise<void>;
  close?(): Promise<void>;
}

export interface BlobWriteMetadata {
  mediaType: string | null;
  contentEncoding: string | null;
}

/** A staged write is invisible until commit and can be explicitly discarded. */
export interface BlobWriteSessionPort {
  readonly writable: WritableStream<Uint8Array>;
  commit(context?: OperationContext): Promise<BodyRef>;
  abort(reason?: unknown): Promise<void>;
}

export interface BlobPinHandlePort {
  release(): Promise<void>;
}

export interface BlobStorePort {
  beginWrite(metadata: BlobWriteMetadata, context?: OperationContext): Promise<BlobWriteSessionPort>;
  open(body: BodyRef, context?: OperationContext): Promise<ReadableStream<Uint8Array>>;
  openByDigest(
    sha256: Sha256,
    context?: OperationContext,
  ): Promise<{ ref: BodyRef; stream: ReadableStream<Uint8Array> }>;
  exists(body: BodyRef, context?: OperationContext): Promise<boolean>;
  pin(body: BodyRef, context?: OperationContext): Promise<BlobPinHandlePort>;
  /** Pins every digest under one visibility fence so GC cannot interleave with acquisition. */
  pinMany(bodies: readonly BodyRef[], context?: OperationContext): Promise<BlobPinHandlePort>;
  collectGarbage(referenced: ReadonlySet<string>, context?: OperationContext): Promise<number>;
}

export interface StoreLeaseHandlePort {
  readonly owner: string;
  assertOwned(): Promise<void>;
  release(): Promise<void>;
}

export interface StoreLeasePort {
  acquire(context?: OperationContext): Promise<StoreLeaseHandlePort>;
  runWithHandle?<Result>(handle: StoreLeaseHandlePort, operation: () => Promise<Result>): Promise<Result>;
}

/** Fences the catalog visibility marker against an expired cross-process writer. */
export interface VisibilityFencePort {
  withVisibilityFence<Result>(operation: () => Promise<Result>, context?: OperationContext): Promise<Result>;
}

/** Process-local coordination; the store lease provides cross-process exclusion. */
export interface WriteCoordinatorPort {
  withCatalogWrite<Result>(operation: () => Promise<Result>, context?: OperationContext): Promise<Result>;
  withScenarioWrite<Result>(
    scenarioId: ScenarioId,
    operation: () => Promise<Result>,
    context?: OperationContext,
  ): Promise<Result>;
}

export interface UpstreamRequest {
  method: HttpMethod;
  url: string;
  headers: HeaderFields;
  body: ReadableStream<Uint8Array> | null;
  signal: AbortSignal;
}

export interface UpstreamResponse {
  status: number;
  statusText: string;
  headers: HeaderFields;
  body: ReadableStream<Uint8Array> | null;
}

export interface UpstreamGatewayPort {
  execute(request: UpstreamRequest): Promise<UpstreamResponse>;
  close(): Promise<void>;
}

export interface EventWatermark {
  runtimeId: RuntimeId;
  sequence: EventSequence;
  revision: Revision;
}

export type EventListener = (event: Event) => Promise<void>;
export type Unsubscribe = () => Promise<void>;

export interface EventSubscription {
  watermark: EventWatermark;
  unsubscribe: Unsubscribe;
}

export interface EventHubPort {
  watermark(): EventWatermark;
  publish<Type extends EventType>(draft: EventDraft<Type>): Promise<EventOf<Type>>;
  subscribe(
    listener: EventListener,
    options?: OperationContext & { afterSequence?: EventSequence },
  ): Promise<Unsubscribe>;
  /** Atomically captures the current watermark and installs the listener. */
  subscribeWithWatermark(
    listener: EventListener,
    options?: OperationContext & { afterSequence?: EventSequence },
  ): Promise<EventSubscription>;
  close(): Promise<void>;
}

export interface CommandBusPort {
  execute<Type extends CommandType>(command: CommandOf<Type>, context?: OperationContext): Promise<CommandResult<Type>>;
}

export interface QueryBusPort {
  execute<Type extends QueryType>(query: QueryOf<Type>, context?: OperationContext): Promise<QueryResult<Type>>;
}

export interface StructuredLogFields {
  [key: string]: unknown;
}

export interface LoggerPort {
  debug(message: string, fields?: StructuredLogFields): void;
  info(message: string, fields?: StructuredLogFields): void;
  warn(message: string, fields?: StructuredLogFields): void;
  error(message: string, fields?: StructuredLogFields): void;
}
