import type { AsyncError } from "../async-command";
import type { Cursor, Recording, RecordingId, RecordingSummary, RequestLog, Revision, ScenarioId } from "../contracts";
import type { RealtimeSyncState } from "../realtime";

export type ConnectionState = "connecting" | "connected" | "reconnecting" | "resyncing" | "stopped";

export interface ServerUiState {
  realtime: RealtimeSyncState;
  connection: ConnectionState;
  error: AsyncError | null;
}

export type RecordingListStatus = "idle" | "loading" | "loading-more" | "ready" | "error";

export interface RecordingListState {
  scenarioId: ScenarioId | null;
  scenarioRevision: Revision | null;
  query: string;
  items: RecordingSummary[];
  nextCursor: Cursor | null;
  status: RecordingListStatus;
  error: AsyncError | null;
}

export type RecordingDocumentPhase = "empty" | "loading" | "ready" | "load-error" | "stale";
export type RecordingDocumentConflict =
  | { kind: "updated"; remoteRevision: Revision }
  | { kind: "deleted" }
  | { kind: "scenario-changed"; scenarioId: ScenarioId };

export interface RecordingDocumentState {
  recordingId: RecordingId | null;
  phase: RecordingDocumentPhase;
  recording: Recording | null;
  /** Highest server content revision observed even after a conflict banner is dismissed. */
  observedContentRevision: Revision | null;
  pendingRecordingId: RecordingId | null;
  pendingScenarioId: ScenarioId | null;
  loadingRequestId: number | null;
  saving: boolean;
  error: AsyncError | null;
  conflict: RecordingDocumentConflict | null;
}

export interface OperationState {
  pending: boolean;
  label: string | null;
  error: AsyncError | null;
}

export interface RequestLogState {
  entries: RequestActivity[];
}

export type RequestActivity = { kind: "completed" } & RequestLog;

export function createRecordingListState(): RecordingListState {
  return {
    scenarioId: null,
    scenarioRevision: null,
    query: "",
    items: [],
    nextCursor: null,
    status: "idle",
    error: null,
  };
}

export function createRecordingDocumentState(): RecordingDocumentState {
  return {
    recordingId: null,
    phase: "empty",
    recording: null,
    observedContentRevision: null,
    pendingRecordingId: null,
    pendingScenarioId: null,
    loadingRequestId: null,
    saving: false,
    error: null,
    conflict: null,
  };
}

export function recordingSummary(recording: Recording): RecordingSummary {
  return {
    id: recording.id,
    scenarioId: recording.scenarioId,
    filename: recording.filename,
    endpoint: recording.route,
    method: recording.method,
    sizeBytes: (recording.request.body?.size ?? 0) + (recording.response.body?.size ?? 0),
    updatedAt: recording.updatedAt,
    contentRevision: recording.revision,
  };
}
