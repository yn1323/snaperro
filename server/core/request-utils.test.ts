import { describe, expect, it } from "vitest";
import { copyRequestHeaders, DEFAULT_SKIP_HEADERS, parseQueryParams, parseRequestBody } from "./request-utils.js";

describe("parseQueryParams", () => {
  it("parses single value parameters", () => {
    const url = new URL("https://example.com?page=1&limit=10");
    expect(parseQueryParams(url)).toEqual({ page: "1", limit: "10" });
  });

  it("parses multiple values for same key as array", () => {
    const url = new URL("https://example.com?tag=a&tag=b&tag=c");
    expect(parseQueryParams(url)).toEqual({ tag: ["a", "b", "c"] });
  });

  it("handles empty query string", () => {
    const url = new URL("https://example.com");
    expect(parseQueryParams(url)).toEqual({});
  });

  it("handles mixed single and multiple values", () => {
    const url = new URL("https://example.com?page=1&tag=a&tag=b");
    expect(parseQueryParams(url)).toEqual({ page: "1", tag: ["a", "b"] });
  });

  it("handles encoded query parameters", () => {
    const url = new URL("https://example.com?name=hello%20world");
    expect(parseQueryParams(url)).toEqual({ name: "hello world" });
  });
});

describe("parseRequestBody", () => {
  it("returns null for GET method", async () => {
    const getText = () => Promise.resolve('{"data": "value"}');
    expect(await parseRequestBody("GET", getText)).toBeNull();
  });

  it("returns null for HEAD method", async () => {
    const getText = () => Promise.resolve('{"data": "value"}');
    expect(await parseRequestBody("HEAD", getText)).toBeNull();
  });

  it("parses JSON body for POST", async () => {
    const getText = () => Promise.resolve('{"name": "test"}');
    expect(await parseRequestBody("POST", getText)).toEqual({ name: "test" });
  });

  it("returns text when JSON parse fails", async () => {
    const getText = () => Promise.resolve("not json");
    expect(await parseRequestBody("POST", getText)).toBe("not json");
  });

  it("returns null for empty body", async () => {
    const getText = () => Promise.resolve("");
    expect(await parseRequestBody("POST", getText)).toBeNull();
  });

  it("returns text when parseJson is false", async () => {
    const getText = () => Promise.resolve('{"name": "test"}');
    expect(await parseRequestBody("POST", getText, false)).toBe('{"name": "test"}');
  });

  it("handles PUT method", async () => {
    const getText = () => Promise.resolve('{"updated": true}');
    expect(await parseRequestBody("PUT", getText)).toEqual({ updated: true });
  });

  it("handles PATCH method", async () => {
    const getText = () => Promise.resolve('{"field": "value"}');
    expect(await parseRequestBody("PATCH", getText)).toEqual({ field: "value" });
  });

  it("handles DELETE method with body", async () => {
    const getText = () => Promise.resolve('{"id": "123"}');
    expect(await parseRequestBody("DELETE", getText)).toEqual({ id: "123" });
  });

  it("handles array JSON body", async () => {
    const getText = () => Promise.resolve("[1, 2, 3]");
    expect(await parseRequestBody("POST", getText)).toEqual([1, 2, 3]);
  });
});

describe("copyRequestHeaders", () => {
  it("copies headers excluding skip headers", () => {
    const source = new Headers({
      "Content-Type": "application/json",
      "X-Custom": "value",
      Host: "localhost",
      Connection: "keep-alive",
    });
    const result = copyRequestHeaders(source);

    expect(result.get("Content-Type")).toBe("application/json");
    expect(result.get("X-Custom")).toBe("value");
    expect(result.get("Host")).toBeNull();
    expect(result.get("Connection")).toBeNull();
  });

  it("excludes cache-related headers", () => {
    const source = new Headers({
      "If-None-Match": '"abc123"',
      "If-Modified-Since": "Wed, 21 Oct 2015 07:28:00 GMT",
    });
    const result = copyRequestHeaders(source);

    expect(result.get("If-None-Match")).toBeNull();
    expect(result.get("If-Modified-Since")).toBeNull();
  });

  it("sets accept-encoding to gzip, deflate", () => {
    const source = new Headers({
      "Accept-Encoding": "gzip, deflate, br, zstd",
    });
    const result = copyRequestHeaders(source);

    expect(result.get("Accept-Encoding")).toBe("gzip, deflate");
  });

  it("adds additional headers from config", () => {
    const source = new Headers();
    const result = copyRequestHeaders(source, {
      "X-Api-Key": "secret",
      Authorization: "Bearer token",
    });

    expect(result.get("X-Api-Key")).toBe("secret");
    expect(result.get("Authorization")).toBe("Bearer token");
  });

  it("config headers override request headers", () => {
    const source = new Headers({
      Authorization: "Bearer request-token",
    });
    const result = copyRequestHeaders(source, {
      Authorization: "Bearer config-token",
    });

    expect(result.get("Authorization")).toBe("Bearer config-token");
  });

  it("handles empty source headers", () => {
    const source = new Headers();
    const result = copyRequestHeaders(source);

    expect(result.get("Accept-Encoding")).toBe("gzip, deflate");
  });

  it("handles undefined additionalHeaders", () => {
    const source = new Headers({ "X-Test": "value" });
    const result = copyRequestHeaders(source, undefined);

    expect(result.get("X-Test")).toBe("value");
  });
});

describe("DEFAULT_SKIP_HEADERS", () => {
  it("contains expected headers", () => {
    expect(DEFAULT_SKIP_HEADERS).toContain("host");
    expect(DEFAULT_SKIP_HEADERS).toContain("connection");
    expect(DEFAULT_SKIP_HEADERS).toContain("if-none-match");
    expect(DEFAULT_SKIP_HEADERS).toContain("if-modified-since");
  });

  it("has exactly 4 headers", () => {
    expect(DEFAULT_SKIP_HEADERS).toHaveLength(4);
  });
});
