import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { state } from "../core/state.js";
import type { SnaperroConfig } from "../types/config.js";
import { createHandler } from "./handler.js";

// テスト用設定（:param形式のルートパターン）
const testConfig: SnaperroConfig = {
  port: 3333,
  filesDir: ".snaperro/files",
  mockFallback: "404",
  apis: {
    userService: {
      name: "ユーザーサービス",
      target: "https://user-api.example.com",
      routes: ["/api/users/:id", "/api/users"],
    },
    orderService: {
      name: "注文サービス",
      target: "https://order-api.example.com",
      routes: ["/api/orders/:id", "/api/orders"],
    },
  },
};

describe("createHandler", () => {
  let app: Hono;

  beforeEach(async () => {
    state.reset();

    app = new Hono();
    const handler = createHandler(testConfig);
    app.all("*", handler);
  });

  describe("マッチしないパス", () => {
    it("設定にないパスは404を返す", async () => {
      const res = await app.request("/api/unknown");
      const body = (await res.json()) as { error: string };

      expect(res.status).toBe(404);
      expect(body.error).toBe("No matching API configuration");
    });
  });

  describe("Proxyモード", () => {
    it("マッチするパスはプロキシ処理される", async () => {
      // 注: 実際のプロキシはfetchが必要なのでテストが難しい
      // ここではハンドラーが呼ばれることを確認
      await state.setMode("proxy");

      const res = await app.request("/api/users");
      // fetchエラーになり502 Bad Gatewayが返される
      expect(res.status).toBe(502);
    });
  });

  describe("Mockモード", () => {
    it("シナリオ未設定の場合は400エラーを返す", async () => {
      await state.setMode("mock");
      // scenarioはnullのまま

      const res = await app.request("/api/users");
      const body = (await res.json()) as { error: string };

      expect(res.status).toBe(400);
      expect(body.error).toBe("No scenario selected");
    });

    it("シナリオ設定済みでモックファイルがない場合は404を返す", async () => {
      await state.setMode("mock");
      await state.setScenario("nonexistent");

      const res = await app.request("/api/users");
      const body = (await res.json()) as { error: string };

      // モックファイルがないので404
      expect(res.status).toBe(404);
      expect(body.error).toBe("No matching mock found");
    });
  });

  describe("Smartモード", () => {
    it("シナリオ未設定の場合は400エラーを返す", async () => {
      await state.setMode("smart");
      // scenarioはnullのまま

      const res = await app.request("/api/users");
      const body = (await res.json()) as { error: string };

      expect(res.status).toBe(400);
      expect(body.error).toBe("No scenario selected");
    });
  });
});
