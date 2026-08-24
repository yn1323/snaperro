import { once } from "node:events";
import { createServer, type RequestListener, type Server } from "node:http";
import { gzipSync } from "node:zlib";
import type { Dispatcher } from "undici";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UndiciUpstreamGateway } from "./undici-upstream-gateway.js";

const servers: Server[] = [];
const gateways: UndiciUpstreamGateway[] = [];

async function listen(handler: RequestListener): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected an IP server address");
  return `http://127.0.0.1:${address.port}`;
}

async function bytes(stream: ReadableStream<Uint8Array> | null): Promise<Uint8Array> {
  return stream ? new Uint8Array(await new Response(stream).arrayBuffer()) : new Uint8Array();
}

afterEach(async () => {
  await Promise.all(gateways.splice(0).map((gateway) => gateway.close()));
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
      ),
  );
});

describe("UndiciUpstreamGateway", () => {
  it("streams request and response bytes without JSON conversion", async () => {
    const target = await listen((request, response) => {
      response.writeHead(201, { "Content-Type": "application/octet-stream" });
      request.pipe(response);
    });
    const gateway = new UndiciUpstreamGateway();
    gateways.push(gateway);
    const payload = new Uint8Array([0, 1, 2, 255]);

    const result = await gateway.execute({
      method: "POST",
      url: target,
      headers: [["content-type", "application/octet-stream"]],
      body: new Blob([payload]).stream(),
      signal: new AbortController().signal,
    });

    expect(result.status).toBe(201);
    expect(await bytes(result.body)).toEqual(payload);
  });

  it("does not transparently decode an encoded upstream response", async () => {
    const compressed = gzipSync(Buffer.from('{"large":true}'));
    const target = await listen((_request, response) => {
      response.writeHead(200, {
        "Content-Encoding": "gzip",
        "Content-Length": String(compressed.byteLength),
        "Content-Type": "application/json",
      });
      response.end(compressed);
    });
    const gateway = new UndiciUpstreamGateway();
    gateways.push(gateway);

    const result = await gateway.execute({
      method: "GET",
      url: target,
      headers: [],
      body: null,
      signal: new AbortController().signal,
    });

    expect(await bytes(result.body)).toEqual(new Uint8Array(compressed));
    expect(result.headers).toContainEqual(["content-encoding", "gzip"]);
  });

  it("shares a concurrent shutdown attempt and permits retry after it fails", async () => {
    let rejectClose: ((error: Error) => void) | undefined;
    const closeError = new Error("dispatcher close failed");
    const close = vi
      .fn<() => Promise<void>>()
      .mockImplementationOnce(
        () =>
          new Promise<void>((_resolve, reject) => {
            rejectClose = reject;
          }),
      )
      .mockResolvedValue(undefined);
    const gateway = new UndiciUpstreamGateway(undefined, { close } as unknown as Dispatcher);

    const first = gateway.close();
    const concurrent = gateway.close();
    expect(concurrent).toBe(first);
    rejectClose?.(closeError);
    await expect(first).rejects.toBe(closeError);

    await expect(gateway.close()).resolves.toBeUndefined();
    expect(close).toHaveBeenCalledTimes(2);
  });
});
