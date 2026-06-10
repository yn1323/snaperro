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

  it("formats aggregate and socket details", () => {
    const firstError = Object.assign(new Error("connect ECONNREFUSED ::1:443"), {
      code: "ECONNREFUSED",
      address: "::1",
      port: 443,
      socket: {
        localAddress: "127.0.0.1",
        localPort: 53124,
        remoteAddress: "::1",
        remotePort: 443,
        remoteFamily: "IPv6",
        bytesWritten: 128,
        bytesRead: 0,
      },
    });
    const secondError = Object.assign(new Error("connect ETIMEDOUT 127.0.0.1:443"), {
      code: "ETIMEDOUT",
      address: "127.0.0.1",
      port: 443,
      timeout: 10000,
    });
    const aggregateError = new AggregateError([firstError, secondError], "All connection attempts failed");
    const error = new TypeError("fetch failed");
    Object.defineProperty(error, "cause", { value: aggregateError });

    const log = formatFetchFailureLog({
      operation: "Proxy",
      method: "POST",
      requestPath: "/api/users",
      targetUrl: "https://api.example.com/api/users",
      upstreamProxyEnabled: true,
      error,
    });

    expect(log).toContain("cause aggregate: 2 error(s)");
    expect(log).toContain("cause.errors[0] details: code=ECONNREFUSED, port=443, address=::1");
    expect(log).toContain(
      "cause.errors[0] socket: localAddress=127.0.0.1, localPort=53124, remoteAddress=::1, remotePort=443, remoteFamily=IPv6, bytesWritten=128, bytesRead=0",
    );
    expect(log).toContain("cause.errors[1] details: code=ETIMEDOUT, port=443, address=127.0.0.1, timeout=10000");
  });
});
