import { describe, expect, it, vi } from "vitest";
import { RevisionSchema, type RuntimeId } from "../../../shared/contracts-v2/primitives.js";
import type { QueryBusPort } from "./ports.js";
import { openSnapshotSubscription } from "./snapshot-subscription.js";
import { applicationTestIds, FakeEventHub, MutexWriteCoordinator } from "./test-doubles.js";

function snapshot(runtimeId: RuntimeId) {
  return {
    protocolVersion: 2 as const,
    runtimeId,
    revision: RevisionSchema.parse(0),
    version: "2.0.0-test",
    mode: "smart" as const,
    currentScenarioId: null,
    folders: {},
    scenarios: {},
  };
}

describe("openSnapshotSubscription", () => {
  it("prevents a state commit from entering the snapshot-to-subscription interval", async () => {
    const runtimeId = applicationTestIds.runtime;
    const writes = new MutexWriteCoordinator();
    const events = new FakeEventHub();
    let markQueryStarted: (() => void) | undefined;
    let releaseQuery: (() => void) | undefined;
    const queryStarted = new Promise<void>((resolve) => {
      markQueryStarted = resolve;
    });
    const queryReleased = new Promise<void>((resolve) => {
      releaseQuery = resolve;
    });
    const queries = {
      execute: vi.fn(async () => {
        markQueryStarted?.();
        await queryReleased;
        return snapshot(runtimeId);
      }),
    } as unknown as QueryBusPort;

    const opening = openSnapshotSubscription({ events, queries, writes }, async () => {});
    await queryStarted;
    let concurrentCommitEntered = false;
    const concurrentCommit = writes.withCatalogWrite(async () => {
      concurrentCommitEntered = true;
    });
    await Promise.resolve();
    expect(concurrentCommitEntered).toBe(false);

    releaseQuery?.();
    const opened = await opening;
    await concurrentCommit;

    expect(opened.snapshot.revision).toBe(0);
    expect(opened.watermark.sequence).toBe(0);
    expect(concurrentCommitEntered).toBe(true);
    await opened.unsubscribe();
  });
});
