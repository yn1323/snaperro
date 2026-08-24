import { describe, expect, it, vi } from "vitest";
import { BodyRefSchema, RecordingSchema, ScenarioManifestSchema } from "../../../shared/contracts-v2/entities.js";
import {
  RecordingIdSchema,
  RequestFingerprintSchema,
  ScenarioIdSchema,
  V2_SCHEMA_VERSION,
} from "../../../shared/contracts-v2/primitives.js";
import type { BlobStorePort, ScenarioManifestRepositoryPort } from "../application/ports.js";
import { OperationAbortedError } from "../domain/errors.js";
import { MockService } from "./mock-service.js";
import type { PreparedTrafficRequest } from "./prepared-request.js";

const scenarioId = ScenarioIdSchema.parse("scn_0123456789abcdef");
const recordingId = RecordingIdSchema.parse("rec_0123456789abcdef");
const fingerprint = RequestFingerprintSchema.parse("a".repeat(64));
const timestamp = "2026-08-24T00:00:00.000Z";
const bodyRef = BodyRefSchema.parse({
  sha256: "b".repeat(64),
  size: 2,
  mediaType: "application/octet-stream",
  contentEncoding: null,
});

function dependencies(matching = true, status = 206) {
  const recording = RecordingSchema.parse({
    id: recordingId,
    scenarioId,
    filename: "users.json",
    revision: 0,
    route: "/users/:id",
    method: "GET",
    requestFingerprint: matching ? fingerprint : "c".repeat(64),
    request: { pathParams: { id: "42" }, query: [], headers: [], body: null },
    response: {
      status,
      statusText: "Partial Content",
      headers: [
        ["content-type", "application/octet-stream"],
        ["transfer-encoding", "chunked"],
      ],
      body: bodyRef,
    },
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  const manifests = {
    read: vi.fn(async () =>
      ScenarioManifestSchema.parse({
        schemaVersion: V2_SCHEMA_VERSION,
        scenarioId,
        revision: 0,
        recordings: [recording],
      }),
    ),
  } as unknown as ScenarioManifestRepositoryPort;
  const blobs = {
    open: vi.fn(async () => new Blob([new Uint8Array([0, 255])]).stream()),
  } as unknown as BlobStorePort;
  return { manifests, blobs };
}

function request(method = "GET"): PreparedTrafficRequest {
  return {
    method: method as never,
    fingerprint,
    incoming: {} as never,
    match: {} as never,
    query: [],
    requestHeaders: [],
    body: {} as never,
    dispose: vi.fn(),
  };
}

describe("MockService", () => {
  it("streams the exact stored body and removes hop-by-hop headers", async () => {
    const deps = dependencies();
    const result = await new MockService(deps.manifests, deps.blobs).find(request(), scenarioId);

    expect(result?.recording.id).toBe(recordingId);
    expect(result?.response.status).toBe(206);
    expect(result?.response.headers).not.toContainEqual(["transfer-encoding", "chunked"]);
    expect(new Uint8Array(await new Response(result?.response.body).arrayBuffer())).toEqual(new Uint8Array([0, 255]));
  });

  it("pins the selected body before opening it and releases the handoff pin afterward", async () => {
    const deps = dependencies();
    let pinned = false;
    const release = vi.fn(async () => {
      pinned = false;
    });
    deps.blobs.pin = vi.fn(async () => {
      pinned = true;
      return { release };
    });
    vi.mocked(deps.blobs.open).mockImplementation(async () => {
      expect(pinned).toBe(true);
      return new Blob([new Uint8Array([0, 255])]).stream();
    });

    const result = await new MockService(deps.manifests, deps.blobs).find(request(), scenarioId);

    expect(result?.response.body).not.toBeNull();
    expect(deps.blobs.pin).toHaveBeenCalledWith(bodyRef, expect.any(Object));
    expect(release).toHaveBeenCalledOnce();
    expect(pinned).toBe(false);
  });

  it("returns the opened body without waiting for handoff-pin cleanup", async () => {
    const deps = dependencies();
    const release = vi.fn(() => new Promise<void>(() => undefined));
    deps.blobs.pin = vi.fn(async () => ({ release }));

    const result = await new MockService(deps.manifests, deps.blobs).find(request(), scenarioId);

    expect(result?.response.body).not.toBeNull();
    expect(release).toHaveBeenCalledOnce();
  });

  it("returns null for a fingerprint miss without opening a body", async () => {
    const deps = dependencies(false);
    expect(await new MockService(deps.manifests, deps.blobs).find(request(), scenarioId)).toBeNull();
    expect(deps.blobs.open).not.toHaveBeenCalled();
  });

  it("does not open a response body for HEAD", async () => {
    const deps = dependencies();
    const result = await new MockService(deps.manifests, deps.blobs).find(request("HEAD"), scenarioId);
    expect(result?.response.body).toBeNull();
    expect(deps.blobs.open).not.toHaveBeenCalled();
  });

  it("does not open a stored body for HTTP 205", async () => {
    const deps = dependencies(true, 205);
    const result = await new MockService(deps.manifests, deps.blobs).find(request(), scenarioId);
    expect(result?.response.body).toBeNull();
    expect(deps.blobs.open).not.toHaveBeenCalled();
  });

  it("aborts a pending body open and cancels a late stream", async () => {
    const deps = dependencies();
    const controller = new AbortController();
    let resolveOpen: ((stream: ReadableStream<Uint8Array>) => void) | undefined;
    deps.blobs.open = vi.fn(
      () =>
        new Promise<ReadableStream<Uint8Array>>((resolve) => {
          resolveOpen = resolve;
        }),
    );
    const finding = new MockService(deps.manifests, deps.blobs).find(request(), scenarioId, {
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(deps.blobs.open).toHaveBeenCalledOnce());
    controller.abort(new Error("generation stopped"));

    await expect(finding).rejects.toBeInstanceOf(OperationAbortedError);

    const cancel = vi.fn(() => new Promise<void>(() => undefined));
    resolveOpen?.(new ReadableStream<Uint8Array>({ cancel }));
    await vi.waitFor(() => expect(cancel).toHaveBeenCalled());
  });
});
