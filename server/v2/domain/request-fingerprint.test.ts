import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { BodyRefSchema, RecordingDraftSchema } from "../../../shared/contracts-v2/entities.js";
import { OperationAbortedError } from "./errors.js";
import {
  canonicalJson,
  deriveRecordingRequestFingerprint,
  MAX_CANONICAL_JSON_BYTES,
  requestFingerprint,
} from "./request-fingerprint.js";

describe("requestFingerprint", () => {
  const base = {
    method: "POST",
    route: "/users/:id",
    pathParams: { id: "1" },
    query: [
      ["include", "roles"],
      ["include", "profile"],
    ] as Array<[string, string]>,
    body: { kind: "json" as const, value: { enabled: true, user: { name: "Ada", id: 1 } } },
  };

  it("is insensitive to JSON object and query-key ordering", () => {
    const reordered = {
      ...base,
      method: "post",
      query: [
        ["include", "profile"],
        ["include", "roles"],
      ] as Array<[string, string]>,
      body: { kind: "json" as const, value: { user: { id: 1, name: "Ada" }, enabled: true } },
    };

    expect(requestFingerprint(reordered)).toBe(requestFingerprint(base));
  });

  it("totally orders canonically equivalent Unicode keys without locale-dependent ties", () => {
    const composed = "é";
    const decomposed = "e\u0301";
    const first = Object.fromEntries([
      [composed, 1],
      [decomposed, 2],
    ]);
    const reordered = Object.fromEntries([
      [decomposed, 2],
      [composed, 1],
    ]);

    expect(requestFingerprint({ ...base, body: { kind: "json", value: first } })).toBe(
      requestFingerprint({ ...base, body: { kind: "json", value: reordered } }),
    );
  });

  it("distinguishes array order in JSON bodies", () => {
    const first = { ...base, body: { kind: "json" as const, value: { ids: [1, 2] } } };
    const second = { ...base, body: { kind: "json" as const, value: { ids: [2, 1] } } };

    expect(requestFingerprint(first)).not.toBe(requestFingerprint(second));
  });

  it("distinguishes empty and raw bodies", () => {
    const empty = requestFingerprint({ ...base, body: { kind: "empty" } });
    const raw = requestFingerprint({ ...base, body: { kind: "raw", sha256: "abc" } });

    expect(empty).not.toBe(raw);
  });

  it("rejects cyclic JSON values", () => {
    const value: Record<string, unknown> = {};
    value.self = value;

    expect(() => canonicalJson(value)).toThrow("cyclic");
  });

  it("derives the same canonical fingerprint from a persisted JSON body stream", async () => {
    const bytes = new TextEncoder().encode('{"user":{"name":"Ada","id":1},"enabled":true}');
    const body = BodyRefSchema.parse({
      sha256: createHash("sha256").update(bytes).digest("hex"),
      size: bytes.byteLength,
      mediaType: "application/json; charset=utf-8",
      contentEncoding: null,
    });
    const recording = RecordingDraftSchema.parse({
      route: base.route,
      method: base.method,
      request: { pathParams: base.pathParams, query: base.query, headers: [], body },
      response: { status: 200, statusText: "OK", headers: [], body: null },
    });
    const open = vi.fn(async () => new Blob([bytes]).stream());

    await expect(deriveRecordingRequestFingerprint(recording, open)).resolves.toBe(requestFingerprint(base));
    expect(open).toHaveBeenCalledOnce();
  });

  it("streams a large BodyRef without buffering the whole body", async () => {
    const chunk = new Uint8Array(64 * 1024).fill(0x61);
    const chunkCount = 80;
    const tail = Uint8Array.of(0x62);
    const hash = createHash("sha256");
    for (let index = 0; index < chunkCount; index += 1) hash.update(chunk);
    hash.update(tail);
    const size = chunk.byteLength * chunkCount + tail.byteLength;
    const body = BodyRefSchema.parse({
      sha256: hash.digest("hex"),
      size,
      mediaType: "application/json",
      contentEncoding: null,
    });
    const recording = RecordingDraftSchema.parse({
      route: base.route,
      method: base.method,
      request: { pathParams: base.pathParams, query: base.query, headers: [], body },
      response: { status: 200, statusText: "OK", headers: [], body: null },
    });
    let pulls = 0;
    const open = vi.fn(
      async () =>
        new ReadableStream<Uint8Array>({
          pull(controller) {
            if (pulls < chunkCount) controller.enqueue(chunk);
            else if (pulls === chunkCount) controller.enqueue(tail);
            else controller.close();
            pulls += 1;
          },
        }),
    );

    await expect(deriveRecordingRequestFingerprint(recording, open)).resolves.toBe(
      requestFingerprint({ ...base, body: { kind: "raw", sha256: body.sha256 } }),
    );
    expect(size).toBeGreaterThan(MAX_CANONICAL_JSON_BYTES);
    expect(open).toHaveBeenCalledOnce();
    expect(pulls).toBe(chunkCount + 2);
  });

  it("does not wait for stream cancellation after an integrity failure", async () => {
    const body = BodyRefSchema.parse({
      sha256: "a".repeat(64),
      size: 1,
      mediaType: "application/octet-stream",
      contentEncoding: null,
    });
    const recording = RecordingDraftSchema.parse({
      route: base.route,
      method: base.method,
      request: { pathParams: base.pathParams, query: base.query, headers: [], body },
      response: { status: 200, statusText: "OK", headers: [], body: null },
    });
    const cancel = vi.fn(() => new Promise<void>(() => undefined));
    const open = vi.fn(
      async () =>
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(Uint8Array.of(1, 2));
          },
          cancel,
        }),
    );

    await expect(deriveRecordingRequestFingerprint(recording, open)).rejects.toThrow(
      "exceeded its declared fingerprinting size",
    );
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("aborts a pending fingerprint read without awaiting source cancellation", async () => {
    const body = BodyRefSchema.parse({
      sha256: "a".repeat(64),
      size: 1,
      mediaType: "application/octet-stream",
      contentEncoding: null,
    });
    const recording = RecordingDraftSchema.parse({
      route: base.route,
      method: base.method,
      request: { pathParams: base.pathParams, query: base.query, headers: [], body },
      response: { status: 200, statusText: "OK", headers: [], body: null },
    });
    const controller = new AbortController();
    let markPullStarted: (() => void) | undefined;
    const pullStarted = new Promise<void>((resolve) => {
      markPullStarted = resolve;
    });
    const cancel = vi.fn(() => new Promise<void>(() => undefined));
    const open = vi.fn(
      async () =>
        new ReadableStream<Uint8Array>({
          pull() {
            markPullStarted?.();
            return new Promise<void>(() => undefined);
          },
          cancel,
        }),
    );

    const deriving = deriveRecordingRequestFingerprint(recording, open, controller.signal);
    await pullStarted;
    controller.abort(new Error("server stopping"));

    await expect(deriving).rejects.toBeInstanceOf(OperationAbortedError);
    expect(cancel).toHaveBeenCalled();
  });

  it("cancels a body stream opened after fingerprinting was aborted", async () => {
    const body = BodyRefSchema.parse({
      sha256: "a".repeat(64),
      size: 1,
      mediaType: "application/octet-stream",
      contentEncoding: null,
    });
    const recording = RecordingDraftSchema.parse({
      route: base.route,
      method: base.method,
      request: { pathParams: base.pathParams, query: base.query, headers: [], body },
      response: { status: 200, statusText: "OK", headers: [], body: null },
    });
    const controller = new AbortController();
    let resolveOpen: ((stream: ReadableStream<Uint8Array>) => void) | undefined;
    const open = vi.fn(
      () =>
        new Promise<ReadableStream<Uint8Array>>((resolve) => {
          resolveOpen = resolve;
        }),
    );
    const cancel = vi.fn(() => new Promise<void>(() => undefined));

    const deriving = deriveRecordingRequestFingerprint(recording, open, controller.signal);
    await vi.waitFor(() => expect(open).toHaveBeenCalledOnce());
    controller.abort(new Error("server stopping"));
    await expect(deriving).rejects.toBeInstanceOf(OperationAbortedError);

    resolveOpen?.(new ReadableStream<Uint8Array>({ cancel }));
    await vi.waitFor(() => expect(cancel).toHaveBeenCalled());
  });
});
