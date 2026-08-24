import { describe, expect, it, vi } from "vitest";
import { createControlTokenInfrastructure } from "../../../client/src/v2/react/control-token-session";
import { DemoControl } from "./demo-control";

const timestamp = "2026-08-24T00:00:00.000Z";

function snapshot(mode: "proxy" | "record" | "mock" | "smart" = "record", revision = 5) {
  return {
    protocolVersion: 2,
    runtimeId: "run_aaaaaaaaaaaaaaaa",
    revision,
    version: "2.0.0",
    mode,
    currentScenarioId: null,
    folders: {},
    scenarios: {},
  };
}

function modeEvent(mode: "proxy" | "record" | "mock" | "smart" = "record", revision = 6) {
  return {
    protocolVersion: 2,
    runtimeId: "run_aaaaaaaaaaaaaaaa",
    id: `evt_${String(revision).padStart(16, "0")}`,
    sequence: revision,
    revision,
    occurredAt: timestamp,
    type: "mode.changed",
    payload: { mode },
  };
}

function eventStream(event: ReturnType<typeof modeEvent>): Response {
  return new Response(`id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`, {
    headers: { "Content-Type": "text/event-stream" },
  });
}

function unauthorized(): Response {
  return new Response(
    JSON.stringify({
      error: { code: "UNAUTHORIZED", message: "A valid control token is required", retryable: false },
    }),
    { status: 401 },
  );
}

function deferred<Value>(): { promise: Promise<Value>; resolve: (value: Value) => void } {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

describe("DemoControl", () => {
  it("uses one memory-only bearer token for validated HTTP and SSE state", async () => {
    const token = "demo-private-control-token";
    const httpRequest = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${token}`);
      return Response.json(snapshot());
    });
    const sseRequest = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${token}`);
      return eventStream(modeEvent());
    });
    const infrastructure = createControlTokenInfrastructure({
      http: { fetch: httpRequest as typeof globalThis.fetch },
      realtime: {
        fetch: sseRequest as typeof globalThis.fetch,
        sleep: (_milliseconds, signal) =>
          new Promise((resolve) => signal.addEventListener("abort", () => resolve(), { once: true })),
      },
    });
    const control = new DemoControl({ infrastructure });
    control.auth.setToken(token);

    control.start();
    await vi.waitFor(() => expect(control.state.getSnapshot()).toMatchObject({ mode: "record", revision: 6 }));

    expect(httpRequest).toHaveBeenCalledOnce();
    expect(sseRequest).toHaveBeenCalledOnce();
    expect(control.auth.getSnapshot()).toEqual({ hasToken: true, required: false });
    expect(JSON.stringify(control.auth.getSnapshot())).not.toContain(token);
    control.stop();
  });

  it("opens an authentication challenge with a sanitized error after official 401 Problems", async () => {
    const infrastructure = createControlTokenInfrastructure({
      http: { fetch: vi.fn(async () => unauthorized()) as typeof globalThis.fetch },
      realtime: { fetch: vi.fn(async () => unauthorized()) as typeof globalThis.fetch },
    });
    const control = new DemoControl({ infrastructure });

    control.start();
    await vi.waitFor(() => expect(control.auth.getSnapshot().required).toBe(true));

    expect(control.state.getSnapshot().error).toMatchObject({
      code: "UNAUTHORIZED",
      message: "A valid control token is required",
    });
    expect(JSON.stringify(control.state.getSnapshot())).not.toContain("WWW-Authenticate");
    control.stop();
  });

  it("refreshes and retries a mode command once after a formal revision conflict", async () => {
    let revision = 3;
    let commands = 0;
    const httpRequest = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/queries")) return Response.json(snapshot("smart", revision));
      commands += 1;
      if (commands === 1) {
        revision = 4;
        return new Response(
          JSON.stringify({
            error: {
              code: "REVISION_CONFLICT",
              message: "The entity was changed by another operation",
              retryable: true,
              details: { expected: 3, actual: 4 },
            },
          }),
          { status: 409 },
        );
      }
      revision = 5;
      return Response.json({ revision, mode: "proxy" });
    });
    const infrastructure = createControlTokenInfrastructure({
      http: { fetch: httpRequest as typeof globalThis.fetch },
    });
    const control = new DemoControl({
      infrastructure,
      commandId: () => "cmd_aaaaaaaaaaaaaaaa",
    });

    await control.refresh();
    await control.setMode("proxy");

    expect(commands).toBe(2);
    expect(control.state.getSnapshot()).toMatchObject({ mode: "proxy", revision: 5, changingMode: false, error: null });
  });

  it("does not let an older mode event roll back a newer refresh", async () => {
    let resolveSse!: (response: Response) => void;
    const sseResponse = new Promise<Response>((resolve) => {
      resolveSse = resolve;
    });
    let markRetryStarted!: () => void;
    const retryStarted = new Promise<void>((resolve) => {
      markRetryStarted = resolve;
    });
    const infrastructure = createControlTokenInfrastructure({
      http: { fetch: vi.fn(async () => Response.json(snapshot("smart", 7))) as typeof globalThis.fetch },
      realtime: {
        fetch: vi.fn(async () => sseResponse) as typeof globalThis.fetch,
        sleep: (_milliseconds, signal) => {
          markRetryStarted();
          return new Promise((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
        },
      },
    });
    const control = new DemoControl({ infrastructure });

    control.start();
    await vi.waitFor(() => expect(control.state.getSnapshot()).toMatchObject({ mode: "smart", revision: 7 }));
    resolveSse(eventStream(modeEvent("mock", 6)));
    await retryStarted;

    expect(control.state.getSnapshot()).toMatchObject({ mode: "smart", revision: 7 });
    control.stop();
  });

  it("keeps a superseded mode response from rolling back the latest command", async () => {
    const firstResponse = deferred<Response>();
    let queries = 0;
    let mockAttempts = 0;
    const httpRequest = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/queries")) {
        queries += 1;
        return Response.json(queries === 1 ? snapshot("smart", 3) : snapshot("proxy", 4));
      }
      const command = JSON.parse(String(init?.body)) as { mode: string };
      if (command.mode === "proxy") return firstResponse.promise;
      mockAttempts += 1;
      if (mockAttempts === 1) {
        return new Response(
          JSON.stringify({
            error: {
              code: "REVISION_CONFLICT",
              message: "The entity was changed by another operation",
              retryable: true,
              details: { expected: 3, actual: 4 },
            },
          }),
          { status: 409 },
        );
      }
      return Response.json({ revision: 5, mode: "mock" });
    });
    let commandId = 0;
    const infrastructure = createControlTokenInfrastructure({
      http: { fetch: httpRequest as typeof globalThis.fetch },
    });
    const control = new DemoControl({
      infrastructure,
      commandId: () => `cmd_${String(++commandId).padStart(16, "a")}`,
    });

    await control.refresh();
    const first = control.setMode("proxy");
    const second = control.setMode("mock");
    await second;
    expect(control.state.getSnapshot()).toMatchObject({ mode: "mock", revision: 5, changingMode: false });

    firstResponse.resolve(Response.json({ revision: 4, mode: "proxy" }));
    await first;
    expect(control.state.getSnapshot()).toMatchObject({ mode: "mock", revision: 5, changingMode: false });
    expect(mockAttempts).toBe(2);
  });
});
