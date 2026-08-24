import { describe, expect, it, vi } from "vitest";
import { ScenarioIdSchema } from "../../../shared/contracts-v2/primitives.js";
import { OperationAbortedError } from "../domain/errors.js";
import { ConsoleLogger, ProcessWriteCoordinator, RandomIdGenerator } from "./system-adapters.js";

describe("RandomIdGenerator", () => {
  it("generates contract-valid and distinct identifiers", () => {
    const ids = new RandomIdGenerator();
    expect(ids.nextFolderId()).toMatch(/^fld_/u);
    expect(ids.nextScenarioId()).toMatch(/^scn_/u);
    expect(ids.nextRecordingId()).not.toBe(ids.nextRecordingId());
    expect(ids.nextRuntimeId()).toMatch(/^run_/u);
    expect(ids.nextCommandId()).toMatch(/^cmd_/u);
    expect(ids.nextRequestId()).toMatch(/^req_/u);
    expect(ids.nextTransferId()).toMatch(/^xfer_/u);
  });
});

describe("ProcessWriteCoordinator", () => {
  it("serializes catalog writes", async () => {
    const coordinator = new ProcessWriteCoordinator();
    const order: string[] = [];
    let releaseFirst!: () => void;
    let startedFirst!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const started = new Promise<void>((resolve) => {
      startedFirst = resolve;
    });
    const first = coordinator.withCatalogWrite(async () => {
      order.push("first:start");
      startedFirst();
      await gate;
      order.push("first:end");
    });
    const second = coordinator.withCatalogWrite(async () => {
      order.push("second");
    });
    await started;
    expect(order).toEqual(["first:start"]);
    releaseFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(["first:start", "first:end", "second"]);
  });

  it("rejects an aborted operation before entering its critical section", async () => {
    const controller = new AbortController();
    controller.abort("stop");
    await expect(
      new ProcessWriteCoordinator().withScenarioWrite(ScenarioIdSchema.parse("scn_0123456789abcdef"), vi.fn(), {
        signal: controller.signal,
      }),
    ).rejects.toBeInstanceOf(OperationAbortedError);
  });

  it("holds the store lease across a catalog transaction", async () => {
    const order: string[] = [];
    const coordinator = new ProcessWriteCoordinator({
      acquire: async () => {
        order.push("acquire");
        return {
          owner: "test",
          assertOwned: async () => undefined,
          release: async () => void order.push("release"),
        };
      },
    });

    await coordinator.withCatalogWrite(async () => {
      order.push("operation");
    });

    expect(order).toEqual(["acquire", "operation", "release"]);
  });

  it("keeps a catalog transaction failure primary when lease release also fails", async () => {
    const primary = new Error("transaction failed");
    const cleanup = new Error("release failed");
    const coordinator = new ProcessWriteCoordinator({
      acquire: async () => ({
        owner: "test",
        assertOwned: async () => undefined,
        release: async () => Promise.reject(cleanup),
      }),
    });

    const failure = await coordinator.withCatalogWrite(async () => Promise.reject(primary)).catch((error) => error);
    expect(failure).toBe(primary);
  });
});

describe("ConsoleLogger", () => {
  it("redacts sensitive structured fields", () => {
    const write = vi.fn();
    new ConsoleLogger({ write }).info("request", { authorization: "Bearer secret", path: "/users" });
    expect(write).toHaveBeenCalledWith('INFO request {"authorization":"[redacted]","path":"/users"}');
  });
});
