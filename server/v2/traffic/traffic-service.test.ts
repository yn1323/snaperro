import { describe, expect, it, vi } from "vitest";
import type { Recording } from "../../../shared/contracts-v2/entities.js";
import { CatalogSnapshotSchema } from "../../../shared/contracts-v2/entities.js";
import type { EventDraft } from "../../../shared/contracts-v2/events.js";
import {
  FolderIdSchema,
  RecordingIdSchema,
  RequestIdSchema,
  RuntimeIdSchema,
  ScenarioIdSchema,
  V2_SCHEMA_VERSION,
} from "../../../shared/contracts-v2/primitives.js";
import type {
  CatalogRepositoryPort,
  ClockPort,
  EventHubPort,
  IdGeneratorPort,
  LoggerPort,
} from "../application/ports.js";
import { compileConfigV2, type V2Mode } from "../config/config.js";
import { EntityNotFoundError, StoreLockedError } from "../domain/errors.js";
import type { PreparedTrafficRequest } from "./prepared-request.js";
import type { IncomingTrafficRequest, TrafficResponse } from "./proxy-service.js";
import type { RecordCaptureState } from "./record-service.js";
import { TrafficService } from "./traffic-service.js";

const folderId = FolderIdSchema.parse("fld_0123456789abcdef");
const scenarioId = ScenarioIdSchema.parse("scn_0123456789abcdef");
const recordingId = RecordingIdSchema.parse("rec_0123456789abcdef");
const requestId = RequestIdSchema.parse("req_0123456789abcdef");
const runtimeId = RuntimeIdSchema.parse("run_0123456789abcdef");
const timestamp = "2026-08-24T00:00:00.000Z";

function catalog(mode: V2Mode) {
  return CatalogSnapshotSchema.parse({
    schemaVersion: V2_SCHEMA_VERSION,
    revision: 2,
    mode,
    currentScenarioId: scenarioId,
    folders: [{ id: folderId, name: "Team", revision: 0, createdAt: timestamp, updatedAt: timestamp }],
    scenarios: [
      {
        id: scenarioId,
        folderId,
        name: "Success",
        revision: 0,
        recordingsCount: 0,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
  });
}

function config(fallback: "404" | "proxy" | "proxy&record" = "404") {
  return compileConfigV2(
    {
      configVersion: 2,
      mock: { fallback },
      apis: { jsonPlaceholder: { name: "Users", target: "https://example.com", routes: ["GET /users"] } },
    },
    "/project/snaperro.config.ts",
  );
}

const response: TrafficResponse = { status: 200, statusText: "OK", headers: [], body: null };

const savedCapture = {
  state: "saved",
  scenarioId,
  recording: { id: recordingId } as Recording,
} satisfies RecordCaptureState;

function harness(
  mode: V2Mode,
  fallback: "404" | "proxy" | "proxy&record" = "404",
  mockHit = false,
  capture: RecordCaptureState = savedCapture,
  lifetimeSignal?: AbortSignal,
) {
  const dispose = vi.fn();
  const prepared = {
    fingerprint: "a".repeat(64),
    body: { createWebStream: vi.fn(() => new Blob(["request"]).stream()) },
    dispose,
  } as unknown as PreparedTrafficRequest;
  const proxy = { execute: vi.fn(async () => response) };
  const record = { execute: vi.fn(async () => ({ response, capture })) };
  const mock = {
    find: vi.fn(async () => (mockHit ? ({ response, recording: { id: recordingId }, scenarioId } as never) : null)),
  };
  const publish = vi.fn(async (_event: EventDraft) => ({}) as never);
  const events = {
    publish,
    watermark: () => ({ runtimeId, sequence: 0 as never, revision: 2 as never }),
  } as unknown as EventHubPort;
  const catalogs = { read: vi.fn(async () => catalog(mode)) } as unknown as CatalogRepositoryPort;
  const prepare = vi.fn(async (_request: IncomingTrafficRequest) => prepared);
  const service = new TrafficService({
    config: config(fallback),
    catalogs,
    proxy,
    record,
    mock,
    events,
    ids: { nextRequestId: () => requestId } as unknown as IdGeneratorPort,
    clock: { now: () => timestamp } as ClockPort,
    logger: { error: vi.fn() } as unknown as LoggerPort,
    lifetimeSignal,
    nowMilliseconds: vi.fn().mockReturnValueOnce(10).mockReturnValue(15),
    prepare,
  });
  return { service, catalogs, proxy, record, mock, dispose, publish, prepare };
}

const request = {
  method: "GET",
  url: "http://localhost/users",
  headers: new Headers(),
  body: null,
  signal: new AbortController().signal,
};

describe("TrafficService", () => {
  it("keeps proxy mode on the original stream path without preparing a body", async () => {
    const target = harness("proxy");
    expect(await target.service.execute(request)).toBe(response);
    expect(target.proxy.execute).toHaveBeenCalledWith(request);
    expect(target.dispose).not.toHaveBeenCalled();
  });

  it("uses a mock hit in smart mode and records telemetry", async () => {
    const target = harness("smart", "404", true);
    expect(await target.service.execute(request)).toBe(response);
    expect(target.record.execute).not.toHaveBeenCalled();
    expect(target.dispose).toHaveBeenCalledOnce();
    expect(target.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "request.completed",
        payload: expect.objectContaining({
          action: "smart",
          subAction: "mock",
          status: 200,
          matchedRecordingId: recordingId,
          recordingOutcome: { state: "not-attempted" },
        }),
      }),
    );
    expect(target.publish.mock.calls[0]?.[0].payload).not.toHaveProperty("recordingId");
    expect(target.catalogs.read).toHaveBeenCalledOnce();
    expect(target.mock.find).toHaveBeenCalledWith(expect.anything(), scenarioId, { signal: request.signal });
  });

  it.each([
    ["record", undefined],
    ["smart", "record"],
  ] as const)("reports a completed %s capture as saved without treating it as a mock match", async (mode, subAction) => {
    const target = harness(mode);
    await target.service.execute(request);

    expect(target.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "request.completed",
        payload: expect.objectContaining({
          id: requestId,
          action: mode,
          ...(subAction ? { subAction } : {}),
          recordingOutcome: { state: "saved", recordingId },
        }),
      }),
    );
    expect(target.publish.mock.calls[0]?.[0].payload).not.toHaveProperty("matchedRecordingId");
  });

  it("publishes a correlated outcome after an asynchronous capture succeeds", async () => {
    let resolveCapture!: (recording: Recording) => void;
    const completion = new Promise<Recording>((resolve) => {
      resolveCapture = resolve;
    });
    const target = harness("record", "404", false, { state: "pending", scenarioId, completion });
    const response = await target.service.execute(request);

    expect(target.publish).toHaveBeenCalledTimes(1);
    expect(target.publish.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        type: "request.completed",
        payload: expect.objectContaining({ id: requestId, recordingOutcome: { state: "pending" } }),
      }),
    );

    resolveCapture({ id: recordingId } as Recording);
    await expect(response.generationCompletion).resolves.toBeUndefined();
    await vi.waitFor(() => expect(target.publish).toHaveBeenCalledTimes(2));
    expect(target.publish.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        type: "recording.outcome",
        payload: {
          requestId,
          scenarioId,
          recordingOutcome: { state: "saved", recordingId },
        },
      }),
    );
  });

  it("publishes a correlated safe failure after an asynchronous capture fails", async () => {
    let rejectCapture!: (error: unknown) => void;
    const completion = new Promise<Recording>((_resolve, reject) => {
      rejectCapture = reject;
    });
    const target = harness("record", "404", false, { state: "pending", scenarioId, completion });
    const response = await target.service.execute(request);

    rejectCapture(new Error("database-password=do-not-expose"));
    await expect(response.generationCompletion).resolves.toBeUndefined();
    await vi.waitFor(() => expect(target.publish).toHaveBeenCalledTimes(2));
    expect(target.publish.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        type: "recording.outcome",
        payload: {
          requestId,
          scenarioId,
          recordingOutcome: {
            state: "failed",
            problem: { code: "INTERNAL", message: "An unexpected error occurred", retryable: false },
          },
        },
      }),
    );
  });

  it.each([
    ["proxy", "proxy"],
    ["proxy&record", "record"],
  ] as const)("routes a mock miss through the %s fallback", async (fallback, expected) => {
    const target = harness("mock", fallback);
    await target.service.execute(request);
    expect(target[expected].execute).toHaveBeenCalledOnce();
    expect(target.dispose).toHaveBeenCalledOnce();
  });

  it("returns a typed not-found failure for the 404 mock fallback and still disposes", async () => {
    const target = harness("mock", "404");
    await expect(target.service.execute(request)).rejects.toBeInstanceOf(EntityNotFoundError);
    expect(target.dispose).toHaveBeenCalledOnce();
    expect(target.publish).toHaveBeenCalledWith(
      expect.objectContaining({ payload: expect.objectContaining({ action: "mock", status: 404 }) }),
    );
  });

  it("uses the transport HTTP status when logging a domain failure", async () => {
    const target = harness("record");
    target.record.execute.mockRejectedValueOnce(new StoreLockedError("/store"));

    await expect(target.service.execute(request)).rejects.toBeInstanceOf(StoreLockedError);
    expect(target.publish).toHaveBeenCalledWith(
      expect.objectContaining({ payload: expect.objectContaining({ action: "record", status: 423 }) }),
    );
  });

  it("fails before preparing traffic when the initial catalog has no selected scenario", async () => {
    const target = harness("record");
    vi.mocked(target.catalogs.read).mockResolvedValueOnce(
      CatalogSnapshotSchema.parse({ ...catalog("record"), currentScenarioId: null }),
    );

    await expect(target.service.execute(request)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(target.record.execute).not.toHaveBeenCalled();
    expect(target.dispose).not.toHaveBeenCalled();
  });

  it("propagates generation abort to a request still being prepared", async () => {
    const lifetime = new AbortController();
    const target = harness("record", "404", false, savedCapture, lifetime.signal);
    let markPreparing: (() => void) | undefined;
    const preparing = new Promise<void>((resolve) => {
      markPreparing = resolve;
    });
    target.prepare.mockImplementationOnce(
      (incoming) =>
        new Promise<PreparedTrafficRequest>((_resolve, reject) => {
          markPreparing?.();
          incoming.signal.addEventListener("abort", () => reject(incoming.signal.reason), { once: true });
        }),
    );

    const execution = target.service.execute(request);
    await preparing;
    const reason = new Error("generation retired");
    lifetime.abort(reason);

    await expect(execution).rejects.toBe(reason);
    expect(target.prepare.mock.calls[0]?.[0].signal).not.toBe(request.signal);
  });

  it("propagates generation abort while the catalog adapter is pending", async () => {
    const lifetime = new AbortController();
    const target = harness("record", "404", false, savedCapture, lifetime.signal);
    vi.mocked(target.catalogs.read).mockImplementationOnce(() => new Promise(() => undefined));

    const execution = target.service.execute(request);
    await vi.waitFor(() => expect(target.catalogs.read).toHaveBeenCalledOnce());
    const reason = new Error("generation retired");
    lifetime.abort(reason);

    await expect(execution).rejects.toBe(reason);
    expect(target.prepare).not.toHaveBeenCalled();
  });
});
