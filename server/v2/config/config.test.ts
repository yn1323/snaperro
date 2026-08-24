import path from "node:path";
import { describe, expect, it } from "vitest";
import { compileConfigV2, defineConfigV2 } from "./config.js";

const api = {
  example: {
    name: "Example",
    target: "https://example.com",
    routes: ["/api/users/:id"],
  },
};

describe("SnaperroConfigV2", () => {
  it("applies secure local defaults", () => {
    const config = defineConfigV2({ configVersion: 2, apis: api });

    expect(config.server).toMatchObject({
      host: "127.0.0.1",
      port: 3333,
      openBrowser: true,
      allowedOrigins: [],
    });
    expect(config.storage.root).toBe(".snaperro/v2");
    expect(config.mock.fallback).toBe("404");
  });

  it("resolves storage root relative to the config file", () => {
    const compiled = compileConfigV2(
      {
        configVersion: 2,
        storage: { root: "fixtures/recordings" },
        apis: api,
      },
      "/work/project/config/snaperro.config.ts",
    );

    expect(compiled.storage.root).toBe(path.resolve("/work/project/config/fixtures/recordings"));
  });

  it("includes the bundled demo API when no API is configured", () => {
    const compiled = compileConfigV2({ configVersion: 2, apis: {} }, "/work/project/snaperro.config.ts");

    expect(compiled.apis.jsonPlaceholder?.target).toBe("https://jsonplaceholder.typicode.com");
  });

  it("allows the bundled demo API to be overridden by key", () => {
    const compiled = compileConfigV2(
      {
        configVersion: 2,
        apis: {
          jsonPlaceholder: {
            name: "Local demo",
            target: "https://demo.example.com",
            routes: ["/users"],
          },
        },
      },
      "/work/project/snaperro.config.ts",
    );

    expect(compiled.apis.jsonPlaceholder?.target).toBe("https://demo.example.com");
  });

  it("keeps the bundled demo API alongside custom APIs", () => {
    const compiled = compileConfigV2({ configVersion: 2, apis: api }, "/work/project/snaperro.config.ts");

    expect(compiled.apis.example?.target).toBe("https://example.com");
    expect(compiled.apis.jsonPlaceholder?.target).toBe("https://jsonplaceholder.typicode.com");
  });

  it("requires a conflicting built-in route to be overridden by its API key", () => {
    expect(() =>
      compileConfigV2(
        {
          configVersion: 2,
          apis: {
            users: { name: "Users", target: "https://example.com", routes: ["/users"] },
          },
        },
        "/work/project/snaperro.config.ts",
      ),
    ).toThrow(/jsonPlaceholder.*users/u);
  });

  it("requires a control token for a non-loopback bind", () => {
    expect(() =>
      defineConfigV2({
        configVersion: 2,
        server: { host: "0.0.0.0" },
        apis: api,
      }),
    ).toThrow(/controlToken/);
  });

  it("rejects ambiguous routes while compiling the config", () => {
    expect(() =>
      compileConfigV2(
        {
          configVersion: 2,
          apis: {
            first: { name: "First", target: "https://example.com", routes: ["/users/:id"] },
            second: { name: "Second", target: "https://example.org", routes: ["/users/:userId"] },
          },
        },
        "/work/project/snaperro.config.ts",
      ),
    ).toThrow(/same requests/);
  });

  it("accepts a protected non-loopback bind", () => {
    const config = defineConfigV2({
      configVersion: 2,
      server: { host: "0.0.0.0", controlToken: "a-secure-local-token" },
      apis: api,
    });

    expect(config.server.host).toBe("0.0.0.0");
  });

  it.each([
    ["API target", { configVersion: 2, apis: { example: { ...api.example, target: "ftp://example.com" } } }],
    ["proxy", { configVersion: 2, proxy: { url: "file:///tmp/proxy.sock" }, apis: {} }],
    ["allowed origin", { configVersion: 2, server: { allowedOrigins: ["ftp://tools.example"] }, apis: {} }],
  ])("rejects unsupported URL schemes for %s", (_label, input) => {
    expect(() => defineConfigV2(input as never)).toThrow(/HTTP\(S\)/u);
  });

  it.each([
    "https://user:secret@example.com/base",
    "https://example.com/base?tenant=one",
    "https://example.com/base#fragment",
  ])("rejects ambiguous or secret-bearing API targets: %s", (target) => {
    expect(() =>
      defineConfigV2({
        configVersion: 2,
        apis: { example: { ...api.example, target } },
      }),
    ).toThrow();
  });

  it("normalizes allowed origins and allows credentials in an explicit HTTP proxy URL", () => {
    const config = defineConfigV2({
      configVersion: 2,
      server: { allowedOrigins: ["https://TOOLS.example:443/path?ignored=yes#ignored"] },
      proxy: { url: "http://user:secret@proxy.example:8080" },
      apis: {},
    });

    expect(config.server.allowedOrigins).toEqual(["https://tools.example"]);
    expect(config.proxy.url).toBe("http://user:secret@proxy.example:8080");
    expect(() =>
      defineConfigV2({
        configVersion: 2,
        server: { allowedOrigins: ["https://user:secret@tools.example"] },
        apis: {},
      }),
    ).toThrow(/credentials/u);
    expect(() =>
      defineConfigV2({
        configVersion: 2,
        server: { allowedOrigins: ["https://tools.example/one", "https://TOOLS.example:443/two"] },
        apis: {},
      }),
    ).toThrow(/unique/u);
  });

  it("rejects unsafe, framing-controlled, and case-duplicate configured headers", () => {
    const configured = (headers: Record<string, string>) => ({
      configVersion: 2 as const,
      apis: { example: { ...api.example, headers } },
    });

    expect(() => defineConfigV2(configured({ "bad header": "value" }))).toThrow(/header name/iu);
    expect(() => defineConfigV2(configured({ "x-safe": "ok\r\nx-injected: yes" }))).toThrow(/header value/iu);
    expect(() => defineConfigV2(configured({ Host: "evil.example" }))).toThrow(/HTTP framing/u);
    expect(() => defineConfigV2(configured({ "content-LENGTH": "12" }))).toThrow(/HTTP framing/u);
    expect(() => defineConfigV2(configured({ Connection: "close" }))).toThrow(/HTTP framing/u);
    expect(() => defineConfigV2(configured({ Authorization: "one", authorization: "two" }))).toThrow(/unique/u);
  });

  it("validates and de-duplicates request-header masks case-insensitively", () => {
    expect(() =>
      defineConfigV2({ configVersion: 2, recording: { maskRequestHeaders: ["bad header"] }, apis: {} }),
    ).toThrow(/header name/iu);
    expect(() =>
      defineConfigV2({
        configVersion: 2,
        apis: { example: { ...api.example, maskRequestHeaders: ["Authorization", "authorization"] } },
      }),
    ).toThrow(/unique/u);
  });

  it("rejects unsafe byte limits before they reach streaming counters", () => {
    const unsafe = Number.MAX_SAFE_INTEGER + 1;
    expect(() => defineConfigV2({ configVersion: 2, storage: { maxImportBytes: unsafe }, apis: {} })).toThrow(/safe/iu);
    expect(() => defineConfigV2({ configVersion: 2, recording: { maxRequestBodyBytes: unsafe }, apis: {} })).toThrow(
      /safe/iu,
    );
  });

  it.each([
    { configVersion: 2, apis: {}, porrt: 3333 },
    { configVersion: 2, apis: {}, server: { porrt: 3333 } },
    { configVersion: 2, apis: {}, storage: { rooot: ".snaperro/v2" } },
    { configVersion: 2, apis: {}, recording: { completeOnDisconnect: true } },
    { configVersion: 2, apis: {}, proxy: { uri: "http://proxy.example" } },
    { configVersion: 2, apis: {}, mock: { fallbak: "404" } },
    {
      configVersion: 2,
      apis: {
        example: {
          name: "Example",
          target: "https://example.com",
          routes: ["/api/users"],
          header: {},
        },
      },
    },
  ])("rejects unknown config keys instead of silently ignoring typos", (input) => {
    expect(() => compileConfigV2(input as never, "/work/project/snaperro.config.ts")).toThrow();
  });
});
