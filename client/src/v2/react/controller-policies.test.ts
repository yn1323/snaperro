import { describe, expect, it } from "vitest";

import { BodyRefSchema, parseRealtimeEvent, RecordingSchema, RevisionSchema } from "../contracts";
import { eventAt, ids, recordingSummaryAt } from "../test-fixtures";
import { createRecordingListState } from "./app-state";
import {
  bodyDownloadFilename,
  invalidatesActiveRecordings,
  reconcileRecordingMutation,
  synchronizeBodyHeaders,
} from "./controller-policies";

const timestamp = "2026-08-24T00:00:00.000Z";
const recording = RecordingSchema.parse({
  id: ids.recording,
  scenarioId: ids.scenario,
  filename: "users.json",
  route: "/users",
  method: "GET",
  requestFingerprint: "a".repeat(64),
  request: { pathParams: {}, query: [], headers: [], body: null },
  response: { status: 200, statusText: "OK", headers: [], body: null },
  revision: 4,
  createdAt: timestamp,
  updatedAt: timestamp,
});

describe("controller policies", () => {
  it("requires an authoritative refresh instead of locally adding a search result", () => {
    const before = {
      ...createRecordingListState(),
      scenarioId: ids.scenario,
      scenarioRevision: RevisionSchema.parse(3),
      query: "hidden-in-body",
      items: [],
    };

    const result = reconcileRecordingMutation(before, recording, RevisionSchema.parse(5));

    expect(result.authoritativeSearchQuery).toBe("hidden-in-body");
    expect(result.state.items).toEqual([]);
    expect(result.state.scenarioRevision).toBe(5);
  });

  it("locally upserts and orders summaries when no search is active", () => {
    const older = recordingSummaryAt({
      id: ids.otherRecording,
      updatedAt: "2026-08-23T00:00:00.000Z",
    });
    const result = reconcileRecordingMutation(
      {
        ...createRecordingListState(),
        scenarioId: ids.scenario,
        query: "",
        items: [older],
      },
      recording,
      RevisionSchema.parse(5),
    );

    expect(result.authoritativeSearchQuery).toBeNull();
    expect(result.state.items.map(({ id }) => id)).toEqual([ids.recording, ids.otherRecording]);
    expect(result.state.items[0]?.contentRevision).toBe(4);
  });

  it("does not roll a newer recording projection back with a late command result", () => {
    const newer = recordingSummaryAt({
      id: recording.id,
      contentRevision: RevisionSchema.parse(6),
    });
    const before = {
      ...createRecordingListState(),
      scenarioId: ids.scenario,
      scenarioRevision: RevisionSchema.parse(8),
      query: "",
      items: [newer],
    };

    const result = reconcileRecordingMutation(before, recording, RevisionSchema.parse(7));

    expect(result.state).toBe(before);
    expect(result.authoritativeSearchQuery).toBe("");
    expect(result.state.items).toEqual([newer]);
  });

  it("only invalidates the active scenario recording projection for scenario aggregates", () => {
    const event = parseRealtimeEvent({
      ...eventAt(11, { type: "mode.changed", payload: { mode: "record" } }),
      type: "scenario.upserted",
      payload: {
        scenario: { id: ids.scenario, folderId: ids.folder, name: "Scenario" },
        recordingsInvalidated: true,
      },
    });

    expect(invalidatesActiveRecordings(event, ids.scenario)).toBe(true);
    expect(invalidatesActiveRecordings(event, ids.otherScenario)).toBe(false);
    expect(invalidatesActiveRecordings(event, null)).toBe(false);
  });

  it("replaces stale body metadata headers with the uploaded BodyRef", () => {
    const body = BodyRefSchema.parse({
      sha256: "f".repeat(64),
      size: 11,
      mediaType: "application/json",
      contentEncoding: "gzip",
    });

    expect(
      synchronizeBodyHeaders(
        [
          ["X-Test", "kept"],
          ["Content-Type", "text/plain"],
          ["content-encoding", "br"],
          ["content-length", "999"],
        ],
        body,
      ),
    ).toEqual([
      ["X-Test", "kept"],
      ["content-type", "application/json"],
      ["content-encoding", "gzip"],
      ["content-length", "11"],
    ]);
  });

  it("sanitizes and bounds native body download filenames", () => {
    const filename = bodyDownloadFilename(`${"a".repeat(300)}/users.json`, "response");

    expect(filename).not.toContain("/");
    expect(filename).toHaveLength(255);
    expect(filename.endsWith(".response.body")).toBe(true);
  });
});
