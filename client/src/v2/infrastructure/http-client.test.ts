import { describe, expect, it, vi } from "vitest";

import { DownloadTicketSchema, SetModeCommandSchema, V2_SCHEMA_VERSION } from "../contracts";
import { ids, snapshotAt } from "../test-fixtures";
import { ApiError } from "./api-error";
import { V2HttpClient } from "./http-client";

type FetchImplementation = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function mockFetch(implementation: FetchImplementation) {
  const mock = vi.fn(implementation);
  return { fetch: mock as unknown as typeof fetch, mock };
}

const command = SetModeCommandSchema.parse({
  protocolVersion: V2_SCHEMA_VERSION,
  commandId: "cmd_aaaaaaaaaaaaaaaa",
  expectedRevision: 3,
  type: "mode.set",
  mode: "record",
});

describe("V2HttpClient", () => {
  it("validates command results and sends the contract with authorization", async () => {
    const request = mockFetch(
      async () =>
        new Response(JSON.stringify({ revision: 4, mode: "record" }), {
          headers: { "content-type": "application/json" },
        }),
    );
    const client = new V2HttpClient({
      baseUrl: "/__snaperro__/v2/",
      fetch: request.fetch,
      authorization: async () => "Bearer control-token",
    });

    await expect(client.command(command)).resolves.toEqual({ revision: 4, mode: "record" });
    expect(request.mock).toHaveBeenCalledOnce();
    const [url, init] = request.mock.mock.calls[0] ?? [];
    expect(url).toBe("/__snaperro__/v2/commands");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer control-token");
    expect(JSON.parse(String(init?.body))).toEqual(command);
  });

  it("uses the query contract for the snapshot shortcut and validates its response", async () => {
    const snapshot = snapshotAt(7);
    const request = mockFetch(async () => new Response(JSON.stringify(snapshot)));
    const client = new V2HttpClient({ fetch: request.fetch });

    await expect(client.snapshot()).resolves.toEqual(snapshot);
    const [url, init] = request.mock.mock.calls[0] ?? [];
    expect(url).toBe("/__snaperro__/v2/queries");
    expect(JSON.parse(String(init?.body))).toEqual({ protocolVersion: 2, type: "runtime.snapshot" });
  });

  it("maps a Problem response to ApiError without losing concurrency details", async () => {
    const request = mockFetch(
      async () =>
        new Response(
          JSON.stringify({
            error: {
              code: "REVISION_CONFLICT",
              message: "The catalog changed",
              retryable: false,
              details: { expectedRevision: 3, actualRevision: 4 },
            },
          }),
          { status: 409 },
        ),
    );
    const client = new V2HttpClient({ fetch: request.fetch });

    const error = await client.command(command).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      code: "REVISION_CONFLICT",
      status: 409,
      retryable: false,
      details: { expectedRevision: 3, actualRevision: 4 },
    });
  });

  it("notifies the authentication session when the server rejects its token", async () => {
    const unauthorized = vi.fn();
    const request = mockFetch(
      async () =>
        new Response(
          JSON.stringify({
            error: {
              code: "UNAUTHORIZED",
              message: "A valid control token is required",
              retryable: false,
            },
          }),
          { status: 401 },
        ),
    );
    const client = new V2HttpClient({
      fetch: request.fetch,
      authorization: () => ({ value: "Bearer rejected-token", epoch: 7 }),
      onUnauthorized: unauthorized,
    });

    await expect(client.command(command)).rejects.toMatchObject({ code: "UNAUTHORIZED", status: 401 });
    expect(unauthorized).toHaveBeenCalledOnce();
    expect(unauthorized.mock.calls[0]?.[0]).toMatchObject({ code: "UNAUTHORIZED", status: 401 });
    expect(unauthorized.mock.calls[0]?.[1]).toEqual({ authorizationEpoch: 7 });
  });

  it("reports non-JSON errors and success-schema mismatches distinctly", async () => {
    const nonJsonRequest = mockFetch(async () => new Response("upstream unavailable", { status: 502 }));
    const nonJsonClient = new V2HttpClient({ fetch: nonJsonRequest.fetch });
    await expect(nonJsonClient.command(command)).rejects.toMatchObject({
      code: "HTTP_ERROR",
      status: 502,
      retryable: true,
      details: { responseSnippet: "upstream unavailable" },
    });

    const invalidSuccessRequest = mockFetch(async () => new Response(JSON.stringify({ revision: 4 })));
    const invalidSuccessClient = new V2HttpClient({ fetch: invalidSuccessRequest.fetch });
    await expect(invalidSuccessClient.command(command)).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
      status: 200,
    });
  });

  it("normalizes fetch aborts and rejects oversized JSON before parsing", async () => {
    const pendingRequest = mockFetch(
      async (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          const abort = () => reject(new DOMException("Aborted", "AbortError"));
          if (init?.signal?.aborted) abort();
          else init?.signal?.addEventListener("abort", abort, { once: true });
        }),
    );
    const controller = new AbortController();
    const aborted = new V2HttpClient({ fetch: pendingRequest.fetch }).snapshot({ signal: controller.signal });
    controller.abort();
    await expect(aborted).rejects.toMatchObject({ code: "ABORTED", retryable: false });

    const cancel = vi.fn(() => new Promise<void>(() => undefined));
    const oversizedRequest = mockFetch(
      async () =>
        new Response(new ReadableStream<Uint8Array>({ cancel }), {
          headers: { "content-length": "100" },
        }),
    );
    const limited = new V2HttpClient({ fetch: oversizedRequest.fetch, maxJsonBytes: 10 });
    await expect(limited.snapshot()).rejects.toMatchObject({
      code: "RESPONSE_TOO_LARGE",
      details: { limit: 10, contentLength: 100 },
    });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("reports an actual oversized JSON stream without awaiting its cancellation", async () => {
    const cancel = vi.fn(() => new Promise<void>(() => undefined));
    const oversizedRequest = mockFetch(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new Uint8Array(11));
            },
            cancel,
          }),
        ),
    );
    const limited = new V2HttpClient({ fetch: oversizedRequest.fetch, maxJsonBytes: 10 });

    await expect(limited.snapshot()).rejects.toMatchObject({
      code: "RESPONSE_TOO_LARGE",
      details: { limit: 10, receivedBytes: 11 },
    });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("uploads raw bodies and stages folder imports through validated transport contracts", async () => {
    const bodyRef = {
      sha256: "c".repeat(64),
      size: 3,
      mediaType: "application/json",
      contentEncoding: null,
    };
    const staged = {
      transferId: "xfer_aaaaaaaaaaaaaaaa",
      suggestedName: "Imported",
      scenariosCount: 2,
      size: 100,
      sha256: "d".repeat(64),
    };
    const stagedRecording = {
      transferId: "xfer_bbbbbbbbbbbbbbbb",
      filename: "recording.zip",
      size: 42,
      sha256: "e".repeat(64),
    };
    const request = mockFetch(async (input) => {
      const url = String(input);
      const value = url.includes("recording-imports")
        ? stagedRecording
        : url.includes("transfers/imports")
          ? staged
          : bodyRef;
      return new Response(JSON.stringify(value));
    });
    const client = new V2HttpClient({ fetch: request.fetch });

    await expect(
      client.uploadBody(new Blob(["{}"], { type: "application/json" }), {
        mediaType: "application/json",
        contentEncoding: "gzip",
      }),
    ).resolves.toEqual(bodyRef);
    await expect(
      client.stageFolderImport(new Blob(["zip"]), { filename: "folder name.zip", mediaType: "application/zip" }),
    ).resolves.toEqual(staged);
    await expect(
      client.stageRecordingImport(new Blob(["zip"]), {
        filename: "recording.zip",
        mediaType: "application/zip",
      }),
    ).resolves.toEqual(stagedRecording);

    expect(request.mock.mock.calls[0]?.[0]).toBe("/__snaperro__/v2/bodies");
    expect(new Headers(request.mock.mock.calls[0]?.[1]?.headers).get("content-encoding")).toBe("gzip");
    expect(request.mock.mock.calls[1]?.[0]).toBe("/__snaperro__/v2/transfers/imports?filename=folder%20name.zip");
    expect(new Headers(request.mock.mock.calls[1]?.[1]?.headers).get("content-type")).toBe("application/zip");
    expect(request.mock.mock.calls[2]?.[0]).toBe("/__snaperro__/v2/transfers/recording-imports?filename=recording.zip");
    expect(new Headers(request.mock.mock.calls[2]?.[1]?.headers).get("content-type")).toBe("application/zip");
  });

  it("strictly validates download tickets returned by a query", async () => {
    const valid = DownloadTicketSchema.parse({
      downloadPath: `/__snaperro__/downloads/${"a".repeat(43)}`,
      expiresAt: "2026-08-24T00:05:00.000Z",
      filename: "folder.zip",
      mediaType: "application/zip",
      size: 65 * 1024 * 1024,
    });
    const request = mockFetch(async () => new Response(JSON.stringify({ revision: 4, download: valid })));
    const client = new V2HttpClient({ fetch: request.fetch });

    await expect(
      client.query({ protocolVersion: V2_SCHEMA_VERSION, type: "folder.export", folderId: ids.folder }),
    ).resolves.toEqual({ revision: 4, download: valid });

    request.mock.mockImplementationOnce(
      async () =>
        new Response(JSON.stringify({ revision: 4, download: { ...valid, downloadPath: "https://evil.test/file" } })),
    );
    await expect(
      client.query({ protocolVersion: V2_SCHEMA_VERSION, type: "folder.export", folderId: ids.folder }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE", status: 200 });
  });

  it("rejects invalid request contracts without making a network request", async () => {
    const request = mockFetch(async () => new Response("{}"));
    const client = new V2HttpClient({ fetch: request.fetch });

    await expect(client.command({ ...command, mode: "invalid" } as never)).rejects.toMatchObject({
      code: "INVALID_REQUEST",
    });
    expect(request.mock).not.toHaveBeenCalled();
  });
});
