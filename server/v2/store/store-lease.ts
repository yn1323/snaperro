import { AsyncLocalStorage } from "node:async_hooks";
import type { OperationContext, StoreLeaseHandlePort, StoreLeasePort } from "../application/ports.js";
import { StoreLockedError } from "../domain/errors.js";
import { StoreLayout, throwIfAborted } from "./layout.js";
import { FileLease, LeaseBusyError, type LeaseOptions } from "./lease.js";

const DEFAULT_RENEWAL_TIMEOUT_MS = 5_000;

export interface FilesystemStoreLeaseOptions {
  lease?: LeaseOptions;
  /** @internal Maximum wait for heartbeat and release I/O before fencing the caller. */
  renewalTimeoutMs?: number;
}

type ObservedCleanup = { status: "fulfilled" } | { status: "rejected"; error: unknown } | { status: "timed-out" };

async function observeWithin(operation: Promise<unknown>, timeoutMs: number): Promise<ObservedCleanup> {
  const observed = operation.then<ObservedCleanup, ObservedCleanup>(
    () => ({ status: "fulfilled" }),
    (error: unknown) => ({ status: "rejected", error }),
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      observed,
      new Promise<ObservedCleanup>((resolve) => {
        timer = setTimeout(() => resolve({ status: "timed-out" }), Math.max(1, timeoutMs));
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export class FilesystemStoreLease implements StoreLeasePort {
  private readonly layout: StoreLayout;
  private readonly options: LeaseOptions;
  private readonly renewalTimeoutMs: number;
  readonly #scope = new AsyncLocalStorage<StoreLeaseHandlePort>();

  constructor(root: string | StoreLayout, options: FilesystemStoreLeaseOptions = {}) {
    this.layout = typeof root === "string" ? new StoreLayout(root) : root;
    this.options = options.lease ?? {};
    this.renewalTimeoutMs = options.renewalTimeoutMs ?? DEFAULT_RENEWAL_TIMEOUT_MS;
    if (!Number.isSafeInteger(this.renewalTimeoutMs) || this.renewalTimeoutMs < 1) {
      throw new TypeError("renewalTimeoutMs must be a positive safe integer");
    }
  }

  async acquire(context: OperationContext = {}): Promise<StoreLeaseHandlePort> {
    throwIfAborted(context);
    let lease: FileLease;
    try {
      lease = await FileLease.acquire(this.layout.root, {
        ...this.options,
        signal: context.signal ?? this.options.signal,
      });
    } catch (error) {
      if (error instanceof LeaseBusyError) throw new StoreLockedError(this.layout.root);
      throw error;
    }
    const heartbeatMs = Math.max(1, Math.floor((this.options.ttlMs ?? 30_000) / 3));
    const renewalTimeoutMs = this.renewalTimeoutMs;
    let renewal = Promise.resolve();
    let renewalError: unknown;
    const heartbeat = setInterval(() => {
      renewal = renewal.then(async () => {
        if (renewalError === undefined) {
          try {
            await lease.renew();
          } catch (error) {
            renewalError = error;
          }
        }
      });
    }, heartbeatMs);
    heartbeat.unref();
    const handle: StoreLeaseHandlePort = {
      owner: lease.token,
      assertOwned: async () => {
        renewal = renewal.then(async () => {
          if (renewalError === undefined) {
            try {
              await lease.renew();
            } catch (error) {
              renewalError = error;
            }
          }
        });
        const renewed = await observeWithin(renewal, renewalTimeoutMs);
        if (renewed.status !== "fulfilled") {
          renewalError ??=
            renewed.status === "rejected"
              ? renewed.error
              : new Error(`Store lease renewal did not settle within ${renewalTimeoutMs}ms`);
        }
        if (renewalError !== undefined) throw new StoreLockedError(this.layout.root, lease.token);
        try {
          await lease.assertOwned();
        } catch (error) {
          if (error instanceof LeaseBusyError) throw new StoreLockedError(this.layout.root, lease.token);
          throw error;
        }
      },
      release: async () => {
        clearInterval(heartbeat);
        const deadline = Date.now() + renewalTimeoutMs;
        const renewed = await observeWithin(renewal, renewalTimeoutMs);
        if (renewed.status !== "fulfilled") {
          renewalError ??=
            renewed.status === "rejected"
              ? renewed.error
              : new Error(`Store lease renewal did not settle within ${renewalTimeoutMs}ms`);
        }
        let releasing: Promise<void>;
        try {
          releasing = Promise.resolve(lease.release());
        } catch (error) {
          releasing = Promise.reject(error);
        }
        const released = await observeWithin(releasing, Math.max(1, deadline - Date.now()));
        if (released.status === "timed-out") {
          throw new StoreLockedError(this.layout.root, lease.token);
        }
        if (released.status === "rejected") {
          const error = released.error;
          if (
            error instanceof LeaseBusyError ||
            (error instanceof Error && "code" in error && error.code === "ENOENT")
          ) {
            throw new StoreLockedError(this.layout.root, lease.token);
          }
          throw error;
        }
        if (renewalError !== undefined) throw new StoreLockedError(this.layout.root, lease.token);
      },
    };
    return handle;
  }

  runWithHandle<Result>(handle: StoreLeaseHandlePort, operation: () => Promise<Result>): Promise<Result> {
    return this.#scope.run(handle, operation);
  }

  async withVisibilityFence<Result>(operation: () => Promise<Result>, context: OperationContext = {}): Promise<Result> {
    const current = this.#scope.getStore();
    if (current) {
      await current.assertOwned();
      return operation();
    }

    const handle = await this.acquire(context);
    let result: Result | undefined;
    let operationError: unknown;
    let operationFailed = false;
    try {
      result = await this.runWithHandle(handle, async () => {
        await handle.assertOwned();
        return operation();
      });
    } catch (error) {
      operationFailed = true;
      operationError = error;
    }
    let releaseError: unknown;
    let releaseFailed = false;
    try {
      await handle.release();
    } catch (error) {
      releaseFailed = true;
      releaseError = error;
    }
    if (operationFailed) {
      throw operationError;
    }
    if (releaseFailed) throw releaseError;
    return result as Result;
  }
}
