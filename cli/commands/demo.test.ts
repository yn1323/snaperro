import { describe, expect, it, vi } from "vitest";
import { demoCommand } from "./demo.js";

const snapshot = {
  protocolVersion: 2,
  runtimeId: "run_aaaaaaaaaaaaaaaa",
  revision: 0,
  version: "2.0.0",
  mode: "smart",
  currentScenarioId: null,
  folders: {},
  scenarios: {},
};

describe("demoCommand", () => {
  it("validates the complete port override before loading config or making a request", async () => {
    const request = vi.fn();
    const loadConfig = vi.fn();

    await expect(demoCommand({ port: "3333oops" }, { fetch: request, loadConfig })).rejects.toThrow("Invalid port");

    expect(loadConfig).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it("uses the configured host and dynamic port for the v2 query and demo page", async () => {
    const request = vi.fn(async (_input: Parameters<typeof globalThis.fetch>[0], _init?: RequestInit) =>
      Response.json(snapshot),
    );
    const openPage = vi.fn(async () => undefined);
    const loadConfig = vi.fn(async () => ({ server: { host: "0.0.0.0", port: 4400 } }));

    await demoCommand({}, { fetch: request as typeof globalThis.fetch, loadConfig, open: openPage });

    expect(request).toHaveBeenCalledOnce();
    expect(request.mock.calls[0]?.[0]).toBe("http://127.0.0.1:4400/__snaperro__/v2/queries");
    expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body))).toEqual({
      protocolVersion: 2,
      type: "runtime.snapshot",
    });
    expect(openPage).toHaveBeenCalledWith("http://127.0.0.1:4400/__snaperro__/demo");
  });

  it("opens the demo when a secured server returns the official unauthorized Problem", async () => {
    const openPage = vi.fn(async () => undefined);
    const request = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: {
              code: "UNAUTHORIZED",
              message: "A valid control token is required",
              retryable: false,
            },
          }),
          { status: 401 },
        ),
    );

    await demoCommand({ port: "5500" }, { fetch: request as typeof globalThis.fetch, open: openPage });

    expect(openPage).toHaveBeenCalledWith("http://127.0.0.1:5500/__snaperro__/demo");
  });

  it("reports a formal server Problem instead of misclassifying it as a connection failure", async () => {
    const request = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: {
              code: "MIGRATION_REQUIRED",
              message: "The v1 store must be migrated before startup",
              retryable: false,
            },
          }),
          { status: 503 },
        ),
    );

    await expect(demoCommand({ port: "4400" }, { fetch: request as typeof globalThis.fetch })).rejects.toThrow(
      "MIGRATION_REQUIRED: The v1 store must be migrated before startup",
    );
  });

  it("reports a network failure with the resolved origin", async () => {
    const request = vi.fn(async () => {
      throw new TypeError("connect ECONNREFUSED");
    });

    await expect(demoCommand({ port: "4400" }, { fetch: request as typeof globalThis.fetch })).rejects.toThrow(
      "Server is not running at http://127.0.0.1:4400",
    );
  });
});
