import { describe, expect, it, vi } from "vitest";

import type { Event } from "../contracts";
import { eventAt } from "../test-fixtures";
import { V2RealtimeClient } from "./realtime-client";

type FetchImplementation = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function mockFetch(implementation: FetchImplementation) {
  const mock = vi.fn(implementation);
  return { fetch: mock as unknown as typeof fetch, mock };
}

function eventStream(body: string): Response {
  return new Response(body, { headers: { "content-type": "text/event-stream; charset=utf-8" } });
}

function wireEvent(event: Event, retry?: number): string {
  return `${retry === undefined ? "" : `retry: ${retry}\n`}id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

describe("V2RealtimeClient", () => {
  it("starts every reconnect from a fresh snapshot without requesting event replay", async () => {
    const controller = new AbortController();
    const event = eventAt(11, { type: "mode.changed", payload: { mode: "record" } });
    const request = mockFetch(async (_input, init) => {
      if (request.mock.mock.calls.length === 1) return eventStream(wireEvent(event, 25));
      expect(new Headers(init?.headers).get("last-event-id")).toBeNull();
      controller.abort();
      throw new DOMException("Aborted", "AbortError");
    });
    const sleep = vi.fn(async () => {});
    const statuses: string[] = [];
    const received: Event[] = [];
    const client = new V2RealtimeClient({
      fetch: request.fetch,
      authorization: () => "Bearer stream-token",
      initialRetryMs: 10,
      maxRetryMs: 100,
      sleep,
    });

    await client.subscribe(
      {
        onEvent: (next) => void received.push(next),
        onStatus: (status) => void statuses.push(status),
      },
      { signal: controller.signal },
    );

    expect(received).toEqual([event]);
    expect(request.mock).toHaveBeenCalledTimes(2);
    expect(new Headers(request.mock.mock.calls[0]?.[1]?.headers).get("authorization")).toBe("Bearer stream-token");
    expect(sleep).toHaveBeenCalledWith(25, controller.signal);
    expect(statuses).toContain("connected");
    expect(statuses).toContain("reconnecting");
    expect(statuses.at(-1)).toBe("stopped");
  });

  it("stops on malformed JSON instead of reconnecting forever", async () => {
    const request = mockFetch(async () => eventStream("event: mode.changed\ndata: {not-json}\n\n"));
    const errors = vi.fn();
    const sleep = vi.fn(async () => {});
    const client = new V2RealtimeClient({ fetch: request.fetch, sleep });

    await expect(
      client.subscribe({ onEvent: vi.fn(), onError: errors }, { signal: new AbortController().signal }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    expect(errors).toHaveBeenCalledOnce();
    expect(request.mock).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
  });

  it("treats contract mismatches as non-retryable protocol errors", async () => {
    const malformed = eventStream(
      'id: evt_aaaaaaaaaaaaaaaa\nevent: mode.changed\ndata: {"protocolVersion":2,"type":"mode.changed","payload":{"mode":"record"}}\n\n',
    );
    const request = mockFetch(async () => malformed);
    const client = new V2RealtimeClient({ fetch: request.fetch, sleep: async () => {} });

    await expect(
      client.subscribe({ onEvent: vi.fn() }, { signal: new AbortController().signal }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE", retryable: false });
    expect(request.mock).toHaveBeenCalledOnce();
  });

  it("ends cleanly when an in-flight fetch is aborted", async () => {
    const controller = new AbortController();
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const request = mockFetch(
      async (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          markStarted?.();
          const abort = () => reject(new DOMException("Aborted", "AbortError"));
          if (init?.signal?.aborted) abort();
          else init?.signal?.addEventListener("abort", abort, { once: true });
        }),
    );
    const errors = vi.fn();
    const statuses: string[] = [];
    const client = new V2RealtimeClient({ fetch: request.fetch });
    const subscription = client.subscribe(
      { onEvent: vi.fn(), onError: errors, onStatus: (status) => void statuses.push(status) },
      { signal: controller.signal },
    );

    await started;
    controller.abort();
    await expect(subscription).resolves.toBeUndefined();
    expect(errors).not.toHaveBeenCalled();
    expect(statuses.at(-1)).toBe("stopped");
  });

  it("cancels an oversized SSE event and reconnects for a fresh snapshot", async () => {
    const controller = new AbortController();
    const cancel = vi.fn(() => new Promise<void>(() => undefined));
    const request = mockFetch(async () => {
      if (request.mock.mock.calls.length === 1) {
        return new Response(
          new ReadableStream<Uint8Array>({
            start(streamController) {
              streamController.enqueue(new TextEncoder().encode(`data: ${"x".repeat(80)}\n\n`));
            },
            cancel,
          }),
          { headers: { "content-type": "text/event-stream; charset=utf-8" } },
        );
      }
      controller.abort();
      throw new DOMException("Aborted", "AbortError");
    });
    const errors = vi.fn();
    const sleep = vi.fn(async () => {});
    const client = new V2RealtimeClient({
      fetch: request.fetch,
      maxLineBytes: 64,
      maxEventBytes: 64,
      initialRetryMs: 0,
      maxRetryMs: 0,
      sleep,
    });

    await client.subscribe({ onEvent: vi.fn(), onError: errors }, { signal: controller.signal });

    expect(errors).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "STREAM_ERROR",
        retryable: true,
        details: expect.objectContaining({ kind: "line", limitBytes: 64 }),
      }),
    );
    expect(request.mock).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("stops without waiting for a non-settling stream read or cancellation", async () => {
    const controller = new AbortController();
    let rejectRead!: (error: Error) => void;
    const pendingRead = new Promise<ReadableStreamReadResult<Uint8Array>>((_resolve, reject) => {
      rejectRead = reject;
    });
    const reader = {
      read: vi.fn(() => pendingRead),
      cancel: vi.fn(() => new Promise<void>(() => undefined)),
      releaseLock: vi.fn(),
    } as unknown as ReadableStreamDefaultReader<Uint8Array>;
    const response = {
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "text/event-stream; charset=utf-8" }),
      body: { getReader: () => reader },
    } as unknown as Response;
    const request = mockFetch(async () => response);
    let markConnected!: () => void;
    const connected = new Promise<void>((resolve) => {
      markConnected = resolve;
    });
    const statuses: string[] = [];
    const client = new V2RealtimeClient({ fetch: request.fetch });
    const subscription = client.subscribe(
      {
        onEvent: vi.fn(),
        onStatus: (status) => {
          statuses.push(status);
          if (status === "connected") markConnected();
        },
      },
      { signal: controller.signal },
    );

    await connected;
    controller.abort();
    await expect(subscription).resolves.toBeUndefined();

    expect(reader.cancel).toHaveBeenCalledOnce();
    expect(reader.releaseLock).toHaveBeenCalledOnce();
    expect(statuses.at(-1)).toBe("stopped");
    rejectRead(new Error("late stream read failure"));
    await Promise.resolve();
  });
});
