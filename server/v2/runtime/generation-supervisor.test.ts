import { describe, expect, it, vi } from "vitest";
import { GenerationSupervisor, type RuntimeGeneration } from "./generation-supervisor.js";

function generation(id: string): RuntimeGeneration & {
  abort: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
} {
  return { id, abort: vi.fn(async () => {}), close: vi.fn(async () => {}) };
}

describe("GenerationSupervisor", () => {
  it("keeps the active generation when candidate preparation fails", async () => {
    const supervisor = new GenerationSupervisor<RuntimeGeneration>();
    const first = generation("first");
    await supervisor.initialize(async () => first);

    await expect(supervisor.reload(async () => Promise.reject(new Error("invalid config")))).rejects.toThrow(
      "invalid config",
    );

    expect(supervisor.activeGenerationId).toBe("first");
    expect(first.close).not.toHaveBeenCalled();
  });

  it("atomically exposes the candidate and drains the previous generation", async () => {
    const supervisor = new GenerationSupervisor<RuntimeGeneration>();
    const first = generation("first");
    const second = generation("second");
    await supervisor.initialize(async () => first);

    let releaseRequest = () => {};
    const requestGate = new Promise<void>((resolve) => {
      releaseRequest = resolve;
    });
    const oldRequest = supervisor.run(async (active) => {
      expect(active.id).toBe("first");
      await requestGate;
    });

    const reload = supervisor.reload(async () => second);
    await vi.waitFor(() => expect(supervisor.activeGenerationId).toBe("second"));
    expect(first.close).not.toHaveBeenCalled();
    expect(await supervisor.run((active) => active.id)).toBe("second");

    releaseRequest();
    await oldRequest;
    await reload;

    expect(first.close).toHaveBeenCalledOnce();
    expect(second.close).not.toHaveBeenCalled();
  });

  it("reports predecessor cleanup failure without rejecting an already committed reload", async () => {
    const supervisor = new GenerationSupervisor<RuntimeGeneration>();
    const first = generation("first");
    const second = generation("second");
    first.close.mockRejectedValueOnce(new Error("old close failed"));
    await supervisor.initialize(async () => first);

    await expect(supervisor.reload(async () => second)).resolves.toMatchObject({
      previousCleanupError: expect.objectContaining({ message: "old close failed" }),
    });
    expect(supervisor.activeGenerationId).toBe("second");

    await supervisor.stop();
    expect(first.close).toHaveBeenCalledTimes(2);
    expect(second.close).toHaveBeenCalledOnce();
    expect(second.close.mock.invocationCallOrder[0]).toBeLessThan(first.close.mock.invocationCallOrder[1] ?? 0);
  });

  it("drains and closes the active generation on stop", async () => {
    const supervisor = new GenerationSupervisor<RuntimeGeneration>();
    const active = generation("active");
    await supervisor.initialize(async () => active);

    const first = supervisor.stop();
    const second = supervisor.stop();
    expect(first).toBe(second);
    await first;
    expect(supervisor.stop()).toBe(first);

    expect(active.close).toHaveBeenCalledOnce();
    await expect(supervisor.run(() => undefined)).rejects.toThrow("stopped");
  });

  it("keeps an explicitly acquired generation alive until its idempotent release", async () => {
    const supervisor = new GenerationSupervisor<RuntimeGeneration>();
    const first = generation("first");
    const second = generation("second");
    await supervisor.initialize(async () => first);

    const lease = supervisor.acquire();
    const reload = supervisor.reload(async () => second);
    await vi.waitFor(() => expect(supervisor.activeGenerationId).toBe("second"));
    expect(first.close).not.toHaveBeenCalled();

    lease.release();
    lease.release();
    await reload;
    expect(first.close).toHaveBeenCalledOnce();
  });

  it("aborts a generation that does not drain before the configured deadline", async () => {
    const supervisor = new GenerationSupervisor<RuntimeGeneration>({ drainTimeoutMs: 5 });
    const active = generation("active");
    await supervisor.initialize(async () => active);
    const lease = supervisor.acquire();

    await supervisor.stop();

    expect(active.abort).toHaveBeenCalledOnce();
    expect(active.abort.mock.calls[0]?.[0]).toMatchObject({
      message: "Runtime generation drain exceeded 5ms",
    });
    expect(active.close).toHaveBeenCalledOnce();
    lease.release();
  });

  it("attempts close after abort fails and retries a failed close on the next idempotent stop attempt", async () => {
    const supervisor = new GenerationSupervisor<RuntimeGeneration>({ drainTimeoutMs: 5 });
    const active = generation("active");
    const abortError = new Error("abort failed");
    const closeError = new Error("close failed");
    active.abort.mockRejectedValueOnce(abortError);
    active.close.mockRejectedValueOnce(closeError);
    await supervisor.initialize(async () => active);
    const lease = supervisor.acquire();

    const first = supervisor.stop();
    const concurrent = supervisor.stop();
    expect(concurrent).toBe(first);
    await expect(first).rejects.toMatchObject({ errors: [abortError, closeError] });
    expect(active.abort).toHaveBeenCalledOnce();
    expect(active.close).toHaveBeenCalledOnce();

    lease.release();
    const retry = supervisor.stop();
    expect(retry).not.toBe(first);
    await retry;
    expect(active.close).toHaveBeenCalledTimes(2);
    expect(supervisor.stop()).toBe(retry);
  });

  it("bounds never-settling abort and close under one deadline while concurrent stops share the attempt", async () => {
    vi.useFakeTimers();
    try {
      const supervisor = new GenerationSupervisor<RuntimeGeneration>({ drainTimeoutMs: 5 });
      const active = generation("active");
      const pendingShutdown = new Promise<void>(() => {});
      active.abort.mockReturnValue(pendingShutdown);
      active.close.mockReturnValue(pendingShutdown);
      await supervisor.initialize(async () => active);
      const lease = supervisor.acquire();

      const first = supervisor.stop();
      const concurrent = supervisor.stop();
      expect(concurrent).toBe(first);
      const outcome = first.catch((error: unknown) => error);

      await vi.advanceTimersByTimeAsync(4);
      expect(active.abort).not.toHaveBeenCalled();
      expect(active.close).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(active.abort).toHaveBeenCalledOnce();
      expect(active.close).toHaveBeenCalledOnce();

      const error = await outcome;
      expect(error).toBeInstanceOf(AggregateError);
      expect((error as AggregateError).errors).toEqual([
        expect.objectContaining({ message: "Runtime generation abort exceeded 5ms" }),
        expect.objectContaining({ message: "Runtime generation close exceeded 5ms" }),
      ]);
      lease.release();
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses one deterministic deadline for many never-settling backlog generations", async () => {
    vi.useFakeTimers();
    try {
      const supervisor = new GenerationSupervisor<RuntimeGeneration>({ drainTimeoutMs: 5 });
      const first = generation("first");
      const second = generation("second");
      const active = generation("active");
      first.close.mockRejectedValueOnce(new Error("first reload close failed"));
      second.close.mockRejectedValueOnce(new Error("second reload close failed"));
      await supervisor.initialize(async () => first);
      await supervisor.reload(async () => second);
      await supervisor.reload(async () => active);

      const pendingClose = new Promise<void>(() => {});
      const activeAbortError = new Error("active abort failed");
      const secondAbortError = new Error("second abort failed");
      const firstAbortError = new Error("first abort failed");
      active.close.mockReturnValue(pendingClose);
      second.close.mockReturnValue(pendingClose);
      first.close.mockReturnValue(pendingClose);
      active.abort.mockRejectedValue(activeAbortError);
      second.abort.mockRejectedValue(secondAbortError);
      first.abort.mockRejectedValue(firstAbortError);

      const startedAt = Date.now();
      const stopping = supervisor.stop();
      const outcome = stopping.catch((error: unknown) => error);
      expect(active.close).toHaveBeenCalledOnce();
      expect(second.close).toHaveBeenCalledTimes(2);
      expect(first.close).toHaveBeenCalledTimes(2);
      expect(active.abort).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(5);
      const error = await outcome;

      expect(Date.now() - startedAt).toBe(5);
      expect(active.abort).toHaveBeenCalledOnce();
      expect(second.abort).toHaveBeenCalledOnce();
      expect(first.abort).toHaveBeenCalledOnce();
      expect(error).toBeInstanceOf(AggregateError);
      expect((error as AggregateError).errors).toEqual([
        activeAbortError,
        expect.objectContaining({ message: "Runtime generation close exceeded 5ms" }),
        secondAbortError,
        expect.objectContaining({ message: "Runtime generation close exceeded 5ms" }),
        firstAbortError,
        expect.objectContaining({ message: "Runtime generation close exceeded 5ms" }),
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not wait for a reload factory that holds the mutation mutex", async () => {
    vi.useFakeTimers();
    try {
      const supervisor = new GenerationSupervisor<RuntimeGeneration>({ drainTimeoutMs: 5 });
      const active = generation("active");
      const pendingShutdown = new Promise<void>(() => {});
      active.abort.mockReturnValue(pendingShutdown);
      active.close.mockReturnValue(pendingShutdown);
      await supervisor.initialize(async () => active);

      const reloadFactory = vi.fn(() => new Promise<RuntimeGeneration>(() => {}));
      void supervisor.reload(reloadFactory);
      await vi.waitFor(() => expect(reloadFactory).toHaveBeenCalledOnce());

      const stopping = supervisor.stop();
      const outcome = stopping.catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(5);
      await outcome;

      expect(active.abort).toHaveBeenCalledOnce();
      expect(active.close).toHaveBeenCalledOnce();
      expect(supervisor.activeGenerationId).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("invalidates a completed stop when a reload factory later returns a stuck candidate", async () => {
    vi.useFakeTimers();
    try {
      const supervisor = new GenerationSupervisor<RuntimeGeneration>({ drainTimeoutMs: 5 });
      const active = generation("active");
      await supervisor.initialize(async () => active);

      let resolveCandidate = (_candidate: RuntimeGeneration) => {};
      const candidateGate = new Promise<RuntimeGeneration>((resolve) => {
        resolveCandidate = resolve;
      });
      const reloadFactory = vi.fn(() => candidateGate);
      const reloading = supervisor.reload(reloadFactory);
      await vi.waitFor(() => expect(reloadFactory).toHaveBeenCalledOnce());

      const completedStop = supervisor.stop();
      await completedStop;
      expect(supervisor.stop()).toBe(completedStop);

      const candidate = generation("late-candidate");
      const pendingCleanup = new Promise<void>(() => {});
      candidate.abort.mockReturnValue(pendingCleanup);
      candidate.close.mockReturnValue(pendingCleanup);
      resolveCandidate(candidate);
      const reloadOutcome = reloading.catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(5);
      const reloadError = await reloadOutcome;

      expect(candidate.abort).toHaveBeenCalledOnce();
      expect(candidate.close).toHaveBeenCalledOnce();
      expect(reloadError).toBeInstanceOf(AggregateError);
      expect((reloadError as Error & { cause?: unknown }).cause).toMatchObject({
        message: "Runtime supervisor is stopped",
      });

      const retry = supervisor.stop();
      expect(retry).not.toBe(completedStop);
      const retryOutcome = retry.catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(5);
      await retryOutcome;
      expect(candidate.abort).toHaveBeenCalledOnce();
      expect(candidate.close).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});
