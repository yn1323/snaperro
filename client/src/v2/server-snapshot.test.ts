import { describe, expect, it } from "vitest";

import { parseRealtimeEvent, parseServerSnapshot, RevisionSchema } from "./contracts";
import {
  assertServerSnapshotInvariants,
  createEmptyServerSnapshot,
  reduceServerSnapshot,
  ServerSnapshotInvariantError,
} from "./server-snapshot";
import { eventAt, ids, snapshotAt } from "./test-fixtures";

describe("server snapshot reducer", () => {
  it("applies normalized entity events in revision order", () => {
    let state = createEmptyServerSnapshot({ runtimeId: ids.runtime, version: "2.0.0" });

    state = reduceServerSnapshot(
      state,
      eventAt(1, {
        type: "folder.upserted",
        payload: { folder: { id: ids.folder, name: "Folder" } },
      }),
    );
    state = reduceServerSnapshot(
      state,
      eventAt(2, {
        type: "scenario.upserted",
        payload: { scenario: { id: ids.scenario, folderId: ids.folder, name: "Scenario" } },
      }),
    );
    state = reduceServerSnapshot(
      state,
      eventAt(3, {
        type: "recording.upserted",
        payload: {
          recording: {
            id: ids.recording,
            scenarioId: ids.scenario,
            filename: "users_001.json",
            endpoint: "/users",
            method: "GET",
            sizeBytes: 12,
            updatedAt: "2026-08-24T00:00:00.000Z",
            contentRevision: RevisionSchema.parse(1),
          },
          scenarioRevision: RevisionSchema.parse(1),
        },
      }),
    );
    state = reduceServerSnapshot(
      state,
      eventAt(4, {
        type: "scenario.current-changed",
        payload: { scenarioId: ids.scenario },
      }),
    );

    expect(state.revision).toBe(4);
    expect(state.currentScenarioId).toBe(ids.scenario);
    expect(() => assertServerSnapshotInvariants(state)).not.toThrow();
  });

  it("cascades folder deletion and clears the current scenario", () => {
    const next = reduceServerSnapshot(
      snapshotAt(8),
      eventAt(9, { type: "folder.deleted", payload: { folderId: ids.folder } }),
    );

    expect(next.currentScenarioId).toBeNull();
    expect(next.folders).toEqual({});
    expect(next.scenarios).toEqual({});
  });

  it("applies a duplicated scenario as a bounded recording invalidation", () => {
    const next = reduceServerSnapshot(
      snapshotAt(8),
      eventAt(9, {
        type: "scenario.upserted",
        payload: {
          scenario: { id: ids.otherScenario, folderId: ids.folder, name: "Duplicated" },
          recordingsInvalidated: true,
        },
      }),
    );

    expect(next.revision).toBe(9);
    expect(next.scenarios[ids.otherScenario]?.name).toBe("Duplicated");
  });

  it("keeps folder upserts bounded to folder metadata", () => {
    const next = reduceServerSnapshot(
      snapshotAt(8),
      eventAt(9, {
        type: "folder.upserted",
        payload: {
          folder: { id: ids.otherFolder, name: "Imported" },
          recordingsInvalidated: true,
        },
      }),
    );

    expect(next.folders[ids.otherFolder]?.name).toBe("Imported");
    expect(next.scenarios[ids.otherScenario]).toBeUndefined();
    expect(next.revision).toBe(9);
  });

  it("rejects out-of-order revisions and dangling entity references", () => {
    const snapshot = snapshotAt(3);
    const gap = eventAt(5, { type: "mode.changed", payload: { mode: "proxy" } });
    expect(() => reduceServerSnapshot(snapshot, gap)).toThrow(ServerSnapshotInvariantError);

    const dangling = eventAt(4, {
      type: "recording.upserted",
      payload: {
        recording: {
          id: ids.otherRecording,
          scenarioId: ids.otherScenario,
          filename: "missing.json",
          endpoint: "/missing",
          method: "GET",
          sizeBytes: 1,
          updatedAt: "2026-08-24T00:00:00.000Z",
          contentRevision: RevisionSchema.parse(1),
        },
        scenarioRevision: RevisionSchema.parse(1),
      },
    });
    expect(() => reduceServerSnapshot(snapshot, dangling)).toThrow(/does not exist/u);
  });

  it("runtime-validates snapshots and event payloads", () => {
    expect(() => parseServerSnapshot({ protocolVersion: 2 })).toThrow();
    expect(() =>
      parseRealtimeEvent({
        protocolVersion: 2,
        runtimeId: ids.runtime,
        id: "evt_aaaaaaaaaaaaaaaa",
        revision: 1,
        type: "mode.changed",
        payload: { mode: "not-a-mode" },
      }),
    ).toThrow();
  });
});
