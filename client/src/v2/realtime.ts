import {
  type EventId,
  type EventSequence,
  type RealtimeEvent,
  RealtimeEventSchema,
  type RuntimeId,
  type ServerSnapshot,
  ServerSnapshotSchema,
  type StateEvent,
} from "./contracts";
import { reduceServerSnapshot, ServerSnapshotInvariantError } from "./server-snapshot";

export type RealtimeStatus = "booting" | "ready" | "reconnecting" | "resyncing" | "protocol-error";

export type RealtimeIssueCode =
  | "missing-snapshot"
  | "runtime-changed"
  | "runtime-shutting-down"
  | "sequence-gap"
  | "revision-gap"
  | "aggregate-invalidated"
  | "invalid-transition"
  | "stale-snapshot"
  | "invalid-message";

export interface RealtimeIssue {
  code: RealtimeIssueCode;
  message: string;
  expectedSequence?: number;
  receivedSequence?: number;
  expectedRevision?: number;
  receivedRevision?: number;
}

export interface RealtimeSyncState {
  status: RealtimeStatus;
  snapshot: ServerSnapshot | null;
  lastEventId: EventId | null;
  lastSequence: EventSequence | null;
  requiredRuntimeId: RuntimeId | null;
  minimumSnapshotRevision: number | null;
  minimumSequence: number | null;
  issue: RealtimeIssue | null;
}

export type RealtimeApplyOutcome = "applied" | "telemetry" | "duplicate-ignored" | "resync-required" | "protocol-error";

export interface RealtimeApplyResult {
  state: RealtimeSyncState;
  outcome: RealtimeApplyOutcome;
  deliveredEvent: RealtimeEvent | null;
}

export function createRealtimeSyncState(): RealtimeSyncState {
  return {
    status: "booting",
    snapshot: null,
    lastEventId: null,
    lastSequence: null,
    requiredRuntimeId: null,
    minimumSnapshotRevision: null,
    minimumSequence: null,
    issue: null,
  };
}

function requireResync(
  state: RealtimeSyncState,
  issue: RealtimeIssue,
  options: {
    minimumSnapshotRevision: number;
    minimumSequence: number | null;
    requiredRuntimeId: RuntimeId | null;
  },
): RealtimeApplyResult {
  const sameRequiredRuntime = state.requiredRuntimeId === null || state.requiredRuntimeId === options.requiredRuntimeId;
  return {
    outcome: "resync-required",
    deliveredEvent: null,
    state: {
      ...state,
      status: "resyncing",
      requiredRuntimeId: options.requiredRuntimeId,
      minimumSnapshotRevision: sameRequiredRuntime
        ? Math.max(state.minimumSnapshotRevision ?? 0, options.minimumSnapshotRevision)
        : options.minimumSnapshotRevision,
      minimumSequence:
        sameRequiredRuntime && state.minimumSequence !== null && options.minimumSequence !== null
          ? Math.max(state.minimumSequence, options.minimumSequence)
          : options.minimumSequence,
      issue,
    },
  };
}

export function installRealtimeSnapshot(
  state: RealtimeSyncState,
  input: unknown,
  streamAnchor?: { sequence: EventSequence; eventId: EventId },
): RealtimeApplyResult {
  const parsed = ServerSnapshotSchema.safeParse(input);
  if (!parsed.success) {
    return {
      outcome: "protocol-error",
      deliveredEvent: null,
      state: {
        ...state,
        status: "protocol-error",
        issue: { code: "invalid-message", message: parsed.error.message },
      },
    };
  }

  const snapshot = parsed.data;
  if (state.requiredRuntimeId && snapshot.runtimeId !== state.requiredRuntimeId) {
    return requireResync(
      state,
      {
        code: "runtime-changed",
        message: `Expected runtime ${state.requiredRuntimeId}, received ${snapshot.runtimeId}`,
        receivedRevision: snapshot.revision,
      },
      {
        minimumSnapshotRevision: state.minimumSnapshotRevision ?? 0,
        minimumSequence: state.minimumSequence,
        requiredRuntimeId: state.requiredRuntimeId,
      },
    );
  }

  const runtimeChanged = state.snapshot !== null && state.snapshot.runtimeId !== snapshot.runtimeId;
  const minimumRevision = Math.max(
    runtimeChanged ? 0 : (state.snapshot?.revision ?? 0),
    state.minimumSnapshotRevision ?? 0,
  );
  const sequenceIsStale =
    streamAnchor !== undefined && state.minimumSequence !== null && streamAnchor.sequence < state.minimumSequence;
  if (snapshot.revision < minimumRevision || sequenceIsStale) {
    return requireResync(
      state,
      {
        code: "stale-snapshot",
        message: `Snapshot is older than the required revision or event sequence`,
        expectedRevision: minimumRevision,
        receivedRevision: snapshot.revision,
        expectedSequence: state.minimumSequence ?? undefined,
        receivedSequence: streamAnchor?.sequence,
      },
      {
        minimumSnapshotRevision: minimumRevision,
        minimumSequence: state.minimumSequence,
        requiredRuntimeId: state.requiredRuntimeId ?? state.snapshot?.runtimeId ?? null,
      },
    );
  }

  if (state.minimumSequence !== null && !streamAnchor) {
    return requireResync(
      { ...state, snapshot },
      {
        code: "sequence-gap",
        message: "The snapshot is current, but a stream anchor is still required",
        expectedSequence: state.minimumSequence,
      },
      {
        minimumSnapshotRevision: snapshot.revision,
        minimumSequence: state.minimumSequence,
        requiredRuntimeId: snapshot.runtimeId,
      },
    );
  }

  return {
    outcome: "applied",
    deliveredEvent: null,
    state: {
      status: "ready",
      snapshot,
      lastEventId: streamAnchor?.eventId ?? null,
      lastSequence: streamAnchor?.sequence ?? null,
      requiredRuntimeId: null,
      minimumSnapshotRevision: null,
      minimumSequence: null,
      issue: null,
    },
  };
}

function isStateEvent(event: RealtimeEvent): event is StateEvent {
  switch (event.type) {
    case "mode.changed":
    case "scenario.current-changed":
    case "folder.upserted":
    case "folder.deleted":
    case "scenario.upserted":
    case "scenario.deleted":
    case "recording.upserted":
    case "recording.deleted":
      return true;
    default:
      return false;
  }
}

function withConsumedEvent(
  state: RealtimeSyncState,
  event: RealtimeEvent,
  outcome: "applied" | "telemetry",
  snapshot = state.snapshot,
): RealtimeApplyResult {
  return {
    outcome,
    deliveredEvent: event,
    state: {
      ...state,
      status: "ready",
      snapshot,
      lastEventId: event.id,
      lastSequence: event.sequence,
      requiredRuntimeId: null,
      minimumSnapshotRevision: null,
      minimumSequence: null,
      issue: null,
    },
  };
}

function withConsumedDuplicate(state: RealtimeSyncState, event: RealtimeEvent): RealtimeApplyResult {
  return {
    outcome: "duplicate-ignored",
    deliveredEvent: null,
    state: {
      ...state,
      status: "ready",
      lastEventId: event.id,
      lastSequence: event.sequence,
      requiredRuntimeId: null,
      minimumSnapshotRevision: null,
      minimumSequence: null,
      issue: null,
    },
  };
}

export function applyTypedRealtimeEvent(state: RealtimeSyncState, event: RealtimeEvent): RealtimeApplyResult {
  if (event.type === "runtime.connected") {
    return installRealtimeSnapshot(state, event.payload, { sequence: event.sequence, eventId: event.id });
  }

  if (!state.snapshot) {
    return requireResync(
      state,
      {
        code: "missing-snapshot",
        message: "A runtime.connected snapshot is required before realtime events can be applied",
        receivedRevision: event.revision,
        receivedSequence: event.sequence,
      },
      {
        minimumSnapshotRevision: event.revision,
        minimumSequence: event.sequence,
        requiredRuntimeId: event.runtimeId,
      },
    );
  }

  if (state.status === "protocol-error") {
    return { state, outcome: "protocol-error", deliveredEvent: null };
  }
  if (event.runtimeId !== state.snapshot.runtimeId) {
    return requireResync(
      state,
      {
        code: "runtime-changed",
        message: `Runtime changed from ${state.snapshot.runtimeId} to ${event.runtimeId}`,
        receivedRevision: event.revision,
        receivedSequence: event.sequence,
      },
      {
        minimumSnapshotRevision: event.revision,
        minimumSequence: event.sequence,
        requiredRuntimeId: event.runtimeId,
      },
    );
  }

  if (state.lastSequence !== null && event.sequence <= state.lastSequence) {
    return { state, outcome: "duplicate-ignored", deliveredEvent: null };
  }
  if (state.lastSequence !== null && event.sequence !== state.lastSequence + 1) {
    return requireResync(
      state,
      {
        code: "sequence-gap",
        message: `Expected event sequence ${state.lastSequence + 1}, received ${event.sequence}`,
        expectedSequence: state.lastSequence + 1,
        receivedSequence: event.sequence,
        receivedRevision: event.revision,
      },
      {
        minimumSnapshotRevision: event.revision,
        minimumSequence: event.sequence,
        requiredRuntimeId: event.runtimeId,
      },
    );
  }

  if (event.type === "runtime.shutting-down") {
    return {
      outcome: "resync-required",
      deliveredEvent: event,
      state: {
        ...state,
        status: "reconnecting",
        lastEventId: event.id,
        lastSequence: event.sequence,
        requiredRuntimeId: null,
        minimumSnapshotRevision: null,
        minimumSequence: null,
        issue: {
          code: "runtime-shutting-down",
          message: event.payload.reason,
          receivedSequence: event.sequence,
        },
      },
    };
  }

  if (state.status === "resyncing" || state.status === "reconnecting") {
    return requireResync(
      state,
      state.issue ?? {
        code: "revision-gap",
        message: "A fresh snapshot is required before more events can be applied",
      },
      {
        minimumSnapshotRevision: Math.max(state.minimumSnapshotRevision ?? 0, event.revision),
        minimumSequence: Math.max(state.minimumSequence ?? 0, event.sequence),
        requiredRuntimeId: state.requiredRuntimeId ?? event.runtimeId,
      },
    );
  }

  if (!isStateEvent(event)) {
    if (event.revision > state.snapshot.revision) {
      return requireResync(
        state,
        {
          code: "revision-gap",
          message: `Telemetry revision ${event.revision} is newer than snapshot revision ${state.snapshot.revision}`,
          expectedRevision: state.snapshot.revision,
          receivedRevision: event.revision,
        },
        {
          minimumSnapshotRevision: event.revision,
          minimumSequence: event.sequence,
          requiredRuntimeId: event.runtimeId,
        },
      );
    }
    return withConsumedEvent(state, event, "telemetry");
  }

  if (event.revision <= state.snapshot.revision) {
    return withConsumedDuplicate(state, event);
  }

  const expectedRevision = state.snapshot.revision + 1;
  if (event.revision !== expectedRevision) {
    return requireResync(
      state,
      {
        code: "revision-gap",
        message: `Expected revision ${expectedRevision}, received ${event.revision}`,
        expectedRevision,
        receivedRevision: event.revision,
      },
      {
        minimumSnapshotRevision: event.revision,
        minimumSequence: event.sequence,
        requiredRuntimeId: event.runtimeId,
      },
    );
  }

  if (event.type === "folder.upserted" && event.payload.recordingsInvalidated === true) {
    return requireResync(
      state,
      {
        code: "aggregate-invalidated",
        message: "A folder import changed bounded catalog metadata; a fresh snapshot is required",
        expectedRevision,
        receivedRevision: event.revision,
      },
      {
        minimumSnapshotRevision: event.revision,
        minimumSequence: event.sequence,
        requiredRuntimeId: event.runtimeId,
      },
    );
  }

  try {
    const snapshot = reduceServerSnapshot(state.snapshot, event);
    return withConsumedEvent(state, event, "applied", snapshot);
  } catch (error) {
    const message =
      error instanceof ServerSnapshotInvariantError || error instanceof Error
        ? error.message
        : "Invalid realtime transition";
    return requireResync(
      state,
      {
        code: "invalid-transition",
        message,
        expectedRevision,
        receivedRevision: event.revision,
      },
      {
        minimumSnapshotRevision: event.revision,
        minimumSequence: event.sequence,
        requiredRuntimeId: event.runtimeId,
      },
    );
  }
}

export function applyRealtimeMessage(state: RealtimeSyncState, input: unknown): RealtimeApplyResult {
  const parsed = RealtimeEventSchema.safeParse(input);
  if (!parsed.success) {
    return {
      outcome: "protocol-error",
      deliveredEvent: null,
      state: {
        ...state,
        status: "protocol-error",
        issue: { code: "invalid-message", message: parsed.error.message },
      },
    };
  }
  return applyTypedRealtimeEvent(state, parsed.data);
}
