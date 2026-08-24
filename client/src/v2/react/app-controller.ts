import {
  type BodyRef,
  CommandIdSchema,
  type CommandOf,
  type Event,
  type FolderId,
  MAX_CONTROL_JSON_BYTES,
  type Mode,
  type QueryResult,
  RecordingDraftSchema,
  type RecordingId,
  RecordingSchema,
  type RecordingSummary,
  type Revision,
  type ScenarioId,
  V2_SCHEMA_VERSION,
} from "../contracts";
import { ApiError } from "../infrastructure/api-error";
import type { V2HttpClient } from "../infrastructure/http-client";
import type { V2RealtimeClient } from "../infrastructure/realtime-client";
import { type LatestRequestResult, LatestRequestRunner } from "../latest-request";
import {
  applyTypedRealtimeEvent,
  createRealtimeSyncState,
  installRealtimeSnapshot,
  type RealtimeApplyResult,
} from "../realtime";
import { createViewState, reconcileCatalogViewState, reduceViewState, type ViewState } from "../view-state";
import {
  createRecordingDocumentState,
  createRecordingListState,
  type OperationState,
  type RecordingDocumentState,
  type RecordingListState,
  type RequestLogState,
  type ServerUiState,
} from "./app-state";
import { type BrowserDownloadPort, createBrowserDownloadPort } from "./browser-download";
import { type ControlTokenSession, createControlTokenInfrastructure } from "./control-token-session";
import {
  bodyDownloadFilename,
  invalidatesActiveRecordings,
  reconcileRecordingMutation,
  recordingDraft,
  synchronizeBodyHeaders,
  upsertRecordingSummary,
} from "./controller-policies";
import { DocumentBuffer } from "./document-buffer";
import { ExternalStore } from "./external-store";

const PAGE_SIZE = 200;
const MAX_LOGS = 500;
const DEFAULT_SEARCH_EVENT_DEBOUNCE_MS = 100;
const MAX_STALE_PAGE_ATTEMPTS = 3;
const STALE_PAGE_RETRY_DELAY_MS = 500;
const MAX_STALE_PAGE_BACKGROUND_RETRIES = 3;

export type { BrowserDownloadPort } from "./browser-download";

export interface V2AppControllerOptions {
  http?: V2HttpClient;
  realtime?: V2RealtimeClient;
  commandId?: () => string;
  downloads?: BrowserDownloadPort;
  searchEventDebounceMs?: number;
}

function defaultCommandId(): string {
  return `cmd_${globalThis.crypto.randomUUID().replace(/-/gu, "")}`;
}

const browserDownloads = createBrowserDownloadPort();

function isRevisionConflict(error: unknown): error is ApiError {
  return error instanceof ApiError && error.code === "REVISION_CONFLICT";
}

function isNotFound(error: unknown): error is ApiError {
  return error instanceof ApiError && (error.code === "NOT_FOUND" || error.status === 404);
}

class OperationInvalidatedError extends ApiError {
  constructor(cause?: unknown) {
    super("The operation was cancelled because the client session changed", { code: "ABORTED", cause });
    this.name = "OperationInvalidatedError";
  }
}

interface ControllerOperationToken {
  readonly signal: AbortSignal;
  assertCurrent(): void;
}

interface DraftDiscardContext {
  recordingId: RecordingId;
  mutationVersion: number;
}

interface RunOperationOptions<Result> {
  resync?: boolean;
  commit?: (result: Result, token: ControllerOperationToken) => Promise<void> | void;
}

export class V2AppController {
  readonly http: V2HttpClient;
  readonly realtime: V2RealtimeClient;
  readonly auth: ControlTokenSession;
  readonly documentBuffer = new DocumentBuffer();
  readonly server = new ExternalStore<ServerUiState>({
    realtime: createRealtimeSyncState(),
    connection: "connecting",
    error: null,
  });
  readonly view = new ExternalStore<ViewState>(createViewState());
  readonly recordings = new ExternalStore<RecordingListState>(createRecordingListState());
  readonly document = new ExternalStore<RecordingDocumentState>(createRecordingDocumentState());
  readonly operation = new ExternalStore<OperationState>({ pending: false, label: null, error: null });
  readonly logs = new ExternalStore<RequestLogState>({ entries: [] });

  readonly #commandId: () => string;
  readonly #downloads: BrowserDownloadPort;
  readonly #searchEventDebounceMs: number;
  readonly #recordingsRequest = new LatestRequestRunner();
  readonly #loadMoreRequest = new LatestRequestRunner();
  readonly #documentRequest = new LatestRequestRunner();
  readonly #snapshotRequest = new LatestRequestRunner();
  #started = false;
  #streamGeneration = 0;
  #streamController: AbortController | null = null;
  #recordingsRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  #stalePageBackgroundRetries = 0;
  #operationGeneration = 0;
  #operationController: AbortController | null = null;

  constructor(options: V2AppControllerOptions = {}) {
    const authenticated = createControlTokenInfrastructure();
    this.auth = authenticated.session;
    this.http = options.http ?? authenticated.http;
    this.realtime = options.realtime ?? authenticated.realtime;
    this.#commandId = options.commandId ?? defaultCommandId;
    this.#downloads = options.downloads ?? browserDownloads;
    this.#searchEventDebounceMs = options.searchEventDebounceMs ?? DEFAULT_SEARCH_EVENT_DEBOUNCE_MS;
    if (!Number.isSafeInteger(this.#searchEventDebounceMs) || this.#searchEventDebounceMs < 0) {
      throw new TypeError("searchEventDebounceMs must be a non-negative safe integer");
    }
  }

  start(): void {
    if (this.#started) return;
    this.#started = true;
    this.#connectStream();
  }

  stop(): void {
    this.#started = false;
    this.#streamGeneration += 1;
    this.#streamController?.abort();
    this.#streamController = null;
    this.#invalidateAsyncWork();
    this.server.update((state) => ({ ...state, connection: "stopped" }));
  }

  #invalidateAsyncWork(): void {
    this.#recordingsRequest.cancel();
    this.#loadMoreRequest.cancel();
    this.#documentRequest.cancel();
    this.#snapshotRequest.cancel();
    this.#cancelScheduledRecordingsRefresh();
    this.#operationGeneration += 1;
    this.#operationController?.abort();
    this.#operationController = null;
    if (this.operation.getSnapshot().pending) {
      this.operation.set({ pending: false, label: null, error: null });
    }
    if (this.document.getSnapshot().saving) {
      this.document.update((state) => ({ ...state, saving: false }));
    }
  }

  reconnect(): void {
    this.server.update((state) => ({
      ...state,
      connection: state.realtime.snapshot ? "reconnecting" : "connecting",
      error: null,
    }));
    if (!this.#started) {
      this.start();
      return;
    }
    this.#connectStream();
  }

  updateControlToken(token: string): void {
    this.auth.setToken(token);
    this.#invalidateAsyncWork();
    this.reconnect();
  }

  clearControlToken(): void {
    this.auth.clearToken();
    this.#invalidateAsyncWork();
    this.reconnect();
  }

  #nextCommandId() {
    return CommandIdSchema.parse(this.#commandId());
  }

  #connectStream(): void {
    this.#streamGeneration += 1;
    const generation = this.#streamGeneration;
    this.#streamController?.abort();
    const controller = new AbortController();
    this.#streamController = controller;
    this.server.update((state) => ({ ...state, connection: state.realtime.snapshot ? "reconnecting" : "connecting" }));

    void this.realtime
      .subscribe(
        {
          onStatus: (status) => {
            if (generation !== this.#streamGeneration) return;
            this.server.update((state) => ({
              ...state,
              connection:
                status === "connecting" && state.realtime.snapshot
                  ? "reconnecting"
                  : status === "stopped"
                    ? "stopped"
                    : status,
            }));
          },
          onError: (error) => {
            if (generation !== this.#streamGeneration) return;
            this.auth.observeError(error);
            this.server.update((state) => ({ ...state, error: this.auth.publicError(error) }));
          },
          onEvent: async (event) => {
            if (generation !== this.#streamGeneration) return;
            const result = applyTypedRealtimeEvent(this.server.getSnapshot().realtime, event);
            this.#acceptRealtimeResult(result, event);
            if (result.outcome === "resync-required") this.#restartStreamForResync();
          },
        },
        { signal: controller.signal },
      )
      .catch((error: unknown) => {
        if (generation !== this.#streamGeneration || controller.signal.aborted) return;
        this.auth.observeError(error);
        this.server.update((state) => ({ ...state, connection: "stopped", error: this.auth.publicError(error) }));
      });
  }

  #restartStreamForResync(): void {
    if (!this.#started) return;
    this.server.update((state) => ({ ...state, connection: "resyncing" }));
    this.#connectStream();
  }

  #acceptRealtimeResult(result: RealtimeApplyResult, event: Event): void {
    this.auth.markAuthorized();
    const previousRealtime = this.server.getSnapshot().realtime;
    const reconnectingFromSnapshot = event.type === "runtime.connected" && previousRealtime.snapshot !== null;
    const previousScenarioId = previousRealtime.snapshot?.currentScenarioId ?? null;
    const sequenceAdvanced = result.state.lastSequence !== previousRealtime.lastSequence;
    this.server.set({
      realtime: result.state,
      connection:
        result.outcome === "resync-required"
          ? "resyncing"
          : result.outcome === "protocol-error"
            ? "stopped"
            : "connected",
      error: result.state.issue ? { name: "RealtimeError", message: result.state.issue.message } : null,
    });

    if (sequenceAdvanced) {
      if (event.type === "request.completed") this.#appendLog({ kind: "completed", ...event.payload });
      if (event.type === "recording.outcome") {
        this.logs.update((state) => ({
          entries: state.entries.map((entry) =>
            entry.id === event.payload.requestId
              ? { ...entry, recordingOutcome: event.payload.recordingOutcome }
              : entry,
          ),
        }));
      }
      if (event.type === "recording.upserted") {
        this.#applyRecordingUpsert(event.payload.recording, event.payload.scenarioRevision);
      }
      if (event.type === "recording.deleted") {
        this.#applyRecordingDelete(
          event.payload.recordingId,
          false,
          event.payload.scenarioId,
          event.payload.scenarioRevision,
        );
      }
    }

    const snapshot = result.state.snapshot;
    if (!snapshot) return;
    this.#reconcileCatalog(snapshot, previousScenarioId);
    if (sequenceAdvanced && invalidatesActiveRecordings(event, snapshot.currentScenarioId)) {
      void this.#refreshActiveRecordingContext();
    }
    if (
      reconnectingFromSnapshot &&
      result.outcome === "applied" &&
      snapshot.currentScenarioId !== null &&
      snapshot.currentScenarioId === previousScenarioId
    ) {
      void this.#refreshActiveRecordingContext();
    }
  }

  #appendLog(log: RequestLogState["entries"][number]): void {
    this.logs.update((state) => ({ entries: [...state.entries, log].slice(-MAX_LOGS) }));
  }

  clearLogs(): void {
    this.logs.set({ entries: [] });
  }

  #reconcileCatalog(
    snapshot: NonNullable<ServerUiState["realtime"]["snapshot"]>,
    previousScenarioId: ScenarioId | null,
  ): void {
    const nextView = reconcileCatalogViewState(this.view.getSnapshot(), snapshot);
    this.view.set(nextView);

    if (snapshot.currentScenarioId !== previousScenarioId) {
      this.#resetStalePageRecovery();
      const activeDocument = this.document.getSnapshot();
      const preserveDraft =
        activeDocument.recordingId !== null && (this.documentBuffer.getSnapshot().dirty || activeDocument.saving);
      this.#recordingsRequest.cancel();
      this.#loadMoreRequest.cancel();
      this.#documentRequest.cancel();
      this.recordings.set(createRecordingListState());
      if (preserveDraft && activeDocument.recording) {
        const scenarioStillExists = Boolean(snapshot.scenarios[activeDocument.recording.scenarioId]);
        const returnedToDocumentScenario = snapshot.currentScenarioId === activeDocument.recording.scenarioId;
        this.document.set({
          ...activeDocument,
          pendingRecordingId: null,
          pendingScenarioId: null,
          conflict: !scenarioStillExists
            ? { kind: "deleted" }
            : returnedToDocumentScenario
              ? null
              : { kind: "scenario-changed", scenarioId: activeDocument.recording.scenarioId },
        });
        if (returnedToDocumentScenario) {
          this.view.update((state) =>
            reduceViewState(state, { type: "recording.selected", recordingId: activeDocument.recordingId }),
          );
        }
      } else {
        this.document.set(createRecordingDocumentState());
        this.documentBuffer.clear();
      }
      if (snapshot.currentScenarioId) void this.refreshRecordings(nextView.searchQuery);
      return;
    }

    const activeRecording = this.document.getSnapshot().recording;
    if (activeRecording && !snapshot.scenarios[activeRecording.scenarioId]) {
      this.view.update((state) => reduceViewState(state, { type: "recording.selected", recordingId: null }));
      const activeDocument = this.document.getSnapshot();
      if (this.documentBuffer.getSnapshot().dirty || activeDocument.saving) {
        this.document.set({ ...activeDocument, conflict: { kind: "deleted" } });
      } else {
        this.document.set(createRecordingDocumentState());
        this.documentBuffer.clear();
      }
    }
  }

  /**
   * A new SSE connection is anchored by a catalog-only snapshot that excludes
   * recording metadata. Re-read paged state and the open recording so changes
   * made while disconnected cannot survive in the UI.
   */
  async #refreshActiveRecordingContext(): Promise<void> {
    const scenarioId = this.server.getSnapshot().realtime.snapshot?.currentScenarioId ?? null;
    if (!scenarioId) return;
    const query = this.view.getSnapshot().searchQuery;
    // Establish the authoritative manifest revision before re-reading the
    // document. Running these reads concurrently can apply an older recording
    // after the page has already observed a newer manifest.
    await this.refreshRecordings(query).catch(() => undefined);
    await this.#revalidateActiveDocument(scenarioId);
  }

  async #revalidateActiveDocument(currentScenarioId: ScenarioId): Promise<void> {
    const before = this.document.getSnapshot();
    if (!before.recordingId) return;
    const recordingId = before.recordingId;
    const scenarioId = before.recording?.scenarioId ?? currentScenarioId;

    try {
      for (let attempt = 1; attempt <= MAX_STALE_PAGE_ATTEMPTS; attempt += 1) {
        const request = await this.#documentRequest.run((token) =>
          this.http.query(
            { protocolVersion: V2_SCHEMA_VERSION, type: "recording.get", scenarioId, recordingId },
            { signal: token.signal },
          ),
        );
        if (request.kind !== "applied") return;
        if (request.value.recording.id !== recordingId || request.value.recording.scenarioId !== scenarioId) {
          throw new ApiError("Recording response did not match the requested identity", { code: "INVALID_RESPONSE" });
        }
        const latest = this.document.getSnapshot();
        if (
          latest.recordingId !== recordingId ||
          this.#snapshot().currentScenarioId !== currentScenarioId ||
          this.#snapshot().currentScenarioId !== scenarioId
        ) {
          return;
        }
        if (
          this.#recordingReadIsStale(
            scenarioId,
            recordingId,
            request.value.scenarioRevision,
            request.value.recording.revision,
          )
        ) {
          if (attempt < MAX_STALE_PAGE_ATTEMPTS) continue;
          throw this.#staleRecordingReadError();
        }
        const dirty = this.documentBuffer.getSnapshot().dirty;
        if (dirty || latest.saving) {
          const observedContentRevision =
            latest.observedContentRevision === null || request.value.recording.revision > latest.observedContentRevision
              ? request.value.recording.revision
              : latest.observedContentRevision;
          if (latest.recording && request.value.recording.revision > latest.recording.revision) {
            this.document.set({
              ...latest,
              observedContentRevision,
              conflict: { kind: "updated", remoteRevision: request.value.recording.revision },
            });
          } else if (observedContentRevision !== latest.observedContentRevision) {
            this.document.set({ ...latest, observedContentRevision });
          }
          return;
        }

        this.documentBuffer.load(JSON.stringify(recordingDraft(request.value.recording), null, 2));
        this.document.set({
          ...createRecordingDocumentState(),
          recordingId,
          phase: "ready",
          recording: request.value.recording,
          observedContentRevision: request.value.recording.revision,
        });
        return;
      }
    } catch (error) {
      const latest = this.document.getSnapshot();
      if (latest.recordingId !== recordingId) return;
      if (isNotFound(error)) {
        this.#applyRecordingDelete(recordingId);
        return;
      }
      this.document.set({ ...latest, error: this.auth.publicError(error) });
    }
  }

  async #resyncSnapshot(): Promise<void> {
    const request = await this.#snapshotRequest.run(async (token) => this.http.snapshot({ signal: token.signal }));
    if (request.kind !== "applied") return;

    const currentServer = this.server.getSnapshot();
    const anchor =
      currentServer.realtime.lastSequence !== null && currentServer.realtime.lastEventId !== null
        ? { sequence: currentServer.realtime.lastSequence, eventId: currentServer.realtime.lastEventId }
        : undefined;
    const previousScenarioId = currentServer.realtime.snapshot?.currentScenarioId ?? null;
    const installed = installRealtimeSnapshot(currentServer.realtime, request.value, anchor);
    if (installed.outcome !== "applied") {
      this.server.set({ realtime: installed.state, connection: "resyncing", error: null });
      this.#restartStreamForResync();
      return;
    }
    this.server.set({ realtime: installed.state, connection: "connected", error: null });
    if (installed.state.snapshot) this.#reconcileCatalog(installed.state.snapshot, previousScenarioId);
  }

  async #runOperation<Result>(
    label: string,
    operation: (token: ControllerOperationToken) => Promise<Result>,
    options: RunOperationOptions<Result> = {},
  ): Promise<Result> {
    if (this.operation.getSnapshot().pending) {
      throw new ApiError("Another operation is still in progress", { code: "INVALID_REQUEST" });
    }
    const generation = ++this.#operationGeneration;
    const controller = new AbortController();
    this.#operationController = controller;
    const isCurrent = (): boolean =>
      generation === this.#operationGeneration &&
      this.#operationController === controller &&
      !controller.signal.aborted;
    const token: ControllerOperationToken = {
      signal: controller.signal,
      assertCurrent: () => {
        if (!isCurrent()) throw new OperationInvalidatedError();
      },
    };
    this.operation.set({ pending: true, label, error: null });
    try {
      const result = await operation(token);
      token.assertCurrent();
      await options.commit?.(result, token);
      token.assertCurrent();
      if (options.resync) {
        try {
          await this.#resyncSnapshot();
        } catch (error) {
          // The command and local commit already succeeded. Reporting the
          // whole operation as failed would invite a duplicate user retry.
          // Surface only the synchronization problem and repair it through a
          // fresh event-stream snapshot.
          token.assertCurrent();
          this.auth.observeError(error);
          this.server.update((state) => ({
            ...state,
            connection: "resyncing",
            error: this.auth.publicError(error),
          }));
          this.#restartStreamForResync();
        }
      }
      token.assertCurrent();
      this.operation.set({ pending: false, label: null, error: null });
      this.#operationController = null;
      return result;
    } catch (error) {
      if (!isCurrent() || error instanceof OperationInvalidatedError) {
        throw error instanceof OperationInvalidatedError ? error : new OperationInvalidatedError(error);
      }
      if (isRevisionConflict(error)) {
        await this.#resyncSnapshot().catch(() => undefined);
        await this.refreshRecordings(this.view.getSnapshot().searchQuery).catch(() => undefined);
        token.assertCurrent();
      }
      this.operation.set({ pending: false, label: null, error: this.auth.publicError(error) });
      this.#operationController = null;
      throw error;
    }
  }

  #snapshot() {
    const snapshot = this.server.getSnapshot().realtime.snapshot;
    if (!snapshot) throw new ApiError("The server snapshot is not ready", { code: "INVALID_REQUEST" });
    return snapshot;
  }

  #recordingReadIsStale(
    scenarioId: ScenarioId,
    recordingId: RecordingId,
    scenarioRevision: Revision,
    contentRevision: Revision,
  ): boolean {
    const list = this.recordings.getSnapshot();
    if (list.scenarioId !== scenarioId) return false;
    const summary = list.items.find((item) => item.id === recordingId);
    const document = this.document.getSnapshot();
    const observedContentRevision = document.recordingId === recordingId ? document.observedContentRevision : null;
    return (
      (list.scenarioRevision !== null && scenarioRevision < list.scenarioRevision) ||
      (summary !== undefined && contentRevision < summary.contentRevision) ||
      (observedContentRevision !== null && contentRevision < observedContentRevision)
    );
  }

  #staleRecordingReadError(): ApiError {
    return new ApiError("The recording kept changing while it was loading. Retry the load.", {
      code: "REVISION_CONFLICT",
      status: 409,
      retryable: true,
    });
  }

  #assertScenarioRevisionCurrent(scenarioId: ScenarioId, scenarioRevision: Revision, message: string): void {
    const list = this.recordings.getSnapshot();
    if (
      this.#snapshot().currentScenarioId !== scenarioId ||
      list.scenarioId !== scenarioId ||
      list.scenarioRevision !== scenarioRevision
    ) {
      throw new ApiError(message, {
        code: "REVISION_CONFLICT",
        status: 409,
        retryable: true,
      });
    }
  }

  setMode(mode: Mode): Promise<unknown> {
    return this.#runOperation(
      "Changing mode",
      (token) =>
        this.http.command(
          {
            protocolVersion: V2_SCHEMA_VERSION,
            commandId: this.#nextCommandId(),
            expectedRevision: this.#snapshot().revision,
            type: "mode.set",
            mode,
          },
          { signal: token.signal },
        ),
      { resync: true },
    );
  }

  selectScenario(scenarioId: ScenarioId): Promise<unknown> {
    const document = this.document.getSnapshot();
    if (
      this.#snapshot().currentScenarioId !== scenarioId &&
      document.recordingId !== null &&
      this.documentBuffer.getSnapshot().dirty
    ) {
      this.document.set({ ...document, pendingScenarioId: scenarioId });
      return Promise.resolve();
    }
    return this.#selectScenarioNow(scenarioId);
  }

  #selectScenarioNow(scenarioId: ScenarioId, discard?: DraftDiscardContext): Promise<unknown> {
    return this.#runOperation(
      "Selecting scenario",
      (token) =>
        this.http.command(
          {
            protocolVersion: V2_SCHEMA_VERSION,
            commandId: this.#nextCommandId(),
            expectedRevision: this.#snapshot().revision,
            type: "scenario.select",
            scenarioId,
          },
          { signal: token.signal },
        ),
      {
        resync: true,
        commit: () => {
          if (!discard) return;
          const latest = this.document.getSnapshot();
          if (
            latest.recordingId !== discard.recordingId ||
            (latest.pendingScenarioId !== scenarioId && this.#snapshot().currentScenarioId !== scenarioId) ||
            this.documentBuffer.mutationVersion !== discard.mutationVersion
          ) {
            // The scenario command has committed, but the local draft changed
            // after confirmation. Preserve that newer draft; the following
            // snapshot resync will present it as a scenario conflict.
            return;
          }
          this.documentBuffer.clear();
          this.document.set(createRecordingDocumentState());
        },
      },
    );
  }

  confirmDiscardAndSelectScenario(): Promise<unknown> {
    const document = this.document.getSnapshot();
    const pending = document.pendingScenarioId;
    if (!pending || !document.recordingId) return Promise.resolve();
    return this.#selectScenarioNow(pending, {
      recordingId: document.recordingId,
      mutationVersion: this.documentBuffer.mutationVersion,
    });
  }

  returnToDocumentScenario(): Promise<unknown> {
    const scenarioId = this.document.getSnapshot().recording?.scenarioId;
    if (!scenarioId) throw new ApiError("The draft is not associated with a scenario", { code: "INVALID_REQUEST" });
    return this.#selectScenarioNow(scenarioId);
  }

  createFolder(name: string): Promise<unknown> {
    return this.#runOperation(
      "Creating folder",
      (token) =>
        this.http.command(
          {
            protocolVersion: V2_SCHEMA_VERSION,
            commandId: this.#nextCommandId(),
            expectedRevision: this.#snapshot().revision,
            type: "folder.create",
            name,
          },
          { signal: token.signal },
        ),
      { resync: true },
    );
  }

  renameFolder(folderId: FolderId, name: string): Promise<unknown> {
    return this.#runOperation(
      "Renaming folder",
      (token) =>
        this.http.command(
          {
            protocolVersion: V2_SCHEMA_VERSION,
            commandId: this.#nextCommandId(),
            expectedRevision: this.#snapshot().revision,
            type: "folder.rename",
            folderId,
            name,
          },
          { signal: token.signal },
        ),
      { resync: true },
    );
  }

  deleteFolder(folderId: FolderId): Promise<unknown> {
    return this.#runOperation(
      "Deleting folder",
      (token) =>
        this.http.command(
          {
            protocolVersion: V2_SCHEMA_VERSION,
            commandId: this.#nextCommandId(),
            expectedRevision: this.#snapshot().revision,
            type: "folder.delete",
            folderId,
          },
          { signal: token.signal },
        ),
      { resync: true },
    );
  }

  createScenario(folderId: FolderId, name: string): Promise<unknown> {
    return this.#runOperation(
      "Creating scenario",
      (token) =>
        this.http.command(
          {
            protocolVersion: V2_SCHEMA_VERSION,
            commandId: this.#nextCommandId(),
            expectedRevision: this.#snapshot().revision,
            type: "scenario.create",
            folderId,
            name,
          },
          { signal: token.signal },
        ),
      { resync: true },
    );
  }

  renameScenario(scenarioId: ScenarioId, name: string): Promise<unknown> {
    return this.#runOperation(
      "Renaming scenario",
      (token) =>
        this.http.command(
          {
            protocolVersion: V2_SCHEMA_VERSION,
            commandId: this.#nextCommandId(),
            expectedRevision: this.#snapshot().revision,
            type: "scenario.rename",
            scenarioId,
            name,
          },
          { signal: token.signal },
        ),
      { resync: true },
    );
  }

  duplicateScenario(scenarioId: ScenarioId): Promise<unknown> {
    const scenario = this.#snapshot().scenarios[scenarioId];
    if (!scenario) throw new ApiError("Scenario no longer exists", { code: "INVALID_REQUEST" });
    return this.#runOperation(
      "Duplicating scenario",
      (token) =>
        this.http.command(
          {
            protocolVersion: V2_SCHEMA_VERSION,
            commandId: this.#nextCommandId(),
            expectedRevision: this.#snapshot().revision,
            type: "scenario.duplicate",
            scenarioId,
            destinationFolderId: scenario.folderId,
            name: `${scenario.name}_copy`,
          },
          { signal: token.signal },
        ),
      { resync: true },
    );
  }

  deleteScenario(scenarioId: ScenarioId): Promise<unknown> {
    return this.#runOperation(
      "Deleting scenario",
      (token) =>
        this.http.command(
          {
            protocolVersion: V2_SCHEMA_VERSION,
            commandId: this.#nextCommandId(),
            expectedRevision: this.#snapshot().revision,
            type: "scenario.delete",
            scenarioId,
          },
          { signal: token.signal },
        ),
      { resync: true },
    );
  }

  selectFolder(folderId: FolderId | null): void {
    this.view.update((state) =>
      folderId
        ? reduceViewState(state, { type: "folder.selected", folderId })
        : reduceViewState(state, { type: "folder.cleared" }),
    );
  }

  setSearchQuery(query: string): void {
    this.#resetStalePageRecovery();
    this.view.update((state) => reduceViewState(state, { type: "search.changed", query }));
  }

  async refreshRecordings(query = this.view.getSnapshot().searchQuery): Promise<void> {
    this.#resetStalePageRecovery();
    return this.#refreshRecordings(query, false);
  }

  async #refreshRecordings(query: string, automaticStaleRetry: boolean): Promise<void> {
    this.#cancelScheduledRecordingsRefresh();
    const scenarioId = this.#snapshot().currentScenarioId;
    if (!scenarioId) {
      this.recordings.set(createRecordingListState());
      return;
    }

    const previous = this.recordings.getSnapshot();
    const preservePage = previous.scenarioId === scenarioId && previous.query === query;
    this.recordings.set({
      ...createRecordingListState(),
      scenarioId,
      scenarioRevision: previous.scenarioId === scenarioId ? previous.scenarioRevision : null,
      query,
      items: preservePage ? previous.items : [],
      nextCursor: preservePage ? previous.nextCursor : null,
      status: "loading",
    });
    try {
      for (let attempt = 1; attempt <= MAX_STALE_PAGE_ATTEMPTS; attempt += 1) {
        const request = await this.#recordingsRequest.run((token) =>
          query.trim()
            ? this.http.query(
                {
                  protocolVersion: V2_SCHEMA_VERSION,
                  type: "recording.search",
                  scenarioId,
                  text: query,
                  limit: PAGE_SIZE,
                },
                { signal: token.signal },
              )
            : this.http.query(
                {
                  protocolVersion: V2_SCHEMA_VERSION,
                  type: "recording.list",
                  scenarioId,
                  limit: PAGE_SIZE,
                },
                { signal: token.signal },
              ),
        );
        if (
          request.kind !== "applied" ||
          this.server.getSnapshot().realtime.snapshot?.currentScenarioId !== scenarioId
        ) {
          return;
        }
        const latest = this.recordings.getSnapshot();
        if (
          latest.scenarioId === scenarioId &&
          latest.scenarioRevision !== null &&
          request.value.scenarioRevision < latest.scenarioRevision
        ) {
          // The page request raced with a committed recording event. A request
          // started after observing that event must read at least its manifest
          // revision, so retry rather than restoring stale items or revision.
          if (attempt < MAX_STALE_PAGE_ATTEMPTS) continue;
          if (this.#stalePageBackgroundRetries >= MAX_STALE_PAGE_BACKGROUND_RETRIES) {
            this.recordings.set({
              ...latest,
              status: "ready",
              error: {
                name: "RevisionConflict",
                code: "REVISION_CONFLICT",
                message:
                  "Recordings kept changing during refresh. Cached results are shown; retry when updates settle.",
              },
            });
            return;
          }
          this.recordings.set({ ...latest, status: "ready", error: null });
          this.#stalePageBackgroundRetries += 1;
          const delay = STALE_PAGE_RETRY_DELAY_MS * 2 ** (this.#stalePageBackgroundRetries - 1);
          this.#scheduleRecordingsRefresh(delay, true, true);
          return;
        }
        this.#resetStalePageRecovery();
        this.recordings.set({
          scenarioId,
          scenarioRevision: request.value.scenarioRevision,
          query,
          items: request.value.items,
          nextCursor: request.value.nextCursor,
          status: "ready",
          error: null,
        });
        return;
      }
    } catch (error) {
      if (this.server.getSnapshot().realtime.snapshot?.currentScenarioId !== scenarioId) return;
      this.recordings.set({
        ...createRecordingListState(),
        scenarioId,
        query,
        status: "error",
        error: this.auth.publicError(error),
      });
      if (!automaticStaleRetry) this.#stalePageBackgroundRetries = 0;
      throw error;
    }
  }

  async loadMoreRecordings(): Promise<void> {
    const current = this.recordings.getSnapshot();
    if (!current.scenarioId || !current.nextCursor || current.status === "loading-more") return;
    const { scenarioId, query, nextCursor } = current;
    this.recordings.set({ ...current, status: "loading-more", error: null });
    try {
      const request = await this.#loadMoreRequest.run((token) =>
        query.trim()
          ? this.http.query(
              {
                protocolVersion: V2_SCHEMA_VERSION,
                type: "recording.search",
                scenarioId,
                text: query,
                cursor: nextCursor,
                limit: PAGE_SIZE,
              },
              { signal: token.signal },
            )
          : this.http.query(
              {
                protocolVersion: V2_SCHEMA_VERSION,
                type: "recording.list",
                scenarioId,
                cursor: nextCursor,
                limit: PAGE_SIZE,
              },
              { signal: token.signal },
            ),
      );
      if (request.kind !== "applied") return;
      const latest = this.recordings.getSnapshot();
      if (latest.scenarioId !== scenarioId || latest.query !== query) return;
      if (latest.scenarioRevision !== request.value.scenarioRevision) {
        // A recording event may arrive after this cursor page was read but
        // before its response is applied. Never merge that stale page into a
        // newer list because it could resurrect a deleted recording.
        await this.refreshRecordings(query);
        return;
      }
      const known = new Set(latest.items.map((item) => item.id));
      this.recordings.set({
        ...latest,
        items: [...latest.items, ...request.value.items.filter((item) => !known.has(item.id))],
        nextCursor: request.value.nextCursor,
        status: "ready",
        error: null,
      });
    } catch (error) {
      if (isRevisionConflict(error)) {
        await this.refreshRecordings(query);
        return;
      }
      this.recordings.update((state) => ({ ...state, status: "error", error: this.auth.publicError(error) }));
      throw error;
    }
  }

  openRecording(recordingId: RecordingId): void {
    const current = this.document.getSnapshot();
    if (current.recordingId === recordingId && current.phase !== "load-error" && current.phase !== "stale") return;
    if (current.recordingId && this.documentBuffer.getSnapshot().dirty) {
      this.document.set({ ...current, pendingRecordingId: recordingId });
      return;
    }
    this.#beginRecordingLoad(recordingId);
  }

  async confirmDiscardAndOpen(): Promise<void> {
    const before = this.document.getSnapshot();
    const pending = before.pendingRecordingId;
    const scenarioId = this.#snapshot().currentScenarioId;
    if (!pending || !before.recordingId || !scenarioId) return;
    const discard = {
      recordingId: before.recordingId,
      mutationVersion: this.documentBuffer.mutationVersion,
    };

    await this.#runOperation(
      "Opening recording",
      (token) =>
        this.http.query(
          { protocolVersion: V2_SCHEMA_VERSION, type: "recording.get", scenarioId, recordingId: pending },
          { signal: token.signal },
        ),
      {
        commit: (result) => {
          const latest = this.document.getSnapshot();
          if (
            this.#snapshot().currentScenarioId !== scenarioId ||
            latest.recordingId !== discard.recordingId ||
            latest.pendingRecordingId !== pending ||
            this.documentBuffer.mutationVersion !== discard.mutationVersion
          ) {
            throw new ApiError("The draft or selected scenario changed while the recording was loading", {
              code: "ABORTED",
              retryable: true,
            });
          }
          if (result.recording.id !== pending || result.recording.scenarioId !== scenarioId) {
            throw new ApiError("Recording response did not match the requested identity", {
              code: "INVALID_RESPONSE",
            });
          }
          if (this.#recordingReadIsStale(scenarioId, pending, result.scenarioRevision, result.recording.revision)) {
            throw this.#staleRecordingReadError();
          }
          this.#documentRequest.cancel();
          this.documentBuffer.load(JSON.stringify(recordingDraft(result.recording), null, 2));
          this.view.update((state) => reduceViewState(state, { type: "recording.selected", recordingId: pending }));
          this.document.set({
            ...createRecordingDocumentState(),
            recordingId: pending,
            phase: "ready",
            recording: result.recording,
            observedContentRevision: result.recording.revision,
          });
        },
      },
    );
  }

  cancelDiscardAndOpen(): void {
    this.document.update((state) => ({ ...state, pendingRecordingId: null }));
  }

  cancelDiscardAndSelectScenario(): void {
    this.document.update((state) => ({ ...state, pendingScenarioId: null }));
  }

  reloadDocument(): void {
    const document = this.document.getSnapshot();
    if (document.saving || this.operation.getSnapshot().pending) return;
    const recordingId = document.recordingId;
    if (!recordingId) return;
    this.documentBuffer.clear();
    this.#beginRecordingLoad(recordingId);
  }

  keepConflictedDraft(): void {
    if (this.operation.getSnapshot().pending || this.document.getSnapshot().saving) return;
    this.document.update((state) => (state.conflict?.kind === "updated" ? { ...state, conflict: null } : state));
  }

  #beginRecordingLoad(recordingId: RecordingId): void {
    const scenarioId = this.#snapshot().currentScenarioId;
    if (!scenarioId) return;
    this.documentBuffer.clear();
    this.view.update((state) => reduceViewState(state, { type: "recording.selected", recordingId }));
    void (async () => {
      for (let attempt = 1; attempt <= MAX_STALE_PAGE_ATTEMPTS; attempt += 1) {
        const result: LatestRequestResult<QueryResult<"recording.get">> = await this.#documentRequest.run(
          async (token): Promise<QueryResult<"recording.get">> => {
            this.document.set({
              ...createRecordingDocumentState(),
              recordingId,
              phase: "loading",
              loadingRequestId: token.id,
            });
            return this.http.query(
              { protocolVersion: V2_SCHEMA_VERSION, type: "recording.get", scenarioId, recordingId },
              { signal: token.signal },
            );
          },
        );
        if (result.kind !== "applied") return;
        if (result.value.recording.id !== recordingId || result.value.recording.scenarioId !== scenarioId) {
          throw new ApiError("Recording response did not match the requested identity", { code: "INVALID_RESPONSE" });
        }
        if (
          this.document.getSnapshot().recordingId !== recordingId ||
          this.#snapshot().currentScenarioId !== scenarioId
        ) {
          return;
        }
        if (
          this.#recordingReadIsStale(
            scenarioId,
            recordingId,
            result.value.scenarioRevision,
            result.value.recording.revision,
          )
        ) {
          if (attempt < MAX_STALE_PAGE_ATTEMPTS) continue;
          throw this.#staleRecordingReadError();
        }
        this.documentBuffer.load(JSON.stringify(recordingDraft(result.value.recording), null, 2));
        this.document.set({
          ...createRecordingDocumentState(),
          recordingId,
          phase: "ready",
          recording: result.value.recording,
          observedContentRevision: result.value.recording.revision,
        });
        return;
      }
    })().catch((error: unknown) => {
      if (this.document.getSnapshot().recordingId !== recordingId) return;
      this.document.update((state) => ({ ...state, phase: "load-error", error: this.auth.publicError(error) }));
    });
  }

  markDocumentChanged(): void {
    this.documentBuffer.markChanged();
  }

  formatDocument(): boolean {
    return this.documentBuffer.format();
  }

  async saveDocument(): Promise<void> {
    const current = this.document.getSnapshot();
    const parsed = this.documentBuffer.parse(RecordingDraftSchema);
    const list = this.recordings.getSnapshot();
    if (!current.recording || current.phase !== "ready" || !parsed || list.scenarioRevision === null) {
      if (!parsed) throw new ApiError("The recording JSON is invalid", { code: "INVALID_REQUEST" });
      throw new ApiError("The recording is not ready to save", { code: "INVALID_REQUEST" });
    }
    if (current.conflict?.kind === "updated") {
      throw new ApiError("Reload the server version or choose Keep draft before saving", {
        code: "REVISION_CONFLICT",
        status: 409,
        retryable: true,
      });
    }
    const recording = current.recording;
    const scenarioRevision = list.scenarioRevision;
    const expectedContentRevision = current.observedContentRevision ?? recording.revision;
    const filename = list.items.find((item) => item.id === recording.id)?.filename ?? recording.filename;

    this.document.set({ ...current, saving: true, error: null });
    try {
      await this.#runOperation(
        "Saving recording",
        (token) =>
          this.http.command<CommandOf<"recording.update">>(
            {
              protocolVersion: V2_SCHEMA_VERSION,
              commandId: this.#nextCommandId(),
              type: "recording.update",
              scenarioId: recording.scenarioId,
              recordingId: recording.id,
              expectedScenarioRevision: scenarioRevision,
              expectedContentRevision,
              filename,
              recording: parsed.value,
            },
            { signal: token.signal },
          ),
        {
          resync: true,
          commit: async (result) => {
            const latest = this.document.getSnapshot();
            const newerServerStateKnown =
              latest.conflict?.kind === "deleted" ||
              (latest.conflict?.kind === "updated" && latest.conflict.remoteRevision > result.recording.revision) ||
              (latest.observedContentRevision ?? 0) > result.recording.revision ||
              (latest.recording?.revision ?? 0) > result.recording.revision;
            const sameDocument =
              latest.recordingId === recording.id && latest.recording?.id === recording.id && latest.phase === "ready";

            if (sameDocument && !newerServerStateKnown) {
              this.documentBuffer.markSaved(parsed.mutationVersion);
              this.document.set({
                ...createRecordingDocumentState(),
                recordingId: result.recording.id,
                phase: "ready",
                recording: result.recording,
                observedContentRevision: result.recording.revision,
                conflict:
                  this.#snapshot().currentScenarioId === result.recording.scenarioId
                    ? null
                    : { kind: "scenario-changed", scenarioId: result.recording.scenarioId },
              });
            } else if (sameDocument) {
              this.document.set({ ...latest, saving: false });
            }
            await this.#applyRecordingMutation(result.recording, result.scenarioRevision);
          },
        },
      );
    } catch (error) {
      if (error instanceof OperationInvalidatedError) throw error;
      const latest = this.document.getSnapshot();
      this.document.set({
        ...latest,
        saving: false,
        error: this.auth.publicError(error),
        conflict: isRevisionConflict(error)
          ? { kind: "updated", remoteRevision: latest.recording?.revision ?? recording.revision }
          : latest.conflict,
      });
      throw error;
    }
  }

  async deleteRecording(recordingId: RecordingId): Promise<void> {
    const list = this.recordings.getSnapshot();
    const summary = list.items.find((item) => item.id === recordingId);
    if (!summary || list.scenarioRevision === null) {
      throw new ApiError("The recording is not available", { code: "INVALID_REQUEST" });
    }
    const scenarioRevision = list.scenarioRevision;
    await this.#runOperation(
      "Deleting recording",
      (token) =>
        this.http.command<CommandOf<"recording.delete">>(
          {
            protocolVersion: V2_SCHEMA_VERSION,
            commandId: this.#nextCommandId(),
            type: "recording.delete",
            scenarioId: summary.scenarioId,
            recordingId: summary.id,
            expectedScenarioRevision: scenarioRevision,
            expectedContentRevision: summary.contentRevision,
          },
          { signal: token.signal },
        ),
      {
        resync: true,
        commit: (result) => {
          this.#applyRecordingDelete(recordingId, true, result.scenarioId, result.scenarioRevision);
        },
      },
    );
  }

  async uploadRecording(file: File): Promise<void> {
    const list = this.recordings.getSnapshot();
    if (!list.scenarioId || list.scenarioRevision === null) {
      throw new ApiError("Select a scenario before importing a recording", { code: "INVALID_REQUEST" });
    }
    const scenarioId = list.scenarioId;
    const scenarioRevision = list.scenarioRevision;
    await this.#runOperation(
      "Importing recording",
      async (token) => {
        if (file.size > MAX_CONTROL_JSON_BYTES) {
          throw new ApiError(`Recording JSON exceeds the ${MAX_CONTROL_JSON_BYTES} byte limit`, {
            code: "PAYLOAD_LIMIT_EXCEEDED",
            status: 413,
            retryable: false,
            details: { limit: MAX_CONTROL_JSON_BYTES, size: file.size },
          });
        }
        const contents = await file.text();
        token.assertCurrent();
        this.#assertScenarioRevisionCurrent(
          scenarioId,
          scenarioRevision,
          "The selected scenario changed while the recording JSON was being read",
        );
        const input = JSON.parse(contents) as unknown;
        token.assertCurrent();
        const full = RecordingSchema.safeParse(input);
        const draft = full.success ? recordingDraft(full.data) : RecordingDraftSchema.parse(input);
        const filename = full.success ? full.data.filename : file.name.replace(/\.json$/iu, "");
        return this.http.command<CommandOf<"recording.create">>(
          {
            protocolVersion: V2_SCHEMA_VERSION,
            commandId: this.#nextCommandId(),
            type: "recording.create",
            scenarioId,
            expectedScenarioRevision: scenarioRevision,
            filename,
            recording: draft,
          },
          { signal: token.signal },
        );
      },
      {
        resync: true,
        commit: (result) => this.#applyRecordingMutation(result.recording, result.scenarioRevision),
      },
    );
  }

  async importRecordingArchive(file: File): Promise<void> {
    const list = this.recordings.getSnapshot();
    if (!list.scenarioId || list.scenarioRevision === null) {
      throw new ApiError("Select a scenario before importing a recording", { code: "INVALID_REQUEST" });
    }
    const scenarioId = list.scenarioId;
    const scenarioRevision = list.scenarioRevision;
    await this.#runOperation(
      "Importing recording ZIP",
      async (token) => {
        const staged = await this.http.stageRecordingImport(
          file,
          {
            filename: file.name,
            mediaType: "application/zip",
          },
          { signal: token.signal },
        );
        token.assertCurrent();
        this.#assertScenarioRevisionCurrent(
          scenarioId,
          scenarioRevision,
          "The selected scenario changed while the recording ZIP was being staged",
        );
        return this.http.command<CommandOf<"recording.import">>(
          {
            protocolVersion: V2_SCHEMA_VERSION,
            commandId: this.#nextCommandId(),
            type: "recording.import",
            scenarioId,
            expectedScenarioRevision: scenarioRevision,
            transferId: staged.transferId,
          },
          { signal: token.signal },
        );
      },
      {
        resync: true,
        commit: (result) => this.#applyRecordingMutation(result.recording, result.scenarioRevision),
      },
    );
  }

  async #applyRecordingMutation(
    recording: Parameters<typeof reconcileRecordingMutation>[1],
    scenarioRevision: Parameters<typeof reconcileRecordingMutation>[2],
  ): Promise<void> {
    this.#resetStalePageRecovery();
    const current = this.recordings.getSnapshot();
    const reconciliation = reconcileRecordingMutation(current, recording, scenarioRevision);
    if (reconciliation.state === current) return;
    this.recordings.set(reconciliation.state);
    if (reconciliation.authoritativeSearchQuery !== null) {
      await this.refreshRecordings(reconciliation.authoritativeSearchQuery).catch(() => undefined);
    }
  }

  async downloadRecording(recordingId: RecordingId): Promise<void> {
    const list = this.recordings.getSnapshot();
    const summary = list.items.find((item) => item.id === recordingId);
    if (!summary) throw new ApiError("The recording is not available", { code: "INVALID_REQUEST" });
    await this.#runOperation(
      "Preparing recording download",
      (token) =>
        this.http.query(
          {
            protocolVersion: V2_SCHEMA_VERSION,
            type: "recording.export",
            scenarioId: summary.scenarioId,
            recordingId,
          },
          { signal: token.signal },
        ),
      {
        commit: (result) => this.#downloads.ticket(result.download),
      },
    );
  }

  async uploadDocumentBody(target: "request" | "response", file: File): Promise<void> {
    const document = this.document.getSnapshot();
    const parsed = this.documentBuffer.parse(RecordingDraftSchema);
    if (!parsed) throw new ApiError("Fix the recording JSON before replacing a body", { code: "INVALID_REQUEST" });
    if (!document.recordingId || !document.recording || document.phase !== "ready") {
      throw new ApiError("The recording is not ready for a body upload", { code: "INVALID_REQUEST" });
    }
    const recordingId = document.recordingId;
    const recordingRevision = document.recording.revision;
    const startingMutationVersion = parsed.mutationVersion;
    await this.#runOperation(
      `Uploading ${target} body`,
      (token) =>
        this.http.uploadBody(
          file,
          {
            mediaType: file.type || "application/octet-stream",
            contentEncoding: null,
          },
          { signal: token.signal },
        ),
      {
        commit: (body) => {
          const latestDocument = this.document.getSnapshot();
          if (
            latestDocument.recordingId !== recordingId ||
            latestDocument.recording?.id !== recordingId ||
            latestDocument.recording.revision !== recordingRevision ||
            latestDocument.phase !== "ready"
          ) {
            throw new ApiError("The active recording changed while the body was uploading", {
              code: "REVISION_CONFLICT",
              status: 409,
              retryable: true,
            });
          }
          const latest = this.documentBuffer.parse(RecordingDraftSchema);
          if (!latest) {
            throw new ApiError("The recording JSON changed and must be fixed before applying the uploaded body", {
              code: "INVALID_REQUEST",
            });
          }
          // Rebase only the uploaded body and its representation headers onto
          // edits made after the upload started. Never restore the stale draft.
          const draftBase = latest.mutationVersion === startingMutationVersion ? parsed.value : latest.value;
          const draft = {
            ...draftBase,
            [target]: {
              ...draftBase[target],
              headers: synchronizeBodyHeaders(draftBase[target].headers, body),
              body,
            },
          };
          this.documentBuffer.replaceDraft(JSON.stringify(draft, null, 2));
        },
      },
    );
  }

  async downloadDocumentBody(target: "request" | "response"): Promise<void> {
    const parsed = this.documentBuffer.parse(RecordingDraftSchema);
    const body: BodyRef | null = parsed?.value[target].body ?? null;
    if (!body) throw new ApiError(`The ${target} has no body`, { code: "INVALID_REQUEST" });
    const filename = bodyDownloadFilename(this.document.getSnapshot().recording?.filename ?? "recording", target);
    await this.#runOperation(
      `Preparing ${target} body download`,
      (token) =>
        this.http.query(
          {
            protocolVersion: V2_SCHEMA_VERSION,
            type: "body.download",
            body,
            filename,
          },
          { signal: token.signal },
        ),
      {
        commit: (result) => this.#downloads.ticket(result.download),
      },
    );
  }

  async importFolder(file: File): Promise<void> {
    await this.#runOperation(
      "Importing folder",
      async (token) => {
        const staged = await this.http.stageFolderImport(
          file,
          {
            filename: file.name,
            mediaType: "application/zip",
          },
          { signal: token.signal },
        );
        token.assertCurrent();
        return this.http.command(
          {
            protocolVersion: V2_SCHEMA_VERSION,
            commandId: this.#nextCommandId(),
            expectedRevision: this.#snapshot().revision,
            type: "folder.import",
            transferId: staged.transferId,
            name: staged.suggestedName,
          },
          { signal: token.signal },
        );
      },
      { resync: true },
    );
  }

  async exportFolder(folderId: FolderId): Promise<void> {
    await this.#runOperation(
      "Exporting folder",
      (token) =>
        this.http.query(
          {
            protocolVersion: V2_SCHEMA_VERSION,
            type: "folder.export",
            folderId,
          },
          { signal: token.signal },
        ),
      { commit: (result) => this.#downloads.ticket(result.download) },
    );
  }

  #applyRecordingUpsert(recording: RecordingSummary, scenarioRevision: Revision): void {
    const current = this.recordings.getSnapshot();
    if (current.scenarioId === recording.scenarioId) {
      const nextScenarioRevision =
        current.scenarioRevision === null || scenarioRevision > current.scenarioRevision
          ? scenarioRevision
          : current.scenarioRevision;
      if (current.query.trim()) {
        this.recordings.set({ ...current, scenarioRevision: nextScenarioRevision });
        this.#scheduleRecordingsRefresh(this.#searchEventDebounceMs, true);
      } else {
        this.recordings.set({
          ...current,
          scenarioRevision: nextScenarioRevision,
          items: upsertRecordingSummary(current.items, recording),
        });
      }
    }
    const active = this.document.getSnapshot();
    if (
      active.recordingId !== recording.id ||
      !active.recording ||
      recording.contentRevision <= (active.observedContentRevision ?? active.recording.revision)
    ) {
      return;
    }
    if (this.documentBuffer.getSnapshot().dirty || active.saving) {
      this.document.set({
        ...active,
        observedContentRevision:
          active.observedContentRevision === null || recording.contentRevision > active.observedContentRevision
            ? recording.contentRevision
            : active.observedContentRevision,
        conflict: { kind: "updated", remoteRevision: recording.contentRevision },
      });
    } else {
      this.document.set({ ...active, phase: "stale" });
      this.#beginRecordingLoad(recording.id);
    }
  }

  #scheduleRecordingsRefresh(
    delayMs = this.#searchEventDebounceMs,
    automaticStaleRetry = false,
    allowAtRetryLimit = false,
  ): void {
    if (
      automaticStaleRetry &&
      !allowAtRetryLimit &&
      this.#stalePageBackgroundRetries >= MAX_STALE_PAGE_BACKGROUND_RETRIES
    ) {
      return;
    }
    this.#cancelScheduledRecordingsRefresh();
    this.#recordingsRefreshTimer = globalThis.setTimeout(() => {
      this.#recordingsRefreshTimer = null;
      const query = this.view.getSnapshot().searchQuery;
      const current = this.recordings.getSnapshot();
      if (!this.#started || !current.scenarioId) return;
      const refresh = automaticStaleRetry ? this.#refreshRecordings(query, true) : this.refreshRecordings(query);
      void refresh.catch(() => undefined);
    }, delayMs);
  }

  #resetStalePageRecovery(): void {
    this.#stalePageBackgroundRetries = 0;
    this.#cancelScheduledRecordingsRefresh();
  }

  #cancelScheduledRecordingsRefresh(): void {
    if (this.#recordingsRefreshTimer === null) return;
    globalThis.clearTimeout(this.#recordingsRefreshTimer);
    this.#recordingsRefreshTimer = null;
  }

  #applyRecordingDelete(
    recordingId: RecordingId,
    local = false,
    scenarioId?: ScenarioId,
    scenarioRevision?: Revision,
  ): void {
    this.recordings.update((state) => {
      const nextScenarioRevision =
        scenarioId === state.scenarioId &&
        scenarioRevision !== undefined &&
        (state.scenarioRevision === null || scenarioRevision > state.scenarioRevision)
          ? scenarioRevision
          : state.scenarioRevision;
      return {
        ...state,
        scenarioRevision: nextScenarioRevision,
        items: state.items.filter((item) => item.id !== recordingId),
      };
    });
    if (this.view.getSnapshot().selectedRecordingId === recordingId) {
      this.view.update((state) => reduceViewState(state, { type: "recording.selected", recordingId: null }));
    }
    const active = this.document.getSnapshot();
    if (active.recordingId !== recordingId) return;
    if (!local && (this.documentBuffer.getSnapshot().dirty || active.saving)) {
      this.document.set({ ...active, conflict: { kind: "deleted" } });
      return;
    }
    this.#documentRequestCancelAndReset();
  }

  #documentRequestCancelAndReset(): void {
    this.#documentRequest.cancel();
    this.document.set(createRecordingDocumentState());
    this.documentBuffer.clear();
  }
}
