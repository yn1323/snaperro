import { describe, expect, it } from "vitest";
import { formatFetchFailureLog, getErrorMessage } from "./fetch-error.js";

describe("fetch-error", () => {
  it("formats nested fetch failure details", () => {
    const cause = Object.assign(new Error("getaddrinfo ENOTFOUND api.example.com"), {
      code: "ENOTFOUND",
      syscall: "getaddrinfo",
      hostname: "api.example.com",
    });
    const error = new TypeError("fetch failed");
    Object.defineProperty(error, "cause", { value: cause });

    const log = formatFetchFailureLog({
      operation: "Record",
      method: "GET",
      requestPath: "/api/users?api_key=secret-token",
      targetUrl: "https://api.example.com/api/users?api_key=secret-token",
      upstreamProxyEnabled: false,
      error,
    });

    expect(log).toContain("Record failed: fetch failed");
    expect(log).toContain("request: GET /api/users?api_key=secr********");
    expect(log).toContain("target: https://api.example.com/api/users?api_key=secr********");
    expect(log).toContain("upstreamProxy: disabled");
    expect(log).toContain("error: TypeError: fetch failed");
    expect(log).toContain("cause: Error: getaddrinfo ENOTFOUND api.example.com");
    expect(log).toContain("cause details: code=ENOTFOUND, syscall=getaddrinfo, hostname=api.example.com");
    expect(log).not.toContain("secret-token");
  });

  it("formats non-Error values", () => {
    expect(getErrorMessage("String error")).toBe("String error");
  });
});
