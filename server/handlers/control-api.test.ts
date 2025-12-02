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

const TEST_PATTERN = "__test_control_api__";
const BASE_DIR = ".snaperro/recordings";

describe("control-api", () => {
  beforeEach(async () => {
    // 状態をリセット
    state.reset();
    // テスト用パターンを作成
    await storage.createPattern(TEST_PATTERN);
  });

  afterEach(async () => {
    // テスト用パターンを削除
    try {
      await fs.rm(path.join(BASE_DIR, TEST_PATTERN), { recursive: true, force: true });
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
        recordingsCount: number;
      };

      expect(res.status).toBe(200);
      expect(body.mode).toBe("mock");
      expect(body.currentPattern).toBe(TEST_PATTERN);
      expect(Array.isArray(body.patterns)).toBe(true);
      expect(typeof body.recordingsCount).toBe("number");
    });

    it("初期状態を返す", async () => {
      const res = await app.request("/__snaperro__/status");
      const body = (await res.json()) as {
        mode: string;
        currentPattern: string | null;
        patterns: string[];
        recordingsCount: number;
      };

      expect(res.status).toBe(200);
      expect(body.mode).toBe("proxy");
      expect(body.currentPattern).toBeNull();
      expect(body.recordingsCount).toBe(0);
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
      expect(body.validModes).toEqual(["proxy", "record", "mock"]);
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
      expect(testPattern?.recordingsCount).toBe(0);
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

    it("空のパターンはエラーを返す", async () => {
      const res = await app.request("/__snaperro__/patterns/current", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pattern: "" }),
      });

      expect(res.status).toBe(400);
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

      expect(res.status).toBe(400);
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
      const res = await app.request(`/__snaperro__/patterns/${TEST_PATTERN}/duplicate`, {
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

    it("現在選択中のパターンは削除できない", async () => {
      await state.setPattern(TEST_PATTERN);

      const res = await app.request(`/__snaperro__/patterns/${TEST_PATTERN}`, {
        method: "DELETE",
      });
      const body = (await res.json()) as { error: string };

      expect(res.status).toBe(400);
      expect(body.error).toBe("Cannot delete current pattern");
    });

    it("存在しないパターンはエラーを返す", async () => {
      const res = await app.request("/__snaperro__/patterns/nonexistent", {
        method: "DELETE",
      });

      expect(res.status).toBe(404);
    });
  });

  describe("GET /patterns/:name/download", () => {
    it("パターンをzipでダウンロードできる", async () => {
      // テスト用のファイルを作成
      const testData = {
        endpoint: "/api/test",
        method: "GET",
        request: { pathParams: {}, queryParams: {}, headers: {}, body: null },
        response: { status: 200, headers: {}, body: { message: "test" } },
      };
      await fs.writeFile(path.join(BASE_DIR, TEST_PATTERN, "api_test_001.json"), JSON.stringify(testData, null, 2));

      const res = await app.request(`/__snaperro__/patterns/${TEST_PATTERN}/download`);

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("application/zip");
      expect(res.headers.get("Content-Disposition")).toContain(".zip");

      // レスポンスがzipファイル（バイナリ）であることを確認
      const buffer = await res.arrayBuffer();
      expect(buffer.byteLength).toBeGreaterThan(0);
      // ZIPファイルのマジックナンバー（PK）を確認
      const view = new Uint8Array(buffer);
      expect(view[0]).toBe(0x50); // 'P'
      expect(view[1]).toBe(0x4b); // 'K'
    });

    it("存在しないパターンは404を返す", async () => {
      const res = await app.request("/__snaperro__/patterns/nonexistent/download");

      expect(res.status).toBe(404);
    });
  });

  describe("POST /patterns/upload", () => {
    it("zipファイルからパターンをアップロードできる", async () => {
      // まずダウンロード用のパターンを準備
      const sourcePattern = "__test_upload_source__";
      await storage.createPattern(sourcePattern);
      const testData = {
        endpoint: "/api/upload",
        method: "POST",
        request: { pathParams: {}, queryParams: {}, headers: {}, body: null },
        response: { status: 201, headers: {}, body: { id: 1 } },
      };
      await fs.writeFile(path.join(BASE_DIR, sourcePattern, "api_upload_001.json"), JSON.stringify(testData, null, 2));

      // zipファイルを取得
      const downloadRes = await app.request(`/__snaperro__/patterns/${sourcePattern}/download`);
      const zipBuffer = await downloadRes.arrayBuffer();

      // 新しいパターンとしてアップロード
      const newPatternName = "__test_uploaded__";
      const formData = new FormData();
      formData.append("file", new Blob([zipBuffer], { type: "application/zip" }), `${newPatternName}.zip`);
      formData.append("name", newPatternName);

      const uploadRes = await app.request("/__snaperro__/patterns/upload", {
        method: "POST",
        body: formData,
      });
      const body = (await uploadRes.json()) as { name: string; recordingsCount: number; message: string };

      expect(uploadRes.status).toBe(201);
      expect(body.name).toBe(newPatternName);
      expect(body.recordingsCount).toBe(1);
      expect(body.message).toBe("Pattern uploaded");

      // クリーンアップ
      await fs.rm(path.join(BASE_DIR, sourcePattern), { recursive: true, force: true });
      await fs.rm(path.join(BASE_DIR, newPatternName), { recursive: true, force: true });
    });

    it("既存パターン名はエラーを返す", async () => {
      // ダミーのzipファイルを作成（実際のzipでなくても先にチェックで弾かれる）
      const formData = new FormData();
      formData.append("file", new Blob(["dummy"], { type: "application/zip" }), `${TEST_PATTERN}.zip`);
      formData.append("name", TEST_PATTERN);

      const res = await app.request("/__snaperro__/patterns/upload", {
        method: "POST",
        body: formData,
      });
      const body = (await res.json()) as { error: string };

      expect(res.status).toBe(400);
      expect(body.error).toBe("Pattern already exists");
    });

    it("ファイルがない場合はエラーを返す", async () => {
      const formData = new FormData();
      formData.append("name", "test");

      const res = await app.request("/__snaperro__/patterns/upload", {
        method: "POST",
        body: formData,
      });
      const body = (await res.json()) as { error: string };

      expect(res.status).toBe(400);
      expect(body.error).toBe("Invalid request");
    });
  });

  // ============================================================
  // 記録データ操作（RESTful: パターンをURLに含める）
  // ============================================================

  describe("GET /patterns/:pattern/recordings", () => {
    it("存在しないパターンは404を返す", async () => {
      const res = await app.request("/__snaperro__/patterns/nonexistent/recordings");

      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: string; resource: string };
      expect(body.error).toBe("Not found");
      expect(body.resource).toBe("pattern");
    });

    it("記録ファイル一覧を取得できる", async () => {
      const res = await app.request(`/__snaperro__/patterns/${TEST_PATTERN}/recordings`);
      const body = (await res.json()) as { pattern: string; recordings: unknown[] };

      expect(res.status).toBe(200);
      expect(body.pattern).toBe(TEST_PATTERN);
      expect(Array.isArray(body.recordings)).toBe(true);
    });
  });

  describe("GET /patterns/:pattern/recordings/:filename", () => {
    it("存在しないパターンは404を返す", async () => {
      const res = await app.request("/__snaperro__/patterns/nonexistent/recordings/test.json");

      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: string; resource: string };
      expect(body.error).toBe("Not found");
      expect(body.resource).toBe("pattern");
    });

    it("存在しないファイルは404を返す", async () => {
      const res = await app.request(`/__snaperro__/patterns/${TEST_PATTERN}/recordings/nonexistent.json`);

      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: string; resource: string };
      expect(body.error).toBe("Not found");
      expect(body.resource).toBe("recording");
    });
  });

  describe("DELETE /patterns/:pattern/recordings/:filename", () => {
    it("存在しないパターンは404を返す", async () => {
      const res = await app.request("/__snaperro__/patterns/nonexistent/recordings/test.json", {
        method: "DELETE",
      });

      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: string; resource: string };
      expect(body.error).toBe("Not found");
      expect(body.resource).toBe("pattern");
    });

    it("存在しないファイルは404を返す", async () => {
      const res = await app.request(`/__snaperro__/patterns/${TEST_PATTERN}/recordings/nonexistent.json`, {
        method: "DELETE",
      });

      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: string; resource: string };
      expect(body.error).toBe("Not found");
      expect(body.resource).toBe("recording");
    });
  });
});
