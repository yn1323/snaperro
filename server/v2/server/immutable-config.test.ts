import { describe, expect, it } from "vitest";
import { compileConfigV2 } from "../config/config.js";
import {
  assertReloadCompatible,
  captureImmutableConfig,
  ImmutableConfigChangeError,
  immutableConfigChanges,
} from "./immutable-config.js";

function config(
  overrides: { server?: Record<string, unknown>; storage?: Record<string, unknown>; proxyUrl?: string } = {},
) {
  return compileConfigV2(
    {
      configVersion: 2,
      server: {
        controlToken: "stable-control-token",
        allowedOrigins: ["https://ui.example"],
        ...overrides.server,
      },
      storage: { root: ".snaperro/v2", ...overrides.storage },
      proxy: { url: overrides.proxyUrl ?? "https://one.example" },
      apis: { jsonPlaceholder: { name: "Users", target: "https://one.example", routes: ["/users"] } },
    },
    "/workspace/snaperro.config.ts",
  );
}

describe("reload compatibility", () => {
  it("allows traffic-only changes and treats allowed-origin ordering as semantic", () => {
    const initial = config();
    const next = config({
      server: { allowedOrigins: ["https://ui.example"], controlToken: "stable-control-token" },
      proxyUrl: "https://two.example",
    });

    expect(immutableConfigChanges(captureImmutableConfig(initial), next)).toEqual([]);
    expect(() => assertReloadCompatible(captureImmutableConfig(initial), next)).not.toThrow();
  });

  it("reports every stable setting that would require rebuilding the core or listener", () => {
    const initial = config();
    const changed = config({
      server: {
        host: "127.0.0.1",
        port: 4444,
        openBrowser: false,
        allowedOrigins: [],
        controlToken: "different-control-token",
        shutdownTimeoutMs: 6000,
      },
      storage: { root: "other", maxImportBytes: 1234 },
    });

    const changes = immutableConfigChanges(captureImmutableConfig(initial), changed);
    expect(changes).toEqual([
      "storage.root",
      "storage.maxImportBytes",
      "server.port",
      "server.openBrowser",
      "server.allowedOrigins",
      "server.controlToken",
      "server.shutdownTimeoutMs",
    ]);
    expect(() => assertReloadCompatible(captureImmutableConfig(initial), changed)).toThrow(ImmutableConfigChangeError);
    try {
      assertReloadCompatible(captureImmutableConfig(initial), changed);
    } catch (error) {
      expect(String(error)).not.toContain("different-control-token");
    }
  });
});
