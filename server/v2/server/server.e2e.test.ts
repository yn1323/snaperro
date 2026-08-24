import fs from "node:fs/promises";
import { createServer, type Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { compileConfigV2 } from "../config/config.js";
import { createV2Server } from "./node-server.js";

const directories: string[] = [];
const servers: Server[] = [];

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) =>
    server.close((error) =>
      error && "code" in error && error.code !== "ERR_SERVER_NOT_RUNNING" ? reject(error) : resolve(),
    ),
  );
}

async function listen(server: Server): Promise<number> {
  servers.push(server);
  return new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      const address = server.address();
      if (!address || typeof address === "string") reject(new Error("Expected a TCP address"));
      else resolve(address.port);
    });
  });
}

async function availablePort(): Promise<number> {
  const probe = createServer();
  const port = await listen(probe);
  await close(probe);
  servers.splice(servers.indexOf(probe), 1);
  return port;
}

afterEach(async () => {
  await Promise.allSettled(servers.splice(0).map(close));
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe("Snaperro v2 over TCP", () => {
  it("re-derives an edited recording identity so only the new route, query, and request body match", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "snaperro-v2-derived-fingerprint-"));
    directories.push(directory);
    let upstreamRequests = 0;
    const upstreamPort = await listen(
      createServer((_request, response) => {
        upstreamRequests += 1;
        response.writeHead(200, { "content-type": "application/json" });
        response.end('{"source":"upstream"}');
      }),
    );
    const snaperroPort = await availablePort();
    const configPath = path.join(directory, "snaperro.config.ts");
    const config = compileConfigV2(
      {
        configVersion: 2,
        server: { host: "127.0.0.1", port: snaperroPort, openBrowser: false },
        storage: { root: ".snaperro/v2" },
        mock: { fallback: "404" },
        apis: {
          jsonPlaceholder: {
            name: "Upstream",
            target: `http://127.0.0.1:${upstreamPort}`,
            routes: ["POST /users/:id", "POST /accounts/:id"],
          },
        },
      },
      configPath,
    );
    const runtime = await createV2Server(config);
    const address = await runtime.start();
    const control = `${address.origin}/__snaperro__/v2`;
    const command = async <Result>(input: Record<string, unknown>): Promise<Result> => {
      const response = await fetch(`${control}/commands`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ protocolVersion: 2, ...input }),
      });
      expect(response.status, await response.clone().text()).toBe(200);
      return response.json() as Promise<Result>;
    };
    const query = async <Result>(input: Record<string, unknown>): Promise<Result> => {
      const response = await fetch(`${control}/queries`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ protocolVersion: 2, ...input }),
      });
      expect(response.status, await response.clone().text()).toBe(200);
      return response.json() as Promise<Result>;
    };

    try {
      const snapshot = (await (await fetch(`${control}/snapshot`)).json()) as { revision: number };
      const folder = await command<{ revision: number; folder: { id: string } }>({
        type: "folder.create",
        commandId: "cmd_0000000000000001",
        expectedRevision: snapshot.revision,
        name: "Tests",
      });
      const scenario = await command<{ revision: number; scenario: { id: string } }>({
        type: "scenario.create",
        commandId: "cmd_0000000000000002",
        expectedRevision: folder.revision,
        folderId: folder.folder.id,
        name: "Editable",
      });
      const selected = await command<{ revision: number }>({
        type: "scenario.select",
        commandId: "cmd_0000000000000003",
        expectedRevision: scenario.revision,
        scenarioId: scenario.scenario.id,
      });
      await command({
        type: "mode.set",
        commandId: "cmd_0000000000000004",
        expectedRevision: selected.revision,
        mode: "record",
      });

      const oldResponse = await fetch(`${address.origin}/users/1?view=old`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: '{"value":1}',
      });
      expect(oldResponse.status).toBe(200);
      expect(await oldResponse.json()).toEqual({ source: "upstream" });

      let page: { items: Array<{ id: string }> } | undefined;
      await vi.waitFor(
        async () => {
          page = await query<{ items: Array<{ id: string }> }>({
            type: "recording.list",
            scenarioId: scenario.scenario.id,
            limit: 50,
          });
          expect(page.items).toHaveLength(1);
        },
        { timeout: 10_000 },
      );
      const summary = page?.items[0];
      if (!summary) throw new Error("Expected a captured recording");
      const loaded = await query<{
        recording: {
          id: string;
          filename: string;
          revision: number;
          request: Record<string, unknown>;
          response: Record<string, unknown>;
        };
      }>({
        type: "recording.get",
        scenarioId: scenario.scenario.id,
        recordingId: summary.id,
      });
      const scenarioState = await query<{ scenario: { revision: number } }>({
        type: "scenario.get",
        scenarioId: scenario.scenario.id,
      });
      const uploadedBody = await fetch(`${control}/bodies`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: '{"value":2}',
      });
      expect(uploadedBody.status).toBe(201);
      const newRequestBody = (await uploadedBody.json()) as Record<string, unknown>;
      const edited = await command<{ revision: number }>({
        type: "recording.update",
        commandId: "cmd_0000000000000005",
        scenarioId: scenario.scenario.id,
        recordingId: loaded.recording.id,
        expectedScenarioRevision: scenarioState.scenario.revision,
        expectedContentRevision: loaded.recording.revision,
        filename: loaded.recording.filename,
        recording: {
          route: "/accounts/:id",
          method: "POST",
          request: {
            ...loaded.recording.request,
            pathParams: { id: "2" },
            query: [["view", "new"]],
            body: newRequestBody,
          },
          response: loaded.recording.response,
        },
      });
      await command({
        type: "mode.set",
        commandId: "cmd_0000000000000006",
        expectedRevision: edited.revision,
        mode: "mock",
      });

      const oldMiss = await fetch(`${address.origin}/users/1?view=old`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: '{"value":1}',
      });
      expect(oldMiss.status).toBe(404);

      const newMatch = await fetch(`${address.origin}/accounts/2?view=new`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: '{"value":2}',
      });
      expect(newMatch.status).toBe(200);
      expect(await newMatch.json()).toEqual({ source: "upstream" });
      expect(upstreamRequests).toBe(1);
    } finally {
      await runtime.stop();
    }
  }, 15_000);

  it("serves control, SSE, streaming traffic, reload, and graceful shutdown through one runtime", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "snaperro-v2-e2e-"));
    directories.push(directory);
    const firstUpstreamPort = await listen(
      createServer((_request, response) => {
        response.writeHead(200, { "content-type": "application/octet-stream", "x-upstream": "first" });
        const chunk = Buffer.alloc(1024 * 1024, 0x5a);
        for (let index = 0; index < 8; index += 1) response.write(chunk);
        response.end();
      }),
    );
    const secondUpstreamPort = await listen(
      createServer((_request, response) => {
        response.writeHead(200, { "content-type": "text/plain", "x-upstream": "second" });
        response.end("reloaded");
      }),
    );
    const snaperroPort = await availablePort();
    const configPath = path.join(directory, "snaperro.config.ts");
    const makeConfig = (upstreamPort: number) =>
      compileConfigV2(
        {
          configVersion: 2,
          server: { host: "127.0.0.1", port: snaperroPort, openBrowser: false },
          storage: { root: ".snaperro/v2" },
          apis: {
            upstream: {
              name: "Upstream",
              target: `http://127.0.0.1:${upstreamPort}`,
              routes: ["/large"],
            },
          },
        },
        configPath,
      );
    const runtime = await createV2Server(makeConfig(firstUpstreamPort), { heartbeatMs: 100 });
    const address = await runtime.start();

    const snapshotResponse = await fetch(`${address.origin}/__snaperro__/v2/snapshot`);
    expect(snapshotResponse.status).toBe(200);
    const snapshot = (await snapshotResponse.json()) as { revision: number; runtimeId: string };
    expect(snapshot.runtimeId).toMatch(/^run_/u);

    const events = await fetch(`${address.origin}/__snaperro__/v2/events`);
    const eventReader = events.body?.getReader();
    expect(new TextDecoder().decode((await eventReader?.read())?.value)).toContain("runtime.connected");

    const mode = await fetch(`${address.origin}/__snaperro__/v2/commands`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        protocolVersion: 2,
        type: "mode.set",
        commandId: "cmd_0123456789abcdef",
        expectedRevision: snapshot.revision,
        mode: "proxy",
      }),
    });
    expect(mode.status).toBe(200);

    const streamed = await fetch(`${address.origin}/large`);
    expect(streamed.headers.get("x-upstream")).toBe("first");
    expect((await streamed.arrayBuffer()).byteLength).toBe(8 * 1024 * 1024);

    await runtime.reload(makeConfig(secondUpstreamPort));
    const reloaded = await fetch(`${address.origin}/large`);
    expect(reloaded.headers.get("x-upstream")).toBe("second");
    expect(await reloaded.text()).toBe("reloaded");

    await eventReader?.cancel();
    await runtime.stop();
    await expect(fetch(`${address.origin}/__snaperro__/v2/snapshot`)).rejects.toThrow();
  }, 20_000);

  it("keeps a reloaded generation alive until an already-returned response body finishes", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "snaperro-v2-stream-reload-"));
    directories.push(directory);
    let releaseFirst = () => {};
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const firstUpstreamPort = await listen(
      createServer(async (_request, response) => {
        response.writeHead(200, { "content-type": "text/plain", "x-upstream": "first" });
        response.write("before-");
        await firstGate;
        response.end("after");
      }),
    );
    const secondUpstreamPort = await listen(
      createServer((_request, response) => {
        response.writeHead(200, { "content-type": "text/plain", "x-upstream": "second" });
        response.end("new");
      }),
    );
    const snaperroPort = await availablePort();
    const configPath = path.join(directory, "snaperro.config.ts");
    const makeConfig = (upstreamPort: number) =>
      compileConfigV2(
        {
          configVersion: 2,
          server: { host: "127.0.0.1", port: snaperroPort, openBrowser: false, shutdownTimeoutMs: 500 },
          storage: { root: ".snaperro/v2" },
          apis: {
            upstream: {
              name: "Upstream",
              target: `http://127.0.0.1:${upstreamPort}`,
              routes: ["/slow"],
            },
          },
        },
        configPath,
      );
    const runtime = await createV2Server(makeConfig(firstUpstreamPort));
    const address = await runtime.start();

    try {
      const snapshot = (await (await fetch(`${address.origin}/__snaperro__/v2/snapshot`)).json()) as {
        revision: number;
      };
      const mode = await fetch(`${address.origin}/__snaperro__/v2/commands`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          protocolVersion: 2,
          type: "mode.set",
          commandId: "cmd_0123456789abcdef",
          expectedRevision: snapshot.revision,
          mode: "proxy",
        }),
      });
      expect(mode.status).toBe(200);

      const oldGeneration = runtime.generations.activeGenerationId;
      const existingResponse = await fetch(`${address.origin}/slow`);
      const existingReader = existingResponse.body?.getReader();
      expect(new TextDecoder().decode((await existingReader?.read())?.value)).toBe("before-");

      let reloadFinished = false;
      const reload = runtime.reload(makeConfig(secondUpstreamPort)).then(() => {
        reloadFinished = true;
      });
      await vi.waitFor(() => expect(runtime.generations.activeGenerationId).not.toBe(oldGeneration));

      const candidateResponse = await fetch(`${address.origin}/slow`);
      expect(candidateResponse.headers.get("x-upstream")).toBe("second");
      expect(await candidateResponse.text()).toBe("new");
      expect(reloadFinished).toBe(false);

      releaseFirst();
      expect(new TextDecoder().decode((await existingReader?.read())?.value)).toBe("after");
      expect((await existingReader?.read())?.done).toBe(true);
      await reload;
      expect(reloadFinished).toBe(true);
    } finally {
      releaseFirst();
      await runtime.stop();
    }
  }, 20_000);

  it("forces non-terminating upstream streams to abort at reload and shutdown deadlines", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "snaperro-v2-stream-deadline-"));
    directories.push(directory);
    const hangingUpstreamPort = await listen(
      createServer((_request, response) => {
        response.writeHead(200, { "content-type": "text/plain" });
        response.write("hanging");
      }),
    );
    const candidateUpstreamPort = await listen(
      createServer((request, response) => {
        response.writeHead(200, { "content-type": "text/plain" });
        response.write(request.url?.includes("finish=1") ? "candidate" : "hanging");
        if (request.url?.includes("finish=1")) response.end();
      }),
    );
    const snaperroPort = await availablePort();
    const configPath = path.join(directory, "snaperro.config.ts");
    const makeConfig = (upstreamPort: number) =>
      compileConfigV2(
        {
          configVersion: 2,
          server: { host: "127.0.0.1", port: snaperroPort, openBrowser: false, shutdownTimeoutMs: 100 },
          storage: { root: ".snaperro/v2" },
          apis: {
            upstream: {
              name: "Upstream",
              target: `http://127.0.0.1:${upstreamPort}`,
              routes: ["/slow"],
            },
          },
        },
        configPath,
      );
    const runtime = await createV2Server(makeConfig(hangingUpstreamPort));
    const address = await runtime.start();

    try {
      const snapshot = (await (await fetch(`${address.origin}/__snaperro__/v2/snapshot`)).json()) as {
        revision: number;
      };
      const mode = await fetch(`${address.origin}/__snaperro__/v2/commands`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          protocolVersion: 2,
          type: "mode.set",
          commandId: "cmd_0123456789abcdef",
          expectedRevision: snapshot.revision,
          mode: "proxy",
        }),
      });
      expect(mode.status).toBe(200);

      const oldResponse = await fetch(`${address.origin}/slow`);
      const oldReader = oldResponse.body?.getReader();
      expect(new TextDecoder().decode((await oldReader?.read())?.value)).toBe("hanging");

      await expect(runtime.reload(makeConfig(candidateUpstreamPort))).resolves.toBeUndefined();
      await expect(oldReader?.read()).rejects.toBeDefined();
      expect(await (await fetch(`${address.origin}/slow?finish=1`)).text()).toBe("candidate");

      const shutdownResponse = await fetch(`${address.origin}/slow`);
      const shutdownReader = shutdownResponse.body?.getReader();
      expect(new TextDecoder().decode((await shutdownReader?.read())?.value)).toBe("hanging");
      const shutdownError = await runtime.stop().catch((error: unknown) => error);
      expect(shutdownError).toBeInstanceOf(AggregateError);
      expect(runtime.state).toBe("stopped");
      await expect(shutdownReader?.read()).rejects.toBeDefined();
    } finally {
      await runtime.stop().catch(() => undefined);
    }
  }, 20_000);
});
