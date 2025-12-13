import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiConfig } from "../types/config.js";
import { handleProxy } from "./proxy.js";

// Mock proxy-agent module
vi.mock("../core/proxy-agent.js", () => ({
  getProxyAgent: vi.fn(() => undefined),
}));

// Mock logger to avoid console output
vi.mock("../core/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    debugHeaders: vi.fn(),
  },
}));

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const testApiConfig: ApiConfig = {
  name: "Test API",
  target: "https://api.example.com",
  routes: ["/api/users/:id", "/api/users"],
};

describe("handleProxy", () => {
  let app: Hono;

  beforeEach(() => {
    mockFetch.mockReset();

    app = new Hono();
    app.all("*", async (c) => {
      return handleProxy(c, testApiConfig);
    });
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("successful proxy", () => {
    it("forwards GET request to target and returns response", async () => {
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ id: "123", name: "Test User" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

      const res = await app.request("/api/users/123");
      const body = (await res.json()) as { id: string; name: string };

      expect(res.status).toBe(200);
      expect(body.id).toBe("123");
      expect(body.name).toBe("Test User");
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.example.com/api/users/123",
        expect.objectContaining({
          method: "GET",
        }),
      );
    });

    it("forwards POST request with body", async () => {
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ id: "456", name: "New User" }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }),
      );

      const res = await app.request("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "New User" }),
      });

      expect(res.status).toBe(201);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.example.com/api/users",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ name: "New User" }),
        }),
      );
    });

    it("preserves query parameters", async () => {
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ users: [] }), {
          status: 200,
        }),
      );

      await app.request("/api/users?page=1&limit=10");

      expect(mockFetch).toHaveBeenCalledWith("https://api.example.com/api/users?page=1&limit=10", expect.any(Object));
    });

    it("forwards response headers (excluding problematic ones)", async () => {
      mockFetch.mockResolvedValue(
        new Response("body", {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "X-Custom-Header": "custom-value",
            "Content-Encoding": "gzip",
            "Transfer-Encoding": "chunked",
            "Content-Length": "100",
          },
        }),
      );

      const res = await app.request("/api/users");

      expect(res.headers.get("Content-Type")).toBe("application/json");
      expect(res.headers.get("X-Custom-Header")).toBe("custom-value");
      // Problematic headers should be removed
      expect(res.headers.get("Content-Encoding")).toBeNull();
      expect(res.headers.get("Transfer-Encoding")).toBeNull();
      expect(res.headers.get("Content-Length")).toBeNull();
    });

    it("excludes cache-related request headers", async () => {
      mockFetch.mockResolvedValue(new Response("ok", { status: 200 }));

      await app.request("/api/users", {
        headers: {
          "If-None-Match": '"abc123"',
          "If-Modified-Since": "Wed, 21 Oct 2015 07:28:00 GMT",
          Host: "localhost",
          Connection: "keep-alive",
          "X-Custom": "custom-value",
        },
      });

      const fetchCall = mockFetch.mock.calls[0];
      const headers = fetchCall[1].headers as Headers;

      expect(headers.get("If-None-Match")).toBeNull();
      expect(headers.get("If-Modified-Since")).toBeNull();
      expect(headers.get("Host")).toBeNull();
      expect(headers.get("Connection")).toBeNull();
      expect(headers.get("X-Custom")).toBe("custom-value");
    });

    it("sets accept-encoding to gzip, deflate", async () => {
      mockFetch.mockResolvedValue(new Response("ok", { status: 200 }));

      await app.request("/api/users");

      const fetchCall = mockFetch.mock.calls[0];
      const headers = fetchCall[1].headers as Headers;

      expect(headers.get("Accept-Encoding")).toBe("gzip, deflate");
    });
  });

  describe("with custom headers from config", () => {
    it("adds headers from apiConfig", async () => {
      mockFetch.mockResolvedValue(new Response("ok", { status: 200 }));

      const apiConfigWithHeaders: ApiConfig = {
        ...testApiConfig,
        headers: {
          Authorization: "Bearer test-token",
          "X-Api-Key": "api-key-123",
        },
      };

      const headersApp = new Hono();
      headersApp.all("*", async (c) => {
        return handleProxy(c, apiConfigWithHeaders);
      });

      await headersApp.request("/api/users");

      const fetchCall = mockFetch.mock.calls[0];
      const headers = fetchCall[1].headers as Headers;

      expect(headers.get("Authorization")).toBe("Bearer test-token");
      expect(headers.get("X-Api-Key")).toBe("api-key-123");
    });

    it("config headers override request headers", async () => {
      mockFetch.mockResolvedValue(new Response("ok", { status: 200 }));

      const apiConfigWithHeaders: ApiConfig = {
        ...testApiConfig,
        headers: {
          Authorization: "Bearer config-token",
        },
      };

      const headersApp = new Hono();
      headersApp.all("*", async (c) => {
        return handleProxy(c, apiConfigWithHeaders);
      });

      await headersApp.request("/api/users", {
        headers: {
          Authorization: "Bearer request-token",
        },
      });

      const fetchCall = mockFetch.mock.calls[0];
      const headers = fetchCall[1].headers as Headers;

      expect(headers.get("Authorization")).toBe("Bearer config-token");
    });
  });

  describe("error handling", () => {
    it("returns 502 Bad Gateway on network error", async () => {
      mockFetch.mockRejectedValue(new Error("Network error"));

      const res = await app.request("/api/users");
      const body = (await res.json()) as { error: string; message: string };

      expect(res.status).toBe(502);
      expect(body.error).toBe("Bad Gateway");
      expect(body.message).toBe("Network error");
    });

    it("returns 502 Bad Gateway on timeout", async () => {
      mockFetch.mockRejectedValue(new Error("Request timeout"));

      const res = await app.request("/api/users");
      const body = (await res.json()) as { error: string; message: string };

      expect(res.status).toBe(502);
      expect(body.error).toBe("Bad Gateway");
      expect(body.message).toBe("Request timeout");
    });

    it("handles non-Error thrown values", async () => {
      mockFetch.mockRejectedValue("String error");

      const res = await app.request("/api/users");
      const body = (await res.json()) as { error: string; message: string };

      expect(res.status).toBe(502);
      expect(body.message).toBe("String error");
    });
  });

  describe("HTTP methods", () => {
    it("handles PUT request", async () => {
      mockFetch.mockResolvedValue(new Response("updated", { status: 200 }));

      await app.request("/api/users/123", {
        method: "PUT",
        body: JSON.stringify({ name: "Updated" }),
      });

      expect(mockFetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ method: "PUT" }));
    });

    it("handles DELETE request", async () => {
      // 204 status causes issues with Response body, using 200 to test method forwarding
      mockFetch.mockResolvedValue(new Response("deleted", { status: 200 }));

      const res = await app.request("/api/users/123", { method: "DELETE" });

      expect(res.status).toBe(200);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: "DELETE",
        }),
      );
    });

    it("handles PATCH request", async () => {
      mockFetch.mockResolvedValue(new Response("patched", { status: 200 }));

      await app.request("/api/users/123", {
        method: "PATCH",
        body: JSON.stringify({ name: "Patched" }),
      });

      expect(mockFetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ method: "PATCH" }));
    });

    it("does not send body for HEAD request", async () => {
      mockFetch.mockResolvedValue(new Response(null, { status: 200 }));

      await app.request("/api/users", { method: "HEAD" });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: "HEAD",
          body: null,
        }),
      );
    });
  });

  describe("response status codes", () => {
    it("preserves 404 status", async () => {
      mockFetch.mockResolvedValue(new Response("Not Found", { status: 404 }));

      const res = await app.request("/api/users/999");

      expect(res.status).toBe(404);
    });

    it("preserves 500 status", async () => {
      mockFetch.mockResolvedValue(new Response("Internal Error", { status: 500 }));

      const res = await app.request("/api/users");

      expect(res.status).toBe(500);
    });

    it("preserves 201 Created status", async () => {
      mockFetch.mockResolvedValue(new Response(JSON.stringify({ id: "new" }), { status: 201 }));

      const res = await app.request("/api/users", { method: "POST" });

      expect(res.status).toBe(201);
    });
  });
});
