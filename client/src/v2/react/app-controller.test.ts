import { describe, expect, it, vi } from "vitest";

import {
  type BodyRef,
  BodyRefSchema,
  CursorSchema,
  DownloadTicketSchema,
  type Event,
  MAX_CONTROL_JSON_BYTES,
  parseRealtimeEvent,
  parseServerSnapshot,
  type Query,
  RecordingSchema,
  type RecordingSummary,
  RevisionSchema,
  TransferIdSchema,
} from "../contracts";
import { ApiError } from "../infrastructure/api-error";
import type { V2HttpClient } from "../infrastructure/http-client";
import type { RealtimeClientHandlers, V2RealtimeClient } from "../infrastructure/realtime-client";
import { eventAt, ids, recordingSummaryAt, snapshotAt } from "../test-fixtures";
import { type BrowserDownloadPort, V2AppController } from "./app-controller";
import { createRecordingDocumentState, createRecordingListState } from "./app-state";

const timestamp = "2026-08-24T00:00:00.000Z";
const transferId = TransferIdSchema.parse("xfer_aaaaaaaaaaaaaaaa");
const folderDownload = DownloadTicketSchema.parse({
  downloadPath: `/__snaperro__/downloads/${"a".repeat(43)}`,
  expiresAt: "2026-08-24T00:05:00.000Z",
  filename: "folder.zip",
  mediaType: "application/zip",
  size: 65 * 1024 * 1024,
});
const recordingDownload = DownloadTicketSchema.parse({
  ...folderDownload,
  downloadPath: `/__snaperro__/downloads/${"b".repeat(43)}`,
  filename: "users.zip",
});
const bodyDownload = DownloadTicketSchema.parse({
  ...folderDownload,
  downloadPath: `/__snaperro__/downloads/${"c".repeat(43)}`,
  filename: "users.json.response.body",
  mediaType: "application/octet-stream",
  size: 3,
});

const recording = RecordingSchema.parse({
  id: ids.recording,
  scenarioId: ids.scenario,
  filename: "users.json",
  route: "/users",
  method: "GET",
  requestFingerprint: "a".repeat(64),
  request: { pathParams: {}, query: [], headers: [], body: null },
  response: { status: 200, statusText: "OK", headers: [], body: null },
  revision: 3,
  createdAt: timestamp,
  updatedAt: timestamp,
});

const otherRecording: RecordingSummary = {
  ...recordingSummaryAt(),
  id: ids.otherRecording,
  filename: "body-match-only.json",
  endpoint: "/not-a-summary-match",
  contentRevision: RevisionSchema.parse(4),
};

function boundedSnapshot(revision = 10) {
  return parseServerSnapshot(snapshotAt(revision));
}

function deferred<Value>() {
  let resolve!: (value: Value | PromiseLike<Value>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function connectedEvent(revision = 10): Event {
  const snapshot = boundedSnapshot(revision);
  return parseRealtimeEvent({
    protocolVersion: 2,
    runtimeId: ids.runtime,
    id: `evt_${String(revision).padStart(16, "0")}`,
    sequence: revision,
    revision,
    occurredAt: timestamp,
    type: "runtime.connected",
    payload: snapshot,
  });
}

function completedEvent(): Event {
  return parseRealtimeEvent({
    protocolVersion: 2,
    runtimeId: ids.runtime,
    id: "evt_0000000000000011",
    sequence: 11,
    revision: 10,
    occurredAt: timestamp,
    type: "request.completed",
    payload: {
      id: "req_aaaaaaaaaaaaaaaa",
      timestamp,
      method: "GET",
      path: "/users",
      action: "mock",
      status: 200,
      recordingOutcome: { state: "pending" },
      durationMs: 12,
    },
  });
}

function recordingOutcomeEvent(
  recordingOutcome:
    | { state: "saved"; recordingId: typeof ids.recording }
    | { state: "failed"; problem: { code: "INTERNAL"; message: string; retryable: false } },
): Event {
  return parseRealtimeEvent({
    protocolVersion: 2,
    runtimeId: ids.runtime,
    id: "evt_0000000000000012",
    sequence: 12,
    revision: 10,
    occurredAt: timestamp,
    type: "recording.outcome",
    payload: {
      requestId: "req_aaaaaaaaaaaaaaaa",
      scenarioId: ids.scenario,
      recordingOutcome,
    },
  });
}

class FakeRealtime {
  handlers: RealtimeClientHandlers | null = null;
  subscriptions = 0;

  async subscribe(handlers: RealtimeClientHandlers, options: { signal: AbortSignal }): Promise<void> {
    this.subscriptions += 1;
    this.handlers = handlers;
    handlers.onStatus?.("connecting");
    await new Promise<void>((resolve) => options.signal.addEventListener("abort", () => resolve(), { once: true }));
  }

  async emit(event: Event): Promise<void> {
    this.handlers?.onStatus?.("connected");
    await this.handlers?.onEvent(event);
  }

  fail(error: ApiError): void {
    this.handlers?.onError?.(error);
  }
}

class FakeHttp {
  currentSnapshot = boundedSnapshot();
  listItems: RecordingSummary[] = [recordingSummaryAt()];
  searchItems: RecordingSummary[] = [recordingSummaryAt()];
  pageScenarioRevision = RevisionSchema.parse(5);
  recordingResult: typeof recording | null = recording;
  readonly snapshot = vi.fn(async () => this.currentSnapshot);
  readonly query = vi.fn(async (input: Query) => {
    switch (input.type) {
      case "recording.list":
        return {
          revision: this.currentSnapshot.revision,
          scenarioRevision: this.pageScenarioRevision,
          items: this.listItems,
          nextCursor: null,
        };
      case "recording.search":
        return {
          revision: this.currentSnapshot.revision,
          scenarioRevision: this.pageScenarioRevision,
          items: this.searchItems,
          nextCursor: null,
        };
      case "recording.get":
        if (!this.recordingResult) throw new ApiError("recording was not found", { code: "NOT_FOUND", status: 404 });
        return {
          revision: this.currentSnapshot.revision,
          scenarioRevision: this.pageScenarioRevision,
          recording: this.recordingResult,
        };
      case "folder.export":
        return { revision: this.currentSnapshot.revision, download: folderDownload };
      case "recording.export":
        return { revision: this.currentSnapshot.revision, download: recordingDownload };
      case "body.download":
        return { revision: this.currentSnapshot.revision, download: bodyDownload };
      default:
        throw new Error(`Unexpected query ${input.type}`);
    }
  });
  readonly command = vi.fn(async () => ({ revision: this.currentSnapshot.revision, mode: "record" }));
  readonly uploadBody = vi.fn(
    async (_body: BodyInit, metadata: { mediaType: string | null; contentEncoding: string | null }) =>
      BodyRefSchema.parse({
        sha256: "f".repeat(64),
        size: 11,
        mediaType: metadata.mediaType,
        contentEncoding: metadata.contentEncoding,
      }),
  );
  readonly stageRecordingImport = vi.fn(async () => ({
    transferId,
    filename: "recording.zip",
    size: 3,
    sha256: "d".repeat(64),
  }));
}

function controllerWith(http = new FakeHttp(), options: { searchEventDebounceMs?: number } = {}) {
  const realtime = new FakeRealtime();
  const controller = new V2AppController({
    http: http as unknown as V2HttpClient,
    realtime: realtime as unknown as V2RealtimeClient,
    commandId: () => "cmd_aaaaaaaaaaaaaaaa",
    ...options,
  });
  controller.start();
  return { controller, realtime, http };
}

describe("V2AppController", () => {
  it("loads each recording page and its scenario revision from one read view", async () => {
    const http = new FakeHttp();
    http.pageScenarioRevision = RevisionSchema.parse(6);
    const { controller, realtime } = controllerWith(http);

    await realtime.emit(connectedEvent());
    await vi.waitFor(() => expect(controller.recordings.getSnapshot().status).toBe("ready"));

    expect(controller.recordings.getSnapshot().scenarioRevision).toBe(6);
    expect(http.query).toHaveBeenCalledTimes(1);
    expect(http.query).toHaveBeenCalledWith(
      expect.objectContaining({ type: "recording.list", scenarioId: ids.scenario }),
      expect.objectContaining({ signal: expect.any(Object) }),
    );
    controller.stop();
  });

  it("retries a recording page that is older than a recording event observed while it was loading", async () => {
    const http = new FakeHttp();
    const { controller, realtime } = controllerWith(http);
    await realtime.emit(connectedEvent());
    await vi.waitFor(() => expect(controller.recordings.getSnapshot().status).toBe("ready"));
    http.query.mockClear();
    const releaseStalePage = deferred<void>();
    http.query.mockImplementationOnce(async () => {
      await releaseStalePage.promise;
      return {
        revision: RevisionSchema.parse(10),
        scenarioRevision: RevisionSchema.parse(5),
        items: [recordingSummaryAt()],
        nextCursor: null,
      } as never;
    });

    const refresh = controller.refreshRecordings();
    await vi.waitFor(() => expect(http.query).toHaveBeenCalledOnce());
    http.pageScenarioRevision = RevisionSchema.parse(6);
    http.listItems = [recordingSummaryAt(), otherRecording];
    await realtime.emit(
      eventAt(11, {
        type: "recording.upserted",
        payload: { recording: otherRecording, scenarioRevision: RevisionSchema.parse(6) },
      }),
    );
    releaseStalePage.resolve();
    await refresh;

    expect(http.query).toHaveBeenCalledTimes(2);
    expect(controller.recordings.getSnapshot()).toMatchObject({
      scenarioRevision: RevisionSchema.parse(6),
      status: "ready",
    });
    expect(controller.recordings.getSnapshot().items.map((item) => item.id)).toEqual([
      ids.recording,
      ids.otherRecording,
    ]);
    controller.stop();
  });

  it("retries an initial recording read that is older than an observed upsert", async () => {
    const http = new FakeHttp();
    const { controller, realtime } = controllerWith(http);
    await realtime.emit(connectedEvent());
    await vi.waitFor(() => expect(controller.recordings.getSnapshot().status).toBe("ready"));

    const staleGet = deferred<unknown>();
    http.query.mockClear();
    http.query.mockImplementationOnce(async (input) => {
      expect(input.type).toBe("recording.get");
      return staleGet.promise as never;
    });
    controller.openRecording(ids.recording);
    await vi.waitFor(() => expect(http.query).toHaveBeenCalledOnce());

    const newer = RecordingSchema.parse({
      ...recording,
      route: "/users/:id",
      revision: 4,
      updatedAt: "2026-08-24T00:01:00.000Z",
    });
    http.recordingResult = newer;
    http.pageScenarioRevision = RevisionSchema.parse(6);
    await realtime.emit(
      eventAt(11, {
        type: "recording.upserted",
        payload: {
          recording: recordingSummaryAt({
            endpoint: newer.route,
            contentRevision: newer.revision,
            updatedAt: newer.updatedAt,
          }),
          scenarioRevision: RevisionSchema.parse(6),
        },
      }),
    );
    staleGet.resolve({
      revision: RevisionSchema.parse(10),
      scenarioRevision: RevisionSchema.parse(5),
      recording,
    });

    await vi.waitFor(() => expect(controller.document.getSnapshot().recording?.revision).toBe(newer.revision));
    const gets = http.query.mock.calls.filter(([input]) => input.type === "recording.get");
    expect(gets).toHaveLength(2);
    expect(controller.documentBuffer.readText()).toContain('"route": "/users/:id"');
    controller.stop();
  });

  it("bounds retries when a recording page remains older than observed events", async () => {
    const http = new FakeHttp();
    const { controller, realtime } = controllerWith(http);
    await realtime.emit(connectedEvent());
    await vi.waitFor(() => expect(controller.recordings.getSnapshot().status).toBe("ready"));
    controller.recordings.update((state) => ({ ...state, scenarioRevision: RevisionSchema.parse(6) }));
    http.pageScenarioRevision = RevisionSchema.parse(5);
    http.query.mockClear();

    await controller.refreshRecordings();

    const lists = http.query.mock.calls.filter(([input]) => input.type === "recording.list");
    expect(lists).toHaveLength(3);
    expect(controller.recordings.getSnapshot()).toMatchObject({
      scenarioRevision: RevisionSchema.parse(6),
      status: "ready",
    });
    controller.stop();
  });

  it("stops exponential background recovery after repeated stale recording pages", async () => {
    const http = new FakeHttp();
    const { controller, realtime } = controllerWith(http);
    await realtime.emit(connectedEvent());
    await vi.waitFor(() => expect(controller.recordings.getSnapshot().status).toBe("ready"));
    controller.recordings.update((state) => ({ ...state, scenarioRevision: RevisionSchema.parse(6) }));
    http.pageScenarioRevision = RevisionSchema.parse(5);
    http.query.mockClear();
    vi.useFakeTimers();

    await controller.refreshRecordings();
    expect(http.query).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(500);
    expect(http.query).toHaveBeenCalledTimes(6);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(http.query).toHaveBeenCalledTimes(9);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(http.query).toHaveBeenCalledTimes(12);
    expect(controller.recordings.getSnapshot()).toMatchObject({
      status: "ready",
      error: { code: "REVISION_CONFLICT" },
    });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(http.query).toHaveBeenCalledTimes(12);

    controller.stop();
    vi.useRealTimers();
  });

  it("keeps stale-page recovery bounded while upsert and delete events continue", async () => {
    const http = new FakeHttp();
    const { controller, realtime } = controllerWith(http);
    await realtime.emit(connectedEvent());
    await vi.waitFor(() => expect(controller.recordings.getSnapshot().status).toBe("ready"));
    controller.setSearchQuery("changing");
    controller.recordings.update((state) => ({
      ...state,
      query: "changing",
      scenarioRevision: RevisionSchema.parse(6),
    }));
    http.pageScenarioRevision = RevisionSchema.parse(5);
    http.query.mockClear();
    vi.useFakeTimers();

    await controller.refreshRecordings("changing");
    expect(http.query).toHaveBeenCalledTimes(3);

    await realtime.emit(
      eventAt(11, {
        type: "recording.upserted",
        payload: {
          recording: recordingSummaryAt({ contentRevision: RevisionSchema.parse(4) }),
          scenarioRevision: RevisionSchema.parse(7),
        },
      }),
    );
    await vi.advanceTimersByTimeAsync(100);
    expect(http.query).toHaveBeenCalledTimes(6);

    await realtime.emit(
      eventAt(12, {
        type: "recording.deleted",
        payload: {
          recordingId: ids.recording,
          scenarioId: ids.scenario,
          scenarioRevision: RevisionSchema.parse(8),
        },
      }),
    );
    await vi.advanceTimersByTimeAsync(1_000);
    expect(http.query).toHaveBeenCalledTimes(9);

    await realtime.emit(
      eventAt(13, {
        type: "recording.upserted",
        payload: {
          recording: recordingSummaryAt({ contentRevision: RevisionSchema.parse(5) }),
          scenarioRevision: RevisionSchema.parse(9),
        },
      }),
    );
    await vi.advanceTimersByTimeAsync(2_000);
    expect(http.query).toHaveBeenCalledTimes(12);
    expect(controller.recordings.getSnapshot()).toMatchObject({
      scenarioRevision: RevisionSchema.parse(9),
      status: "ready",
      error: { code: "REVISION_CONFLICT" },
    });

    await realtime.emit(
      eventAt(14, {
        type: "recording.upserted",
        payload: {
          recording: recordingSummaryAt({ contentRevision: RevisionSchema.parse(6) }),
          scenarioRevision: RevisionSchema.parse(10),
        },
      }),
    );
    await vi.advanceTimersByTimeAsync(10_000);
    expect(http.query).toHaveBeenCalledTimes(12);

    controller.stop();
    vi.useRealTimers();
  });

  it("resets stale-page recovery after an event-driven search refresh succeeds", async () => {
    const http = new FakeHttp();
    const { controller, realtime } = controllerWith(http);
    await realtime.emit(connectedEvent());
    await vi.waitFor(() => expect(controller.recordings.getSnapshot().status).toBe("ready"));
    controller.setSearchQuery("settles");
    controller.recordings.update((state) => ({
      ...state,
      query: "settles",
      scenarioRevision: RevisionSchema.parse(6),
    }));
    http.pageScenarioRevision = RevisionSchema.parse(5);
    http.query.mockClear();
    vi.useFakeTimers();

    await controller.refreshRecordings("settles");
    expect(http.query).toHaveBeenCalledTimes(3);
    const settled = recordingSummaryAt({ endpoint: "/settled", contentRevision: RevisionSchema.parse(4) });
    http.pageScenarioRevision = RevisionSchema.parse(7);
    http.searchItems = [settled];
    await realtime.emit(
      eventAt(11, {
        type: "recording.upserted",
        payload: { recording: settled, scenarioRevision: RevisionSchema.parse(7) },
      }),
    );
    await vi.advanceTimersByTimeAsync(100);

    expect(http.query).toHaveBeenCalledTimes(4);
    expect(controller.recordings.getSnapshot()).toMatchObject({
      scenarioRevision: RevisionSchema.parse(7),
      items: [expect.objectContaining({ endpoint: "/settled" })],
      status: "ready",
      error: null,
    });

    const next = recordingSummaryAt({ endpoint: "/next", contentRevision: RevisionSchema.parse(5) });
    http.pageScenarioRevision = RevisionSchema.parse(8);
    http.searchItems = [next];
    await realtime.emit(
      eventAt(12, {
        type: "recording.upserted",
        payload: { recording: next, scenarioRevision: RevisionSchema.parse(8) },
      }),
    );
    await vi.advanceTimersByTimeAsync(100);
    expect(http.query).toHaveBeenCalledTimes(5);
    expect(controller.recordings.getSnapshot()).toMatchObject({
      scenarioRevision: RevisionSchema.parse(8),
      items: [expect.objectContaining({ endpoint: "/next" })],
      error: null,
    });

    controller.stop();
    vi.useRealTimers();
  });

  it("refreshes instead of merging a stale cursor page after a recording event", async () => {
    const http = new FakeHttp();
    const { controller, realtime } = controllerWith(http);
    await realtime.emit(connectedEvent());
    await vi.waitFor(() => expect(controller.recordings.getSnapshot().status).toBe("ready"));
    controller.recordings.update((state) => ({
      ...state,
      nextCursor: CursorSchema.parse("next-page"),
    }));

    http.query.mockClear();
    const releaseStalePage = deferred<void>();
    http.query
      .mockImplementationOnce(async () => {
        await releaseStalePage.promise;
        return {
          revision: RevisionSchema.parse(10),
          scenarioRevision: RevisionSchema.parse(5),
          items: [otherRecording],
          nextCursor: null,
        } as never;
      })
      .mockImplementationOnce(async () => ({
        revision: RevisionSchema.parse(11),
        scenarioRevision: RevisionSchema.parse(6),
        items: [],
        nextCursor: null,
      }));

    const loadingMore = controller.loadMoreRecordings();
    await vi.waitFor(() => expect(http.query).toHaveBeenCalledOnce());
    await realtime.emit(
      eventAt(11, {
        type: "recording.deleted",
        payload: {
          recordingId: ids.recording,
          scenarioId: ids.scenario,
          scenarioRevision: RevisionSchema.parse(6),
        },
      }),
    );
    releaseStalePage.resolve();
    await loadingMore;

    expect(http.query).toHaveBeenCalledTimes(2);
    expect(controller.recordings.getSnapshot()).toMatchObject({
      scenarioRevision: RevisionSchema.parse(6),
      items: [],
      status: "ready",
    });
    controller.stop();
  });

  it("keeps paged recording selection across catalog snapshots and corrects it on deletion", async () => {
    const { controller, realtime } = controllerWith();
    await realtime.emit(connectedEvent());
    await vi.waitFor(() => expect(controller.recordings.getSnapshot().status).toBe("ready"));

    controller.openRecording(ids.recording);
    await vi.waitFor(() => expect(controller.document.getSnapshot().phase).toBe("ready"));
    expect(controller.view.getSnapshot().selectedRecordingId).toBe(ids.recording);
    expect(controller.documentBuffer.readText()).not.toContain("requestFingerprint");

    await realtime.emit(eventAt(11, { type: "mode.changed", payload: { mode: "record" } }));
    expect(controller.view.getSnapshot().selectedRecordingId).toBe(ids.recording);

    controller.markDocumentChanged();
    await realtime.emit(
      eventAt(12, {
        type: "recording.deleted",
        payload: {
          recordingId: ids.recording,
          scenarioId: ids.scenario,
          scenarioRevision: RevisionSchema.parse(6),
        },
      }),
    );
    expect(controller.view.getSnapshot().selectedRecordingId).toBeNull();
    expect(controller.recordings.getSnapshot().items).toEqual([]);
    expect(controller.document.getSnapshot().conflict).toEqual({ kind: "deleted" });
    expect(controller.documentBuffer.getSnapshot().dirty).toBe(true);
    controller.stop();
  });

  it("revalidates a dirty active recording after a fresh connection and preserves it when remotely deleted", async () => {
    const http = new FakeHttp();
    const { controller, realtime } = controllerWith(http);
    await realtime.emit(connectedEvent());
    await vi.waitFor(() => expect(controller.recordings.getSnapshot().status).toBe("ready"));
    controller.openRecording(ids.recording);
    await vi.waitFor(() => expect(controller.document.getSnapshot().phase).toBe("ready"));
    controller.markDocumentChanged();

    http.currentSnapshot = boundedSnapshot(12);
    http.listItems = [];
    http.recordingResult = null;
    await realtime.emit(connectedEvent(12));

    await vi.waitFor(() => expect(controller.recordings.getSnapshot().items).toEqual([]));
    await vi.waitFor(() => expect(controller.document.getSnapshot().conflict).toEqual({ kind: "deleted" }));
    expect(controller.view.getSnapshot().selectedRecordingId).toBeNull();
    expect(controller.document.getSnapshot().recordingId).toBe(ids.recording);
    expect(controller.documentBuffer.getSnapshot().dirty).toBe(true);
    controller.stop();
  });

  it("reloads a clean active recording that changed while the realtime stream was disconnected", async () => {
    const http = new FakeHttp();
    const { controller, realtime } = controllerWith(http);
    await realtime.emit(connectedEvent());
    await vi.waitFor(() => expect(controller.recordings.getSnapshot().status).toBe("ready"));
    controller.openRecording(ids.recording);
    await vi.waitFor(() => expect(controller.document.getSnapshot().phase).toBe("ready"));

    const remote = RecordingSchema.parse({
      ...recording,
      route: "/users/:id",
      revision: 4,
      updatedAt: "2026-08-24T00:01:00.000Z",
    });
    http.currentSnapshot = boundedSnapshot(12);
    http.listItems = [
      recordingSummaryAt({
        endpoint: remote.route,
        contentRevision: remote.revision,
        updatedAt: remote.updatedAt,
      }),
    ];
    http.recordingResult = remote;
    await realtime.emit(connectedEvent(12));

    await vi.waitFor(() => expect(controller.document.getSnapshot().recording?.revision).toBe(remote.revision));
    expect(controller.documentBuffer.readText()).toContain('"route": "/users/:id"');
    expect(controller.documentBuffer.getSnapshot().dirty).toBe(false);
    controller.stop();
  });

  it("uploads a replacement request body without exposing a client-controlled fingerprint", async () => {
    const http = new FakeHttp();
    const { controller, realtime } = controllerWith(http);
    await realtime.emit(connectedEvent());
    await vi.waitFor(() => expect(controller.recordings.getSnapshot().status).toBe("ready"));
    controller.openRecording(ids.recording);
    await vi.waitFor(() => expect(controller.document.getSnapshot().phase).toBe("ready"));
    const loadedDraft = JSON.parse(controller.documentBuffer.readText()) as {
      request: { headers: Array<[string, string]> };
    };
    loadedDraft.request.headers = [
      ["Content-Type", "text/plain"],
      ["content-encoding", "gzip"],
      ["Content-Length", "999"],
      ["x-trace", "keep"],
    ];
    controller.documentBuffer.replaceDraft(JSON.stringify(loadedDraft));
    http.uploadBody.mockResolvedValueOnce(
      BodyRefSchema.parse({
        sha256: "f".repeat(64),
        size: 11,
        mediaType: "application/json",
        contentEncoding: "br",
      }),
    );

    await controller.uploadDocumentBody(
      "request",
      new File(['{"value":2}'], "request.json", { type: "application/json" }),
    );
    const edited = JSON.parse(controller.documentBuffer.readText()) as Record<string, unknown>;
    expect(edited).not.toHaveProperty("requestFingerprint");
    expect(edited).toMatchObject({
      request: {
        body: { sha256: "f".repeat(64), size: 11 },
        headers: [
          ["x-trace", "keep"],
          ["content-type", "application/json"],
          ["content-encoding", "br"],
          ["content-length", "11"],
        ],
      },
    });

    http.command.mockResolvedValueOnce({
      revision: RevisionSchema.parse(11),
      scenarioRevision: RevisionSchema.parse(6),
      recording: RecordingSchema.parse({
        ...recording,
        requestFingerprint: "b".repeat(64),
        request: { ...recording.request, body: (edited.request as { body: BodyRef }).body },
        revision: 4,
      }),
    } as never);
    await controller.saveDocument();
    expect(http.command).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "recording.update",
        recording: expect.not.objectContaining({ requestFingerprint: expect.anything() }),
      }),
      expect.objectContaining({ signal: expect.any(Object) }),
    );
    controller.stop();
  });

  it("keeps a dirty draft when an older save settles after a dismissed remote-update conflict", async () => {
    const http = new FakeHttp();
    const { controller, realtime } = controllerWith(http);
    await realtime.emit(connectedEvent());
    await vi.waitFor(() => expect(controller.recordings.getSnapshot().status).toBe("ready"));
    controller.openRecording(ids.recording);
    await vi.waitFor(() => expect(controller.document.getSnapshot().phase).toBe("ready"));
    controller.documentBuffer.replaceDraft(
      JSON.stringify({
        route: "/local-draft",
        method: recording.method,
        request: recording.request,
        response: recording.response,
      }),
    );

    const saveResponse = deferred<unknown>();
    http.command.mockImplementationOnce(async () => saveResponse.promise as never);
    const saving = controller.saveDocument();
    await vi.waitFor(() => expect(controller.operation.getSnapshot().pending).toBe(true));

    const remote = RecordingSchema.parse({
      ...recording,
      route: "/remote-version",
      revision: 5,
      updatedAt: "2026-08-24T00:02:00.000Z",
    });
    const remoteSummary = recordingSummaryAt({
      endpoint: remote.route,
      contentRevision: remote.revision,
      updatedAt: remote.updatedAt,
    });
    http.pageScenarioRevision = RevisionSchema.parse(7);
    http.listItems = [remoteSummary];
    http.recordingResult = remote;
    await realtime.emit(
      eventAt(11, {
        type: "recording.upserted",
        payload: { recording: remoteSummary, scenarioRevision: RevisionSchema.parse(7) },
      }),
    );
    expect(controller.document.getSnapshot()).toMatchObject({
      conflict: { kind: "updated", remoteRevision: RevisionSchema.parse(5) },
      observedContentRevision: RevisionSchema.parse(5),
    });
    controller.keepConflictedDraft();
    expect(controller.document.getSnapshot().conflict).toEqual({
      kind: "updated",
      remoteRevision: RevisionSchema.parse(5),
    });

    saveResponse.resolve({
      revision: RevisionSchema.parse(10),
      scenarioRevision: RevisionSchema.parse(6),
      recording: RecordingSchema.parse({ ...recording, route: "/local-draft", revision: 4 }),
    });
    await saving;

    expect(controller.documentBuffer.getSnapshot().dirty).toBe(true);
    expect(controller.document.getSnapshot()).toMatchObject({
      recording: { revision: RevisionSchema.parse(3) },
      observedContentRevision: RevisionSchema.parse(5),
      saving: false,
      conflict: { kind: "updated", remoteRevision: RevisionSchema.parse(5) },
    });
    expect(controller.recordings.getSnapshot().items[0]).toMatchObject({ contentRevision: RevisionSchema.parse(5) });

    controller.keepConflictedDraft();
    expect(controller.document.getSnapshot().conflict).toBeNull();
    const saved = RecordingSchema.parse({ ...recording, route: "/local-draft", revision: 6 });
    http.command.mockResolvedValueOnce({
      revision: RevisionSchema.parse(11),
      scenarioRevision: RevisionSchema.parse(8),
      recording: saved,
    } as never);
    await controller.saveDocument();

    expect(http.command).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: "recording.update",
        expectedScenarioRevision: RevisionSchema.parse(7),
        expectedContentRevision: RevisionSchema.parse(5),
        recording: expect.objectContaining({ route: "/local-draft" }),
      }),
      expect.objectContaining({ signal: expect.any(Object) }),
    );
    expect(controller.documentBuffer.getSnapshot().dirty).toBe(false);
    expect(controller.document.getSnapshot().recording?.revision).toBe(6);
    controller.stop();
  });

  it("rebases an uploaded body onto edits made while the upload is in flight", async () => {
    const http = new FakeHttp();
    const uploaded = deferred<BodyRef>();
    http.uploadBody.mockImplementationOnce(async () => uploaded.promise);
    const { controller, realtime } = controllerWith(http);
    await realtime.emit(connectedEvent());
    await vi.waitFor(() => expect(controller.recordings.getSnapshot().status).toBe("ready"));
    controller.openRecording(ids.recording);
    await vi.waitFor(() => expect(controller.document.getSnapshot().phase).toBe("ready"));

    const upload = controller.uploadDocumentBody(
      "request",
      new File(["new body"], "request.txt", { type: "text/plain" }),
    );
    await vi.waitFor(() => expect(controller.operation.getSnapshot().pending).toBe(true));
    const latestDraft = JSON.parse(controller.documentBuffer.readText()) as {
      route: string;
      request: { headers: Array<[string, string]> };
    };
    latestDraft.route = "/users/:id";
    latestDraft.request.headers = [["x-edited-during-upload", "preserved"]];
    controller.documentBuffer.replaceDraft(JSON.stringify(latestDraft));

    uploaded.resolve(
      BodyRefSchema.parse({
        sha256: "f".repeat(64),
        size: 8,
        mediaType: "text/plain",
        contentEncoding: null,
      }),
    );
    await upload;

    expect(JSON.parse(controller.documentBuffer.readText())).toMatchObject({
      route: "/users/:id",
      request: {
        body: { sha256: "f".repeat(64), size: 8 },
        headers: [
          ["x-edited-during-upload", "preserved"],
          ["content-type", "text/plain"],
          ["content-length", "8"],
        ],
      },
    });
    controller.stop();
  });

  it("does not apply an uploaded body after the active recording changes", async () => {
    const http = new FakeHttp();
    const uploaded = deferred<BodyRef>();
    http.uploadBody.mockImplementationOnce(async () => uploaded.promise);
    const { controller, realtime } = controllerWith(http);
    await realtime.emit(connectedEvent());
    await vi.waitFor(() => expect(controller.recordings.getSnapshot().status).toBe("ready"));
    controller.openRecording(ids.recording);
    await vi.waitFor(() => expect(controller.document.getSnapshot().phase).toBe("ready"));

    const upload = controller.uploadDocumentBody(
      "response",
      new File(["new body"], "response.txt", { type: "text/plain" }),
    );
    await vi.waitFor(() => expect(controller.operation.getSnapshot().pending).toBe(true));
    const otherRecording = RecordingSchema.parse({
      ...recording,
      id: ids.otherRecording,
      filename: "other.json",
      route: "/other",
      requestFingerprint: "b".repeat(64),
    });
    http.recordingResult = otherRecording;
    controller.openRecording(ids.otherRecording);
    await vi.waitFor(() => expect(controller.document.getSnapshot().recordingId).toBe(ids.otherRecording));
    await vi.waitFor(() => expect(controller.document.getSnapshot().phase).toBe("ready"));
    const otherDraft = controller.documentBuffer.readText();

    const rejected = expect(upload).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    uploaded.resolve(
      BodyRefSchema.parse({
        sha256: "f".repeat(64),
        size: 8,
        mediaType: "text/plain",
        contentEncoding: null,
      }),
    );
    await rejected;

    expect(controller.document.getSnapshot().recordingId).toBe(ids.otherRecording);
    expect(controller.documentBuffer.readText()).toBe(otherDraft);
    expect(controller.documentBuffer.readText()).not.toContain("f".repeat(64));
    controller.stop();
  });

  it("resyncs snapshot and paged recordings after a revision conflict", async () => {
    const http = new FakeHttp();
    http.command.mockRejectedValueOnce(new ApiError("Catalog changed", { code: "REVISION_CONFLICT", status: 409 }));
    const { controller, realtime } = controllerWith(http);
    await realtime.emit(connectedEvent());
    await vi.waitFor(() => expect(controller.recordings.getSnapshot().status).toBe("ready"));
    http.snapshot.mockClear();
    http.query.mockClear();

    await expect(controller.setMode("record")).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    expect(http.snapshot).toHaveBeenCalledOnce();
    expect(http.query).toHaveBeenCalledWith(
      expect.objectContaining({ type: "recording.list", scenarioId: ids.scenario }),
      expect.any(Object),
    );
    expect(controller.operation.getSnapshot()).toMatchObject({ pending: false, error: { code: "REVISION_CONFLICT" } });
    controller.stop();
  });

  it("does not report a committed command as failed when only its follow-up resync fails", async () => {
    const http = new FakeHttp();
    const { controller, realtime } = controllerWith(http);
    await realtime.emit(connectedEvent());
    await vi.waitFor(() => expect(controller.recordings.getSnapshot().status).toBe("ready"));
    http.command.mockResolvedValueOnce({ revision: RevisionSchema.parse(11), mode: "record" } as never);
    http.snapshot.mockRejectedValueOnce(
      new ApiError("Snapshot connection failed", { code: "NETWORK_ERROR", retryable: true }),
    );

    await expect(controller.setMode("record")).resolves.toMatchObject({ mode: "record" });

    expect(controller.operation.getSnapshot()).toEqual({ pending: false, label: null, error: null });
    expect(controller.server.getSnapshot()).toMatchObject({
      connection: "reconnecting",
      error: { message: "Snapshot connection failed" },
    });
    expect(realtime.subscriptions).toBe(2);
    controller.stop();
  });

  it("does not duplicate request activity when the stream replays an event", async () => {
    const { controller, realtime } = controllerWith();
    await realtime.emit(connectedEvent());

    const event = completedEvent();
    await realtime.emit(event);
    await realtime.emit(event);

    expect(controller.logs.getSnapshot().entries).toHaveLength(1);
    expect(controller.logs.getSnapshot().entries[0]).toMatchObject({ id: "req_aaaaaaaaaaaaaaaa", kind: "completed" });
    controller.stop();
  });

  it.each([
    [{ state: "saved", recordingId: ids.recording } as const],
    [
      {
        state: "failed",
        problem: { code: "INTERNAL", message: "Recording could not be saved", retryable: false },
      } as const,
    ],
  ])("updates the original pending request when its recording outcome settles", async (recordingOutcome) => {
    const { controller, realtime } = controllerWith();
    await realtime.emit(connectedEvent());
    await realtime.emit(completedEvent());
    expect(controller.logs.getSnapshot().entries[0]?.recordingOutcome).toEqual({ state: "pending" });

    await realtime.emit(recordingOutcomeEvent(recordingOutcome));

    expect(controller.logs.getSnapshot().entries).toHaveLength(1);
    expect(controller.logs.getSnapshot().entries[0]).toMatchObject({
      id: "req_aaaaaaaaaaaaaaaa",
      recordingOutcome,
    });
    controller.stop();
  });

  it("coalesces realtime upserts into one server search so body and header matches stay correct", async () => {
    const http = new FakeHttp();
    const { controller, realtime } = controllerWith(http, { searchEventDebounceMs: 5 });
    await realtime.emit(connectedEvent());
    await vi.waitFor(() => expect(controller.recordings.getSnapshot().status).toBe("ready"));
    controller.setSearchQuery("needle-only-in-body");
    await controller.refreshRecordings("needle-only-in-body");
    expect(controller.recordings.getSnapshot().items.map((recording) => recording.id)).toEqual([ids.recording]);
    http.query.mockClear();
    http.searchItems = [otherRecording];

    await realtime.emit(
      eventAt(11, {
        type: "recording.upserted",
        payload: {
          recording: recordingSummaryAt({ contentRevision: RevisionSchema.parse(4) }),
          scenarioRevision: RevisionSchema.parse(6),
        },
      }),
    );
    http.pageScenarioRevision = RevisionSchema.parse(7);
    await realtime.emit(
      eventAt(12, {
        type: "recording.upserted",
        payload: { recording: otherRecording, scenarioRevision: RevisionSchema.parse(7) },
      }),
    );

    expect(controller.recordings.getSnapshot().items.map((recording) => recording.id)).toEqual([ids.recording]);
    await vi.waitFor(() =>
      expect(controller.recordings.getSnapshot().items.map((recording) => recording.id)).toEqual([ids.otherRecording]),
    );

    const searches = http.query.mock.calls.filter(([input]) => input.type === "recording.search");
    expect(searches).toHaveLength(1);
    expect(searches[0]?.[0]).toMatchObject({ text: "needle-only-in-body", scenarioId: ids.scenario });
    controller.stop();
  });

  it("advances scenario revision from recording events without allowing an older payload to roll it back", async () => {
    const { controller, realtime } = controllerWith();
    await realtime.emit(connectedEvent());
    await vi.waitFor(() => expect(controller.recordings.getSnapshot().status).toBe("ready"));

    await realtime.emit(
      eventAt(11, {
        type: "recording.upserted",
        payload: {
          recording: recordingSummaryAt({ contentRevision: RevisionSchema.parse(4) }),
          scenarioRevision: RevisionSchema.parse(7),
        },
      }),
    );
    expect(controller.recordings.getSnapshot().scenarioRevision).toBe(7);

    controller.recordings.update((state) => ({ ...state, scenarioRevision: RevisionSchema.parse(8) }));
    await realtime.emit(
      eventAt(12, {
        type: "recording.deleted",
        payload: {
          recordingId: ids.recording,
          scenarioId: ids.scenario,
          scenarioRevision: RevisionSchema.parse(7),
        },
      }),
    );

    expect(controller.recordings.getSnapshot().scenarioRevision).toBe(8);
    controller.stop();
  });

  it("does not roll back the list revision when a delete response arrives after a newer event", async () => {
    const http = new FakeHttp();
    const { controller, realtime } = controllerWith(http);
    await realtime.emit(connectedEvent());
    await vi.waitFor(() => expect(controller.recordings.getSnapshot().status).toBe("ready"));

    const deleted = deferred<unknown>();
    http.command.mockImplementationOnce(async () => deleted.promise as never);
    const deleting = controller.deleteRecording(ids.recording);
    await vi.waitFor(() => expect(controller.operation.getSnapshot().pending).toBe(true));
    await realtime.emit(
      eventAt(11, {
        type: "recording.deleted",
        payload: {
          recordingId: ids.recording,
          scenarioId: ids.scenario,
          scenarioRevision: RevisionSchema.parse(6),
        },
      }),
    );
    await realtime.emit(
      eventAt(12, {
        type: "recording.upserted",
        payload: { recording: otherRecording, scenarioRevision: RevisionSchema.parse(7) },
      }),
    );
    http.currentSnapshot = boundedSnapshot(12);
    deleted.resolve({
      revision: RevisionSchema.parse(11),
      scenarioRevision: RevisionSchema.parse(6),
      scenarioId: ids.scenario,
      recordingId: ids.recording,
    });
    await deleting;

    expect(controller.recordings.getSnapshot()).toMatchObject({
      scenarioRevision: RevisionSchema.parse(7),
      items: [expect.objectContaining({ id: ids.otherRecording })],
    });
    controller.stop();
  });

  it("replaces an event-derived scenario revision with the authoritative revision after reconnect", async () => {
    const http = new FakeHttp();
    const { controller, realtime } = controllerWith(http);
    await realtime.emit(connectedEvent());
    await vi.waitFor(() => expect(controller.recordings.getSnapshot().status).toBe("ready"));

    await realtime.emit(
      eventAt(11, {
        type: "recording.upserted",
        payload: {
          recording: recordingSummaryAt({ contentRevision: RevisionSchema.parse(4) }),
          scenarioRevision: RevisionSchema.parse(6),
        },
      }),
    );
    expect(controller.recordings.getSnapshot().scenarioRevision).toBe(6);

    http.currentSnapshot = boundedSnapshot(12);
    http.pageScenarioRevision = RevisionSchema.parse(7);
    await realtime.emit(connectedEvent(12));

    await vi.waitFor(() => expect(controller.recordings.getSnapshot().scenarioRevision).toBe(7));
    controller.stop();
  });

  it.each([
    "save",
    "JSON import",
    "ZIP import",
  ] as const)("re-runs the authoritative server search after a recording %s", async (mutation) => {
    const http = new FakeHttp();
    const { controller, realtime } = controllerWith(http);
    await realtime.emit(connectedEvent());
    await vi.waitFor(() => expect(controller.recordings.getSnapshot().status).toBe("ready"));
    if (mutation === "save") {
      controller.openRecording(ids.recording);
      await vi.waitFor(() => expect(controller.document.getSnapshot().phase).toBe("ready"));
      controller.documentBuffer.replaceDraft(
        JSON.stringify({
          route: recording.route,
          method: recording.method,
          request: recording.request,
          response: recording.response,
        }),
      );
    }
    controller.setSearchQuery("needle-only-in-body");
    await controller.refreshRecordings("needle-only-in-body");
    http.query.mockClear();
    http.searchItems = [];
    http.pageScenarioRevision = RevisionSchema.parse(6);
    http.command.mockResolvedValueOnce({
      revision: RevisionSchema.parse(11),
      scenarioRevision: RevisionSchema.parse(6),
      recording: RecordingSchema.parse({ ...recording, revision: 4 }),
    } as never);

    if (mutation === "save") await controller.saveDocument();
    else if (mutation === "JSON import") {
      await controller.uploadRecording(
        new File([JSON.stringify(recording)], "recording.json", { type: "application/json" }),
      );
    } else {
      await controller.importRecordingArchive(new File(["zip"], "recording.zip", { type: "application/zip" }));
    }

    const searches = http.query.mock.calls.filter(([input]) => input.type === "recording.search");
    expect(searches).toHaveLength(1);
    expect(searches[0]?.[0]).toMatchObject({ text: "needle-only-in-body", scenarioId: ids.scenario });
    expect(controller.recordings.getSnapshot().items).toEqual([]);
    controller.stop();
  });

  it("refreshes the active page when an aggregate event invalidates recording metadata", async () => {
    const http = new FakeHttp();
    const { controller, realtime } = controllerWith(http);
    await realtime.emit(connectedEvent());
    await vi.waitFor(() => expect(controller.recordings.getSnapshot().status).toBe("ready"));
    http.listItems = [];
    http.query.mockClear();

    await realtime.emit(
      eventAt(11, {
        type: "scenario.upserted",
        payload: {
          scenario: { id: ids.scenario, folderId: ids.folder, name: "Scenario" },
          recordingsInvalidated: true,
        },
      }),
    );

    await vi.waitFor(() => expect(controller.recordings.getSnapshot().items).toEqual([]));
    expect(http.query).toHaveBeenCalledWith(
      expect.objectContaining({ type: "recording.list", scenarioId: ids.scenario }),
      expect.any(Object),
    );
    controller.stop();
  });

  it("opens the confirmed recording only after its deferred read succeeds", async () => {
    const http = new FakeHttp();
    const { controller, realtime } = controllerWith(http);
    await realtime.emit(connectedEvent());
    await vi.waitFor(() => expect(controller.recordings.getSnapshot().status).toBe("ready"));
    controller.openRecording(ids.recording);
    await vi.waitFor(() => expect(controller.document.getSnapshot().phase).toBe("ready"));
    controller.documentBuffer.replaceDraft(
      JSON.stringify({
        route: "/unsaved-a",
        method: recording.method,
        request: recording.request,
        response: recording.response,
      }),
    );

    const selected = RecordingSchema.parse({
      ...recording,
      id: ids.otherRecording,
      filename: "other.json",
      route: "/recording-b",
      requestFingerprint: "b".repeat(64),
      revision: 4,
    });
    controller.openRecording(ids.otherRecording);
    expect(controller.document.getSnapshot()).toMatchObject({
      recordingId: ids.recording,
      pendingRecordingId: ids.otherRecording,
    });

    const response = deferred<unknown>();
    http.query.mockImplementationOnce(async (input) => {
      expect(input).toMatchObject({
        type: "recording.get",
        scenarioId: ids.scenario,
        recordingId: ids.otherRecording,
      });
      return response.promise as never;
    });
    const opening = controller.confirmDiscardAndOpen();
    await vi.waitFor(() => expect(controller.operation.getSnapshot().pending).toBe(true));
    expect(controller.documentBuffer.readText()).toContain("/unsaved-a");

    response.resolve({
      revision: RevisionSchema.parse(10),
      scenarioRevision: RevisionSchema.parse(5),
      recording: selected,
    });
    await opening;

    expect(controller.document.getSnapshot()).toMatchObject({
      recordingId: ids.otherRecording,
      pendingRecordingId: null,
      phase: "ready",
      recording: { route: "/recording-b" },
    });
    expect(controller.documentBuffer.getSnapshot().dirty).toBe(false);
    expect(controller.documentBuffer.readText()).toContain("/recording-b");
    expect(controller.documentBuffer.readText()).not.toContain("/unsaved-a");
    controller.stop();
  });

  it("requires explicit discard before changing scenarios with a dirty draft", async () => {
    const { controller, realtime, http } = controllerWith();
    await realtime.emit(connectedEvent());
    await vi.waitFor(() => expect(controller.recordings.getSnapshot().status).toBe("ready"));
    controller.openRecording(ids.recording);
    await vi.waitFor(() => expect(controller.document.getSnapshot().phase).toBe("ready"));
    controller.markDocumentChanged();
    http.command.mockClear();

    await controller.selectScenario(ids.otherScenario);

    expect(controller.document.getSnapshot().pendingScenarioId).toBe(ids.otherScenario);
    expect(controller.documentBuffer.getSnapshot().dirty).toBe(true);
    expect(http.command).not.toHaveBeenCalled();

    await controller.confirmDiscardAndSelectScenario();

    expect(controller.documentBuffer.getSnapshot().dirty).toBe(false);
    expect(controller.document.getSnapshot().recordingId).toBeNull();
    expect(http.command).toHaveBeenCalledWith(
      expect.objectContaining({ type: "scenario.select", scenarioId: ids.otherScenario }),
      expect.objectContaining({ signal: expect.any(Object) }),
    );
    controller.stop();
  });

  it("discards the confirmed draft when the scenario command response arrives before its events", async () => {
    const http = new FakeHttp();
    const { controller, realtime } = controllerWith(http);
    await realtime.emit(connectedEvent());
    await vi.waitFor(() => expect(controller.recordings.getSnapshot().status).toBe("ready"));
    controller.openRecording(ids.recording);
    await vi.waitFor(() => expect(controller.document.getSnapshot().phase).toBe("ready"));
    controller.markDocumentChanged();
    await controller.selectScenario(ids.otherScenario);

    const response = deferred<unknown>();
    http.command.mockImplementationOnce(async () => response.promise as never);
    const switching = controller.confirmDiscardAndSelectScenario();
    await vi.waitFor(() => expect(controller.operation.getSnapshot().pending).toBe(true));
    const nextSnapshot = boundedSnapshot(12);
    http.currentSnapshot = parseServerSnapshot({
      ...nextSnapshot,
      currentScenarioId: ids.otherScenario,
      scenarios: {
        ...nextSnapshot.scenarios,
        [ids.otherScenario]: { id: ids.otherScenario, folderId: ids.folder, name: "Other Scenario" },
      },
    });
    http.pageScenarioRevision = RevisionSchema.parse(0);
    http.listItems = [];

    response.resolve({ revision: RevisionSchema.parse(12), currentScenarioId: ids.otherScenario });
    await switching;
    expect(controller.documentBuffer.getSnapshot().dirty).toBe(false);
    expect(controller.document.getSnapshot().recordingId).toBeNull();
    expect(controller.server.getSnapshot().realtime.snapshot?.currentScenarioId).toBe(ids.otherScenario);

    await realtime.emit(
      eventAt(11, {
        type: "scenario.upserted",
        payload: {
          scenario: { id: ids.otherScenario, folderId: ids.folder, name: "Other Scenario" },
        },
      }),
    );
    await realtime.emit(eventAt(12, { type: "scenario.current-changed", payload: { scenarioId: ids.otherScenario } }));
    expect(controller.documentBuffer.getSnapshot().dirty).toBe(false);
    expect(controller.document.getSnapshot().recordingId).toBeNull();
    controller.stop();
  });

  it("discards the confirmed draft when the scenario event arrives before the command response", async () => {
    const http = new FakeHttp();
    const { controller, realtime } = controllerWith(http);
    await realtime.emit(connectedEvent());
    await vi.waitFor(() => expect(controller.recordings.getSnapshot().status).toBe("ready"));
    controller.openRecording(ids.recording);
    await vi.waitFor(() => expect(controller.document.getSnapshot().phase).toBe("ready"));
    controller.markDocumentChanged();
    await controller.selectScenario(ids.otherScenario);

    const response = deferred<unknown>();
    http.command.mockImplementationOnce(async () => response.promise as never);
    const switching = controller.confirmDiscardAndSelectScenario();
    await vi.waitFor(() => expect(controller.operation.getSnapshot().pending).toBe(true));
    const nextSnapshot = boundedSnapshot(12);
    http.currentSnapshot = parseServerSnapshot({
      ...nextSnapshot,
      currentScenarioId: ids.otherScenario,
      scenarios: {
        ...nextSnapshot.scenarios,
        [ids.otherScenario]: { id: ids.otherScenario, folderId: ids.folder, name: "Other Scenario" },
      },
    });
    http.pageScenarioRevision = RevisionSchema.parse(0);
    http.listItems = [];
    await realtime.emit(
      eventAt(11, {
        type: "scenario.upserted",
        payload: {
          scenario: { id: ids.otherScenario, folderId: ids.folder, name: "Other Scenario" },
        },
      }),
    );
    await realtime.emit(eventAt(12, { type: "scenario.current-changed", payload: { scenarioId: ids.otherScenario } }));
    expect(controller.documentBuffer.getSnapshot().dirty).toBe(true);
    expect(controller.document.getSnapshot().pendingScenarioId).toBeNull();

    response.resolve({ revision: RevisionSchema.parse(12), currentScenarioId: ids.otherScenario });
    await switching;

    expect(controller.documentBuffer.getSnapshot().dirty).toBe(false);
    expect(controller.document.getSnapshot().recordingId).toBeNull();
    controller.stop();
  });

  it("preserves a dirty draft when discard confirmation is rejected by another pending operation", async () => {
    const http = new FakeHttp();
    const { controller, realtime } = controllerWith(http);
    await realtime.emit(connectedEvent());
    await vi.waitFor(() => expect(controller.recordings.getSnapshot().status).toBe("ready"));
    controller.openRecording(ids.recording);
    await vi.waitFor(() => expect(controller.document.getSnapshot().phase).toBe("ready"));
    controller.markDocumentChanged();

    const saveResponse = deferred<unknown>();
    http.command.mockImplementationOnce(async () => saveResponse.promise as never);
    const saving = controller.saveDocument();
    await vi.waitFor(() => expect(controller.operation.getSnapshot().pending).toBe(true));
    await controller.selectScenario(ids.otherScenario);

    await expect(controller.confirmDiscardAndSelectScenario()).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(controller.documentBuffer.getSnapshot().dirty).toBe(true);
    expect(controller.document.getSnapshot()).toMatchObject({
      recordingId: ids.recording,
      pendingScenarioId: ids.otherScenario,
    });

    saveResponse.resolve({
      revision: RevisionSchema.parse(11),
      scenarioRevision: RevisionSchema.parse(6),
      recording: RecordingSchema.parse({ ...recording, revision: 4 }),
    });
    await saving;
    controller.stop();
  });

  it("preserves a dirty draft when another client changes the active scenario", async () => {
    const { controller, realtime } = controllerWith();
    await realtime.emit(connectedEvent());
    await vi.waitFor(() => expect(controller.recordings.getSnapshot().status).toBe("ready"));
    controller.openRecording(ids.recording);
    await vi.waitFor(() => expect(controller.document.getSnapshot().phase).toBe("ready"));
    controller.markDocumentChanged();

    await realtime.emit(
      eventAt(11, {
        type: "scenario.upserted",
        payload: {
          scenario: { id: ids.otherScenario, folderId: ids.folder, name: "Other Scenario" },
        },
      }),
    );
    await realtime.emit(eventAt(12, { type: "scenario.current-changed", payload: { scenarioId: ids.otherScenario } }));

    expect(controller.documentBuffer.getSnapshot().dirty).toBe(true);
    expect(controller.document.getSnapshot()).toMatchObject({
      recordingId: ids.recording,
      conflict: { kind: "scenario-changed", scenarioId: ids.scenario },
    });
    expect(controller.view.getSnapshot().selectedRecordingId).toBeNull();
    controller.stop();
  });

  it("prompts for a rejected control token and reconnects after it is replaced", async () => {
    const { controller, realtime } = controllerWith();
    const token = "replacement-control-token";

    realtime.fail(new ApiError("A valid control token is required", { code: "UNAUTHORIZED", status: 401 }));
    expect(controller.auth.getSnapshot()).toMatchObject({ hasToken: false, required: true });

    controller.updateControlToken(token);

    expect(controller.auth.getSnapshot()).toMatchObject({ hasToken: true, required: false });
    expect(realtime.subscriptions).toBe(2);
    expect(JSON.stringify(controller.auth.getSnapshot())).not.toContain(token);
    controller.stop();
  });

  it("invalidates an operation that settles after the control-token session changes", async () => {
    const http = new FakeHttp();
    let finishCommand: (() => void) | undefined;
    http.command.mockImplementationOnce(
      async () =>
        new Promise((resolve) => {
          finishCommand = () => resolve({ revision: RevisionSchema.parse(11), mode: "record" });
        }),
    );
    const { controller, realtime } = controllerWith(http);
    await realtime.emit(connectedEvent());
    await vi.waitFor(() => expect(controller.recordings.getSnapshot().status).toBe("ready"));
    http.snapshot.mockClear();

    const oldOperation = controller.setMode("record");
    await vi.waitFor(() => expect(controller.operation.getSnapshot().pending).toBe(true));
    const commandCalls = http.command.mock.calls as unknown as Array<[unknown, { signal?: AbortSignal }]>;
    const oldSignal = commandCalls[0]?.[1].signal;
    expect(oldSignal?.aborted).toBe(false);
    controller.updateControlToken("replacement-control-token");
    expect(oldSignal?.aborted).toBe(true);
    await realtime.emit(connectedEvent(11));
    finishCommand?.();

    await expect(oldOperation).rejects.toMatchObject({ code: "ABORTED" });
    expect(controller.operation.getSnapshot()).toEqual({ pending: false, label: null, error: null });
    expect(controller.auth.getSnapshot()).toEqual({ hasToken: true, required: false });
    expect(controller.server.getSnapshot().realtime.snapshot?.revision).toBe(11);
    expect(http.snapshot).not.toHaveBeenCalled();
    controller.stop();
  });

  it("uses a native capability ticket for body downloads regardless of control-token state", async () => {
    const ref = BodyRefSchema.parse({
      sha256: "e".repeat(64),
      size: 3,
      mediaType: "application/octet-stream",
      contentEncoding: null,
    });
    const unsafeFilename = `../${"x".repeat(252)}`;
    const withBody = RecordingSchema.parse({
      ...recording,
      filename: unsafeFilename,
      response: { ...recording.response, body: ref },
    });
    const http = new FakeHttp();
    const downloads = {
      ticket: vi.fn(),
    } satisfies BrowserDownloadPort;
    const controller = new V2AppController({
      http: http as unknown as V2HttpClient,
      realtime: new FakeRealtime() as unknown as V2RealtimeClient,
      downloads,
    });
    controller.document.set({
      ...createRecordingDocumentState(),
      recordingId: withBody.id,
      phase: "ready",
      recording: withBody,
    });
    controller.documentBuffer.load(
      JSON.stringify({
        route: withBody.route,
        method: withBody.method,
        request: withBody.request,
        response: withBody.response,
      }),
    );

    controller.auth.setToken("protected-download-token");
    await controller.downloadDocumentBody("response");
    expect(http.query).toHaveBeenLastCalledWith(
      {
        protocolVersion: 2,
        type: "body.download",
        body: ref,
        filename: `.._${"x".repeat(238)}.response.body`,
      },
      expect.objectContaining({ signal: expect.any(Object) }),
    );
    expect(downloads.ticket).toHaveBeenLastCalledWith(bodyDownload);

    controller.auth.clearToken();
    await controller.downloadDocumentBody("response");
    expect(downloads.ticket).toHaveBeenCalledTimes(2);
    expect(downloads.ticket).toHaveBeenLastCalledWith(bodyDownload);
  });

  it("passes a 65 MiB protected folder export directly to the native capability path", async () => {
    const http = new FakeHttp();
    const downloads = {
      ticket: vi.fn(),
    } satisfies BrowserDownloadPort;
    const controller = new V2AppController({
      http: http as unknown as V2HttpClient,
      realtime: new FakeRealtime() as unknown as V2RealtimeClient,
      downloads,
    });
    controller.auth.setToken("protected-export-token");

    await controller.exportFolder(ids.folder);

    expect(http.query).toHaveBeenCalledWith(
      {
        protocolVersion: 2,
        type: "folder.export",
        folderId: ids.folder,
      },
      expect.objectContaining({ signal: expect.any(Object) }),
    );
    expect(downloads.ticket).toHaveBeenCalledWith(folderDownload);
  });

  it("exports an individual recording through its server-issued ZIP ticket", async () => {
    const http = new FakeHttp();
    const downloads = { ticket: vi.fn() } satisfies BrowserDownloadPort;
    const controller = new V2AppController({
      http: http as unknown as V2HttpClient,
      realtime: new FakeRealtime() as unknown as V2RealtimeClient,
      downloads,
    });
    controller.recordings.set({
      ...createRecordingListState(),
      scenarioId: ids.scenario,
      scenarioRevision: RevisionSchema.parse(5),
      status: "ready",
      items: [recordingSummaryAt()],
    });

    await controller.downloadRecording(ids.recording);

    expect(http.query).toHaveBeenCalledWith(
      {
        protocolVersion: 2,
        type: "recording.export",
        scenarioId: ids.scenario,
        recordingId: ids.recording,
      },
      expect.objectContaining({ signal: expect.any(Object) }),
    );
    expect(downloads.ticket).toHaveBeenCalledWith(recordingDownload);
  });

  it("rejects an oversized recording JSON before reading it", async () => {
    const http = new FakeHttp();
    const { controller, realtime } = controllerWith(http);
    await realtime.emit(connectedEvent());
    await vi.waitFor(() => expect(controller.recordings.getSnapshot().status).toBe("ready"));
    http.command.mockClear();
    const text = vi.fn(async () => JSON.stringify(recording));
    const oversized = {
      name: "oversized.json",
      size: MAX_CONTROL_JSON_BYTES + 1,
      text,
    } as unknown as File;

    await expect(controller.uploadRecording(oversized)).rejects.toMatchObject({
      code: "PAYLOAD_LIMIT_EXCEEDED",
      status: 413,
    });

    expect(text).not.toHaveBeenCalled();
    expect(http.command).not.toHaveBeenCalled();
    controller.stop();
  });

  it("does not import JSON into a scenario selected while the file is being read", async () => {
    const http = new FakeHttp();
    const { controller, realtime } = controllerWith(http);
    await realtime.emit(connectedEvent());
    await vi.waitFor(() => expect(controller.recordings.getSnapshot().status).toBe("ready"));
    http.command.mockClear();
    const contents = deferred<string>();
    const text = vi.fn(async () => contents.promise);
    const file = { name: "recording.json", size: 1, text } as unknown as File;

    const importing = controller.uploadRecording(file);
    await vi.waitFor(() => expect(controller.operation.getSnapshot().pending).toBe(true));
    const nextSnapshot = boundedSnapshot(12);
    http.currentSnapshot = parseServerSnapshot({
      ...nextSnapshot,
      currentScenarioId: ids.otherScenario,
      scenarios: {
        ...nextSnapshot.scenarios,
        [ids.otherScenario]: { id: ids.otherScenario, folderId: ids.folder, name: "Other Scenario" },
      },
    });
    http.pageScenarioRevision = RevisionSchema.parse(0);
    http.listItems = [];
    await realtime.emit(
      eventAt(11, {
        type: "scenario.upserted",
        payload: {
          scenario: { id: ids.otherScenario, folderId: ids.folder, name: "Other Scenario" },
        },
      }),
    );
    await realtime.emit(eventAt(12, { type: "scenario.current-changed", payload: { scenarioId: ids.otherScenario } }));
    contents.resolve("not parsed after the scenario fence");

    await expect(importing).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    expect(text).toHaveBeenCalledOnce();
    expect(http.command).not.toHaveBeenCalled();
    controller.stop();
  });

  it("invalidates a recording JSON read when the control-token session changes", async () => {
    const http = new FakeHttp();
    const { controller, realtime } = controllerWith(http);
    await realtime.emit(connectedEvent());
    await vi.waitFor(() => expect(controller.recordings.getSnapshot().status).toBe("ready"));
    http.command.mockClear();
    const contents = deferred<string>();
    const text = vi.fn(async () => contents.promise);
    const file = { name: "recording.json", size: 1, text } as unknown as File;

    const importing = controller.uploadRecording(file);
    await vi.waitFor(() => expect(controller.operation.getSnapshot().pending).toBe(true));
    controller.updateControlToken("replacement-control-token");
    contents.resolve("not parsed after the token fence");

    await expect(importing).rejects.toMatchObject({ code: "ABORTED" });
    expect(text).toHaveBeenCalledOnce();
    expect(http.command).not.toHaveBeenCalled();
    controller.stop();
  });

  it("stages a recording ZIP and commits it with the selected scenario revision", async () => {
    const http = new FakeHttp();
    http.command.mockResolvedValueOnce({
      revision: RevisionSchema.parse(11),
      scenarioRevision: RevisionSchema.parse(6),
      recording,
    } as never);
    const { controller, realtime } = controllerWith(http);
    await realtime.emit(connectedEvent());
    await vi.waitFor(() => expect(controller.recordings.getSnapshot().status).toBe("ready"));
    controller.recordings.update((state) => ({ ...state, items: [] }));
    const archive = new File(["zip"], "recording.zip", { type: "application/zip" });

    await controller.importRecordingArchive(archive);

    expect(http.stageRecordingImport).toHaveBeenCalledWith(
      archive,
      {
        filename: "recording.zip",
        mediaType: "application/zip",
      },
      expect.objectContaining({ signal: expect.any(Object) }),
    );
    expect(http.command).toHaveBeenCalledWith(
      {
        protocolVersion: 2,
        commandId: "cmd_aaaaaaaaaaaaaaaa",
        type: "recording.import",
        scenarioId: ids.scenario,
        expectedScenarioRevision: RevisionSchema.parse(5),
        transferId,
      },
      expect.objectContaining({ signal: expect.any(Object) }),
    );
    expect(controller.recordings.getSnapshot()).toMatchObject({
      scenarioRevision: RevisionSchema.parse(6),
      items: [expect.objectContaining({ id: ids.recording })],
    });
    controller.stop();
  });

  it("does not import a staged recording ZIP after the selected scenario changes", async () => {
    const http = new FakeHttp();
    const staged = deferred<unknown>();
    http.stageRecordingImport.mockImplementationOnce(async () => staged.promise as never);
    const { controller, realtime } = controllerWith(http);
    await realtime.emit(connectedEvent());
    await vi.waitFor(() => expect(controller.recordings.getSnapshot().status).toBe("ready"));
    http.command.mockClear();

    const importing = controller.importRecordingArchive(
      new File(["zip"], "recording.zip", { type: "application/zip" }),
    );
    await vi.waitFor(() => expect(controller.operation.getSnapshot().pending).toBe(true));
    const nextSnapshot = boundedSnapshot(12);
    http.currentSnapshot = parseServerSnapshot({
      ...nextSnapshot,
      currentScenarioId: ids.otherScenario,
      scenarios: {
        ...nextSnapshot.scenarios,
        [ids.otherScenario]: { id: ids.otherScenario, folderId: ids.folder, name: "Other Scenario" },
      },
    });
    http.pageScenarioRevision = RevisionSchema.parse(0);
    http.listItems = [];
    await realtime.emit(
      eventAt(11, {
        type: "scenario.upserted",
        payload: {
          scenario: { id: ids.otherScenario, folderId: ids.folder, name: "Other Scenario" },
        },
      }),
    );
    await realtime.emit(eventAt(12, { type: "scenario.current-changed", payload: { scenarioId: ids.otherScenario } }));
    staged.resolve({
      transferId,
      filename: "recording.zip",
      size: 3,
      sha256: "d".repeat(64),
    });

    await expect(importing).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    expect(http.command).not.toHaveBeenCalled();
    controller.stop();
  });
});
