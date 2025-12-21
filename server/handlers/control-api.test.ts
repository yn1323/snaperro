import fs from "node:fs/promises";
import path from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { state } from "../core/state.js";
import type { ScenarioMetadata } from "../core/storage.js";
import { storage } from "../core/storage.js";
import { controlApi } from "./control-api.js";

// テスト用のアプリを作成
const app = new Hono();
app.route("/__snaperro__", controlApi);

const TEST_FOLDER = "__test_folder__";
const TEST_SCENARIO_NAME = "__test_scenario__";
const TEST_SCENARIO = `${TEST_FOLDER}/${TEST_SCENARIO_NAME}`;
const TEST_SCENARIO_ENCODED = encodeURIComponent(TEST_SCENARIO);
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
    // テスト用フォルダとシナリオを作成
    await storage.createFolder(TEST_FOLDER);
    await storage.createScenario(TEST_SCENARIO);
    // シナリオとして認識されるようにファイルを作成
    await fs.writeFile(path.join(BASE_DIR, TEST_SCENARIO, "api_test_001.json"), JSON.stringify(testFileData, null, 2));
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
      await state.setScenario(TEST_SCENARIO);

      const res = await app.request("/__snaperro__/status");
      const body = (await res.json()) as {
        mode: string;
        currentScenario: string;
        scenarios: string[];
        filesCount: number;
      };

      expect(res.status).toBe(200);
      expect(body.mode).toBe("mock");
      expect(body.currentScenario).toBe(TEST_SCENARIO);
      expect(Array.isArray(body.scenarios)).toBe(true);
      expect(typeof body.filesCount).toBe("number");
    });

    it("初期状態を返す", async () => {
      const res = await app.request("/__snaperro__/status");
      const body = (await res.json()) as {
        mode: string;
        currentScenario: string | null;
        scenarios: string[];
        filesCount: number;
      };

      expect(res.status).toBe(200);
      expect(body.mode).toBe("smart");
      expect(body.currentScenario).toBeNull();
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
  // シナリオ操作
  // ============================================================

  describe("GET /scenarios", () => {
    it("シナリオ一覧をメタデータ付きで取得できる", async () => {
      const res = await app.request("/__snaperro__/scenarios");
      const body = (await res.json()) as { scenarios: ScenarioMetadata[] };

      expect(res.status).toBe(200);
      expect(Array.isArray(body.scenarios)).toBe(true);

      const testScenario = body.scenarios.find((p) => p.name === TEST_SCENARIO);
      expect(testScenario).toBeDefined();
      expect(testScenario?.filesCount).toBe(1); // We created one file in beforeEach
      expect(testScenario?.createdAt).toBeDefined();
      expect(testScenario?.updatedAt).toBeDefined();
    });
  });

  describe("GET /scenarios/current", () => {
    it("現在のシナリオを返す", async () => {
      await state.setScenario(TEST_SCENARIO);

      const res = await app.request("/__snaperro__/scenarios/current");
      const body = (await res.json()) as { currentScenario: string };

      expect(res.status).toBe(200);
      expect(body.currentScenario).toBe(TEST_SCENARIO);
    });

    it("シナリオ未選択時はnullを返す", async () => {
      const res = await app.request("/__snaperro__/scenarios/current");
      const body = (await res.json()) as { currentScenario: string | null };

      expect(res.status).toBe(200);
      expect(body.currentScenario).toBeNull();
    });
  });

  describe("PUT /scenarios/current", () => {
    it("シナリオを切り替えできる", async () => {
      const res = await app.request("/__snaperro__/scenarios/current", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenario: TEST_SCENARIO }),
      });
      const body = (await res.json()) as { currentScenario: string; message: string };

      expect(res.status).toBe(200);
      expect(body.currentScenario).toBe(TEST_SCENARIO);
      expect(body.message).toBe(`Scenario changed to ${TEST_SCENARIO}`);
      expect(state.getScenario()).toBe(TEST_SCENARIO);
    });

    it("存在しないシナリオはエラーを返す", async () => {
      const res = await app.request("/__snaperro__/scenarios/current", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenario: "nonexistent" }),
      });

      expect(res.status).toBe(404);
    });

    it("空のシナリオでも設定可能", async () => {
      const res = await app.request("/__snaperro__/scenarios/current", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenario: "" }),
      });

      // Empty string is treated as a valid scenario path (base directory)
      expect(res.status).toBe(200);
    });
  });

  describe("POST /scenarios", () => {
    it("シナリオを作成できる", async () => {
      const newScenario = "__test_new_scenario__";
      const res = await app.request("/__snaperro__/scenarios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newScenario }),
      });
      const body = (await res.json()) as { name: string; message: string };

      expect(res.status).toBe(201);
      expect(body.name).toBe(newScenario);
      expect(body.message).toBe("Scenario created");

      // クリーンアップ
      await fs.rm(path.join(BASE_DIR, newScenario), { recursive: true, force: true });
    });

    it("既存シナリオはエラーを返す", async () => {
      const res = await app.request("/__snaperro__/scenarios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: TEST_SCENARIO }),
      });
      const body = (await res.json()) as { error: string };

      expect(res.status).toBe(409);
      expect(body.error).toBe("Scenario already exists");
    });

    it("名前がない場合はエラーを返す", async () => {
      const res = await app.request("/__snaperro__/scenarios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
    });
  });

  describe("POST /scenarios/:name/duplicate", () => {
    it("シナリオを複製できる", async () => {
      const newName = "__test_duplicated__";
      const res = await app.request(`/__snaperro__/scenarios/${TEST_SCENARIO_ENCODED}/duplicate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newName }),
      });
      const body = (await res.json()) as { source: string; destination: string; message: string };

      expect(res.status).toBe(200);
      expect(body.source).toBe(TEST_SCENARIO);
      expect(body.destination).toBe(newName);
      expect(body.message).toBe("Scenario duplicated");

      // クリーンアップ
      await fs.rm(path.join(BASE_DIR, newName), { recursive: true, force: true });
    });

    it("存在しないシナリオはエラーを返す", async () => {
      const res = await app.request("/__snaperro__/scenarios/nonexistent/duplicate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newName: "copy" }),
      });

      expect(res.status).toBe(404);
    });
  });

  describe("PUT /scenarios/:name/rename", () => {
    it("シナリオ名を変更できる", async () => {
      const oldName = "__test_rename_source__";
      const newName = "__test_rename_dest__";
      await storage.createScenario(oldName);

      const res = await app.request(`/__snaperro__/scenarios/${oldName}/rename`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newName }),
      });
      const body = (await res.json()) as { oldName: string; newName: string; message: string };

      expect(res.status).toBe(200);
      expect(body.oldName).toBe(oldName);
      expect(body.newName).toBe(newName);
      expect(body.message).toBe("Scenario renamed");

      // クリーンアップ
      await fs.rm(path.join(BASE_DIR, newName), { recursive: true, force: true });
    });

    it("現在選択中のシナリオをリネームするとstateも更新される", async () => {
      const oldName = "__test_current_rename__";
      const newName = "__test_current_renamed__";
      await storage.createScenario(oldName);
      await state.setScenario(oldName);

      const res = await app.request(`/__snaperro__/scenarios/${oldName}/rename`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newName }),
      });

      expect(res.status).toBe(200);
      expect(state.getScenario()).toBe(newName);

      // クリーンアップ
      await fs.rm(path.join(BASE_DIR, newName), { recursive: true, force: true });
    });

    it("フォルダ内のシナリオをリネームするとフォルダパスが維持される", async () => {
      const folder = "__test_folder_rename__";
      const oldScenario = "original";
      const newScenario = "renamed";
      const oldName = `${folder}/${oldScenario}`;
      const expectedNewName = `${folder}/${newScenario}`;

      await storage.createFolder(folder);
      await storage.createScenario(oldName);

      const res = await app.request(`/__snaperro__/scenarios/${encodeURIComponent(oldName)}/rename`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newName: newScenario }), // シナリオ名のみ送信
      });
      const body = (await res.json()) as { oldName: string; newName: string; message: string };

      expect(res.status).toBe(200);
      expect(body.newName).toBe(expectedNewName); // フォルダパスが維持される

      // クリーンアップ
      await storage.deleteFolder(folder);
    });
  });

  describe("DELETE /scenarios/:name", () => {
    it("シナリオを削除できる", async () => {
      const deleteScenario = "__test_delete__";
      await storage.createScenario(deleteScenario);

      const res = await app.request(`/__snaperro__/scenarios/${deleteScenario}`, {
        method: "DELETE",
      });
      const body = (await res.json()) as { name: string; message: string };

      expect(res.status).toBe(200);
      expect(body.name).toBe(deleteScenario);
      expect(body.message).toBe("Scenario deleted");
    });

    it("現在選択中のシナリオも削除できる", async () => {
      await state.setScenario(TEST_SCENARIO);

      const res = await app.request(`/__snaperro__/scenarios/${TEST_SCENARIO_ENCODED}`, {
        method: "DELETE",
      });

      expect(res.status).toBe(200);
    });

    it("存在しないシナリオはエラーを返す", async () => {
      const res = await app.request("/__snaperro__/scenarios/nonexistent", {
        method: "DELETE",
      });

      expect(res.status).toBe(404);
    });
  });

  // ============================================================
  // 記録データ操作（RESTful: シナリオをURLに含める）
  // ============================================================

  describe("GET /scenarios/:scenario/files", () => {
    it("存在しないシナリオは404を返す", async () => {
      const res = await app.request("/__snaperro__/scenarios/nonexistent/files");

      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: string; resource: string };
      expect(body.error).toBe("Not found");
      expect(body.resource).toBe("scenario");
    });

    it("記録ファイル一覧を取得できる", async () => {
      const res = await app.request(`/__snaperro__/scenarios/${TEST_SCENARIO_ENCODED}/files`);
      const body = (await res.json()) as { scenario: string; files: unknown[] };

      expect(res.status).toBe(200);
      expect(body.scenario).toBe(TEST_SCENARIO);
      expect(Array.isArray(body.files)).toBe(true);
    });
  });

  describe("GET /scenarios/:scenario/files/:filename", () => {
    it("存在しないシナリオは404を返す", async () => {
      const res = await app.request("/__snaperro__/scenarios/nonexistent/files/test.json");

      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: string; resource: string };
      expect(body.error).toBe("Not found");
      expect(body.resource).toBe("scenario");
    });

    it("存在しないファイルは404を返す", async () => {
      const res = await app.request(`/__snaperro__/scenarios/${TEST_SCENARIO_ENCODED}/files/nonexistent.json`);

      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: string; resource: string };
      expect(body.error).toBe("Not found");
      expect(body.resource).toBe("file");
    });
  });

  describe("DELETE /scenarios/:scenario/files/:filename", () => {
    it("存在しないシナリオは404を返す", async () => {
      const res = await app.request("/__snaperro__/scenarios/nonexistent/files/test.json", {
        method: "DELETE",
      });

      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: string; resource: string };
      expect(body.error).toBe("Not found");
      expect(body.resource).toBe("scenario");
    });

    it("存在しないファイルは404を返す", async () => {
      const res = await app.request(`/__snaperro__/scenarios/${TEST_SCENARIO_ENCODED}/files/nonexistent.json`, {
        method: "DELETE",
      });

      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: string; resource: string };
      expect(body.error).toBe("Not found");
      expect(body.resource).toBe("file");
    });
  });
});
