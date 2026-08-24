import { describe, expect, it } from "vitest";

import { parseRealtimeEvent } from "./contracts";
import {
  applyRealtimeMessage,
  applyTypedRealtimeEvent,
  createRealtimeSyncState,
  installRealtimeSnapshot,
} from "./realtime";
import { eventAt, ids, snapshotAt, streamAnchorAt } from "./test-fixtures";

describe("realtime revision application", () => {
  it("applies the next revision and ignores duplicate delivery", () => {
    const ready = installRealtimeSnapshot(createRealtimeSyncState(), snapshotAt(10)).state;
    const event = eventAt(11, { type: "mode.changed", payload: { mode: "record" } });

    const applied = applyTypedRealtimeEvent(ready, event);
    expect(applied.outcome).toBe("applied");
    expect(applied.state.snapshot?.mode).toBe("record");
    expect(applied.state.lastEventId).toBe(event.id);

    const duplicate = applyTypedRealtimeEvent(applied.state, event);
    expect(duplicate.outcome).toBe("duplicate-ignored");
    expect(duplicate.state).toBe(applied.state);
  });

  it("establishes stream position from runtime.connected and delivers telemetry without changing the snapshot", () => {
    const snapshot = snapshotAt(10);
    const connected = parseRealtimeEvent({
      protocolVersion: 2,
      runtimeId: ids.runtime,
      id: "evt_0000000000000010",
      sequence: 10,
      revision: 10,
      occurredAt: "2026-08-24T00:00:00.000Z",
      type: "runtime.connected",
      payload: snapshot,
    });
    const ready = applyTypedRealtimeEvent(createRealtimeSyncState(), connected);
    expect(ready.outcome).toBe("applied");
    expect(ready.state.lastSequence).toBe(10);

    const telemetry = parseRealtimeEvent({
      protocolVersion: 2,
      runtimeId: ids.runtime,
      id: "evt_0000000000000011",
      sequence: 11,
      revision: 10,
      occurredAt: "2026-08-24T00:00:01.000Z",
      type: "request.completed",
      payload: {
        id: "req_aaaaaaaaaaaaaaaa",
        timestamp: "2026-08-24T00:00:01.000Z",
        method: "GET",
        path: "/users",
        action: "mock",
        status: 200,
        recordingOutcome: { state: "not-attempted" },
        durationMs: 12,
      },
    });
    const delivered = applyTypedRealtimeEvent(ready.state, telemetry);
    expect(delivered.outcome).toBe("telemetry");
    expect(delivered.state.snapshot).toBe(ready.state.snapshot);
    expect(delivered.deliveredEvent).toBe(telemetry);
  });

  it("consumes a queued state event already included in a newer snapshot", () => {
    const ready = installRealtimeSnapshot(createRealtimeSyncState(), snapshotAt(12), streamAnchorAt(10)).state;
    const alreadyApplied = eventAt(11, { type: "mode.changed", payload: { mode: "record" } });

    const consumed = applyTypedRealtimeEvent(ready, alreadyApplied);
    expect(consumed.outcome).toBe("duplicate-ignored");
    expect(consumed.state.snapshot).toBe(ready.snapshot);
    expect(consumed.state.lastSequence).toBe(11);
    expect(consumed.state.lastEventId).toBe(alreadyApplied.id);

    const next = parseRealtimeEvent({
      ...eventAt(13, { type: "mode.changed", payload: { mode: "proxy" } }),
      sequence: 12,
    });
    const applied = applyTypedRealtimeEvent(consumed.state, next);
    expect(applied.outcome).toBe("applied");
    expect(applied.state.snapshot?.revision).toBe(13);
  });

  it("delivers queued telemetry from an older revision and consumes its sequence", () => {
    const ready = installRealtimeSnapshot(createRealtimeSyncState(), snapshotAt(12), streamAnchorAt(10)).state;
    const telemetry = parseRealtimeEvent({
      protocolVersion: 2,
      runtimeId: ids.runtime,
      id: "evt_0000000000000011",
      sequence: 11,
      revision: 11,
      occurredAt: "2026-08-24T00:00:01.000Z",
      type: "request.completed",
      payload: {
        id: "req_bbbbbbbbbbbbbbbb",
        timestamp: "2026-08-24T00:00:01.000Z",
        method: "GET",
        path: "/queued",
        action: "mock",
        status: 200,
        recordingOutcome: { state: "not-attempted" },
        durationMs: 4,
      },
    });

    const consumed = applyTypedRealtimeEvent(ready, telemetry);
    expect(consumed.outcome).toBe("telemetry");
    expect(consumed.deliveredEvent).toBe(telemetry);
    expect(consumed.state.snapshot).toBe(ready.snapshot);
    expect(consumed.state.lastSequence).toBe(11);

    const next = parseRealtimeEvent({
      ...eventAt(13, { type: "mode.changed", payload: { mode: "record" } }),
      sequence: 12,
    });
    expect(applyTypedRealtimeEvent(consumed.state, next).outcome).toBe("applied");
  });

  it("requires resync only when telemetry is newer than the installed snapshot", () => {
    const ready = installRealtimeSnapshot(createRealtimeSyncState(), snapshotAt(10), streamAnchorAt(10)).state;
    const futureTelemetry = parseRealtimeEvent({
      protocolVersion: 2,
      runtimeId: ids.runtime,
      id: "evt_0000000000000011",
      sequence: 11,
      revision: 11,
      occurredAt: "2026-08-24T00:00:01.000Z",
      type: "request.completed",
      payload: {
        id: "req_cccccccccccccccc",
        timestamp: "2026-08-24T00:00:01.000Z",
        method: "GET",
        path: "/future",
        action: "proxy",
        status: 200,
        recordingOutcome: { state: "not-attempted" },
        durationMs: 3,
      },
    });

    const result = applyTypedRealtimeEvent(ready, futureTelemetry);
    expect(result.outcome).toBe("resync-required");
    expect(result.state.issue?.code).toBe("revision-gap");
    expect(result.state.minimumSnapshotRevision).toBe(11);
  });

  it("requires resync when the event sequence has a gap", () => {
    const anchored = installRealtimeSnapshot(createRealtimeSyncState(), snapshotAt(10), streamAnchorAt(10)).state;
    const gapEvent = parseRealtimeEvent({
      ...eventAt(11, { type: "mode.changed", payload: { mode: "record" } }),
      sequence: 12,
    });
    const gap = applyTypedRealtimeEvent(anchored, gapEvent);
    expect(gap.outcome).toBe("resync-required");
    expect(gap.state.issue?.code).toBe("sequence-gap");
    expect(gap.state.minimumSequence).toBe(12);
  });

  it("requires a sufficiently new snapshot after a revision gap", () => {
    const ready = installRealtimeSnapshot(createRealtimeSyncState(), snapshotAt(10)).state;
    const gap = applyTypedRealtimeEvent(ready, eventAt(13, { type: "mode.changed", payload: { mode: "mock" } }));

    expect(gap.outcome).toBe("resync-required");
    expect(gap.state.status).toBe("resyncing");
    expect(gap.state.minimumSnapshotRevision).toBe(13);

    const stale = installRealtimeSnapshot(gap.state, snapshotAt(12));
    expect(stale.outcome).toBe("resync-required");

    const recovered = installRealtimeSnapshot(gap.state, snapshotAt(13), streamAnchorAt(13));
    expect(recovered.outcome).toBe("applied");
    expect(recovered.state.status).toBe("ready");
  });

  it("requires a fresh snapshot for a bounded folder import invalidation", () => {
    const ready = installRealtimeSnapshot(createRealtimeSyncState(), snapshotAt(10), streamAnchorAt(10)).state;
    const imported = eventAt(11, {
      type: "folder.upserted",
      payload: {
        folder: { id: ids.otherFolder, name: "Imported" },
        recordingsInvalidated: true,
      },
    });

    const result = applyTypedRealtimeEvent(ready, imported);

    expect(result.outcome).toBe("resync-required");
    expect(result.state.issue?.code).toBe("aggregate-invalidated");
    expect(result.state.minimumSnapshotRevision).toBe(11);
    expect(result.state.minimumSequence).toBe(11);
    expect(result.state.snapshot).toBe(ready.snapshot);
  });

  it("resyncs to a new runtime and does not compare its revision with the old runtime", () => {
    const ready = installRealtimeSnapshot(createRealtimeSyncState(), snapshotAt(100)).state;
    const changed = applyTypedRealtimeEvent(
      ready,
      eventAt(1, { type: "mode.changed", payload: { mode: "proxy" } }, ids.otherRuntime),
    );

    expect(changed.outcome).toBe("resync-required");
    expect(changed.state.issue?.code).toBe("runtime-changed");
    expect(changed.state.requiredRuntimeId).toBe(ids.otherRuntime);

    const tooOld = installRealtimeSnapshot(changed.state, snapshotAt(0, ids.otherRuntime));
    expect(tooOld.outcome).toBe("resync-required");

    const recovered = installRealtimeSnapshot(changed.state, snapshotAt(1, ids.otherRuntime), streamAnchorAt(1));
    expect(recovered.outcome).toBe("applied");
    expect(recovered.state.snapshot?.runtimeId).toBe(ids.otherRuntime);
  });

  it("requests resync for invalid transitions and marks malformed messages as protocol errors", () => {
    const ready = installRealtimeSnapshot(createRealtimeSyncState(), snapshotAt(2)).state;
    const invalid = applyTypedRealtimeEvent(
      ready,
      eventAt(3, {
        type: "scenario.current-changed",
        payload: { scenarioId: ids.otherScenario },
      }),
    );
    expect(invalid.outcome).toBe("resync-required");
    expect(invalid.state.issue?.code).toBe("invalid-transition");

    const malformed = applyRealtimeMessage(ready, { type: "mode.changed", payload: {} });
    expect(malformed.outcome).toBe("protocol-error");
    expect(malformed.state.status).toBe("protocol-error");
  });
});
