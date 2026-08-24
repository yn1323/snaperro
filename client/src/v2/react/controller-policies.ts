import {
  type BodyRef,
  type Event,
  type Recording,
  type RecordingDraft,
  RecordingDraftSchema,
  type RecordingSummary,
  type Revision,
  type ScenarioId,
} from "../contracts";
import { type RecordingListState, recordingSummary } from "./app-state";

export function recordingDraft(recording: Recording): RecordingDraft {
  return RecordingDraftSchema.parse({
    route: recording.route,
    method: recording.method,
    request: recording.request,
    response: recording.response,
  });
}

export function bodyDownloadFilename(recordingFilename: string, target: "request" | "response"): string {
  const suffix = `.${target}.body`;
  const maxBaseLength = 255 - suffix.length;
  const normalized = Array.from(recordingFilename.normalize("NFC"), (character) => {
    const codePoint = character.codePointAt(0);
    return character === "/" || character === "\\" || codePoint === undefined || codePoint < 0x20 || codePoint === 0x7f
      ? "_"
      : character;
  })
    .join("")
    .trim();
  let base = "";
  for (const character of normalized) {
    if (base.length + character.length > maxBaseLength) break;
    base += character;
  }
  return `${base || "recording"}${suffix}`;
}

function compareRecordingSummaries(left: RecordingSummary, right: RecordingSummary): number {
  return right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id);
}

export function upsertRecordingSummary(items: RecordingSummary[], summary: RecordingSummary): RecordingSummary[] {
  const index = items.findIndex((candidate) => candidate.id === summary.id);
  if (index === -1) return [...items, summary].sort(compareRecordingSummaries);
  const next = [...items];
  next[index] = summary;
  return next.sort(compareRecordingSummaries);
}

export function synchronizeBodyHeaders(headers: Recording["request"]["headers"], body: BodyRef) {
  const bodyHeaderNames = new Set(["content-type", "content-encoding", "content-length"]);
  const synchronized = headers.filter(([name]) => !bodyHeaderNames.has(name.toLocaleLowerCase("en-US")));
  if (body.mediaType) synchronized.push(["content-type", body.mediaType]);
  if (body.contentEncoding) synchronized.push(["content-encoding", body.contentEncoding]);
  synchronized.push(["content-length", String(body.size)]);
  return synchronized;
}

export function invalidatesActiveRecordings(event: Event, activeScenarioId: ScenarioId | null): boolean {
  if (!activeScenarioId) return false;
  if (event.type === "scenario.upserted") {
    return event.payload.recordingsInvalidated === true && event.payload.scenario.id === activeScenarioId;
  }
  return false;
}

export interface RecordingMutationReconciliation {
  state: RecordingListState;
  authoritativeSearchQuery: string | null;
}

/**
 * Summary fields cannot determine body/header search membership, so a mutation
 * may only be applied locally when no full-text search is active.
 */
export function reconcileRecordingMutation(
  state: RecordingListState,
  recording: Recording,
  scenarioRevision: Revision,
): RecordingMutationReconciliation {
  if (state.scenarioId !== recording.scenarioId) {
    return { state, authoritativeSearchQuery: null };
  }
  if (state.scenarioRevision !== null && scenarioRevision < state.scenarioRevision) {
    // A command response can arrive after a newer SSE event. Applying its
    // projection would resurrect a deleted recording or roll back a newer
    // summary, so keep the newer revision and re-read the authoritative page.
    return { state, authoritativeSearchQuery: state.query };
  }
  if (state.query.trim()) {
    return {
      state: { ...state, scenarioRevision },
      authoritativeSearchQuery: state.query,
    };
  }
  return {
    state: {
      ...state,
      scenarioRevision,
      items: upsertRecordingSummary(state.items, recordingSummary(recording)),
    },
    authoritativeSearchQuery: null,
  };
}
