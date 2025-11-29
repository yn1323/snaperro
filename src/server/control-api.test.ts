import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { state } from "../core/state.js";
import { controlApi } from "./control-api.js";

// テスト用のアプリを作成
const app = new Hono();
app.route("/__snaperro__", controlApi);

describe("control-api", () => {
  beforeEach(() => {
    // 状態をリセット
    state.setMode("proxy");
    state.setPattern("");
    state.resetCounter();
  });

  describe("GET /status", () => {
    it("現在の状態を返す", async () => {
      state.setMode("mock");
      state.setPattern("テストパターン");

      const res = await app.request("/__snaperro__/status");
      const body = (await res.json()) as { mode: string; pattern: string };

      expect(res.status).toBe(200);
      expect(body.mode).toBe("mock");
      expect(body.pattern).toBe("テストパターン");
    });
  });

  describe("POST /mode", () => {
    it("モードを変更できる", async () => {
      const res = await app.request("/__snaperro__/mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "record" }),
      });
      const body = (await res.json()) as { mode: string };

      expect(res.status).toBe(200);
      expect(body.mode).toBe("record");
      expect(state.getMode()).toBe("record");
    });

    it("無効なモードはエラーを返す", async () => {
      const res = await app.request("/__snaperro__/mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "invalid" }),
      });

      expect(res.status).toBe(400);
    });

    it("大文字小文字を区別しない", async () => {
      const res = await app.request("/__snaperro__/mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "MOCK" }),
      });
      const body = (await res.json()) as { mode: string };

      expect(res.status).toBe(200);
      expect(body.mode).toBe("mock");
    });
  });

  describe("POST /pattern", () => {
    it("パターンを変更できる", async () => {
      const res = await app.request("/__snaperro__/pattern", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pattern: "正常系" }),
      });
      const body = (await res.json()) as { pattern: string };

      expect(res.status).toBe(200);
      expect(body.pattern).toBe("正常系");
      expect(state.getPattern()).toBe("正常系");
    });

    it("空のパターンはエラーを返す", async () => {
      const res = await app.request("/__snaperro__/pattern", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pattern: "" }),
      });

      expect(res.status).toBe(400);
    });
  });

  describe("POST /reset", () => {
    it("カウンターをリセットできる", async () => {
      // カウンターを増やす
      state.incrementCounter("GET", "/api/users");
      state.incrementCounter("GET", "/api/users");

      const res = await app.request("/__snaperro__/reset", {
        method: "POST",
      });
      const body = (await res.json()) as { message: string };

      expect(res.status).toBe(200);
      expect(body.message).toBe("Counters reset");

      // リセット後は1から始まる
      expect(state.incrementCounter("GET", "/api/users")).toBe(1);
    });
  });

  describe("GET /patterns", () => {
    it("パターン一覧を取得できる", async () => {
      const res = await app.request("/__snaperro__/patterns");
      const body = (await res.json()) as { patterns: string[] };

      expect(res.status).toBe(200);
      expect(Array.isArray(body.patterns)).toBe(true);
    });
  });

  describe("POST /patterns", () => {
    it("パターンを作成できる", async () => {
      const res = await app.request("/__snaperro__/patterns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "__test_api_pattern__" }),
      });
      const body = (await res.json()) as { name: string; message: string };

      expect(res.status).toBe(201);
      expect(body.name).toBe("__test_api_pattern__");
    });

    it("名前がない場合はエラーを返す", async () => {
      const res = await app.request("/__snaperro__/patterns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
    });
  });

  describe("GET /patterns/:name/files", () => {
    it("パターン内のファイル一覧を取得できる", async () => {
      const res = await app.request("/__snaperro__/patterns/nonexistent/files");
      const body = (await res.json()) as { files: unknown[] };

      expect(res.status).toBe(200);
      expect(Array.isArray(body.files)).toBe(true);
    });
  });

  describe("GET /files/*", () => {
    it("存在しないファイルは404を返す", async () => {
      const res = await app.request("/__snaperro__/files/nonexistent/GET_1.json");

      expect(res.status).toBe(404);
    });
  });

  describe("DELETE /files/*", () => {
    it("存在しないファイルは404を返す", async () => {
      const res = await app.request("/__snaperro__/files/nonexistent/GET_1.json", {
        method: "DELETE",
      });

      expect(res.status).toBe(404);
    });
  });
});
