import fs from "node:fs/promises";
import path from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { state } from "../core/state.js";
import { storage } from "../core/storage.js";
import type { SnaperroConfig } from "../types/config.js";
import { createHandler } from "./handler.js";

const TEST_PATTERN = "__test_smart__";
const BASE_DIR = ".snaperro/files";

const testConfig: SnaperroConfig = {
  port: 3333,
  filesDir: ".snaperro/files",
  mockFallback: "404",
  apis: {
    testApi: {
      name: "Test API",
      target: "https://jsonplaceholder.typicode.com",
      routes: ["/users", "/users/:id"],
    },
  },
};

describe("handleSmart", () => {
  let app: Hono;

  beforeEach(async () => {
    state.reset();
    await state.setMode("smart");
    await storage.createPattern(TEST_PATTERN);

    app = new Hono();
    const handler = createHandler(testConfig);
    app.all("*", handler);
  });

  afterEach(async () => {
    try {
      await fs.rm(path.join(BASE_DIR, TEST_PATTERN), { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe("パターン未選択", () => {
    it("パターン未選択時は400エラーを返す", async () => {
      // パターンを未選択状態にする
      await state.setPattern(null);

      const res = await app.request("/users");
      const body = (await res.json()) as { error: string };

      expect(res.status).toBe(400);
      expect(body.error).toBe("No pattern selected");
    });
  });

  describe("mockがある場合", () => {
    it("既存mockを返す（実サーバーにアクセスしない）", async () => {
      await state.setPattern(TEST_PATTERN);

      // mockファイルを作成
      const mockData = {
        endpoint: "/users",
        method: "GET",
        request: { pathParams: {}, queryParams: {}, headers: {}, body: null },
        response: { status: 200, headers: {}, body: { id: 1, name: "Test User" } },
      };
      await fs.writeFile(path.join(BASE_DIR, TEST_PATTERN, "users_001.json"), JSON.stringify(mockData, null, 2));

      const res = await app.request("/users");
      const body = (await res.json()) as { id: number; name: string };

      expect(res.status).toBe(200);
      expect(body.name).toBe("Test User");
    });
  });

  describe("mockがない場合", () => {
    it("実サーバーにproxy&recordする", async () => {
      await state.setPattern(TEST_PATTERN);

      // mockファイルなし → proxy&record
      const res = await app.request("/users");

      // 実サーバーに接続できない環境では502になる可能性あり
      // 接続できる場合は200でファイルが作成される
      expect([200, 502]).toContain(res.status);
    });
  });
});
