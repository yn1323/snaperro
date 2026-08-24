import { describe, expect, it } from "vitest";

import { LatestRequestRunner } from "./latest-request";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("LatestRequestRunner", () => {
  it("aborts the previous signal and ignores its late result", async () => {
    const runner = new LatestRequestRunner();
    const firstDeferred = deferred<string>();
    const secondDeferred = deferred<string>();
    let firstAborted = false;

    const first = runner.run(async ({ signal }) => {
      signal.addEventListener("abort", () => {
        firstAborted = true;
      });
      return firstDeferred.promise;
    });
    const second = runner.run(async () => secondDeferred.promise);

    expect(firstAborted).toBe(true);
    firstDeferred.resolve("old");
    secondDeferred.resolve("new");

    await expect(first).resolves.toEqual({ kind: "stale" });
    await expect(second).resolves.toEqual({ kind: "applied", value: "new" });
  });

  it("returns aborted after explicit cancellation", async () => {
    const runner = new LatestRequestRunner();
    const request = runner.run(
      ({ signal }) =>
        new Promise<string>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        }),
    );
    runner.cancel();
    await expect(request).resolves.toEqual({ kind: "aborted" });
  });

  it("rethrows an error from the current request", async () => {
    const runner = new LatestRequestRunner();
    await expect(
      runner.run(async () => {
        throw new Error("network");
      }),
    ).rejects.toThrow("network");
  });
});
