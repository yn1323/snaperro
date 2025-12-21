import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiConfig, SnaperroConfig } from "../types/config.js";
import { handleRecord } from "./recorder.js";

// Create hoisted mock functions
const { mockGetScenario, mockFindAndWriteAtomic, mockEmitSSE, mockFetch } = vi.hoisted(() => ({
  mockGetScenario: vi.fn(),
  mockFindAndWriteAtomic: vi.fn(),
  mockEmitSSE: vi.fn(),
  mockFetch: vi.fn(),
}));

// Mock global fetch
vi.stubGlobal("fetch", mockFetch);

// Mock state module
vi.mock("../core/state.js", () => ({
  state: {
    getScenario: mockGetScenario,
    getMode: vi.fn().mockReturnValue("record"),
    setScenario: vi.fn(),
    setMode: vi.fn(),
    reset: vi.fn(),
    getStatus: vi.fn().mockReturnValue({ mode: "record", scenario: null }),
  },
}));

// Mock storage module
vi.mock("../core/storage.js", () => ({
  storage: {
    findAndWriteAtomic: mockFindAndWriteAtomic,
    formatSize: vi.fn((size: number) => `${size}B`),
    getScenarioFiles: vi.fn().mockResolvedValue([]),
  },
}));

// Mock event-bus module
vi.mock("../core/event-bus.js", () => ({
  eventBus: {
    emitSSE: mockEmitSSE,
  },
}));

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
    request: vi.fn(),
  },
}));

const testApiConfig: ApiConfig = {
  name: "Test API",
  target: "https://api.example.com",
  routes: ["/api/users/:id", "/api/users"],
};

const testConfig: SnaperroConfig = {
  port: 3333,
  filesDir: ".snaperro/files",
  mockFallback: "404",
  apis: {
    testApi: testApiConfig,
  },
};

const testMatch = {
  apiKey: "testApi",
  apiConfig: testApiConfig,
  matchedRoute: "/api/users/:id",
  pathParams: { id: "123" },
};

describe("handleRecord", () => {
  let app: Hono;

  beforeEach(() => {
    mockGetScenario.mockReturnValue(null);
    mockFetch.mockReset();
    mockFindAndWriteAtomic.mockReset();
    mockEmitSSE.mockReset();

    app = new Hono();
    app.all("*", async (c) => {
      return handleRecord(c, testMatch, testConfig);
    });
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("no scenario selected", () => {
    it("returns 400 when no scenario is selected", async () => {
      const res = await app.request("/api/users/123");
      const body = (await res.json()) as { error: string };

      expect(res.status).toBe(400);
      expect(body.error).toBe("No scenario selected");
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("with scenario selected", () => {
    beforeEach(() => {
      mockGetScenario.mockReturnValue("test-scenario");
    });

    it("records GET request and returns response", async () => {
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ id: "123", name: "Test User" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
      mockFindAndWriteAtomic.mockResolvedValue({
        filePath: ".snaperro/files/test-scenario/GET_api_users_{id}.json",
        isNew: true,
      });

      const res = await app.request("/api/users/123");
      const body = (await res.json()) as { id: string; name: string };

      expect(res.status).toBe(200);
      expect(body.id).toBe("123");
      expect(body.name).toBe("Test User");
    });

    it("calls findAndWriteAtomic with correct parameters", async () => {
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ id: "123" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
      mockFindAndWriteAtomic.mockResolvedValue({
        filePath: "/path/to/file.json",
        isNew: true,
      });

      await app.request("/api/users/123");

      expect(mockFindAndWriteAtomic).toHaveBeenCalledWith(
        "test-scenario",
        "GET",
        "/api/users/:id",
        { id: "123" },
        {},
        null,
        expect.objectContaining({
          endpoint: "/api/users/:id",
          method: "GET",
          request: expect.objectContaining({
            pathParams: { id: "123" },
          }),
          response: expect.objectContaining({
            status: 200,
            body: { id: "123" },
          }),
        }),
      );
    });

    it("emits file_created event for new file", async () => {
      mockFetch.mockResolvedValue(new Response("{}", { status: 200 }));
      mockFindAndWriteAtomic.mockResolvedValue({
        filePath: ".snaperro/files/test-scenario/GET_api_users.json",
        isNew: true,
      });

      await app.request("/api/users/123");

      expect(mockEmitSSE).toHaveBeenCalledWith("file_created", {
        scenario: "test-scenario",
        filename: "GET_api_users.json",
        endpoint: "/api/users/:id",
        method: "GET",
      });
    });

    it("emits file_updated event for existing file", async () => {
      mockFetch.mockResolvedValue(new Response("{}", { status: 200 }));
      mockFindAndWriteAtomic.mockResolvedValue({
        filePath: ".snaperro/files/test-scenario/GET_api_users.json",
        isNew: false,
      });

      await app.request("/api/users/123");

      expect(mockEmitSSE).toHaveBeenCalledWith("file_updated", {
        scenario: "test-scenario",
        filename: "GET_api_users.json",
        endpoint: "/api/users/:id",
        method: "GET",
      });
    });

    it("records POST request with body", async () => {
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ id: "456" }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }),
      );
      mockFindAndWriteAtomic.mockResolvedValue({
        filePath: "/path/to/file.json",
        isNew: true,
      });

      const res = await app.request("/api/users/123", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "New User" }),
      });

      expect(res.status).toBe(201);
      expect(mockFindAndWriteAtomic).toHaveBeenCalledWith(
        "test-scenario",
        "POST",
        "/api/users/:id",
        { id: "123" },
        {},
        { name: "New User" },
        expect.objectContaining({
          method: "POST",
          request: expect.objectContaining({
            body: { name: "New User" },
          }),
        }),
      );
    });

    it("records query parameters", async () => {
      mockFetch.mockResolvedValue(new Response("{}", { status: 200 }));
      mockFindAndWriteAtomic.mockResolvedValue({
        filePath: "/path/to/file.json",
        isNew: true,
      });

      // Create app with route without path params
      const usersApp = new Hono();
      usersApp.all("*", async (c) => {
        return handleRecord(
          c,
          {
            ...testMatch,
            matchedRoute: "/api/users",
            pathParams: {},
          },
          testConfig,
        );
      });

      await usersApp.request("/api/users?page=1&limit=10");

      expect(mockFindAndWriteAtomic).toHaveBeenCalledWith(
        "test-scenario",
        "GET",
        "/api/users",
        {},
        { page: "1", limit: "10" },
        null,
        expect.objectContaining({
          request: expect.objectContaining({
            queryParams: { page: "1", limit: "10" },
          }),
        }),
      );
    });

    it("handles multiple values for same query parameter", async () => {
      mockFetch.mockResolvedValue(new Response("{}", { status: 200 }));
      mockFindAndWriteAtomic.mockResolvedValue({
        filePath: "/path/to/file.json",
        isNew: true,
      });

      const usersApp = new Hono();
      usersApp.all("*", async (c) => {
        return handleRecord(
          c,
          {
            ...testMatch,
            matchedRoute: "/api/users",
            pathParams: {},
          },
          testConfig,
        );
      });

      await usersApp.request("/api/users?tag=a&tag=b");

      expect(mockFindAndWriteAtomic).toHaveBeenCalledWith(
        "test-scenario",
        "GET",
        "/api/users",
        {},
        { tag: ["a", "b"] },
        null,
        expect.any(Object),
      );
    });

    it("handles 204 No Content response", async () => {
      mockFetch.mockResolvedValue(new Response(null, { status: 204 }));
      mockFindAndWriteAtomic.mockResolvedValue({
        filePath: "/path/to/file.json",
        isNew: true,
      });

      const res = await app.request("/api/users/123", { method: "DELETE" });

      expect(res.status).toBe(204);
      expect(await res.text()).toBe("");
      expect(mockFindAndWriteAtomic).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.any(Object),
        expect.any(Object),
        null,
        expect.objectContaining({
          response: expect.objectContaining({
            status: 204,
            body: null,
          }),
        }),
      );
    });

    it("handles 304 Not Modified response", async () => {
      mockFetch.mockResolvedValue(new Response(null, { status: 304 }));
      mockFindAndWriteAtomic.mockResolvedValue({
        filePath: "/path/to/file.json",
        isNew: true,
      });

      const res = await app.request("/api/users/123");

      expect(res.status).toBe(304);
      expect(await res.text()).toBe("");
    });

    it("handles non-JSON response as text", async () => {
      mockFetch.mockResolvedValue(
        new Response("plain text response", {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        }),
      );
      mockFindAndWriteAtomic.mockResolvedValue({
        filePath: "/path/to/file.json",
        isNew: true,
      });

      await app.request("/api/users/123");

      expect(mockFindAndWriteAtomic).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.any(Object),
        expect.any(Object),
        null,
        expect.objectContaining({
          response: expect.objectContaining({
            body: "plain text response",
          }),
        }),
      );
    });

    it("records response headers", async () => {
      mockFetch.mockResolvedValue(
        new Response("{}", {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "X-Custom-Header": "custom-value",
          },
        }),
      );
      mockFindAndWriteAtomic.mockResolvedValue({
        filePath: "/path/to/file.json",
        isNew: true,
      });

      await app.request("/api/users/123");

      expect(mockFindAndWriteAtomic).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.any(Object),
        expect.any(Object),
        null,
        expect.objectContaining({
          response: expect.objectContaining({
            headers: expect.objectContaining({
              "content-type": "application/json",
              "x-custom-header": "custom-value",
            }),
          }),
        }),
      );
    });
  });

  describe("header masking", () => {
    beforeEach(async () => {
      mockGetScenario.mockReturnValue("test-scenario");
    });

    it("masks request headers when API-level maskRequestHeaders is configured", async () => {
      mockFetch.mockResolvedValue(new Response("{}", { status: 200 }));
      mockFindAndWriteAtomic.mockResolvedValue({
        filePath: "/path/to/file.json",
        isNew: true,
      });

      const apiConfigWithMask: ApiConfig = {
        ...testApiConfig,
        maskRequestHeaders: ["authorization"],
      };

      const maskApp = new Hono();
      maskApp.all("*", async (c) => {
        return handleRecord(
          c,
          {
            ...testMatch,
            apiConfig: apiConfigWithMask,
          },
          testConfig,
        );
      });

      await maskApp.request("/api/users/123", {
        headers: {
          Authorization: "Bearer secret-token-12345",
          "Content-Type": "application/json",
        },
      });

      const savedData = mockFindAndWriteAtomic.mock.calls[0][6];
      expect(savedData.request.headers.authorization).toBe("Bear**********");
      expect(savedData.request.headers["content-type"]).toBe("application/json");
    });

    it("masks request headers when root-level maskRequestHeaders is configured", async () => {
      mockFetch.mockResolvedValue(new Response("{}", { status: 200 }));
      mockFindAndWriteAtomic.mockResolvedValue({
        filePath: "/path/to/file.json",
        isNew: true,
      });

      const configWithRootMask: SnaperroConfig = {
        ...testConfig,
        maskRequestHeaders: ["authorization"],
      };

      const maskApp = new Hono();
      maskApp.all("*", async (c) => {
        return handleRecord(c, testMatch, configWithRootMask);
      });

      await maskApp.request("/api/users/123", {
        headers: {
          Authorization: "Bearer secret-token-12345",
          "Content-Type": "application/json",
        },
      });

      const savedData = mockFindAndWriteAtomic.mock.calls[0][6];
      expect(savedData.request.headers.authorization).toBe("Bear**********");
      expect(savedData.request.headers["content-type"]).toBe("application/json");
    });

    it("merges root-level and API-level maskRequestHeaders", async () => {
      mockFetch.mockResolvedValue(new Response("{}", { status: 200 }));
      mockFindAndWriteAtomic.mockResolvedValue({
        filePath: "/path/to/file.json",
        isNew: true,
      });

      const apiConfigWithMask: ApiConfig = {
        ...testApiConfig,
        maskRequestHeaders: ["x-api-key"],
      };

      const configWithRootMask: SnaperroConfig = {
        ...testConfig,
        maskRequestHeaders: ["authorization"],
        apis: {
          testApi: apiConfigWithMask,
        },
      };

      const maskApp = new Hono();
      maskApp.all("*", async (c) => {
        return handleRecord(
          c,
          {
            ...testMatch,
            apiConfig: apiConfigWithMask,
          },
          configWithRootMask,
        );
      });

      await maskApp.request("/api/users/123", {
        headers: {
          Authorization: "Bearer secret-token-12345",
          "X-Api-Key": "sk-secret-key-12345",
          "Content-Type": "application/json",
        },
      });

      const savedData = mockFindAndWriteAtomic.mock.calls[0][6];
      expect(savedData.request.headers.authorization).toBe("Bear**********");
      expect(savedData.request.headers["x-api-key"]).toBe("sk-s**********");
      expect(savedData.request.headers["content-type"]).toBe("application/json");
    });
  });

  describe("error handling", () => {
    beforeEach(async () => {
      mockGetScenario.mockReturnValue("test-scenario");
    });

    it("returns 502 Bad Gateway on network error", async () => {
      mockFetch.mockRejectedValue(new Error("Network error"));

      const res = await app.request("/api/users/123");
      const body = (await res.json()) as { error: string; message: string };

      expect(res.status).toBe(502);
      expect(body.error).toBe("Bad Gateway");
      expect(body.message).toBe("Network error");
    });

    it("returns 502 Bad Gateway on non-Error thrown value", async () => {
      mockFetch.mockRejectedValue("String error");

      const res = await app.request("/api/users/123");
      const body = (await res.json()) as { error: string; message: string };

      expect(res.status).toBe(502);
      expect(body.message).toBe("String error");
    });

    it("does not emit event on fetch error", async () => {
      mockFetch.mockRejectedValue(new Error("Network error"));

      await app.request("/api/users/123");

      expect(mockEmitSSE).not.toHaveBeenCalled();
    });
  });

  describe("with config headers", () => {
    beforeEach(async () => {
      mockGetScenario.mockReturnValue("test-scenario");
    });

    it("adds headers from apiConfig to request", async () => {
      mockFetch.mockResolvedValue(new Response("{}", { status: 200 }));
      mockFindAndWriteAtomic.mockResolvedValue({
        filePath: "/path/to/file.json",
        isNew: true,
      });

      const apiConfigWithHeaders: ApiConfig = {
        ...testApiConfig,
        headers: {
          "X-Api-Key": "test-api-key",
        },
      };

      const headersApp = new Hono();
      headersApp.all("*", async (c) => {
        return handleRecord(
          c,
          {
            ...testMatch,
            apiConfig: apiConfigWithHeaders,
          },
          testConfig,
        );
      });

      await headersApp.request("/api/users/123");

      const fetchCall = mockFetch.mock.calls[0];
      const headers = fetchCall[1].headers as Headers;
      expect(headers.get("X-Api-Key")).toBe("test-api-key");
    });
  });

  describe("HTTP methods", () => {
    beforeEach(async () => {
      mockGetScenario.mockReturnValue("test-scenario");
    });

    it("handles PUT request", async () => {
      mockFetch.mockResolvedValue(new Response("{}", { status: 200 }));
      mockFindAndWriteAtomic.mockResolvedValue({
        filePath: "/path/to/file.json",
        isNew: true,
      });

      await app.request("/api/users/123", {
        method: "PUT",
        body: JSON.stringify({ name: "Updated" }),
      });

      expect(mockFindAndWriteAtomic).toHaveBeenCalledWith(
        expect.any(String),
        "PUT",
        expect.any(String),
        expect.any(Object),
        expect.any(Object),
        { name: "Updated" },
        expect.any(Object),
      );
    });

    it("handles DELETE request", async () => {
      mockFetch.mockResolvedValue(new Response(null, { status: 204 }));
      mockFindAndWriteAtomic.mockResolvedValue({
        filePath: "/path/to/file.json",
        isNew: true,
      });

      await app.request("/api/users/123", { method: "DELETE" });

      expect(mockFindAndWriteAtomic).toHaveBeenCalledWith(
        expect.any(String),
        "DELETE",
        expect.any(String),
        expect.any(Object),
        expect.any(Object),
        null,
        expect.any(Object),
      );
    });

    it("handles PATCH request", async () => {
      mockFetch.mockResolvedValue(new Response("{}", { status: 200 }));
      mockFindAndWriteAtomic.mockResolvedValue({
        filePath: "/path/to/file.json",
        isNew: true,
      });

      await app.request("/api/users/123", {
        method: "PATCH",
        body: JSON.stringify({ name: "Patched" }),
      });

      expect(mockFindAndWriteAtomic).toHaveBeenCalledWith(
        expect.any(String),
        "PATCH",
        expect.any(String),
        expect.any(Object),
        expect.any(Object),
        { name: "Patched" },
        expect.any(Object),
      );
    });

    it("does not send body for HEAD request", async () => {
      mockFetch.mockResolvedValue(new Response(null, { status: 200 }));
      mockFindAndWriteAtomic.mockResolvedValue({
        filePath: "/path/to/file.json",
        isNew: true,
      });

      await app.request("/api/users/123", { method: "HEAD" });

      expect(mockFindAndWriteAtomic).toHaveBeenCalledWith(
        expect.any(String),
        "HEAD",
        expect.any(String),
        expect.any(Object),
        expect.any(Object),
        null,
        expect.any(Object),
      );
    });
  });
});
