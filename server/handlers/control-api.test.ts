import fs from "node:fs/promises";
import path from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { state } from "../core/state.js";
import type { PatternMetadata } from "../core/storage.js";
import { storage } from "../core/storage.js";
import { controlApi } from "./control-api.js";

// テスト用のアプリを作成
const app = new Hono();
app.route("/__snaperro__", controlApi);

const TEST_FOLDER = "__test_folder__";
const TEST_PATTERN_NAME = "__test_pattern__";
const TEST_PATTERN = `${TEST_FOLDER}/${TEST_PATTERN_NAME}`;
const TEST_PATTERN_ENCODED = encodeURIComponent(TEST_PATTERN);
const BASE_DIR = ".snaperro/files";

// テストデータ
const testFileData = {
  endpoint: "/api/test",
  method: "GET",
  request: { pathParams: {}, queryParams: {}, headers: {}, body: null },
  response: { status: 200, headers: {}, body: { message: "test" } },
};

describe("control-api", () => {
  beforeEach(async () => {
    // 状態をリセット
    state.reset();
    // テスト用フォルダとパターンを作成
    await storage.createFolder(TEST_FOLDER);
    await storage.createPattern(TEST_PATTERN);
    // パターンとして認識されるようにファイルを作成
    await fs.writeFile(path.join(BASE_DIR, TEST_PATTERN, "api_test_001.json"), JSON.stringify(testFileData, null, 2));
  });

  afterEach(async () => {
    // テスト用フォルダを削除
    try {
      await fs.rm(path.join(BASE_DIR, TEST_FOLDER), { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  // ============================================================
  // サーバー状態
  // ============================================================

  describe("GET /status", () => {
    it("現在の状態を返す", async () => {
      await state.setMode("mock");
      await state.setPattern(TEST_PATTERN);

      const res = await app.request("/__snaperro__/status");
      const body = (await res.json()) as {
        mode: string;
        currentPattern: string;
        patterns: string[];
        filesCount: number;
      };

      expect(res.status).toBe(200);
      expect(body.mode).toBe("mock");
      expect(body.currentPattern).toBe(TEST_PATTERN);
      expect(Array.isArray(body.patterns)).toBe(true);
      expect(typeof body.filesCount).toBe("number");
    });

    it("初期状態を返す", async () => {
      const res = await app.request("/__snaperro__/status");
      const body = (await res.json()) as {
        mode: string;
        currentPattern: string | null;
        patterns: string[];
        filesCount: number;
      };

      expect(res.status).toBe(200);
      expect(body.mode).toBe("proxy");
      expect(body.currentPattern).toBeNull();
      expect(body.filesCount).toBe(0);
    });
  });

  // ============================================================
  // モード操作
  // ============================================================

  describe("GET /mode", () => {
    it("現在のモードを返す", async () => {
      await state.setMode("record");

      const res = await app.request("/__snaperro__/mode");
      const body = (await res.json()) as { mode: string };

      expect(res.status).toBe(200);
      expect(body.mode).toBe("record");
    });
  });

  describe("PUT /mode", () => {
    it("モードを変更できる", async () => {
      const res = await app.request("/__snaperro__/mode", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "record" }),
      });
      const body = (await res.json()) as { mode: string; message: string };

      expect(res.status).toBe(200);
      expect(body.mode).toBe("record");
      expect(body.message).toBe("Mode changed to record");
      expect(state.getMode()).toBe("record");
    });

    it("無効なモードはエラーを返す", async () => {
      const res = await app.request("/__snaperro__/mode", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "invalid" }),
      });
      const body = (await res.json()) as { error: string; validModes: string[] };

      expect(res.status).toBe(400);
      expect(body.error).toBe("Invalid mode");
      expect(body.validModes).toEqual(["proxy", "record", "mock", "smart"]);
    });

    it("大文字小文字を区別しない", async () => {
      const res = await app.request("/__snaperro__/mode", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "MOCK" }),
      });
      const body = (await res.json()) as { mode: string };

      expect(res.status).toBe(200);
      expect(body.mode).toBe("mock");
    });
  });

  // ============================================================
  // パターン操作
  // ============================================================

  describe("GET /patterns", () => {
    it("パターン一覧をメタデータ付きで取得できる", async () => {
      const res = await app.request("/__snaperro__/patterns");
      const body = (await res.json()) as { patterns: PatternMetadata[] };

      expect(res.status).toBe(200);
      expect(Array.isArray(body.patterns)).toBe(true);

      const testPattern = body.patterns.find((p) => p.name === TEST_PATTERN);
      expect(testPattern).toBeDefined();
      expect(testPattern?.filesCount).toBe(1); // We created one file in beforeEach
      expect(testPattern?.createdAt).toBeDefined();
      expect(testPattern?.updatedAt).toBeDefined();
    });
  });

  describe("GET /patterns/current", () => {
    it("現在のパターンを返す", async () => {
      await state.setPattern(TEST_PATTERN);

      const res = await app.request("/__snaperro__/patterns/current");
      const body = (await res.json()) as { currentPattern: string };

      expect(res.status).toBe(200);
      expect(body.currentPattern).toBe(TEST_PATTERN);
    });

    it("パターン未選択時はnullを返す", async () => {
      const res = await app.request("/__snaperro__/patterns/current");
      const body = (await res.json()) as { currentPattern: string | null };

      expect(res.status).toBe(200);
      expect(body.currentPattern).toBeNull();
    });
  });

  describe("PUT /patterns/current", () => {
    it("パターンを切り替えできる", async () => {
      const res = await app.request("/__snaperro__/patterns/current", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pattern: TEST_PATTERN }),
      });
      const body = (await res.json()) as { currentPattern: string; message: string };

      expect(res.status).toBe(200);
      expect(body.currentPattern).toBe(TEST_PATTERN);
      expect(body.message).toBe(`Pattern changed to ${TEST_PATTERN}`);
      expect(state.getPattern()).toBe(TEST_PATTERN);
    });

    it("存在しないパターンはエラーを返す", async () => {
      const res = await app.request("/__snaperro__/patterns/current", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pattern: "nonexistent" }),
      });

      expect(res.status).toBe(404);
    });

    it("空のパターンでも設定可能", async () => {
      const res = await app.request("/__snaperro__/patterns/current", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pattern: "" }),
      });

      // Empty string is treated as a valid pattern path (base directory)
      expect(res.status).toBe(200);
    });
  });

  describe("POST /patterns", () => {
    it("パターンを作成できる", async () => {
      const newPattern = "__test_new_pattern__";
      const res = await app.request("/__snaperro__/patterns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newPattern }),
      });
      const body = (await res.json()) as { name: string; message: string };

      expect(res.status).toBe(201);
      expect(body.name).toBe(newPattern);
      expect(body.message).toBe("Pattern created");

      // クリーンアップ
      await fs.rm(path.join(BASE_DIR, newPattern), { recursive: true, force: true });
    });

    it("既存パターンはエラーを返す", async () => {
      const res = await app.request("/__snaperro__/patterns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: TEST_PATTERN }),
      });
      const body = (await res.json()) as { error: string };

      expect(res.status).toBe(409);
      expect(body.error).toBe("Pattern already exists");
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

  describe("POST /patterns/:name/duplicate", () => {
    it("パターンを複製できる", async () => {
      const newName = "__test_duplicated__";
      const res = await app.request(`/__snaperro__/patterns/${TEST_PATTERN_ENCODED}/duplicate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newName }),
      });
      const body = (await res.json()) as { source: string; destination: string; message: string };

      expect(res.status).toBe(200);
      expect(body.source).toBe(TEST_PATTERN);
      expect(body.destination).toBe(newName);
      expect(body.message).toBe("Pattern duplicated");

      // クリーンアップ
      await fs.rm(path.join(BASE_DIR, newName), { recursive: true, force: true });
    });

    it("存在しないパターンはエラーを返す", async () => {
      const res = await app.request("/__snaperro__/patterns/nonexistent/duplicate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newName: "copy" }),
      });

      expect(res.status).toBe(404);
    });
  });

  describe("PUT /patterns/:name/rename", () => {
    it("パターン名を変更できる", async () => {
      const oldName = "__test_rename_source__";
      const newName = "__test_rename_dest__";
      await storage.createPattern(oldName);

      const res = await app.request(`/__snaperro__/patterns/${oldName}/rename`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newName }),
      });
      const body = (await res.json()) as { oldName: string; newName: string; message: string };

      expect(res.status).toBe(200);
      expect(body.oldName).toBe(oldName);
      expect(body.newName).toBe(newName);
      expect(body.message).toBe("Pattern renamed");

      // クリーンアップ
      await fs.rm(path.join(BASE_DIR, newName), { recursive: true, force: true });
    });

    it("現在選択中のパターンをリネームするとstateも更新される", async () => {
      const oldName = "__test_current_rename__";
      const newName = "__test_current_renamed__";
      await storage.createPattern(oldName);
      await state.setPattern(oldName);

      const res = await app.request(`/__snaperro__/patterns/${oldName}/rename`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newName }),
      });

      expect(res.status).toBe(200);
      expect(state.getPattern()).toBe(newName);

      // クリーンアップ
      await fs.rm(path.join(BASE_DIR, newName), { recursive: true, force: true });
    });
  });

  describe("DELETE /patterns/:name", () => {
    it("パターンを削除できる", async () => {
      const deletePattern = "__test_delete__";
      await storage.createPattern(deletePattern);

      const res = await app.request(`/__snaperro__/patterns/${deletePattern}`, {
        method: "DELETE",
      });
      const body = (await res.json()) as { name: string; message: string };

      expect(res.status).toBe(200);
      expect(body.name).toBe(deletePattern);
      expect(body.message).toBe("Pattern deleted");
    });

    it("現在選択中のパターンも削除できる", async () => {
      await state.setPattern(TEST_PATTERN);

      const res = await app.request(`/__snaperro__/patterns/${TEST_PATTERN_ENCODED}`, {
        method: "DELETE",
      });

      expect(res.status).toBe(200);
    });

    it("存在しないパターンはエラーを返す", async () => {
      const res = await app.request("/__snaperro__/patterns/nonexistent", {
        method: "DELETE",
      });

      expect(res.status).toBe(404);
    });
  });

  // ============================================================
  // 記録データ操作（RESTful: パターンをURLに含める）
  // ============================================================

  describe("GET /patterns/:pattern/files", () => {
    it("存在しないパターンは404を返す", async () => {
      const res = await app.request("/__snaperro__/patterns/nonexistent/files");

      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: string; resource: string };
      expect(body.error).toBe("Not found");
      expect(body.resource).toBe("pattern");
    });

    it("記録ファイル一覧を取得できる", async () => {
      const res = await app.request(`/__snaperro__/patterns/${TEST_PATTERN_ENCODED}/files`);
      const body = (await res.json()) as { pattern: string; files: unknown[] };

      expect(res.status).toBe(200);
      expect(body.pattern).toBe(TEST_PATTERN);
      expect(Array.isArray(body.files)).toBe(true);
    });
  });

  describe("GET /patterns/:pattern/files/:filename", () => {
    it("存在しないパターンは404を返す", async () => {
      const res = await app.request("/__snaperro__/patterns/nonexistent/files/test.json");

      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: string; resource: string };
      expect(body.error).toBe("Not found");
      expect(body.resource).toBe("pattern");
    });

    it("存在しないファイルは404を返す", async () => {
      const res = await app.request(`/__snaperro__/patterns/${TEST_PATTERN_ENCODED}/files/nonexistent.json`);

      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: string; resource: string };
      expect(body.error).toBe("Not found");
      expect(body.resource).toBe("file");
    });
  });

  describe("DELETE /patterns/:pattern/files/:filename", () => {
    it("存在しないパターンは404を返す", async () => {
      const res = await app.request("/__snaperro__/patterns/nonexistent/files/test.json", {
        method: "DELETE",
      });

      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: string; resource: string };
      expect(body.error).toBe("Not found");
      expect(body.resource).toBe("pattern");
    });

    it("存在しないファイルは404を返す", async () => {
      const res = await app.request(`/__snaperro__/patterns/${TEST_PATTERN_ENCODED}/files/nonexistent.json`, {
        method: "DELETE",
      });

      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: string; resource: string };
      expect(body.error).toBe("Not found");
      expect(body.resource).toBe("file");
    });
  });
});
