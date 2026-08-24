import { Mutex } from "async-mutex";

export interface RuntimeGeneration {
  readonly id: string;
  abort(reason: Error): Promise<void> | void;
  close(): Promise<void> | void;
}

export interface GenerationSupervisorOptions {
  /** Maximum graceful drain time before the old generation is aborted. */
  drainTimeoutMs?: number;
}

export interface GenerationLease<T extends RuntimeGeneration> {
  readonly generation: T;
  release(): void;
}

export interface GenerationReloadResult {
  /** Cleanup can fail only after the candidate has become the active truth. */
  readonly previousCleanupError?: Error;
}

interface GenerationSlot<T extends RuntimeGeneration> {
  generation: T;
  inFlight: number;
  drained: Promise<void>;
  resolveDrained: () => void;
  abortAttempt?: CleanupHandle;
  closeAttempt?: CleanupHandle;
}

interface GenerationCleanupResult {
  errors: Error[];
  closeFailed: boolean;
}

type SettledCleanupObservation = { status: "fulfilled" } | { status: "rejected"; error: Error };
type CleanupObservation = SettledCleanupObservation | { status: "timed-out" };

interface CleanupHandle {
  outcome?: SettledCleanupObservation;
  settled: Promise<SettledCleanupObservation>;
}

interface StopSlotState<T extends RuntimeGeneration> {
  slot: GenerationSlot<T>;
  abort?: CleanupHandle;
  close?: CleanupHandle;
}

function errorValue(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function cleanupFailure(errors: readonly Error[]): Error {
  if (errors.length === 1) return errors[0] as Error;
  return new AggregateError(errors, "Runtime generation cleanup failed", { cause: errors[0] });
}

function startCleanupOperation(operation: () => Promise<void> | void): CleanupHandle {
  let resolveSettled = (_outcome: SettledCleanupObservation) => {};
  const handle: CleanupHandle = {
    settled: new Promise<SettledCleanupObservation>((resolve) => {
      resolveSettled = resolve;
    }),
  };
  const settle = (outcome: SettledCleanupObservation) => {
    handle.outcome = outcome;
    resolveSettled(outcome);
  };

  try {
    const result = operation();
    if (result === undefined) {
      settle({ status: "fulfilled" });
    } else {
      void Promise.resolve(result).then(
        () => settle({ status: "fulfilled" }),
        (error) => settle({ status: "rejected", error: errorValue(error) }),
      );
    }
  } catch (error) {
    settle({ status: "rejected", error: errorValue(error) });
  }
  return handle;
}

function createSlot<T extends RuntimeGeneration>(generation: T): GenerationSlot<T> {
  let resolveDrained = () => {};
  const drained = new Promise<void>((resolve) => {
    resolveDrained = resolve;
  });

  return { generation, inFlight: 0, drained, resolveDrained };
}

export class GenerationSupervisor<T extends RuntimeGeneration> {
  readonly #mutationMutex = new Mutex();
  readonly #drainTimeoutMs: number | undefined;
  readonly #cleanupBacklog = new Set<GenerationSlot<T>>();
  #active: GenerationSlot<T> | undefined;
  #accepting = true;
  #stopPromise: Promise<void> | undefined;

  constructor(options: GenerationSupervisorOptions = {}) {
    if (
      options.drainTimeoutMs !== undefined &&
      (!Number.isSafeInteger(options.drainTimeoutMs) || options.drainTimeoutMs < 1)
    ) {
      throw new TypeError("drainTimeoutMs must be a positive safe integer");
    }
    this.#drainTimeoutMs = options.drainTimeoutMs;
  }

  get activeGenerationId(): string | undefined {
    return this.#active?.generation.id;
  }

  async initialize(factory: () => Promise<T>): Promise<void> {
    await this.#mutationMutex.runExclusive(async () => {
      if (this.#active) throw new Error("Runtime generation is already initialized");
      if (!this.#accepting) throw new Error("Runtime supervisor is stopped");
      const candidate = createSlot(await factory());
      if (!this.#accepting) {
        await this.#rejectCandidatePreparedAfterStop(candidate);
      }
      this.#active = candidate;
    });
  }

  async reload(factory: () => Promise<T>): Promise<GenerationReloadResult> {
    return this.#mutationMutex.runExclusive(async () => {
      if (!this.#accepting) throw new Error("Runtime supervisor is stopped");

      // The active generation is left untouched when preparation fails.
      const candidate = createSlot(await factory());
      if (!this.#accepting) {
        await this.#rejectCandidatePreparedAfterStop(candidate);
      }
      const previous = this.#active;
      this.#active = candidate;

      if (previous) {
        this.#cleanupBacklog.add(previous);
        const cleanup = await this.#drainAndClose(previous);
        if (!cleanup.closeFailed) this.#cleanupBacklog.delete(previous);
        if (cleanup.errors.length > 0) {
          return { previousCleanupError: cleanupFailure(cleanup.errors) };
        }
      }
      return {};
    });
  }

  acquire(): GenerationLease<T> {
    if (!this.#accepting) throw new Error("Runtime supervisor is stopped");
    const slot = this.#active;
    if (!slot) throw new Error("Runtime generation is not initialized");

    slot.inFlight += 1;
    let released = false;
    return {
      generation: slot.generation,
      release: () => {
        if (released) return;
        released = true;
        slot.inFlight -= 1;
        if (slot.inFlight === 0 && slot !== this.#active) {
          slot.resolveDrained();
        }
      },
    };
  }

  async run<R>(operation: (generation: T) => Promise<R> | R): Promise<R> {
    const lease = this.acquire();
    try {
      return await operation(lease.generation);
    } finally {
      lease.release();
    }
  }

  stop(): Promise<void> {
    if (this.#stopPromise) return this.#stopPromise;
    // Fence new work synchronously. Waiting for the mutation mutex here would
    // let a stalled reload factory turn the shutdown deadline into an
    // unbounded wait.
    this.#accepting = false;
    const active = this.#active;
    this.#active = undefined;
    if (active) this.#cleanupBacklog.add(active);
    const slots = [
      ...(active ? [active] : []),
      ...[...this.#cleanupBacklog].reverse().filter((slot) => slot !== active),
    ];
    const stopping = this.#stop(slots);
    this.#stopPromise = stopping;
    void stopping.catch(() => {
      // Concurrent callers share one attempt. A failed attempt may be retried
      // later because close failures remain in the cleanup backlog.
      if (this.#stopPromise === stopping) this.#stopPromise = undefined;
    });
    return stopping;
  }

  async #stop(slots: readonly GenerationSlot<T>[]): Promise<void> {
    const cleanups = await this.#stopAll(slots);
    const errors: Error[] = [];
    for (const [index, cleanup] of cleanups.entries()) {
      const slot = slots[index] as GenerationSlot<T>;
      errors.push(...cleanup.errors);
      if (cleanup.closeFailed) this.#cleanupBacklog.add(slot);
      else this.#cleanupBacklog.delete(slot);
    }
    if (errors.length > 0) throw cleanupFailure(errors);
  }

  async #stopAll(slots: readonly GenerationSlot<T>[]): Promise<GenerationCleanupResult[]> {
    const states: StopSlotState<T>[] = slots.map((slot) => ({ slot }));
    const naturalCleanup = Promise.all(states.map((state) => this.#naturallyCloseForStop(state)));
    if (this.#drainTimeoutMs === undefined) {
      await naturalCleanup;
      return states.map((state) => this.#stopResult(state, false));
    }

    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<"deadline">((resolve) => {
      timer = setTimeout(() => {
        const pending = states.filter((state) => state.close?.outcome === undefined);
        // Invoke every abort directly before any close. Runtime generations use
        // this synchronous call to fire their lifetime signal before core
        // cleanup is allowed to start.
        for (const state of pending) {
          const reason = new Error(`Runtime generation drain exceeded ${this.#drainTimeoutMs}ms`);
          state.abort = this.#startAbort(state.slot, reason);
        }
        for (const state of pending) {
          state.close ??= this.#startClose(state.slot);
        }
        resolve("deadline");
      }, this.#drainTimeoutMs);
    });

    const outcome = await Promise.race([naturalCleanup.then(() => "settled" as const), deadline]);
    if (outcome === "settled" && timer) clearTimeout(timer);
    if (outcome === "deadline") {
      // Give promptly-aborted transports a fixed number of microtask turns to
      // report their result. The bound is independent of the backlog size;
      // work that remains pending is still observed by CleanupHandle.
      for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
    }
    return states.map((state) => this.#stopResult(state, outcome === "deadline"));
  }

  async #naturallyCloseForStop(state: StopSlotState<T>): Promise<void> {
    const existingClose = state.slot.closeAttempt;
    if (existingClose && existingClose.outcome?.status !== "rejected") {
      state.close = existingClose;
    } else {
      if (state.slot.inFlight > 0) await state.slot.drained;
      state.close = this.#startClose(state.slot);
    }
    await state.close.settled;
  }

  #stopResult(state: StopSlotState<T>, deadlineReached: boolean): GenerationCleanupResult {
    const errors: Error[] = [];
    if (state.abort) {
      if (state.abort.outcome?.status === "rejected") errors.push(state.abort.outcome.error);
      else if (deadlineReached && state.abort.outcome === undefined) {
        errors.push(new Error(`Runtime generation abort exceeded ${this.#drainTimeoutMs}ms`));
      }
    }

    let closeFailed = false;
    if (state.close?.outcome?.status === "rejected") {
      closeFailed = true;
      errors.push(state.close.outcome.error);
    } else if (state.close?.outcome === undefined) {
      closeFailed = true;
      if (deadlineReached) errors.push(new Error(`Runtime generation close exceeded ${this.#drainTimeoutMs}ms`));
    }
    return { errors, closeFailed };
  }

  async #drainAndClose(slot: GenerationSlot<T>): Promise<GenerationCleanupResult> {
    const errors: Error[] = [];
    if (slot.inFlight > 0) {
      const drained = await this.#waitForDrain(slot);
      if (!drained) {
        const reason = new Error(`Runtime generation drain exceeded ${this.#drainTimeoutMs}ms`);
        const abortError = await this.#observeCleanup("abort", this.#startAbort(slot, reason));
        if (abortError) errors.push(abortError);
      }
    }
    const closeError = await this.#observeCleanup("close", this.#startClose(slot));
    const closeFailed = closeError !== undefined;
    if (closeError) errors.push(closeError);
    return { errors, closeFailed };
  }

  async #observeCleanup(label: "abort" | "close", handle: CleanupHandle): Promise<Error | undefined> {
    if (this.#drainTimeoutMs === undefined) {
      const result = await handle.settled;
      return result.status === "rejected" ? result.error : undefined;
    }

    let timer: NodeJS.Timeout | undefined;
    try {
      const result = await Promise.race<CleanupObservation>([
        handle.settled,
        new Promise<CleanupObservation>((resolve) => {
          timer = setTimeout(() => resolve({ status: "timed-out" }), this.#drainTimeoutMs);
        }),
      ]);
      if (result.status === "rejected") return result.error;
      if (result.status === "timed-out") {
        return new Error(`Runtime generation ${label} exceeded ${this.#drainTimeoutMs}ms`);
      }
      return undefined;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  #startAbort(slot: GenerationSlot<T>, reason: Error): CleanupHandle {
    const existing = slot.abortAttempt;
    if (existing && existing.outcome?.status !== "rejected") return existing;
    const attempt = startCleanupOperation(() => slot.generation.abort(reason));
    slot.abortAttempt = attempt;
    return attempt;
  }

  #startClose(slot: GenerationSlot<T>): CleanupHandle {
    const existing = slot.closeAttempt;
    if (existing && existing.outcome?.status !== "rejected") return existing;
    const attempt = startCleanupOperation(() => slot.generation.close());
    slot.closeAttempt = attempt;
    return attempt;
  }

  async #rejectCandidatePreparedAfterStop(slot: GenerationSlot<T>): Promise<never> {
    this.#cleanupBacklog.add(slot);
    this.#invalidateStopPromiseAfterAttempt();
    const reason = new Error("Runtime supervisor stopped while preparing a generation");
    const abort = this.#startAbort(slot, reason);
    const close = this.#startClose(slot);
    const [abortError, closeError] = await Promise.all([
      this.#observeCleanup("abort", abort),
      this.#observeCleanup("close", close),
    ]);
    if (!closeError) this.#cleanupBacklog.delete(slot);

    const stopped = new Error("Runtime supervisor is stopped");
    const cleanupErrors = [abortError, closeError].filter((error): error is Error => error !== undefined);
    if (cleanupErrors.length > 0) {
      throw new AggregateError([stopped, ...cleanupErrors], "Stopped generation preparation cleanup failed", {
        cause: stopped,
      });
    }
    throw stopped;
  }

  #invalidateStopPromiseAfterAttempt(): void {
    const stopping = this.#stopPromise;
    if (!stopping) return;
    void stopping.then(
      () => {
        if (this.#stopPromise === stopping) this.#stopPromise = undefined;
      },
      () => {
        if (this.#stopPromise === stopping) this.#stopPromise = undefined;
      },
    );
  }

  async #waitForDrain(slot: GenerationSlot<T>): Promise<boolean> {
    if (this.#drainTimeoutMs === undefined) {
      await slot.drained;
      return true;
    }

    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        slot.drained.then(() => true),
        new Promise<false>((resolve) => {
          timer = setTimeout(() => resolve(false), this.#drainTimeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
