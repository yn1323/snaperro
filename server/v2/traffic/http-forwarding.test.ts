import { describe, expect, it } from "vitest";
import { buildUpstreamUrl, forwardRequestHeaders, forwardResponseHeaders } from "./http-forwarding.js";

describe("buildUpstreamUrl", () => {
  it("preserves the configured base path and incoming query", () => {
    const url = buildUpstreamUrl("https://api.example.com/v1/", "http://localhost/users/a%20b?include=roles");

    expect(url.toString()).toBe("https://api.example.com/v1/users/a%20b?include=roles");
  });
});

describe("HTTP forwarding headers", () => {
  it("removes hop-by-hop and request framing headers", () => {
    const headers = forwardRequestHeaders(
      new Headers({
        Connection: "keep-alive, X-Internal-Hop",
        "Content-Length": "100",
        Host: "localhost",
        "X-Internal-Hop": "secret",
        "X-Request": "kept",
      }),
      { Authorization: "Bearer configured" },
    );

    expect(Object.fromEntries(headers)).toEqual({
      authorization: "Bearer configured",
      "x-request": "kept",
    });
  });

  it("keeps representation headers when forwarding an unchanged raw body", () => {
    const headers = forwardResponseHeaders(
      new Headers({
        "Content-Encoding": "gzip",
        "Content-Length": "123",
        "Content-Type": "application/json",
        "Transfer-Encoding": "chunked",
      }),
    );

    expect(Object.fromEntries(headers)).toEqual({
      "content-encoding": "gzip",
      "content-length": "123",
      "content-type": "application/json",
    });
  });
});
