import {
  type FolderId,
  type Mode,
  PROTOCOL_VERSION,
  type ScenarioId,
  type ServerSnapshot,
  ServerSnapshotSchema,
  type StateEvent,
} from "./contracts";

export class ServerSnapshotInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ServerSnapshotInvariantError";
  }
}

export function createEmptyServerSnapshot(options?: {
  runtimeId?: string;
  revision?: number;
  version?: string;
  mode?: Mode;
}): ServerSnapshot {
  return ServerSnapshotSchema.parse({
    protocolVersion: PROTOCOL_VERSION,
    runtimeId: options?.runtimeId ?? "run_0000000000000000",
    revision: options?.revision ?? 0,
    version: options?.version ?? "2.0.0",
    mode: options?.mode ?? "smart",
    currentScenarioId: null,
    folders: {},
    scenarios: {},
  });
}

function omitKeys<T>(record: Record<string, T>, keys: ReadonlySet<string>): Record<string, T> {
  let changed = false;
  const next: Record<string, T> = {};
  for (const [key, value] of Object.entries(record)) {
    if (keys.has(key)) {
      changed = true;
    } else {
      next[key] = value;
    }
  }
  return changed ? next : record;
}

function omitKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record;
  const { [key]: _removed, ...rest } = record;
  return rest;
}

export function assertServerSnapshotInvariants(snapshot: ServerSnapshot): void {
  if (snapshot.protocolVersion !== PROTOCOL_VERSION) {
    throw new ServerSnapshotInvariantError(`Unsupported protocol version: ${snapshot.protocolVersion}`);
  }
  if (!Number.isInteger(snapshot.revision) || snapshot.revision < 0) {
    throw new ServerSnapshotInvariantError(`Invalid revision: ${snapshot.revision}`);
  }

  for (const [id, folder] of Object.entries(snapshot.folders)) {
    if (id !== folder.id) throw new ServerSnapshotInvariantError(`Folder key does not match id: ${id}`);
  }

  for (const [id, scenario] of Object.entries(snapshot.scenarios)) {
    if (id !== scenario.id) throw new ServerSnapshotInvariantError(`Scenario key does not match id: ${id}`);
    if (!snapshot.folders[scenario.folderId]) {
      throw new ServerSnapshotInvariantError(`Scenario ${id} references missing folder ${scenario.folderId}`);
    }
  }

  if (snapshot.currentScenarioId && !snapshot.scenarios[snapshot.currentScenarioId]) {
    throw new ServerSnapshotInvariantError(`Current scenario does not exist: ${snapshot.currentScenarioId}`);
  }
}

function withRevision(snapshot: ServerSnapshot, event: StateEvent): ServerSnapshot {
  return { ...snapshot, revision: event.revision };
}

function cascadeFolderDeletion(snapshot: ServerSnapshot, folderId: FolderId): ServerSnapshot {
  const scenarioIds = new Set(
    Object.values(snapshot.scenarios)
      .filter((scenario) => scenario.folderId === folderId)
      .map((scenario) => scenario.id),
  );
  return {
    ...snapshot,
    currentScenarioId:
      snapshot.currentScenarioId && scenarioIds.has(snapshot.currentScenarioId) ? null : snapshot.currentScenarioId,
    folders: omitKey(snapshot.folders, folderId),
    scenarios: omitKeys(snapshot.scenarios, scenarioIds),
  };
}

function cascadeScenarioDeletion(snapshot: ServerSnapshot, scenarioId: ScenarioId): ServerSnapshot {
  return {
    ...snapshot,
    currentScenarioId: snapshot.currentScenarioId === scenarioId ? null : snapshot.currentScenarioId,
    scenarios: omitKey(snapshot.scenarios, scenarioId),
  };
}

export function reduceServerSnapshot(snapshot: ServerSnapshot, event: StateEvent): ServerSnapshot {
  assertServerSnapshotInvariants(snapshot);

  if (event.protocolVersion !== snapshot.protocolVersion) {
    throw new ServerSnapshotInvariantError(`Protocol version mismatch: ${event.protocolVersion}`);
  }
  if (event.runtimeId !== snapshot.runtimeId) {
    throw new ServerSnapshotInvariantError(`Runtime id mismatch: ${event.runtimeId}`);
  }
  if (event.revision !== snapshot.revision + 1) {
    throw new ServerSnapshotInvariantError(`Expected revision ${snapshot.revision + 1}, received ${event.revision}`);
  }

  let next: ServerSnapshot;
  switch (event.type) {
    case "mode.changed":
      next = { ...snapshot, mode: event.payload.mode };
      break;
    case "scenario.current-changed":
      if (event.payload.scenarioId && !snapshot.scenarios[event.payload.scenarioId]) {
        throw new ServerSnapshotInvariantError(`Cannot select missing scenario ${event.payload.scenarioId}`);
      }
      next = { ...snapshot, currentScenarioId: event.payload.scenarioId };
      break;
    case "folder.upserted":
      next = {
        ...snapshot,
        folders: { ...snapshot.folders, [event.payload.folder.id]: event.payload.folder },
      };
      break;
    case "folder.deleted":
      next = cascadeFolderDeletion(snapshot, event.payload.folderId);
      break;
    case "scenario.upserted":
      if (!snapshot.folders[event.payload.scenario.folderId]) {
        throw new ServerSnapshotInvariantError(
          `Cannot upsert scenario ${event.payload.scenario.id}; folder ${event.payload.scenario.folderId} does not exist`,
        );
      }
      next = {
        ...snapshot,
        scenarios: {
          ...snapshot.scenarios,
          [event.payload.scenario.id]: event.payload.scenario,
        },
      };
      break;
    case "scenario.deleted":
      next = cascadeScenarioDeletion(snapshot, event.payload.scenarioId);
      break;
    case "recording.upserted":
      if (!snapshot.scenarios[event.payload.recording.scenarioId]) {
        throw new ServerSnapshotInvariantError(
          `Cannot apply recording change ${event.payload.recording.id}; scenario ${event.payload.recording.scenarioId} does not exist`,
        );
      }
      next = snapshot;
      break;
    case "recording.deleted":
      if (!snapshot.scenarios[event.payload.scenarioId]) {
        throw new ServerSnapshotInvariantError(
          `Cannot apply recording deletion ${event.payload.recordingId}; scenario ${event.payload.scenarioId} does not exist`,
        );
      }
      next = snapshot;
      break;
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }

  const revised = withRevision(next, event);
  assertServerSnapshotInvariants(revised);
  return revised;
}
