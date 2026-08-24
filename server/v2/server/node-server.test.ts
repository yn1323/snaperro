import { createServer } from "node:http";
import type { Socket } from "node:net";
import type { ServerType, serve } from "@hono/node-server";
import { describe, expect, it, vi } from "vitest";
import type {
  BlobStorePort,
  CommandBusPort,
  EventHubPort,
  LoggerPort,
  QueryBusPort,
  WriteCoordinatorPort,
} from "../application/ports.js";
import { compileConfigV2 } from "../config/config.js";
import type { TrafficRuntimeGeneration } from "../runtime/runtime-core.js";
import type { FolderTransferPort } from "../transport/transfer-api.js";
import { ImmutableConfigChangeError } from "./immutable-config.js";
import { closeNodeListener, createV2Server, type ManagedRuntimeCore, type RuntimeCoreFactory } from "./node-server.js";

function config(proxyUrl: string, server: Record<string, unknown> = {}) {
  return compileConfigV2(
    {
      configVersion: 2,
      server,
      proxy: { url: proxyUrl },
      apis: { jsonPlaceholder: { name: "Users", target: proxyUrl, routes: ["/users"] } },
    },
    "/workspace/snaperro.config.ts",
  );
}

function managedCore() {
  const generationCloses: Array<ReturnType<typeof vi.fn>> = [];
  let generation = 0;
  const createTrafficGeneration = vi.fn((nextConfig) => {
    if (nextConfig.proxy.url?.includes("invalid")) throw new Error("candidate setup failed");
    generation += 1;
    const close = vi.fn();
    generationCloses.push(close);
    return {
      id: `generation-${generation}`,
      traffic: {
        execute: vi.fn(async () => ({
          status: 200,
          statusText: "OK",
          headers: [["content-type", "text/plain"]],
          body: new Response(nextConfig.proxy.url).body,
        })),
      },
      close,
    } as unknown as TrafficRuntimeGeneration;
  });
  const core = {
    commands: {} as CommandBusPort,
    queries: {} as QueryBusPort,
    events: {} as EventHubPort,
    writes: {} as WriteCoordinatorPort,
    store: { blobs: {} as BlobStorePort, garbageCollection: { schedule: vi.fn() } },
    transfers: {} as FolderTransferPort & import("../transport/transfer-api.js").CapabilityDownloadPort,
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as LoggerPort,
    createTrafficGeneration,
    close: vi.fn(async () => {}),
  } as ManagedRuntimeCore;
  return { core, createTrafficGeneration, generationCloses };
}

describe("SnaperroV2Server", () => {
  it("atomically reloads traffic while retaining one stable core", async () => {
    const initial = config("https://one.example");
    const mutableReload = config("https://two.example");
    const { core, createTrafficGeneration, generationCloses } = managedCore();
    const coreFactory = vi.fn(async () => core) as RuntimeCoreFactory;
    const runtime = await createV2Server(initial, { coreFactory });

    expect(await (await runtime.app.request("/users")).text()).toBe("https://one.example");
    const stableStore = runtime.core.store;
    await runtime.reload(mutableReload);
    expect(await (await runtime.app.request("/users")).text()).toBe("https://two.example");
    expect(runtime.core.store).toBe(stableStore);
    expect(coreFactory).toHaveBeenCalledOnce();
    expect(generationCloses[0]).toHaveBeenCalledOnce();

    const activeId = runtime.generations.activeGenerationId;
    await expect(runtime.reload(config("https://two.example", { port: 4444 }))).rejects.toBeInstanceOf(
      ImmutableConfigChangeError,
    );
    expect(runtime.generations.activeGenerationId).toBe(activeId);
    expect(createTrafficGeneration).toHaveBeenCalledTimes(2);

    await expect(runtime.reload(config("https://invalid.example"))).rejects.toThrow("candidate setup failed");
    expect(runtime.generations.activeGenerationId).toBe(activeId);
    expect(await (await runtime.app.request("/users")).text()).toBe("https://two.example");

    await runtime.stop();
    expect(generationCloses[1]).toHaveBeenCalledOnce();
    expect(core.close).toHaveBeenCalledOnce();
  });

  it("lets an in-flight request drain on the old generation while new requests use the candidate", async () => {
    const initial = config("https://one.example");
    const next = config("https://two.example");
    const fixture = managedCore();
    let generationNumber = 0;
    let markOldStarted: (() => void) | undefined;
    const oldStarted = new Promise<void>((resolve) => {
      markOldStarted = resolve;
    });
    let releaseOld: (() => void) | undefined;
    const oldReleased = new Promise<void>((resolve) => {
      releaseOld = resolve;
    });
    let markCandidateCreated: (() => void) | undefined;
    const candidateCreated = new Promise<void>((resolve) => {
      markCandidateCreated = resolve;
    });
    fixture.core.createTrafficGeneration = vi.fn((generationConfig) => {
      generationNumber += 1;
      const number = generationNumber;
      if (number === 2) markCandidateCreated?.();
      return {
        id: `draining-generation-${number}`,
        traffic: {
          execute: async () => {
            if (number === 1) {
              markOldStarted?.();
              await oldReleased;
            }
            return {
              status: 200,
              statusText: "OK",
              headers: [] as [string, string][],
              body: new Response(generationConfig.proxy.url).body,
            };
          },
        },
        close: vi.fn(),
      } as unknown as TrafficRuntimeGeneration;
    });
    const runtime = await createV2Server(initial, { coreFactory: async () => fixture.core });

    const oldRequest = runtime.app.request("/users");
    await oldStarted;
    let reloadFinished = false;
    const reload = runtime.reload(next).then(() => {
      reloadFinished = true;
    });
    await candidateCreated;
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(runtime.generations.activeGenerationId).toBe("draining-generation-2");
    expect(await (await runtime.app.request("/users")).text()).toBe("https://two.example");
    expect(reloadFinished).toBe(false);

    releaseOld?.();
    expect(await (await oldRequest).text()).toBe("https://one.example");
    await reload;
    expect(reloadFinished).toBe(true);
    await runtime.stop();
  });

  it("keeps a committed candidate active when predecessor cleanup fails", async () => {
    const initial = config("https://one.example");
    const next = config("https://two.example");
    const fixture = managedCore();
    const runtime = await createV2Server(initial, { coreFactory: async () => fixture.core });
    fixture.generationCloses[0]?.mockRejectedValueOnce(new Error("old close failed"));

    await expect(runtime.reload(next)).resolves.toBeUndefined();
    expect(runtime.config.proxy.url).toBe("https://two.example");
    expect(await (await runtime.app.request("/users")).text()).toBe("https://two.example");
    expect(fixture.core.logger.error).toHaveBeenCalledWith(
      "Previous traffic generation cleanup failed after reload",
      expect.objectContaining({
        error: expect.objectContaining({ message: "old close failed" }),
        activeGenerationId: "generation-2",
      }),
    );

    await runtime.stop();
    expect(fixture.generationCloses[0]).toHaveBeenCalledTimes(2);
  });

  it("does not reject a committed reload when cleanup logging also fails", async () => {
    const initial = config("https://one.example");
    const next = config("https://two.example");
    const fixture = managedCore();
    const runtime = await createV2Server(initial, { coreFactory: async () => fixture.core });
    fixture.generationCloses[0]?.mockRejectedValueOnce(new Error("old close failed"));
    vi.mocked(fixture.core.logger.error).mockImplementationOnce(() => {
      throw new Error("logger unavailable");
    });

    await expect(runtime.reload(next)).resolves.toBeUndefined();
    expect(runtime.config.proxy.url).toBe("https://two.example");
    expect(await (await runtime.app.request("/users")).text()).toBe("https://two.example");

    await runtime.stop();
  });

  it("starts @hono/node-server with the configured host and port and stops idempotently", async () => {
    const initial = config("https://one.example", { host: "127.0.0.1", port: 4567 });
    const { core } = managedCore();
    const nodeServer = createServer();
    let received: { hostname?: string; port?: number } | undefined;
    const serveStub: typeof serve = (options, listening) => {
      received = { hostname: options.hostname, port: options.port };
      queueMicrotask(() => listening?.({ address: "127.0.0.1", family: "IPv4", port: options.port ?? 0 }));
      return nodeServer;
    };
    const runtime = await createV2Server(initial, { coreFactory: async () => core, serve: serveStub });

    const address = await runtime.start();
    expect(received).toEqual({ hostname: "127.0.0.1", port: 4567 });
    expect(address).toMatchObject({ host: "127.0.0.1", port: 4567 });
    expect(address.clientUrl).toBe("http://127.0.0.1:4567/__snaperro__/client");
    expect(runtime.state).toBe("running");

    await Promise.all([runtime.stop(), runtime.stop()]);
    expect(runtime.state).toBe("stopped");
    expect(runtime.address).toBeUndefined();
    await expect(runtime.start()).rejects.toThrow("stopped");
    expect(core.close).toHaveBeenCalledOnce();
  });

  it("bounds runtime-core cleanup after traffic generations have stopped", async () => {
    vi.useFakeTimers();
    try {
      const initial = config("https://one.example", { shutdownTimeoutMs: 100 });
      const { core, generationCloses } = managedCore();
      core.close = vi.fn(() => new Promise<void>(() => undefined));
      const runtime = await createV2Server(initial, { coreFactory: async () => core });

      const stopping = runtime.stop();
      const outcome = stopping.catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(100);
      const error = await outcome;

      expect(error).toBeInstanceOf(AggregateError);
      expect((error as AggregateError).errors).toEqual([
        expect.objectContaining({ message: "Runtime core shutdown did not settle within 100ms" }),
      ]);
      expect(generationCloses[0]).toHaveBeenCalledOnce();
      expect(core.close).toHaveBeenCalledOnce();
      expect(runtime.state).toBe("stopped");
    } finally {
      vi.useRealTimers();
    }
  });

  it("closes the initialized generation and core when app assembly fails", async () => {
    const initial = config("https://one.example");
    const fixture = managedCore();

    await expect(createV2Server(initial, { coreFactory: async () => fixture.core, heartbeatMs: 1 })).rejects.toThrow(
      "heartbeatMs must be an integer of at least 100 milliseconds",
    );

    expect(fixture.generationCloses[0]).toHaveBeenCalledOnce();
    expect(fixture.core.close).toHaveBeenCalledOnce();
    expect(fixture.generationCloses[0]?.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(fixture.core.close).mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("closes the core when generation-supervisor construction fails", async () => {
    const initial = config("https://one.example");
    const invalid = {
      ...initial,
      server: { ...initial.server, shutdownTimeoutMs: 0 },
    };
    const fixture = managedCore();

    await expect(createV2Server(invalid, { coreFactory: async () => fixture.core })).rejects.toThrow(
      "drainTimeoutMs must be a positive safe integer",
    );

    expect(fixture.createTrafficGeneration).not.toHaveBeenCalled();
    expect(fixture.core.close).toHaveBeenCalledOnce();
  });

  it("keeps the app assembly error primary while reporting every cleanup failure", async () => {
    const initial = config("https://one.example");
    const fixture = managedCore();
    const generationCloseError = new Error("generation close failed");
    const coreCloseError = new Error("core close failed");
    fixture.core.createTrafficGeneration = vi.fn(() => {
      const close = vi.fn(async () => {
        throw generationCloseError;
      });
      fixture.generationCloses.push(close);
      return {
        id: "failing-generation",
        traffic: { execute: vi.fn() },
        close,
      } as unknown as TrafficRuntimeGeneration;
    });
    vi.mocked(fixture.core.close).mockRejectedValue(coreCloseError);

    const failure = await createV2Server(initial, {
      coreFactory: async () => fixture.core,
      heartbeatMs: 1,
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as Error & { cause?: unknown }).cause).toMatchObject({
      message: "heartbeatMs must be an integer of at least 100 milliseconds",
    });
    expect((failure as AggregateError).errors).toEqual([
      expect.objectContaining({ message: "heartbeatMs must be an integer of at least 100 milliseconds" }),
      generationCloseError,
      coreCloseError,
    ]);
    expect(fixture.generationCloses[0]).toHaveBeenCalledOnce();
    expect(fixture.core.close).toHaveBeenCalledOnce();
    expect(fixture.generationCloses[0]?.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(fixture.core.close).mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("bounds runtime-core cleanup when server assembly fails", async () => {
    vi.useFakeTimers();
    try {
      const initial = config("https://one.example", { shutdownTimeoutMs: 100 });
      const fixture = managedCore();
      let markCoreCloseStarted: (() => void) | undefined;
      const coreCloseStarted = new Promise<void>((resolve) => {
        markCoreCloseStarted = resolve;
      });
      fixture.core.close = vi.fn(() => {
        markCoreCloseStarted?.();
        return new Promise<void>(() => undefined);
      });

      const failurePromise = createV2Server(initial, {
        coreFactory: async () => fixture.core,
        heartbeatMs: 1,
      }).catch((error: unknown) => error);
      await coreCloseStarted;
      await vi.advanceTimersByTimeAsync(100);
      const failure = await failurePromise;

      expect(failure).toBeInstanceOf(AggregateError);
      expect((failure as Error & { cause?: unknown }).cause).toMatchObject({
        message: "heartbeatMs must be an integer of at least 100 milliseconds",
      });
      expect((failure as AggregateError).errors).toEqual([
        expect.objectContaining({ message: "heartbeatMs must be an integer of at least 100 milliseconds" }),
        expect.objectContaining({ message: "Runtime core initialization cleanup did not settle within 100ms" }),
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("closeNodeListener", () => {
  it("forces remaining sockets closed after the graceful deadline", async () => {
    let finishClose: (() => void) | undefined;
    const server = {
      close: vi.fn((callback: () => void) => {
        finishClose = callback;
      }),
      closeIdleConnections: vi.fn(),
    } as unknown as ServerType;
    const socket = {
      destroy: vi.fn(() => {
        finishClose?.();
      }),
    } as unknown as Socket;

    await closeNodeListener(server, new Set([socket]), 5);
    expect(socket.destroy).toHaveBeenCalledOnce();
  });

  it("returns at the force deadline even when the server never invokes its close callback", async () => {
    vi.useFakeTimers();
    try {
      const closeAllConnections = vi.fn();
      const server = {
        close: vi.fn(),
        closeAllConnections,
        closeIdleConnections: vi.fn(),
      } as unknown as ServerType;
      const socket = { destroy: vi.fn() } as unknown as Socket;

      const closing = closeNodeListener(server, new Set([socket]), 5);
      const assertion = expect(closing).resolves.toBeUndefined();
      await vi.advanceTimersByTimeAsync(5);
      await assertion;

      expect(closeAllConnections).toHaveBeenCalledOnce();
      expect(socket.destroy).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports a force-close failure without leaving listener shutdown pending", async () => {
    vi.useFakeTimers();
    try {
      const forceError = new Error("force close failed");
      const server = {
        close: vi.fn(),
        closeAllConnections: vi.fn(() => {
          throw forceError;
        }),
        closeIdleConnections: vi.fn(),
      } as unknown as ServerType;
      const socket = { destroy: vi.fn() } as unknown as Socket;

      const closing = closeNodeListener(server, new Set([socket]), 5);
      const assertion = expect(closing).rejects.toMatchObject({ errors: [forceError] });
      await vi.advanceTimersByTimeAsync(5);
      await assertion;

      expect(socket.destroy).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});
