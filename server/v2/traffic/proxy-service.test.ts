import { describe, expect, it, vi } from "vitest";
import type { UpstreamGatewayPort } from "../application/ports.js";
import { compileConfigV2 } from "../config/config.js";
import { EntityNotFoundError, OperationAbortedError, UpstreamUnavailableError } from "../domain/errors.js";
import { ProxyService } from "./proxy-service.js";

function config() {
  return compileConfigV2(
    {
      configVersion: 2,
      apis: {
        jsonPlaceholder: {
          name: "Users",
          target: "https://api.example.com/v1",
          routes: ["POST /users/:id"],
          headers: { Authorization: "Bearer configured" },
        },
      },
    },
    "/work/project/snaperro.config.ts",
  );
}

describe("ProxyService", () => {
  it("forwards the original stream and preserves raw response metadata", async () => {
    const responseBody = new Blob([new Uint8Array([0, 255])]).stream();
    const execute = vi.fn(async () => ({
      status: 206,
      statusText: "Partial Content",
      headers: [
        ["content-type", "application/octet-stream"],
        ["content-encoding", "gzip"],
        ["transfer-encoding", "chunked"],
      ],
      body: responseBody,
    }));
    const upstream = { execute, close: vi.fn() } as unknown as UpstreamGatewayPort;
    const requestBody = new Blob(["request"]).stream();
    const service = new ProxyService(config(), upstream);

    const result = await service.execute({
      method: "POST",
      url: "http://localhost/users/42?include=roles",
      headers: new Headers({ Host: "localhost", "X-Request": "value" }),
      body: requestBody,
      signal: new AbortController().signal,
    });

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        url: "https://api.example.com/v1/users/42?include=roles",
        body: requestBody,
        headers: expect.arrayContaining([
          ["authorization", "Bearer configured"],
          ["x-request", "value"],
        ]),
      }),
    );
    expect(result).toMatchObject({ status: 206, statusText: "Partial Content", body: responseBody });
    expect(result.headers).toContainEqual(["content-encoding", "gzip"]);
    expect(result.headers).not.toContainEqual(["transfer-encoding", "chunked"]);
  });

  it("returns a typed not-found failure for an unmatched route", async () => {
    const upstream = { execute: vi.fn(), close: vi.fn() } as unknown as UpstreamGatewayPort;
    const service = new ProxyService(config(), upstream);

    await expect(
      service.execute({
        method: "GET",
        url: "http://localhost/unknown",
        headers: new Headers(),
        body: null,
        signal: new AbortController().signal,
      }),
    ).rejects.toBeInstanceOf(EntityNotFoundError);
    expect(upstream.execute).not.toHaveBeenCalled();
  });

  it("normalizes upstream failures", async () => {
    const upstream = {
      execute: vi.fn(async () => Promise.reject(new Error("ECONNRESET secret"))),
      close: vi.fn(),
    } as unknown as UpstreamGatewayPort;
    const service = new ProxyService(config(), upstream);

    await expect(
      service.execute({
        method: "POST",
        url: "http://localhost/users/1",
        headers: new Headers(),
        body: null,
        signal: new AbortController().signal,
      }),
    ).rejects.toBeInstanceOf(UpstreamUnavailableError);
  });

  it("normalizes an aborted upstream request", async () => {
    const controller = new AbortController();
    const upstream = {
      execute: vi.fn(async () => {
        controller.abort("client disconnected");
        throw new Error("UND_ERR_ABORTED");
      }),
      close: vi.fn(),
    } as unknown as UpstreamGatewayPort;

    await expect(
      new ProxyService(config(), upstream).execute({
        method: "POST",
        url: "http://localhost/users/1",
        headers: new Headers(),
        body: null,
        signal: controller.signal,
      }),
    ).rejects.toBeInstanceOf(OperationAbortedError);
  });

  it("aborts a pending upstream adapter and cancels a late response body", async () => {
    const controller = new AbortController();
    let resolveUpstream: ((response: Awaited<ReturnType<UpstreamGatewayPort["execute"]>>) => void) | undefined;
    const upstream = {
      execute: vi.fn(
        () =>
          new Promise<Awaited<ReturnType<UpstreamGatewayPort["execute"]>>>((resolve) => {
            resolveUpstream = resolve;
          }),
      ),
      close: vi.fn(),
    } as unknown as UpstreamGatewayPort;
    const service = new ProxyService(config(), upstream);
    const executing = service.execute({
      method: "POST",
      url: "http://localhost/users/1",
      headers: new Headers(),
      body: null,
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(upstream.execute).toHaveBeenCalledOnce());
    controller.abort(new Error("generation stopped"));

    await expect(executing).rejects.toBeInstanceOf(OperationAbortedError);

    const cancel = vi.fn(() => new Promise<void>(() => undefined));
    resolveUpstream?.({ status: 200, statusText: "OK", headers: [], body: new ReadableStream({ cancel }) });
    await vi.waitFor(() => expect(cancel).toHaveBeenCalled());
  });
});
