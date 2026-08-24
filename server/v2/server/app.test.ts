import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RuntimeSnapshotSchema } from "../../../shared/contracts-v2/entities.js";
import { RevisionSchema, RuntimeIdSchema, V2_SCHEMA_VERSION } from "../../../shared/contracts-v2/primitives.js";
import type { BlobStorePort, CommandBusPort, LoggerPort, QueryBusPort } from "../application/ports.js";
import { compileConfigV2 } from "../config/config.js";
import { InMemoryEventHub } from "../events/in-memory-event-hub.js";
import { GenerationSupervisor } from "../runtime/generation-supervisor.js";
import type { TrafficRuntimeGeneration } from "../runtime/runtime-core.js";
import { ProcessWriteCoordinator } from "../runtime/system-adapters.js";
import type { TrafficResponse } from "../traffic/proxy-service.js";
import type { CapabilityDownloadPort, FolderTransferPort } from "../transport/transfer-api.js";
import { createV2App } from "./app.js";

const directories: string[] = [];
const runtimeId = RuntimeIdSchema.parse("run_0123456789abcdef");
const token = "stable-control-token";

function snapshot() {
  return RuntimeSnapshotSchema.parse({
    protocolVersion: V2_SCHEMA_VERSION,
    runtimeId,
    revision: RevisionSchema.parse(0),
    version: "2.0.0-test",
    mode: "smart",
    currentScenarioId: null,
    folders: {},
    scenarios: {},
  });
}

async function staticRoots() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "snaperro-app-"));
  directories.push(directory);
  const client = path.join(directory, "client");
  const demo = path.join(directory, "demo");
  await Promise.all([fs.mkdir(client), fs.mkdir(demo)]);
  await Promise.all([
    fs.writeFile(path.join(client, "index.html"), "<title>Client</title>"),
    fs.writeFile(path.join(demo, "index.html"), "<title>Demo</title>"),
  ]);
  return { client, demo };
}

async function fixture(drainTimeoutMs?: number) {
  const config = compileConfigV2(
    {
      configVersion: 2,
      server: { controlToken: token },
      storage: { maxImportBytes: 1024 },
      proxy: { url: "https://example.com" },
      apis: { jsonPlaceholder: { name: "Users", target: "https://example.com", routes: ["/users"] } },
    },
    "/workspace/snaperro.config.ts",
  );
  const events = new InMemoryEventHub({ runtimeId, initialRevision: RevisionSchema.parse(0) });
  const queries = { execute: vi.fn(async () => snapshot()) } as unknown as QueryBusPort;
  const commands = { execute: vi.fn() } as unknown as CommandBusPort;
  const executeTraffic = vi.fn(
    async (): Promise<TrafficResponse> => ({
      status: 202,
      statusText: "Accepted",
      headers: [["x-snaperro-generation", "active"]] as [string, string][],
      body: new Response("traffic generation").body,
    }),
  );
  const abortGeneration = vi.fn();
  const closeGeneration = vi.fn();
  const generations = new GenerationSupervisor<TrafficRuntimeGeneration>({ drainTimeoutMs });
  await generations.initialize(
    async () =>
      ({
        id: "generation-active",
        traffic: { execute: executeTraffic },
        abort: abortGeneration,
        close: closeGeneration,
      }) as unknown as TrafficRuntimeGeneration,
  );
  const roots = await staticRoots();
  const openCapability = vi.fn(async () => ({
    filename: "large.zip",
    mediaType: "application/zip",
    contentEncoding: null,
    size: 3,
    stream: new Blob(["zip"]).stream(),
  }));
  const stageImport = vi.fn();
  const stageRecordingImport = vi.fn();
  const app = createV2App({
    config,
    generations,
    staticAssets: roots,
    heartbeatMs: 100,
    core: {
      commands,
      queries,
      events,
      writes: new ProcessWriteCoordinator(),
      store: { blobs: {} as BlobStorePort, garbageCollection: { schedule: vi.fn() } },
      logger: { error: vi.fn() } as unknown as LoggerPort,
      transfers: {
        stageImport,
        stageRecordingImport,
        openCapability,
      } as FolderTransferPort & CapabilityDownloadPort,
    },
  });
  return {
    app,
    events,
    generations,
    executeTraffic,
    abortGeneration,
    closeGeneration,
    openCapability,
    stageImport,
    stageRecordingImport,
  };
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe("createV2App", () => {
  it("mounts the stable control plane and static applications before traffic", async () => {
    const { app, events, generations, executeTraffic, openCapability } = await fixture();
    const authorization = { authorization: `Bearer ${token}` };

    expect((await app.request("/__snaperro__/v2/snapshot")).status).toBe(401);
    const control = await app.request("/__snaperro__/v2/snapshot", { headers: authorization });
    expect(control.status).toBe(200);
    expect((await control.json()) as unknown).toMatchObject({ runtimeId, revision: 0 });
    expect((await app.request("/__snaperro__/v2/bodies/not-a-digest", { headers: authorization })).status).toBe(404);
    expect((await app.request("/__snaperro__/v2/transfers/not-an-id", { headers: authorization })).status).toBe(404);

    expect(await (await app.request("/__snaperro__/client")).text()).toContain("Client");
    expect(await (await app.request("/__snaperro__/demo/")).text()).toContain("Demo");
    expect((await app.request("/__snaperro__/unknown")).status).toBe(404);
    const capability = "a".repeat(43);
    const download = await app.request(`/__snaperro__/downloads/${capability}`);
    expect(download.status).toBe(200);
    expect(await download.text()).toBe("zip");
    expect(openCapability).toHaveBeenCalledWith(capability, expect.anything());
    expect((await app.request("/__snaperro__/downloads/not-valid")).status).toBe(404);
    expect(executeTraffic).not.toHaveBeenCalled();

    const traffic = await app.request("/users?page=1", { method: "POST", body: "request" });
    expect(traffic.status).toBe(202);
    expect(traffic.headers.get("x-snaperro-generation")).toBe("active");
    expect(await traffic.text()).toBe("traffic generation");
    expect(executeTraffic).toHaveBeenCalledOnce();

    await generations.stop();
    await events.close();
  });

  it("applies the configured import byte limit before either ZIP staging route", async () => {
    const { app, events, generations, stageImport, stageRecordingImport } = await fixture();
    const headers = {
      authorization: `Bearer ${token}`,
      "content-type": "application/zip",
      "content-length": "1025",
    };

    const folder = await app.request("/__snaperro__/v2/transfers/imports?filename=folder.zip", {
      method: "POST",
      headers,
      body: "zip",
    });
    const recording = await app.request("/__snaperro__/v2/transfers/recording-imports?filename=recording.zip", {
      method: "POST",
      headers,
      body: "zip",
    });

    expect(folder.status).toBe(413);
    expect(recording.status).toBe(413);
    expect(stageImport).not.toHaveBeenCalled();
    expect(stageRecordingImport).not.toHaveBeenCalled();
    await generations.stop();
    await events.close();
  });

  it("keeps SSE on the stable core rather than the active traffic generation", async () => {
    const { app, events, generations, executeTraffic } = await fixture();
    const controller = new AbortController();
    const response = await app.request("/__snaperro__/v2/events", {
      headers: { authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    const reader = response.body?.getReader();
    const first = await reader?.read();
    expect(new TextDecoder().decode(first?.value)).toContain("runtime.connected");
    expect(executeTraffic).not.toHaveBeenCalled();

    controller.abort();
    await reader?.cancel();
    await generations.stop();
    await events.close();
  });

  it("keeps the old generation leased after response EOF until background capture settles", async () => {
    const { app, events, generations, executeTraffic, closeGeneration } = await fixture();
    let settleCapture = () => {};
    const captureCompletion = new Promise<void>((resolve) => {
      settleCapture = resolve;
    });
    executeTraffic.mockResolvedValueOnce({
      status: 200,
      statusText: "OK",
      headers: [],
      body: new Blob(["complete response"]).stream(),
      generationCompletion: captureCompletion,
    });

    const oldGeneration = generations.activeGenerationId;
    const response = await app.request("/users");
    expect(await response.text()).toBe("complete response");

    const replacement = {
      id: "generation-next",
      traffic: { execute: vi.fn() },
      abort: vi.fn(),
      close: vi.fn(),
    } as unknown as TrafficRuntimeGeneration;
    const reload = generations.reload(async () => replacement);
    await vi.waitFor(() => expect(generations.activeGenerationId).toBe("generation-next"));
    expect(oldGeneration).toBe("generation-active");
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(closeGeneration).not.toHaveBeenCalled();

    settleCapture();
    await reload;
    await generations.stop();
    await events.close();
  });

  it("releases the generation when a pending response read never settles its upstream cancellation", async () => {
    const { app, events, generations, executeTraffic, closeGeneration } = await fixture();
    const cancelSource = vi.fn(() => new Promise<void>(() => undefined));
    executeTraffic.mockResolvedValueOnce({
      status: 200,
      statusText: "OK",
      headers: [],
      body: new ReadableStream<Uint8Array>({
        pull() {
          return new Promise<void>(() => undefined);
        },
        cancel: cancelSource,
      }),
    });

    const response = await app.request("/users");
    const reader = response.body?.getReader();
    const pendingRead = reader?.read();
    await expect(reader?.cancel("client disconnected")).resolves.toBeUndefined();
    await expect(pendingRead).resolves.toMatchObject({ done: true });
    expect(cancelSource).toHaveBeenCalledOnce();

    await generations.reload(
      async () =>
        ({
          id: "generation-next",
          traffic: { execute: vi.fn() },
          abort: vi.fn(),
          close: vi.fn(),
        }) as unknown as TrafficRuntimeGeneration,
    );
    expect(closeGeneration).toHaveBeenCalledOnce();

    await generations.stop();
    await events.close();
  });

  it("aborts a capture that remains pending past the generation drain deadline", async () => {
    const { app, events, generations, executeTraffic, abortGeneration, closeGeneration } = await fixture(5);
    let rejectCapture = (_reason: unknown) => {};
    const captureCompletion = new Promise<void>((_resolve, reject) => {
      rejectCapture = reject;
    });
    abortGeneration.mockImplementationOnce((reason: unknown) => rejectCapture(reason));
    executeTraffic.mockResolvedValueOnce({
      status: 200,
      statusText: "OK",
      headers: [],
      body: new Blob(["complete response"]).stream(),
      generationCompletion: captureCompletion,
    });

    const response = await app.request("/users");
    expect(await response.text()).toBe("complete response");
    await generations.reload(
      async () =>
        ({
          id: "generation-next",
          traffic: { execute: vi.fn() },
          abort: vi.fn(),
          close: vi.fn(),
        }) as unknown as TrafficRuntimeGeneration,
    );

    expect(abortGeneration).toHaveBeenCalledOnce();
    expect(abortGeneration.mock.calls[0]?.[0]).toMatchObject({
      message: "Runtime generation drain exceeded 5ms",
    });
    expect(closeGeneration).toHaveBeenCalledOnce();
    await generations.stop();
    await events.close();
  });
});
