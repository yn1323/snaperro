import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RuntimeIdSchema, V2_SCHEMA_VERSION } from "../../../shared/contracts-v2/primitives.js";
import { compileConfigV2 } from "../config/config.js";
import { InMemoryEventHub } from "../events/in-memory-event-hub.js";
import { FilesystemGarbageCollector } from "../store/garbage-collector.js";
import { FilesystemTransferService } from "../transfer/filesystem-transfer-service.js";
import { RuntimeCore } from "./runtime-core.js";

const directories: string[] = [];

async function tempDirectory(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(process.cwd(), ".runtime-core-"));
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe("RuntimeCore", () => {
  it("assembles isolated application services over a v2 store", async () => {
    const directory = await tempDirectory();
    const config = compileConfigV2(
      {
        configVersion: 2,
        storage: { root: ".snaperro/v2" },
        apis: { jsonPlaceholder: { name: "Users", target: "https://example.com", routes: ["/users"] } },
      },
      path.join(directory, "snaperro.config.ts"),
    );
    const core = await RuntimeCore.create(config);

    const snapshot = await core.queries.execute({ protocolVersion: V2_SCHEMA_VERSION, type: "runtime.snapshot" });
    expect(RuntimeIdSchema.safeParse(snapshot.runtimeId).success).toBe(true);
    expect(snapshot.mode).toBe("smart");
    expect(snapshot.folders).toEqual({});
    const generation = core.createTrafficGeneration(config);
    expect(generation.id).toMatch(/^run_/u);

    await generation.close();
    await core.close();
    expect((await core.store.verifyIntegrity()).ok).toBe(true);
  });

  it("closes the partially initialized transfer, event, and GC resources when transfer readiness fails", async () => {
    const directory = await tempDirectory();
    const storageRoot = path.join(directory, ".snaperro", "v2");
    await fs.mkdir(storageRoot, { recursive: true });
    await fs.writeFile(path.join(storageRoot, "transfers"), "blocks the transfer directory", "utf8");
    const config = compileConfigV2(
      { configVersion: 2, storage: { root: ".snaperro/v2" }, apis: {} },
      path.join(directory, "snaperro.config.ts"),
    );
    const transferClose = vi.spyOn(FilesystemTransferService.prototype, "close");
    const eventClose = vi.spyOn(InMemoryEventHub.prototype, "close");
    const garbageCollectionClose = vi.spyOn(FilesystemGarbageCollector.prototype, "close");

    await expect(RuntimeCore.create(config)).rejects.toMatchObject({ code: "EEXIST" });

    expect(transferClose).toHaveBeenCalledOnce();
    expect(eventClose).toHaveBeenCalledOnce();
    expect(garbageCollectionClose).toHaveBeenCalledOnce();
    expect(transferClose.mock.invocationCallOrder[0]).toBeLessThan(eventClose.mock.invocationCallOrder[0] ?? 0);
    expect(eventClose.mock.invocationCallOrder[0]).toBeLessThan(
      garbageCollectionClose.mock.invocationCallOrder[0] ?? 0,
    );
    await expect(fs.access(path.join(storageRoot, ".store.lease"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps the initialization error primary when a partial-resource cleanup also fails", async () => {
    const directory = await tempDirectory();
    const storageRoot = path.join(directory, ".snaperro", "v2");
    await fs.mkdir(storageRoot, { recursive: true });
    await fs.writeFile(path.join(storageRoot, "transfers"), "blocks the transfer directory", "utf8");
    const config = compileConfigV2(
      { configVersion: 2, storage: { root: ".snaperro/v2" }, apis: {} },
      path.join(directory, "snaperro.config.ts"),
    );
    const cleanupError = new Error("event cleanup failed");
    const realEventClose = InMemoryEventHub.prototype.close;
    vi.spyOn(InMemoryEventHub.prototype, "close").mockImplementation(async function (this: InMemoryEventHub) {
      await realEventClose.call(this);
      throw cleanupError;
    });
    const garbageCollectionClose = vi.spyOn(FilesystemGarbageCollector.prototype, "close");

    const failure = await RuntimeCore.create(config).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as Error & { cause?: unknown }).cause).toMatchObject({ code: "EEXIST" });
    expect((failure as AggregateError).errors).toEqual([expect.objectContaining({ code: "EEXIST" }), cleanupError]);
    expect(garbageCollectionClose).toHaveBeenCalledOnce();
  });

  it("bounds each initialization rollback step and continues in reverse dependency order", async () => {
    const directory = await tempDirectory();
    const storageRoot = path.join(directory, ".snaperro", "v2");
    await fs.mkdir(storageRoot, { recursive: true });
    await fs.writeFile(path.join(storageRoot, "transfers"), "blocks the transfer directory", "utf8");
    const config = compileConfigV2(
      {
        configVersion: 2,
        storage: { root: ".snaperro/v2" },
        server: { shutdownTimeoutMs: 100 },
        apis: {},
      },
      path.join(directory, "snaperro.config.ts"),
    );
    let releaseTransferClose: (() => void) | undefined;
    const transferCloseGate = new Promise<void>((resolve) => {
      releaseTransferClose = resolve;
    });
    const realTransferClose = FilesystemTransferService.prototype.close;
    const transferClose = vi.spyOn(FilesystemTransferService.prototype, "close").mockImplementation(async function (
      this: FilesystemTransferService,
    ) {
      await realTransferClose.call(this).catch(() => undefined);
      await transferCloseGate;
    });
    const eventClose = vi.spyOn(InMemoryEventHub.prototype, "close");
    const garbageCollectionClose = vi.spyOn(FilesystemGarbageCollector.prototype, "close");

    try {
      const failure = await RuntimeCore.create(config).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(AggregateError);
      expect((failure as Error & { cause?: unknown }).cause).toMatchObject({ code: "EEXIST" });
      expect((failure as AggregateError).errors).toEqual([
        expect.objectContaining({ code: "EEXIST" }),
        expect.objectContaining({
          message: "Runtime core initialization cleanup step 1 did not settle within 100ms",
        }),
      ]);
      expect(transferClose).toHaveBeenCalledOnce();
      expect(eventClose).toHaveBeenCalledOnce();
      expect(garbageCollectionClose).toHaveBeenCalledOnce();
      expect(transferClose.mock.invocationCallOrder[0]).toBeLessThan(eventClose.mock.invocationCallOrder[0] ?? 0);
      expect(eventClose.mock.invocationCallOrder[0]).toBeLessThan(
        garbageCollectionClose.mock.invocationCallOrder[0] ?? 0,
      );
    } finally {
      releaseTransferClose?.();
    }
  });

  it("runs every shutdown step once even when transfer cleanup fails", async () => {
    const directory = await tempDirectory();
    const config = compileConfigV2(
      { configVersion: 2, storage: { root: ".snaperro/v2" }, apis: {} },
      path.join(directory, "snaperro.config.ts"),
    );
    const core = await RuntimeCore.create(config);
    const realTransferClose = core.transfers.close.bind(core.transfers);
    const realEventClose = core.events.close.bind(core.events);
    const realGarbageCollectionClose = core.store.garbageCollection.close.bind(core.store.garbageCollection);
    const transferError = new Error("transfer close failed");
    const eventError = new Error("event close failed");
    const garbageCollectionError = new Error("garbage collection close failed");
    const transferClose = vi.spyOn(core.transfers, "close").mockRejectedValue(transferError);
    const eventClose = vi.spyOn(core.events, "close").mockRejectedValue(eventError);
    const garbageCollectionClose = vi
      .spyOn(core.store.garbageCollection, "close")
      .mockRejectedValue(garbageCollectionError);

    const first = core.close();
    const second = core.close();
    expect(first).toBe(second);
    await expect(first).rejects.toMatchObject({
      errors: [transferError, eventError, garbageCollectionError],
    });

    expect(transferClose).toHaveBeenCalledOnce();
    expect(eventClose).toHaveBeenCalledOnce();
    expect(garbageCollectionClose).toHaveBeenCalledOnce();
    transferClose.mockRestore();
    eventClose.mockRestore();
    garbageCollectionClose.mockRestore();
    await Promise.all([realTransferClose(), realEventClose(), realGarbageCollectionClose()]);
  });

  it("starts later shutdown steps before a leading unsubscribe settles", async () => {
    const directory = await tempDirectory();
    const config = compileConfigV2(
      { configVersion: 2, storage: { root: ".snaperro/v2" }, apis: {} },
      path.join(directory, "snaperro.config.ts"),
    );
    const realSubscribe = InMemoryEventHub.prototype.subscribe;
    let releaseUnsubscribe = () => {};
    const unsubscribeGate = new Promise<void>((resolve) => {
      releaseUnsubscribe = resolve;
    });
    const unsubscribe = vi.fn();
    const subscribe = vi.spyOn(InMemoryEventHub.prototype, "subscribe").mockImplementation(async function (
      this: InMemoryEventHub,
      listener,
    ) {
      const realUnsubscribe = await realSubscribe.call(this, listener);
      return async () => {
        unsubscribe();
        await unsubscribeGate;
        await realUnsubscribe();
      };
    });
    try {
      const core = await RuntimeCore.create(config);
      const transferClose = vi.spyOn(core.transfers, "close");
      const eventClose = vi.spyOn(core.events, "close");
      const garbageCollectionClose = vi.spyOn(core.store.garbageCollection, "close");
      const closing = core.close();
      try {
        await vi.waitFor(() => {
          expect(unsubscribe).toHaveBeenCalledOnce();
          expect(transferClose).toHaveBeenCalledOnce();
          expect(eventClose).toHaveBeenCalledOnce();
          expect(garbageCollectionClose).toHaveBeenCalledOnce();
        });
      } finally {
        releaseUnsubscribe();
        await closing;
      }
    } finally {
      releaseUnsubscribe();
      subscribe.mockRestore();
    }
  });
});
