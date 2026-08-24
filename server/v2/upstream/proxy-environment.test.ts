import { describe, expect, it } from "vitest";
import { maskProxyUrl, resolveUpstreamProxy } from "./proxy-environment.js";

describe("upstream proxy environment", () => {
  it("uses config before the legacy environment precedence", () => {
    expect(
      resolveUpstreamProxy("http://config.example:8080", {
        HTTPS_PROXY: "http://https-upper.example:8080",
        HTTP_PROXY: "http://http-upper.example:8080",
        https_proxy: "http://https-lower.example:8080",
        http_proxy: "http://http-lower.example:8080",
      }),
    ).toEqual({ url: "http://config.example:8080/", source: "config" });
  });

  it.each([
    ["HTTPS_PROXY", { HTTPS_PROXY: "http://https-upper.example:8080", HTTP_PROXY: "http://ignored.example" }],
    ["HTTP_PROXY", { HTTP_PROXY: "http://http-upper.example:8080", https_proxy: "http://ignored.example" }],
    ["https_proxy", { https_proxy: "http://https-lower.example:8080", http_proxy: "http://ignored.example" }],
    ["http_proxy", { http_proxy: "http://http-lower.example:8080" }],
  ] as const)("supports %s", (source, environment) => {
    expect(resolveUpstreamProxy(undefined, environment)).toMatchObject({ source });
  });

  it("rejects malformed and unsupported values without echoing credentials", () => {
    const secret = "do-not-print-this";
    expect(() => resolveUpstreamProxy(undefined, { HTTPS_PROXY: `not-a-url-${secret}` })).toThrow(
      "Invalid upstream proxy URL from HTTPS_PROXY",
    );
    expect(() => resolveUpstreamProxy(`ftp://user:${secret}@proxy.example/path`, {})).toThrow(
      "Unsupported upstream proxy protocol from config",
    );
    try {
      resolveUpstreamProxy(undefined, { HTTPS_PROXY: `not-a-url-${secret}` });
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });

  it("redacts credentials and never returns malformed input", () => {
    expect(maskProxyUrl("http://alice:secret@proxy.example:8080")).toBe("http://***:***@proxy.example:8080/");
    expect(maskProxyUrl("not-a-url-secret")).toBe("[invalid proxy URL]");
  });
});
