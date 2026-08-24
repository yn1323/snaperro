import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { BodyRefSchema } from "../../../shared/contracts-v2/entities.js";
import { RequestFingerprintSchema, ScenarioIdSchema } from "../../../shared/contracts-v2/primitives.js";
import type { BlobStorePort } from "../application/ports.js";
import { compileConfigV2 } from "../config/config.js";
import { OperationAbortedError } from "../domain/errors.js";
import type { PreparedTrafficRequest } from "./prepared-request.js";
import { type ProxyTrafficPort, RecordService } from "./record-service.js";
import type { RecordingCapturePort } from "./recording-capture.js";

const scenarioId = ScenarioIdSchema.parse("scn_0123456789abcdef");
const fingerprint = RequestFingerprintSchema.parse("a".repeat(64));

function config() {
  return compileConfigV2(
    {
      configVersion: 2,
      recording: { maskRequestHeaders: ["authorization"] },
      apis: {
        jsonPlaceholder: {
          name: "Users",
          target: "https://api.example.com",
          routes: ["POST /users/:id"],
          maskRequestHeaders: ["x-secret"],
        },
      },
    },
    "/project/snaperro.config.ts",
  );
}

function blobStore() {
  const writes: Uint8Array[][] = [];
  const store = {
    beginWrite: vi.fn(async (metadata: { mediaType: string | null; contentEncoding: string | null }) => {
      const chunks: Uint8Array[] = [];
      writes.push(chunks);
      return {
        writable: new WritableStream<Uint8Array>({
          write(chunk) {
            chunks.push(chunk.slice());
          },
        }),
        commit: vi.fn(async () => {
          const bytes = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
          return BodyRefSchema.parse({
            sha256: createHash("sha256").update(bytes).digest("hex"),
            size: bytes.byteLength,
            ...metadata,
          });
        }),
        abort: vi.fn(),
      };
    }),
  } as unknown as BlobStorePort;
  return { store, writes };
}

function prepared(): PreparedTrafficRequest {
  const requestBytes = new TextEncoder().encode('{"name":"Ada"}');
  return {
    method: "POST",
    incoming: {
      method: "POST",
      url: "http://localhost/users/42?expand=team",
      headers: new Headers({
        authorization: "secret",
        "content-type": "application/json",
        "x-secret": "also-secret",
        "x-visible": "visible",
      }),
      body: null,
      signal: new AbortController().signal,
    },
    match: {
      apiKey: "jsonPlaceholder",
      api: config().apis.jsonPlaceholder,
      method: "POST",
      route: "/users/:id",
      pathParams: { id: "42" },
    },
    query: [["expand", "team"]],
    requestHeaders: [
      ["authorization", "secret"],
      ["x-secret", "also-secret"],
      ["x-visible", "visible"],
    ],
    body: {
      size: requestBytes.byteLength,
      createWebStream: () => new Blob([requestBytes]).stream(),
    } as never,
    fingerprint,
    dispose: vi.fn(),
  };
}

describe("RecordService", () => {
  it("streams raw upstream bytes while committing request and response blobs", async () => {
    const blobs = blobStore();
    const capture = { upsert: vi.fn(async () => ({}) as never) } as RecordingCapturePort;
    const proxy = {
      execute: vi.fn(async (request) => {
        expect(new TextDecoder().decode(await new Response(request.body).arrayBuffer())).toBe('{"name":"Ada"}');
        return {
          status: 201,
          statusText: "Created",
          headers: [["content-type", "application/octet-stream"]] as Array<[string, string]>,
          body: new Blob([new Uint8Array([0, 255, 1])]).stream(),
        };
      }),
    };
    const service = new RecordService({
      config: config(),
      blobs: blobs.store,
      capture,
      proxy,
    });

    const result = await service.execute(prepared(), scenarioId);
    expect(result.capture.state).toBe("pending");
    expect(capture.upsert).not.toHaveBeenCalled();
    expect(new Uint8Array(await new Response(result.response.body).arrayBuffer())).toEqual(new Uint8Array([0, 255, 1]));
    if (result.capture.state !== "pending") throw new Error("expected a pending capture");
    await result.capture.completion;

    expect(capture.upsert).toHaveBeenCalledOnce();
    const captured = vi.mocked(capture.upsert).mock.calls[0]?.[0].recording;
    expect(captured.request.headers).toEqual([
      ["authorization", "***"],
      ["x-secret", "***"],
      ["x-visible", "visible"],
    ]);
    expect(captured.request.body?.size).toBe(14);
    expect(captured.response.body?.size).toBe(3);
    expect(Buffer.concat(blobs.writes[1].map((chunk) => Buffer.from(chunk)))).toEqual(Buffer.from([0, 255, 1]));
  });

  it("commits a bodyless response before returning", async () => {
    const blobs = blobStore();
    const capture = { upsert: vi.fn(async () => ({}) as never) } as RecordingCapturePort;
    const service = new RecordService({
      config: config(),
      blobs: blobs.store,
      capture,
      proxy: {
        execute: vi.fn(async () => ({ status: 204, statusText: "No Content", headers: [], body: null })),
      },
    });

    const result = await service.execute(prepared(), scenarioId);
    expect(result.response.body).toBeNull();
    expect(result.capture.state).toBe("saved");
    expect(capture.upsert).toHaveBeenCalledOnce();
    expect(vi.mocked(capture.upsert).mock.calls[0]?.[0].recording.response.body).toBeNull();
  });

  it("drops an invalid upstream body for HTTP 205 before capture and delivery", async () => {
    const blobs = blobStore();
    const capture = { upsert: vi.fn(async () => ({}) as never) } as RecordingCapturePort;
    const cancel = vi.fn(() => new Promise<void>(() => undefined));
    const service = new RecordService({
      config: config(),
      blobs: blobs.store,
      capture,
      proxy: {
        execute: vi.fn(async () => ({
          status: 205,
          statusText: "Reset Content",
          headers: [],
          body: new ReadableStream({ cancel }),
        })),
      },
    });

    const result = await service.execute(prepared(), scenarioId);
    expect(result.response.body).toBeNull();
    expect(result.capture.state).toBe("saved");
    expect(cancel).toHaveBeenCalledOnce();
    expect(vi.mocked(capture.upsert).mock.calls[0]?.[0].recording.response.body).toBeNull();
  });

  it("preserves a bodyless upstream response when capture persistence fails", async () => {
    const blobs = blobStore();
    const captureError = new Error("catalog write failed");
    const capture = { upsert: vi.fn(async () => Promise.reject(captureError)) } as RecordingCapturePort;
    const service = new RecordService({
      config: config(),
      blobs: blobs.store,
      capture,
      proxy: {
        execute: vi.fn(async () => ({ status: 204, statusText: "No Content", headers: [], body: null })),
      },
    });

    const result = await service.execute(prepared(), scenarioId);

    expect(result.response).toMatchObject({ status: 204, statusText: "No Content", body: null });
    expect(result.capture.state).toBe("pending");
    if (result.capture.state !== "pending") throw new Error("expected a failed pending capture");
    await expect(result.capture.completion).rejects.toBe(captureError);
  });

  it("returns the raw upstream stream when response blob setup fails", async () => {
    const blobs = blobStore();
    const beginWrite = vi.mocked(blobs.store.beginWrite);
    const writeImplementation = beginWrite.getMockImplementation();
    if (!writeImplementation) throw new Error("expected a blob writer implementation");
    beginWrite
      .mockImplementationOnce(writeImplementation)
      .mockRejectedValueOnce(new Error("response blob unavailable"));
    const capture = { upsert: vi.fn(async () => ({}) as never) } as RecordingCapturePort;
    const service = new RecordService({
      config: config(),
      blobs: blobs.store,
      capture,
      proxy: {
        execute: vi.fn(async () => ({
          status: 200,
          statusText: "OK",
          headers: [],
          body: new Blob([new Uint8Array([4, 5, 6])]).stream(),
        })),
      },
    });

    const result = await service.execute(prepared(), scenarioId);

    await expect(new Response(result.response.body).arrayBuffer()).resolves.toEqual(new Uint8Array([4, 5, 6]).buffer);
    expect(result.capture.state).toBe("pending");
    if (result.capture.state !== "pending") throw new Error("expected a failed pending capture");
    await expect(result.capture.completion).rejects.toThrow("response blob unavailable");
    expect(capture.upsert).not.toHaveBeenCalled();
  });

  it("still proxies the request when its recording blob cannot be persisted", async () => {
    const blobs = blobStore();
    vi.mocked(blobs.store.beginWrite).mockRejectedValueOnce(new Error("request blob unavailable"));
    const capture = { upsert: vi.fn(async () => ({}) as never) } as RecordingCapturePort;
    const proxy = {
      execute: vi.fn(async (request) => ({
        status: 201,
        statusText: "Created",
        headers: [] as Array<[string, string]>,
        body: new Blob([await new Response(request.body).text()]).stream(),
      })),
    };
    const service = new RecordService({ config: config(), blobs: blobs.store, capture, proxy });

    const result = await service.execute(prepared(), scenarioId);

    expect(await new Response(result.response.body).text()).toBe('{"name":"Ada"}');
    expect(result.capture.state).toBe("pending");
    if (result.capture.state !== "pending") throw new Error("expected a failed pending capture");
    await expect(result.capture.completion).rejects.toThrow("request blob unavailable");
    expect(proxy.execute).toHaveBeenCalledOnce();
    expect(capture.upsert).not.toHaveBeenCalled();
  });

  it("aborts a pending proxy adapter and cancels its late response", async () => {
    const blobs = blobStore();
    const lifetime = new AbortController();
    let resolveProxy: ((response: Awaited<ReturnType<ProxyTrafficPort["execute"]>>) => void) | undefined;
    const proxy = {
      execute: vi.fn(
        () =>
          new Promise<Awaited<ReturnType<ProxyTrafficPort["execute"]>>>((resolve) => {
            resolveProxy = resolve;
          }),
      ),
    };
    const service = new RecordService({
      config: config(),
      blobs: blobs.store,
      capture: { upsert: vi.fn() },
      proxy,
      lifetimeSignal: lifetime.signal,
    });
    const executing = service.execute(prepared(), scenarioId);
    await vi.waitFor(() => expect(proxy.execute).toHaveBeenCalledOnce());
    lifetime.abort(new Error("generation stopped"));

    await expect(executing).rejects.toBeInstanceOf(OperationAbortedError);

    const cancel = vi.fn(() => new Promise<void>(() => undefined));
    resolveProxy?.({ status: 200, statusText: "OK", headers: [], body: new ReadableStream({ cancel }) });
    await vi.waitFor(() => expect(cancel).toHaveBeenCalled());
  });
});
