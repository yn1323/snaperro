import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { state } from "../core/state.js";
import type { SnaperroConfig } from "../types/config.js";
import { createHandler } from "./handler.js";

// テスト用設定
const testConfig: SnaperroConfig = {
  port: 3333,
  apis: {
    userService: {
      name: "ユーザーサービス",
      target: "https://user-api.example.com",
      match: ["/api/users/**"],
    },
    orderService: {
      name: "注文サービス",
      target: "https://order-api.example.com",
      match: ["/api/orders/**"],
    },
  },
};

describe("createHandler", () => {
  let app: Hono;

  beforeEach(() => {
    state.setMode("proxy");
    state.setPattern("");
    state.resetCounter();

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
      state.setMode("proxy");

      const res = await app.request("/api/users");
      // fetchエラーになり502 Bad Gatewayが返される
      expect(res.status).toBe(502);
    });
  });

  describe("Mockモード", () => {
    it("パターン未設定でもモック処理が呼ばれる", async () => {
      state.setMode("mock");
      state.setPattern("nonexistent");

      const res = await app.request("/api/users");
      const body = (await res.json()) as { error: string };

      // モックファイルがないので404
      expect(res.status).toBe(404);
      expect(body.error).toBe("Mock file not found");
    });
  });
});
