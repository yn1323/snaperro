import { describe, expect, it, vi } from "vitest";
import { BodyRefSchema } from "../../../shared/contracts-v2/entities.js";
import type { BlobStorePort } from "../application/ports.js";
import { createBodyApi } from "./body-api.js";

const ref = BodyRefSchema.parse({
  sha256: "a".repeat(64),
  size: 4,
  mediaType: "application/octet-stream",
  contentEncoding: null,
});

function blobs(): BlobStorePort {
  const chunks: Uint8Array[] = [];
  return {
    beginWrite: vi.fn(async () => ({
      writable: new WritableStream<Uint8Array>({
        write(chunk) {
          chunks.push(chunk.slice());
        },
      }),
      commit: vi.fn(async () => {
        const size = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
        return BodyRefSchema.parse({ ...ref, size });
      }),
      abort: vi.fn(),
    })),
    open: vi.fn(),
    openByDigest: vi.fn(),
    exists: vi.fn(),
    collectGarbage: vi.fn(),
  } as unknown as BlobStorePort;
}

describe("createBodyApi", () => {
  const garbageCollection = () => ({
    pinPending: vi.fn(async () => undefined),
    schedule: vi.fn(async () => undefined),
  });

  it("does not expose a direct authenticated download route", async () => {
    const store = blobs();
    const response = await createBodyApi({ blobs: store, garbageCollection: garbageCollection() }).request(
      `/bodies/${ref.sha256}`,
    );

    expect(response.status).toBe(404);
    expect(store.openByDigest).not.toHaveBeenCalled();
  });

  it("streams an uploaded body into content-addressed storage", async () => {
    const store = blobs();
    const gc = garbageCollection();
    const response = await createBodyApi({ blobs: store, garbageCollection: gc }).request("/bodies", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"ok":true}',
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ size: 11, mediaType: "application/octet-stream" });
    expect(store.beginWrite).toHaveBeenCalledWith(
      { mediaType: "application/json", contentEncoding: null },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(gc.pinPending).toHaveBeenCalledWith(
      expect.objectContaining({ size: 11 }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(gc.pinPending).toHaveBeenCalledBefore(gc.schedule);
    await vi.waitFor(() => expect(gc.schedule).toHaveBeenCalledOnce());
  });

  it("rejects an oversized upload before creating a blob session", async () => {
    const store = blobs();
    const response = await createBodyApi({
      blobs: store,
      garbageCollection: garbageCollection(),
      maxUploadBytes: 3,
    }).request("/bodies", {
      method: "POST",
      headers: { "content-length": "4" },
      body: "four",
    });

    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ error: { code: "PAYLOAD_LIMIT_EXCEEDED" } });
    expect(store.beginWrite).not.toHaveBeenCalled();
  });

  it.each([
    "-1",
    "1.5",
    "4, 4",
    "9007199254740992",
  ])("rejects invalid declared Content-Length %s before creating a blob session", async (contentLength) => {
    const store = blobs();
    const response = await createBodyApi({
      blobs: store,
      garbageCollection: garbageCollection(),
      maxUploadBytes: 10,
    }).request("/bodies", {
      method: "POST",
      headers: { "content-length": contentLength },
      body: "four",
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "INVALID_ARGUMENT" } });
    expect(store.beginWrite).not.toHaveBeenCalled();
  });

  it("returns an oversized-stream error when storage cleanup never settles", async () => {
    vi.useFakeTimers();
    try {
      let markAbortStarted: (() => void) | undefined;
      const abortStarted = new Promise<void>((resolve) => {
        markAbortStarted = resolve;
      });
      const never = () => new Promise<void>(() => undefined);
      const store = {
        ...blobs(),
        beginWrite: vi.fn(async () => ({
          writable: new WritableStream<Uint8Array>({
            abort() {
              markAbortStarted?.();
              return never();
            },
          }),
          commit: vi.fn(),
          abort: vi.fn(never),
        })),
      } as unknown as BlobStorePort;
      const logger = { error: vi.fn() };
      const responsePromise = createBodyApi({
        blobs: store,
        garbageCollection: garbageCollection(),
        logger,
        maxUploadBytes: 3,
        cleanupTimeoutMs: 25,
      }).request("/bodies", {
        method: "POST",
        body: "four",
      });

      await abortStarted;
      await vi.advanceTimersByTimeAsync(25);
      const response = await responsePromise;

      expect(response.status).toBe(413);
      expect(logger.error).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("aborts a pending blob-session open and cleans a late session", async () => {
    const controller = new AbortController();
    let resolveSession: ((session: Awaited<ReturnType<BlobStorePort["beginWrite"]>>) => void) | undefined;
    const abort = vi.fn(() => new Promise<void>(() => undefined));
    const store = {
      ...blobs(),
      beginWrite: vi.fn(
        () =>
          new Promise<Awaited<ReturnType<BlobStorePort["beginWrite"]>>>((resolve) => {
            resolveSession = resolve;
          }),
      ),
    } as unknown as BlobStorePort;
    const responsePromise = createBodyApi({
      blobs: store,
      garbageCollection: garbageCollection(),
      cleanupTimeoutMs: 25,
    }).request("/bodies", {
      method: "POST",
      body: "body",
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(store.beginWrite).toHaveBeenCalledOnce());
    controller.abort(new Error("client disconnected"));

    const response = await responsePromise;
    expect(response.status).toBe(408);

    resolveSession?.({ writable: new WritableStream<Uint8Array>(), commit: vi.fn(), abort });
    await vi.waitFor(() => expect(abort).toHaveBeenCalled());
  });

  it("aborts a pending storage write without awaiting the sink", async () => {
    const controller = new AbortController();
    let markWriteStarted: (() => void) | undefined;
    const writeStarted = new Promise<void>((resolve) => {
      markWriteStarted = resolve;
    });
    const store = {
      ...blobs(),
      beginWrite: vi.fn(async () => ({
        writable: new WritableStream<Uint8Array>({
          write() {
            markWriteStarted?.();
            return new Promise<void>(() => undefined);
          },
        }),
        commit: vi.fn(),
        abort: vi.fn(async () => undefined),
      })),
    } as unknown as BlobStorePort;
    const responsePromise = createBodyApi({
      blobs: store,
      garbageCollection: garbageCollection(),
      cleanupTimeoutMs: 25,
    }).request("/bodies", {
      method: "POST",
      body: "body",
      signal: controller.signal,
    });
    await writeStarted;
    controller.abort(new Error("client disconnected"));

    const response = await responsePromise;
    expect(response.status).toBe(408);
  });
});
