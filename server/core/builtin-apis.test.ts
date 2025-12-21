import { describe, expect, it } from "vitest";
import type { SnaperroConfig } from "../types/config.js";
import { BUILTIN_APIS, mergeWithBuiltinApis } from "./builtin-apis.js";

describe("BUILTIN_APIS", () => {
  it("jsonPlaceholderを含む", () => {
    expect(BUILTIN_APIS.jsonPlaceholder).toBeDefined();
    expect(BUILTIN_APIS.jsonPlaceholder.name).toBe("JSON Placeholder");
    expect(BUILTIN_APIS.jsonPlaceholder.target).toBe("https://jsonplaceholder.typicode.com");
  });

  it("jsonPlaceholderに必要なルートが含まれている", () => {
    const routes = BUILTIN_APIS.jsonPlaceholder.routes;
    expect(routes).toContain("/users");
    expect(routes).toContain("/users/:id");
    expect(routes).toContain("/posts");
    expect(routes).toContain("/posts/:id");
    expect(routes).toContain("/comments");
  });
});

describe("mergeWithBuiltinApis", () => {
  const baseConfig: SnaperroConfig = {
    port: 3333,
    filesDir: ".snaperro/files",
    mockFallback: "404",
    apis: {},
  };

  it("空のユーザー設定に組み込みAPIをマージする", () => {
    const merged = mergeWithBuiltinApis(baseConfig);
    expect(merged.apis.jsonPlaceholder).toBeDefined();
    expect(merged.apis.jsonPlaceholder.target).toBe("https://jsonplaceholder.typicode.com");
  });

  it("ユーザー設定で組み込みAPIを上書きできる", () => {
    const config: SnaperroConfig = {
      ...baseConfig,
      apis: {
        jsonPlaceholder: {
          name: "My Custom Placeholder",
          target: "https://my-custom-api.com",
          routes: ["/custom"],
        },
      },
    };
    const merged = mergeWithBuiltinApis(config);
    expect(merged.apis.jsonPlaceholder.name).toBe("My Custom Placeholder");
    expect(merged.apis.jsonPlaceholder.target).toBe("https://my-custom-api.com");
    expect(merged.apis.jsonPlaceholder.routes).toEqual(["/custom"]);
  });

  it("ユーザーのAPIを保持する", () => {
    const config: SnaperroConfig = {
      ...baseConfig,
      apis: {
        myApi: {
          name: "My API",
          target: "https://example.com",
          routes: ["/api/*"],
        },
      },
    };
    const merged = mergeWithBuiltinApis(config);
    expect(merged.apis.myApi).toBeDefined();
    expect(merged.apis.myApi.name).toBe("My API");
    expect(merged.apis.jsonPlaceholder).toBeDefined();
  });

  it("他の設定項目を変更しない", () => {
    const config: SnaperroConfig = {
      port: 4000,
      filesDir: "custom/path",
      mockFallback: "proxy",
      apis: {
        myApi: {
          name: "My API",
          target: "https://example.com",
          routes: ["/api"],
        },
      },
    };
    const merged = mergeWithBuiltinApis(config);
    expect(merged.port).toBe(4000);
    expect(merged.filesDir).toBe("custom/path");
    expect(merged.mockFallback).toBe("proxy");
  });
});
