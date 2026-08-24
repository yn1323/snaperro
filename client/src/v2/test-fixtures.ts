import {
  EventIdSchema,
  EventSequenceSchema,
  FolderIdSchema,
  parseRealtimeEvent,
  parseServerSnapshot,
  RecordingIdSchema,
  type RecordingSummary,
  RevisionSchema,
  RuntimeIdSchema,
  ScenarioIdSchema,
  type ServerSnapshot,
  type StateEvent,
} from "./contracts";

export const ids = {
  runtime: RuntimeIdSchema.parse("run_aaaaaaaaaaaaaaaa"),
  otherRuntime: RuntimeIdSchema.parse("run_bbbbbbbbbbbbbbbb"),
  folder: FolderIdSchema.parse("fld_aaaaaaaaaaaaaaaa"),
  otherFolder: FolderIdSchema.parse("fld_bbbbbbbbbbbbbbbb"),
  scenario: ScenarioIdSchema.parse("scn_aaaaaaaaaaaaaaaa"),
  otherScenario: ScenarioIdSchema.parse("scn_bbbbbbbbbbbbbbbb"),
  recording: RecordingIdSchema.parse("rec_aaaaaaaaaaaaaaaa"),
  otherRecording: RecordingIdSchema.parse("rec_bbbbbbbbbbbbbbbb"),
};

export function recordingSummaryAt(overrides: Partial<RecordingSummary> = {}): RecordingSummary {
  return {
    id: ids.recording,
    scenarioId: ids.scenario,
    filename: "users_001.json",
    endpoint: "/users",
    method: "GET",
    sizeBytes: 1024,
    updatedAt: "2026-08-24T00:00:00.000Z",
    contentRevision: RevisionSchema.parse(3),
    ...overrides,
  };
}

export function streamAnchorAt(sequence: number) {
  return {
    sequence: EventSequenceSchema.parse(sequence),
    eventId: EventIdSchema.parse(`evt_${String(sequence).padStart(16, "0")}`),
  };
}

export function snapshotAt(revision = 0, runtimeId = ids.runtime): ServerSnapshot {
  return parseServerSnapshot({
    protocolVersion: 2,
    runtimeId,
    revision,
    version: "2.0.0",
    mode: "smart",
    currentScenarioId: ids.scenario,
    folders: {
      [ids.folder]: { id: ids.folder, name: "Folder" },
    },
    scenarios: {
      [ids.scenario]: { id: ids.scenario, folderId: ids.folder, name: "Scenario" },
    },
  });
}

type StateEventBody<Type extends StateEvent["type"]> = Pick<Extract<StateEvent, { type: Type }>, "type" | "payload">;

export function eventAt<Type extends StateEvent["type"]>(
  revision: number,
  event: StateEventBody<Type>,
  runtimeId = ids.runtime,
): Extract<StateEvent, { type: Type }> {
  return parseRealtimeEvent({
    protocolVersion: 2,
    runtimeId,
    id: `evt_${String(revision).padStart(16, "0")}`,
    sequence: revision,
    revision,
    occurredAt: "2026-08-24T00:00:00.000Z",
    ...event,
  }) as Extract<StateEvent, { type: Type }>;
}
