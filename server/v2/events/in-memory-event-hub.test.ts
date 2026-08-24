import { describe, expect, it, vi } from "vitest";
import { RevisionSchema, RuntimeIdSchema } from "../../../shared/contracts-v2/primitives.js";
import { EventReplayUnavailableError, InMemoryEventHub } from "./in-memory-event-hub.js";

function hub(replayCapacity = 8, shutdownTimeoutMs = 5_000) {
  return new InMemoryEventHub({
    runtimeId: RuntimeIdSchema.parse("run_1234567890abcdef"),
    initialRevision: RevisionSchema.parse(0),
    replayCapacity,
    shutdownTimeoutMs,
    now: () => "2026-08-24T00:00:00.000Z",
  });
}

describe("InMemoryEventHub", () => {
  it("couples an event type to its payload and advances the watermark", async () => {
    const events = hub();
    const event = await events.publish({
      type: "mode.changed",
      revision: RevisionSchema.parse(1),
      payload: { mode: "record" },
    });

    expect(event).toMatchObject({
      type: "mode.changed",
      sequence: 1,
      revision: 1,
      payload: { mode: "record" },
    });
    expect(events.watermark()).toMatchObject({ sequence: 1, revision: 1 });
  });

  it("delivers concurrent publications to each subscriber in sequence order", async () => {
    const events = hub();
    const received: number[] = [];
    const unsubscribe = await events.subscribe(async (event) => {
      await Promise.resolve();
      received.push(event.sequence);
    });

    await Promise.all([
      events.publish({ type: "mode.changed", revision: RevisionSchema.parse(1), payload: { mode: "proxy" } }),
      events.publish({ type: "mode.changed", revision: RevisionSchema.parse(2), payload: { mode: "record" } }),
      events.publish({ type: "mode.changed", revision: RevisionSchema.parse(3), payload: { mode: "mock" } }),
    ]);
    await unsubscribe();

    expect(received).toEqual([1, 2, 3]);
  });

  it("replays retained events after the requested sequence", async () => {
    const events = hub();
    await events.publish({ type: "mode.changed", revision: RevisionSchema.parse(1), payload: { mode: "record" } });
    await events.publish({ type: "mode.changed", revision: RevisionSchema.parse(2), payload: { mode: "mock" } });
    const received: number[] = [];

    const unsubscribe = await events.subscribe(async (event) => void received.push(event.sequence), {
      afterSequence: (events.watermark().sequence - 1) as never,
    });
    await unsubscribe();

    expect(received).toEqual([2]);
  });

  it("captures the watermark and installs a subscriber as one atomic operation", async () => {
    const events = hub();
    await events.publish({ type: "mode.changed", revision: RevisionSchema.parse(1), payload: { mode: "record" } });
    const received: number[] = [];

    const subscription = await events.subscribeWithWatermark(async (event) => void received.push(event.sequence));
    await events.publish({ type: "mode.changed", revision: RevisionSchema.parse(2), payload: { mode: "mock" } });
    await subscription.unsubscribe();

    expect(subscription.watermark).toMatchObject({ sequence: 1, revision: 1 });
    expect(received).toEqual([2]);
  });

  it("atomically upgrades concurrent telemetry to the current catalog revision", async () => {
    const events = hub();
    await events.publish({ type: "mode.changed", revision: RevisionSchema.parse(1), payload: { mode: "record" } });

    const telemetry = await events.publish({
      type: "runtime.shutting-down",
      revision: RevisionSchema.parse(0),
      payload: { reason: "test complete" },
    });

    expect(telemetry.revision).toBe(1);
    expect(events.watermark()).toMatchObject({ sequence: 2, revision: 1 });
  });

  it("rejects a replay request older than the retained buffer", async () => {
    const events = hub(1);
    await events.publish({ type: "mode.changed", revision: RevisionSchema.parse(1), payload: { mode: "record" } });
    await events.publish({ type: "mode.changed", revision: RevisionSchema.parse(2), payload: { mode: "mock" } });

    await expect(
      events.subscribe(async () => {}, { afterSequence: RevisionSchema.parse(0) as never }),
    ).rejects.toBeInstanceOf(EventReplayUnavailableError);
  });

  it("coalesces a slow subscriber backlog to the latest event within the replay capacity", async () => {
    const events = hub(2);
    const received: number[] = [];
    let releaseFirst: (() => void) | undefined;
    const firstReleased = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let markFirstStarted: (() => void) | undefined;
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    const unsubscribe = await events.subscribe(async (event) => {
      received.push(event.sequence);
      if (event.sequence === 1) {
        markFirstStarted?.();
        await firstReleased;
      }
    });

    await events.publish({ type: "mode.changed", revision: RevisionSchema.parse(1), payload: { mode: "proxy" } });
    await firstStarted;
    await events.publish({ type: "mode.changed", revision: RevisionSchema.parse(2), payload: { mode: "record" } });
    await events.publish({ type: "mode.changed", revision: RevisionSchema.parse(3), payload: { mode: "mock" } });
    await events.publish({ type: "mode.changed", revision: RevisionSchema.parse(4), payload: { mode: "smart" } });
    await events.publish({ type: "mode.changed", revision: RevisionSchema.parse(5), payload: { mode: "proxy" } });

    expect(received).toEqual([1]);
    releaseFirst?.();
    await unsubscribe();
    expect(received).toEqual([1, 5]);
  });

  it("bounds close when a subscriber never settles", async () => {
    vi.useFakeTimers();
    try {
      const events = hub(8, 25);
      let markStarted: (() => void) | undefined;
      const started = new Promise<void>((resolve) => {
        markStarted = resolve;
      });
      await events.subscribe(async () => {
        markStarted?.();
        await new Promise<void>(() => undefined);
      });
      await events.publish({ type: "mode.changed", revision: RevisionSchema.parse(1), payload: { mode: "proxy" } });
      await started;

      const closing = events.close();
      const assertion = expect(closing).rejects.toThrow("Event subscribers did not settle within 25ms");
      await vi.advanceTimersByTimeAsync(25);
      await assertion;
      expect(events.close()).toBe(closing);
    } finally {
      vi.useRealTimers();
    }
  });

  it("bounds unsubscribe when its listener never settles", async () => {
    vi.useFakeTimers();
    try {
      const events = hub(8, 25);
      let markStarted: (() => void) | undefined;
      const started = new Promise<void>((resolve) => {
        markStarted = resolve;
      });
      const unsubscribe = await events.subscribe(async () => {
        markStarted?.();
        await new Promise<void>(() => undefined);
      });
      await events.publish({ type: "mode.changed", revision: RevisionSchema.parse(1), payload: { mode: "proxy" } });
      await started;

      const unsubscribing = unsubscribe();
      const assertion = expect(unsubscribing).rejects.toThrow("Event subscriber did not settle within 25ms");
      await vi.advanceTimersByTimeAsync(25);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("observes a timed-out unsubscribe triggered by an abort signal", async () => {
    vi.useFakeTimers();
    try {
      const events = hub(8, 25);
      const controller = new AbortController();
      let markStarted: (() => void) | undefined;
      const started = new Promise<void>((resolve) => {
        markStarted = resolve;
      });
      await events.subscribe(
        async () => {
          markStarted?.();
          await new Promise<void>(() => undefined);
        },
        { signal: controller.signal },
      );
      await events.publish({ type: "mode.changed", revision: RevisionSchema.parse(1), payload: { mode: "proxy" } });
      await started;

      controller.abort(new Error("client disconnected"));
      await vi.advanceTimersByTimeAsync(25);

      await expect(events.close()).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
