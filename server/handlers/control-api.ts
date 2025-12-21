import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { conflictError, internalError, notFoundError, validationError } from "../core/api-response.js";
import { eventBus } from "../core/event-bus.js";
import { type Mode, state } from "../core/state.js";
import { storage } from "../core/storage.js";
import { VERSION } from "../core/version.js";
import type { FileData } from "../types/file.js";

/**
 * 制御API
 * /__snaperro__/* エンドポイントでモード・シナリオ管理
 */
export const controlApi = new Hono();

// ============================================================
// サーバー状態
// ============================================================

/**
 * 状態取得
 * GET /__snaperro__/status
 */
controlApi.get("/status", async (c) => {
  const scenario = state.getScenario();
  const scenarios = await storage.listScenarios();
  const filesCount = scenario ? (await storage.getScenarioFiles(scenario)).length : 0;

  return c.json({
    version: VERSION,
    mode: state.getMode(),
    currentScenario: scenario,
    scenarios,
    filesCount,
  });
});

// ============================================================
// モード操作
// ============================================================

/**
 * モード取得
 * GET /__snaperro__/mode
 */
controlApi.get("/mode", (c) => {
  return c.json({ mode: state.getMode() });
});

/**
 * モード変更
 * PUT /__snaperro__/mode
 * Body: { mode: "proxy" | "record" | "mock" }
 */
controlApi.put("/mode", async (c) => {
  const body = await c.req.json<{ mode: string }>();
  const mode = body.mode?.toLowerCase();

  const validModes = ["proxy", "record", "mock", "smart"];
  if (!validModes.includes(mode)) {
    return c.json({ error: "Invalid mode", validModes }, 400);
  }

  await state.setMode(mode as Mode);
  return c.json({
    mode: state.getMode(),
    message: `Mode changed to ${mode}`,
  });
});

// ============================================================
// フォルダ操作
// ============================================================

/**
 * フォルダ一覧取得
 * GET /__snaperro__/folders
 */
controlApi.get("/folders", async (c) => {
  const folders = await storage.listFolders();
  return c.json({ folders });
});

/**
 * フォルダ作成
 * POST /__snaperro__/folders
 * Body: { name: string }
 */
controlApi.post("/folders", async (c) => {
  const body = await c.req.json<{ name: string }>();
  const name = body.name;

  if (!name || typeof name !== "string") {
    return c.json(validationError("Missing required field: name"), 400);
  }

  // フォルダが既に存在するかチェック
  if (await storage.folderExists(name)) {
    return c.json(conflictError("folder", name), 409);
  }

  await storage.createFolder(name);
  return c.json({ name, message: "Folder created" }, 201);
});

/**
 * フォルダ削除
 * DELETE /__snaperro__/folders/:name
 */
controlApi.delete("/folders/:name", async (c) => {
  const name = c.req.param("name");

  // フォルダが存在するかチェック
  if (!(await storage.folderExists(name))) {
    return c.json(notFoundError("folder", name), 404);
  }

  await storage.deleteFolder(name);
  return c.json({ name, message: "Folder deleted" });
});

/**
 * フォルダ名変更
 * PUT /__snaperro__/folders/:name/rename
 * Body: { newName: string }
 */
controlApi.put("/folders/:name/rename", async (c) => {
  const name = c.req.param("name");
  const body = await c.req.json<{ newName: string }>();
  const newName = body.newName;

  if (!newName || typeof newName !== "string") {
    return c.json(validationError("Missing required field: newName"), 400);
  }

  // フォルダが存在するかチェック
  if (!(await storage.folderExists(name))) {
    return c.json(notFoundError("folder", name), 404);
  }

  try {
    await storage.renameFolder(name, newName);
    return c.json({
      oldName: name,
      newName,
      message: "Folder renamed",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to rename folder";
    return c.json({ error: message }, 400);
  }
});

/**
 * フォルダ内シナリオ一覧取得
 * GET /__snaperro__/folders/:folder/scenarios
 */
controlApi.get("/folders/:folder/scenarios", async (c) => {
  const folder = c.req.param("folder");

  // フォルダが存在するかチェック
  if (!(await storage.folderExists(folder))) {
    return c.json(notFoundError("folder", folder), 404);
  }

  const scenarios = await storage.listScenariosInFolder(folder);
  return c.json({ folder, scenarios });
});

// ============================================================
// シナリオ操作
// ============================================================

/**
 * シナリオ一覧取得
 * GET /__snaperro__/scenarios
 */
controlApi.get("/scenarios", async (c) => {
  const scenarioNames = await storage.listScenarios();
  const scenarios = await Promise.all(
    scenarioNames.map(async (name) => {
      const metadata = await storage.getScenarioMetadata(name);
      return metadata;
    }),
  );

  return c.json({ scenarios: scenarios.filter((s) => s !== null) });
});

/**
 * 現在のシナリオ取得
 * GET /__snaperro__/scenarios/current
 */
controlApi.get("/scenarios/current", (c) => {
  return c.json({ currentScenario: state.getScenario() });
});

/**
 * シナリオ切替
 * PUT /__snaperro__/scenarios/current
 * Body: { scenario: string }
 */
controlApi.put("/scenarios/current", async (c) => {
  const body = await c.req.json<{ scenario: string | null }>();
  const scenario = body.scenario;

  if (scenario !== null && typeof scenario !== "string") {
    return c.json(validationError("scenario must be string or null"), 400);
  }

  // null でない場合はシナリオの存在チェック
  if (scenario !== null && !(await storage.scenarioExists(scenario))) {
    return c.json(notFoundError("scenario", scenario), 404);
  }

  await state.setScenario(scenario);
  return c.json({
    currentScenario: scenario,
    message: `Scenario changed to ${scenario}`,
  });
});

/**
 * シナリオ作成
 * POST /__snaperro__/scenarios
 * Body: { name: string }
 */
controlApi.post("/scenarios", async (c) => {
  const body = await c.req.json<{ name: string }>();
  const name = body.name;

  if (!name || typeof name !== "string") {
    return c.json(validationError("Missing required field: name"), 400);
  }

  // シナリオが既に存在するかチェック
  if (await storage.scenarioExists(name)) {
    return c.json(conflictError("scenario", name), 409);
  }

  await storage.createScenario(name);
  return c.json({ name, message: "Scenario created" }, 201);
});

/**
 * シナリオ複製
 * POST /__snaperro__/scenarios/:name/duplicate
 * Body: { newName: string }
 */
controlApi.post("/scenarios/:name/duplicate", async (c) => {
  const name = c.req.param("name");
  const body = await c.req.json<{ newName: string }>();
  const newName = body.newName;

  if (!newName || typeof newName !== "string") {
    return c.json(validationError("Missing required field: newName"), 400);
  }

  // ソースが存在するかチェック
  if (!(await storage.scenarioExists(name))) {
    return c.json(notFoundError("scenario", name), 404);
  }

  try {
    await storage.duplicateScenario(name, newName);
    return c.json({
      source: name,
      destination: newName,
      message: "Scenario duplicated",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to duplicate scenario";
    return c.json({ error: message }, 400);
  }
});

/**
 * シナリオ名変更
 * PUT /__snaperro__/scenarios/:name/rename
 * Body: { newName: string }
 */
controlApi.put("/scenarios/:name/rename", async (c) => {
  const name = c.req.param("name");
  const body = await c.req.json<{ newName: string }>();
  const newName = body.newName;

  if (!newName || typeof newName !== "string") {
    return c.json(validationError("Missing required field: newName"), 400);
  }

  // ソースが存在するかチェック
  if (!(await storage.scenarioExists(name))) {
    return c.json(notFoundError("scenario", name), 404);
  }

  try {
    await storage.renameScenario(name, newName);

    // 現在のシナリオがリネームされた場合は更新
    if (state.getScenario() === name) {
      await state.setScenario(newName);
    }

    return c.json({
      oldName: name,
      newName,
      message: "Scenario renamed",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to rename scenario";
    return c.json({ error: message }, 400);
  }
});

/**
 * シナリオ削除
 * DELETE /__snaperro__/scenarios/:name
 */
controlApi.delete("/scenarios/:name", async (c) => {
  const name = c.req.param("name");

  // シナリオが存在するかチェック
  if (!(await storage.scenarioExists(name))) {
    return c.json(notFoundError("scenario", name), 404);
  }

  // 現在選択中のシナリオを削除する場合は未選択状態にする
  if (state.getScenario() === name) {
    await state.setScenario(null);
  }

  await storage.deleteScenario(name);
  return c.json({ name, message: "Scenario deleted" });
});

/**
 * フォルダZIPダウンロード
 * GET /__snaperro__/folders/:name/download
 */
controlApi.get("/folders/:name/download", async (c) => {
  const name = c.req.param("name");

  if (!(await storage.folderExists(name))) {
    return c.json(notFoundError("folder", name), 404);
  }

  try {
    const zipBuffer = await storage.zipFolderDir(name);
    c.header("Content-Type", "application/zip");
    c.header("Content-Disposition", `attachment; filename="${encodeURIComponent(name)}.zip"`);
    return c.body(new Uint8Array(zipBuffer));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create zip";
    return c.json(internalError(message), 500);
  }
});

/**
 * フォルダZIPアップロード
 * POST /__snaperro__/folders/upload
 * Body: multipart/form-data { file: zipファイル }
 * 同名フォルダが存在する場合はサフィックスを付与
 */
controlApi.post("/folders/upload", async (c) => {
  try {
    const formData = await c.req.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof File)) {
      return c.json(validationError("Missing file"), 400);
    }

    // フォルダ名はzipファイル名から（.zip を除去）
    const folderName = file.name.replace(/\.zip$/i, "");

    // zipを解凍して展開（同名フォルダがあればサフィックス付与）
    const arrayBuffer = await file.arrayBuffer();
    const zipBuffer = Buffer.from(arrayBuffer);
    const { actualFolderName, scenariosCount } = await storage.extractZipToFolder(zipBuffer, folderName);

    return c.json(
      {
        name: actualFolderName,
        scenariosCount,
        message: "Folder uploaded",
      },
      201,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to extract zip";
    return c.json(internalError(message), 500);
  }
});

// ============================================================
// 記録データ操作（RESTful: シナリオをURLに含める）
// ============================================================

/**
 * シナリオ存在チェック用ヘルパー
 */
async function checkScenarioExists(scenario: string) {
  return await storage.scenarioExists(scenario);
}

/**
 * 記録ファイル一覧取得
 * GET /__snaperro__/scenarios/:scenario/files
 */
controlApi.get("/scenarios/:scenario/files", async (c) => {
  const scenario = c.req.param("scenario");

  if (!(await checkScenarioExists(scenario))) {
    return c.json(notFoundError("scenario", scenario), 404);
  }

  const scenarioFiles = await storage.getScenarioFiles(scenario);
  const files = scenarioFiles.map((f) => ({
    filename: f.path,
    endpoint: f.endpoint,
    method: f.method,
    size: f.size,
    updatedAt: f.updatedAt,
  }));

  return c.json({ scenario, files });
});

/**
 * シナリオ内ファイル検索
 * GET /__snaperro__/scenarios/:scenario/files/search?q=<query>
 */
controlApi.get("/scenarios/:scenario/files/search", async (c) => {
  const scenario = c.req.param("scenario");
  const query = c.req.query("q");

  if (!query) {
    return c.json(validationError("Query required"), 400);
  }

  if (!(await checkScenarioExists(scenario))) {
    return c.json(notFoundError("scenario", scenario), 404);
  }

  const results = await storage.searchScenarioFiles(scenario, query);
  return c.json({ scenario, query, files: results });
});

/**
 * 記録ファイル内容取得
 * GET /__snaperro__/scenarios/:scenario/files/:filename
 */
controlApi.get("/scenarios/:scenario/files/:filename", async (c) => {
  const scenario = c.req.param("scenario");
  const filename = c.req.param("filename");

  if (!(await checkScenarioExists(scenario))) {
    return c.json(notFoundError("scenario", scenario), 404);
  }

  try {
    const data = await storage.read(`${scenario}/${filename}`);
    return c.json(data);
  } catch {
    return c.json(notFoundError("file", filename), 404);
  }
});

/**
 * 記録ファイル個別ダウンロード
 * GET /__snaperro__/scenarios/:scenario/files/:filename/download
 */
controlApi.get("/scenarios/:scenario/files/:filename/download", async (c) => {
  const scenario = c.req.param("scenario");
  const filename = c.req.param("filename");

  if (!(await checkScenarioExists(scenario))) {
    return c.json(notFoundError("scenario", scenario), 404);
  }

  try {
    const data = await storage.read(`${scenario}/${filename}`);
    c.header("Content-Disposition", `attachment; filename="${filename}"`);
    c.header("Content-Type", "application/json");
    return c.body(JSON.stringify(data, null, 2));
  } catch {
    return c.json(notFoundError("file", filename), 404);
  }
});

/**
 * 記録ファイルアップロード
 * POST /__snaperro__/scenarios/:scenario/files/upload
 */
controlApi.post("/scenarios/:scenario/files/upload", async (c) => {
  const scenario = c.req.param("scenario");

  if (!(await checkScenarioExists(scenario))) {
    return c.json(notFoundError("scenario", scenario), 404);
  }

  try {
    const formData = await c.req.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof File)) {
      return c.json(validationError("Missing file"), 400);
    }

    const content = await file.text();
    const data = JSON.parse(content) as FileData;

    // ファイル名を決定（新規連番）
    const sequence = await storage.findNextSequence(scenario, data.endpoint);

    // buildFilePath を使ってファイルパスを構築
    const { buildFilePath, endpointToFileName } = await import("../core/storage.js");
    const filePath = buildFilePath(scenario, data.endpoint, sequence);
    const filename = `${endpointToFileName(data.endpoint)}_${String(sequence).padStart(3, "0")}.json`;

    await storage.write(filePath, data);

    // SSEイベント発行
    eventBus.emitSSE("file_created", {
      scenario,
      filename,
      endpoint: data.endpoint,
      method: data.method,
    });

    return c.json({ filename, message: "File uploaded" }, 201);
  } catch {
    return c.json(validationError("Invalid JSON file"), 400);
  }
});

/**
 * 記録ファイル編集
 * PUT /__snaperro__/scenarios/:scenario/files/:filename
 */
controlApi.put("/scenarios/:scenario/files/:filename", async (c) => {
  const scenario = c.req.param("scenario");
  const filename = c.req.param("filename");

  if (!(await checkScenarioExists(scenario))) {
    return c.json(notFoundError("scenario", scenario), 404);
  }

  const filePath = `${scenario}/${filename}`;

  // ファイルが存在するかチェック
  if (!(await storage.exists(filePath))) {
    return c.json(notFoundError("file", filename), 404);
  }

  try {
    const data = (await c.req.json()) as FileData;
    await storage.write(filePath, data);
    return c.json({ filename, message: "File updated" });
  } catch {
    return c.json(validationError("Invalid JSON data"), 400);
  }
});

/**
 * 記録ファイル削除
 * DELETE /__snaperro__/scenarios/:scenario/files/:filename
 */
controlApi.delete("/scenarios/:scenario/files/:filename", async (c) => {
  const scenario = c.req.param("scenario");
  const filename = c.req.param("filename");

  if (!(await checkScenarioExists(scenario))) {
    return c.json(notFoundError("scenario", scenario), 404);
  }

  const filePath = `${scenario}/${filename}`;

  try {
    await storage.deleteFile(filePath);
    return c.json({ filename, message: "File deleted" });
  } catch {
    return c.json(notFoundError("file", filename), 404);
  }
});

// ============================================================
// SSE (Server-Sent Events)
// ============================================================

/**
 * SSEイベントストリーム
 * GET /__snaperro__/events
 *
 * GUIがリアルタイムで状態変更を検知するためのエンドポイント
 */
controlApi.get("/events", async (c) => {
  return streamSSE(c, async (stream) => {
    // 1. 初期状態を送信
    const currentScenario = state.getScenario();
    const scenarioNames = await storage.listScenarios();
    const folders = await storage.listFolders();
    const files = currentScenario ? await storage.getScenarioFiles(currentScenario) : [];

    await stream.writeSSE({
      event: "connected",
      data: JSON.stringify({
        version: VERSION,
        mode: state.getMode(),
        currentScenario,
        scenarios: scenarioNames,
        folders,
        files: files.map((f) => ({
          filename: f.path,
          endpoint: f.endpoint,
          method: f.method,
        })),
      }),
      id: "0",
    });

    // 2. イベント購読
    let eventId = 1;
    const unsubscribe = eventBus.subscribe(async (event) => {
      try {
        await stream.writeSSE({
          event: event.type,
          data: JSON.stringify(event.data),
          id: String(eventId++),
        });
      } catch {
        // クライアント切断時のエラーは無視
      }
    });

    // 3. クライアント切断時に購読解除
    stream.onAbort(() => {
      unsubscribe();
    });

    // 4. 接続維持のためのループ（30秒ごとにkeep-alive）
    while (true) {
      await stream.sleep(30000);
    }
  });
});
