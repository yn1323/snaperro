import { describe, expect, it, vi } from "vitest";
import { type DemoTrafficOutcome, executeDemoTraffic, LatestExecution } from "./demo-execution";

function deferred<Value>(): { promise: Promise<Value>; resolve: (value: Value) => void } {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("LatestExecution", () => {
  it("keeps a late superseded response from replacing the latest result", async () => {
    const firstResponse = deferred<Response>();
    const secondResponse = deferred<Response>();
    const signals: AbortSignal[] = [];
    let request = 0;
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.signal instanceof AbortSignal) signals.push(init.signal);
      request += 1;
      return request === 1 ? firstResponse.promise : secondResponse.promise;
    }) as typeof globalThis.fetch;
    const execution = new LatestExecution();
    let visible: DemoTrafficOutcome | null = null;
    let loading = false;
    const run = (url: string) => {
      loading = true;
      return execution.run((signal) => executeDemoTraffic(fetch, url, "GET", undefined, signal), {
        onSuccess: (outcome) => {
          visible = outcome;
        },
        onError: (error) => {
          throw error;
        },
        onSettled: () => {
          loading = false;
        },
      });
    };

    const first = run("/first");
    const second = run("/second");
    expect(signals[0]?.aborted).toBe(true);
    secondResponse.resolve(response({ value: "second" }));
    await second;
    expect(visible).toMatchObject({ response: { preview: { text: '{"value":"second"}' } }, error: null });
    expect(loading).toBe(false);

    firstResponse.resolve(response({ value: "first" }));
    await first;
    expect(visible).toMatchObject({ response: { preview: { text: '{"value":"second"}' } }, error: null });
    expect(loading).toBe(false);
  });

  it("does not clear the latest loading state when superseded work settles first", async () => {
    const firstResponse = deferred<Response>();
    const secondResponse = deferred<Response>();
    let request = 0;
    const fetch = vi.fn(async () => {
      request += 1;
      return request === 1 ? firstResponse.promise : secondResponse.promise;
    }) as typeof globalThis.fetch;
    const execution = new LatestExecution();
    let loading = false;
    const run = (url: string) => {
      loading = true;
      return execution.run((signal) => executeDemoTraffic(fetch, url, "GET", undefined, signal), {
        onSuccess: () => undefined,
        onError: () => undefined,
        onSettled: () => {
          loading = false;
        },
      });
    };

    const first = run("/first");
    const second = run("/second");
    firstResponse.resolve(response({ value: "first" }));
    await first;
    expect(loading).toBe(true);

    secondResponse.resolve(response({ value: "second" }));
    await second;
    expect(loading).toBe(false);
  });
});
