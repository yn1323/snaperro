import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SnaperroConfig } from "../types/config.js";
import type { FileData } from "../types/file.js";
import { handleMock } from "./mocker.js";

// Create hoisted mock functions
const { mockGetScenario, mockFindMatchingFile } = vi.hoisted(() => ({
  mockGetScenario: vi.fn(),
  mockFindMatchingFile: vi.fn(),
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

// Mock state module
vi.mock("../core/state.js", () => ({
  state: {
    getScenario: mockGetScenario,
    getMode: vi.fn().mockReturnValue("mock"),
    setScenario: vi.fn(),
    setMode: vi.fn(),
    reset: vi.fn(),
    getStatus: vi.fn().mockReturnValue({ mode: "mock", scenario: null }),
  },
}));

// Mock storage module
vi.mock("../core/storage.js", () => ({
  storage: {
    findMatchingFile: mockFindMatchingFile,
    getScenarioFiles: vi.fn().mockResolvedValue([]),
  },
}));

const testConfig: SnaperroConfig = {
  port: 3333,
  filesDir: ".snaperro/files",
  mockFallback: "404",
  apis: {
    testApi: {
      name: "Test API",
      target: "https://api.example.com",
      routes: ["/api/users/:id", "/api/users"],
    },
  },
};

describe("handleMock", () => {
  let app: Hono;

  beforeEach(() => {
    mockGetScenario.mockReturnValue(null);
    mockFindMatchingFile.mockReset();

    app = new Hono();
    app.all("*", async (c) => {
      const match = {
        apiKey: "testApi",
        apiConfig: testConfig.apis.testApi,
        matchedRoute: "/api/users/:id",
        pathParams: { id: "123" },
      };
      return handleMock(c, match, testConfig);
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
    });
  });

  describe("with scenario selected", () => {
    beforeEach(() => {
      mockGetScenario.mockReturnValue("test-scenario");
    });

    it("returns mock response when file is found", async () => {
      const mockFileData: FileData = {
        endpoint: "/api/users/:id",
        method: "GET",
        request: {
          pathParams: { id: "123" },
          queryParams: {},
          headers: {},
          body: null,
        },
        response: {
          status: 200,
          headers: { "content-type": "application/json" },
          body: { id: "123", name: "Test User" },
        },
      };

      mockFindMatchingFile.mockResolvedValue({
        filePath: "/path/to/mock.json",
        fileData: mockFileData,
      });

      const res = await app.request("/api/users/123");
      const body = (await res.json()) as { id: string; name: string };

      expect(res.status).toBe(200);
      expect(body.id).toBe("123");
      expect(body.name).toBe("Test User");
    });

    it("returns 404 when no matching file found (default fallback)", async () => {
      mockFindMatchingFile.mockResolvedValue(null);

      const res = await app.request("/api/users/123");
      const body = (await res.json()) as { error: string };

      expect(res.status).toBe(404);
      expect(body.error).toBe("No matching mock found");
    });

    it("returns 204 with empty body for status 204", async () => {
      const mockFileData: FileData = {
        endpoint: "/api/users/:id",
        method: "DELETE",
        request: {
          pathParams: { id: "123" },
          queryParams: {},
          headers: {},
          body: null,
        },
        response: {
          status: 204,
          headers: {},
          body: null,
        },
      };

      mockFindMatchingFile.mockResolvedValue({
        filePath: "/path/to/mock.json",
        fileData: mockFileData,
      });

      const res = await app.request("/api/users/123", { method: "DELETE" });

      expect(res.status).toBe(204);
      expect(await res.text()).toBe("");
    });

    it("returns 304 with empty body for status 304", async () => {
      const mockFileData: FileData = {
        endpoint: "/api/users/:id",
        method: "GET",
        request: {
          pathParams: { id: "123" },
          queryParams: {},
          headers: {},
          body: null,
        },
        response: {
          status: 304,
          headers: {},
          body: null,
        },
      };

      mockFindMatchingFile.mockResolvedValue({
        filePath: "/path/to/mock.json",
        fileData: mockFileData,
      });

      const res = await app.request("/api/users/123");

      expect(res.status).toBe(304);
      expect(await res.text()).toBe("");
    });

    it("parses query parameters correctly", async () => {
      const mockFileData: FileData = {
        endpoint: "/api/users",
        method: "GET",
        request: {
          pathParams: {},
          queryParams: { page: "1", limit: "10" },
          headers: {},
          body: null,
        },
        response: {
          status: 200,
          headers: {},
          body: { users: [] },
        },
      };

      mockFindMatchingFile.mockResolvedValue({
        filePath: "/path/to/mock.json",
        fileData: mockFileData,
      });

      // Set up app to handle /api/users route
      const usersApp = new Hono();
      usersApp.all("*", async (c) => {
        const match = {
          apiKey: "testApi",
          apiConfig: testConfig.apis.testApi,
          matchedRoute: "/api/users",
          pathParams: {},
        };
        return handleMock(c, match, testConfig);
      });

      const res = await usersApp.request("/api/users?page=1&limit=10");

      expect(res.status).toBe(200);
      expect(mockFindMatchingFile).toHaveBeenCalledWith(
        "test-scenario",
        "GET",
        "/api/users",
        {},
        { page: "1", limit: "10" },
        null,
      );
    });

    it("handles multiple values for same query parameter", async () => {
      mockFindMatchingFile.mockResolvedValue(null);

      const usersApp = new Hono();
      usersApp.all("*", async (c) => {
        const match = {
          apiKey: "testApi",
          apiConfig: testConfig.apis.testApi,
          matchedRoute: "/api/users",
          pathParams: {},
        };
        return handleMock(c, match, testConfig);
      });

      await usersApp.request("/api/users?tag=a&tag=b&tag=c");

      expect(mockFindMatchingFile).toHaveBeenCalledWith(
        "test-scenario",
        "GET",
        "/api/users",
        {},
        { tag: ["a", "b", "c"] },
        null,
      );
    });

    it("parses JSON request body for POST", async () => {
      mockFindMatchingFile.mockResolvedValue(null);

      await app.request("/api/users/123", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "New User" }),
      });

      expect(mockFindMatchingFile).toHaveBeenCalledWith(
        "test-scenario",
        "POST",
        "/api/users/:id",
        { id: "123" },
        {},
        { name: "New User" },
      );
    });

    it("handles non-JSON request body as text", async () => {
      mockFindMatchingFile.mockResolvedValue(null);

      await app.request("/api/users/123", {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: "plain text body",
      });

      expect(mockFindMatchingFile).toHaveBeenCalledWith(
        "test-scenario",
        "POST",
        "/api/users/:id",
        { id: "123" },
        {},
        "plain text body",
      );
    });

    it("does not read body for GET requests", async () => {
      mockFindMatchingFile.mockResolvedValue(null);

      await app.request("/api/users/123", { method: "GET" });

      expect(mockFindMatchingFile).toHaveBeenCalledWith(
        "test-scenario",
        "GET",
        "/api/users/:id",
        { id: "123" },
        {},
        null,
      );
    });

    it("does not read body for HEAD requests", async () => {
      mockFindMatchingFile.mockResolvedValue(null);

      await app.request("/api/users/123", { method: "HEAD" });

      expect(mockFindMatchingFile).toHaveBeenCalledWith(
        "test-scenario",
        "HEAD",
        "/api/users/:id",
        { id: "123" },
        {},
        null,
      );
    });
  });

  describe("fallback modes", () => {
    beforeEach(() => {
      mockGetScenario.mockReturnValue("test-scenario");
    });

    it("returns 404 response details in body when fallback is 404", async () => {
      mockFindMatchingFile.mockResolvedValue(null);

      const res = await app.request("/api/users/123");
      const body = (await res.json()) as {
        error: string;
        endpoint: string;
        method: string;
        pathParams: Record<string, string>;
      };

      expect(res.status).toBe(404);
      expect(body.endpoint).toBe("/api/users/:id");
      expect(body.method).toBe("GET");
      expect(body.pathParams).toEqual({ id: "123" });
    });
  });
});
