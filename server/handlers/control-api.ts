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
 * /__snaperro__/* エンドポイントでモード・パターン管理
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
  const pattern = state.getPattern();
  const patterns = await storage.listPatterns();
  const filesCount = pattern ? (await storage.getPatternFiles(pattern)).length : 0;

  return c.json({
    version: VERSION,
    mode: state.getMode(),
    currentPattern: pattern,
    patterns,
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
 * フォルダ内パターン一覧取得
 * GET /__snaperro__/folders/:folder/patterns
 */
controlApi.get("/folders/:folder/patterns", async (c) => {
  const folder = c.req.param("folder");

  // フォルダが存在するかチェック
  if (!(await storage.folderExists(folder))) {
    return c.json(notFoundError("folder", folder), 404);
  }

  const patterns = await storage.listPatternsInFolder(folder);
  return c.json({ folder, patterns });
});

// ============================================================
// パターン操作
// ============================================================

/**
 * パターン一覧取得
 * GET /__snaperro__/patterns
 */
controlApi.get("/patterns", async (c) => {
  const patternNames = await storage.listPatterns();
  const patterns = await Promise.all(
    patternNames.map(async (name) => {
      const metadata = await storage.getPatternMetadata(name);
      return metadata;
    }),
  );

  return c.json({ patterns: patterns.filter((p) => p !== null) });
});

/**
 * 現在のパターン取得
 * GET /__snaperro__/patterns/current
 */
controlApi.get("/patterns/current", (c) => {
  return c.json({ currentPattern: state.getPattern() });
});

/**
 * パターン切替
 * PUT /__snaperro__/patterns/current
 * Body: { pattern: string }
 */
controlApi.put("/patterns/current", async (c) => {
  const body = await c.req.json<{ pattern: string | null }>();
  const pattern = body.pattern;

  if (pattern !== null && typeof pattern !== "string") {
    return c.json(validationError("pattern must be string or null"), 400);
  }

  // null でない場合はパターンの存在チェック
  if (pattern !== null && !(await storage.patternExists(pattern))) {
    return c.json(notFoundError("pattern", pattern), 404);
  }

  await state.setPattern(pattern);
  return c.json({
    currentPattern: pattern,
    message: `Pattern changed to ${pattern}`,
  });
});

/**
 * パターン作成
 * POST /__snaperro__/patterns
 * Body: { name: string }
 */
controlApi.post("/patterns", async (c) => {
  const body = await c.req.json<{ name: string }>();
  const name = body.name;

  if (!name || typeof name !== "string") {
    return c.json(validationError("Missing required field: name"), 400);
  }

  // パターンが既に存在するかチェック
  if (await storage.patternExists(name)) {
    return c.json(conflictError("pattern", name), 409);
  }

  await storage.createPattern(name);
  return c.json({ name, message: "Pattern created" }, 201);
});

/**
 * パターン複製
 * POST /__snaperro__/patterns/:name/duplicate
 * Body: { newName: string }
 */
controlApi.post("/patterns/:name/duplicate", async (c) => {
  const name = c.req.param("name");
  const body = await c.req.json<{ newName: string }>();
  const newName = body.newName;

  if (!newName || typeof newName !== "string") {
    return c.json(validationError("Missing required field: newName"), 400);
  }

  // ソースが存在するかチェック
  if (!(await storage.patternExists(name))) {
    return c.json(notFoundError("pattern", name), 404);
  }

  try {
    await storage.duplicatePattern(name, newName);
    return c.json({
      source: name,
      destination: newName,
      message: "Pattern duplicated",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to duplicate pattern";
    return c.json({ error: message }, 400);
  }
});

/**
 * パターン名変更
 * PUT /__snaperro__/patterns/:name/rename
 * Body: { newName: string }
 */
controlApi.put("/patterns/:name/rename", async (c) => {
  const name = c.req.param("name");
  const body = await c.req.json<{ newName: string }>();
  const newName = body.newName;

  if (!newName || typeof newName !== "string") {
    return c.json(validationError("Missing required field: newName"), 400);
  }

  // ソースが存在するかチェック
  if (!(await storage.patternExists(name))) {
    return c.json(notFoundError("pattern", name), 404);
  }

  try {
    await storage.renamePattern(name, newName);

    // 現在のパターンがリネームされた場合は更新
    if (state.getPattern() === name) {
      await state.setPattern(newName);
    }

    return c.json({
      oldName: name,
      newName,
      message: "Pattern renamed",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to rename pattern";
    return c.json({ error: message }, 400);
  }
});

/**
 * パターン削除
 * DELETE /__snaperro__/patterns/:name
 */
controlApi.delete("/patterns/:name", async (c) => {
  const name = c.req.param("name");

  // パターンが存在するかチェック
  if (!(await storage.patternExists(name))) {
    return c.json(notFoundError("pattern", name), 404);
  }

  // 現在選択中のパターンを削除する場合は未選択状態にする
  if (state.getPattern() === name) {
    await state.setPattern(null);
  }

  await storage.deletePattern(name);
  return c.json({ name, message: "Pattern deleted" });
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
    const { actualFolderName, patternsCount } = await storage.extractZipToFolder(zipBuffer, folderName);

    return c.json(
      {
        name: actualFolderName,
        patternsCount,
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
// 記録データ操作（RESTful: パターンをURLに含める）
// ============================================================

/**
 * パターン存在チェック用ヘルパー
 */
async function checkPatternExists(pattern: string) {
  return await storage.patternExists(pattern);
}

/**
 * 記録ファイル一覧取得
 * GET /__snaperro__/patterns/:pattern/files
 */
controlApi.get("/patterns/:pattern/files", async (c) => {
  const pattern = c.req.param("pattern");

  if (!(await checkPatternExists(pattern))) {
    return c.json(notFoundError("pattern", pattern), 404);
  }

  const patternFiles = await storage.getPatternFiles(pattern);
  const files = patternFiles.map((f) => ({
    filename: f.path,
    endpoint: f.endpoint,
    method: f.method,
    size: f.size,
    updatedAt: f.updatedAt,
  }));

  return c.json({ pattern, files });
});

/**
 * パターン内ファイル検索
 * GET /__snaperro__/patterns/:pattern/files/search?q=<query>
 */
controlApi.get("/patterns/:pattern/files/search", async (c) => {
  const pattern = c.req.param("pattern");
  const query = c.req.query("q");

  if (!query) {
    return c.json(validationError("Query required"), 400);
  }

  if (!(await checkPatternExists(pattern))) {
    return c.json(notFoundError("pattern", pattern), 404);
  }

  const results = await storage.searchPatternFiles(pattern, query);
  return c.json({ pattern, query, files: results });
});

/**
 * 記録ファイル内容取得
 * GET /__snaperro__/patterns/:pattern/files/:filename
 */
controlApi.get("/patterns/:pattern/files/:filename", async (c) => {
  const pattern = c.req.param("pattern");
  const filename = c.req.param("filename");

  if (!(await checkPatternExists(pattern))) {
    return c.json(notFoundError("pattern", pattern), 404);
  }

  try {
    const data = await storage.read(`${pattern}/${filename}`);
    return c.json(data);
  } catch {
    return c.json(notFoundError("file", filename), 404);
  }
});

/**
 * 記録ファイル個別ダウンロード
 * GET /__snaperro__/patterns/:pattern/files/:filename/download
 */
controlApi.get("/patterns/:pattern/files/:filename/download", async (c) => {
  const pattern = c.req.param("pattern");
  const filename = c.req.param("filename");

  if (!(await checkPatternExists(pattern))) {
    return c.json(notFoundError("pattern", pattern), 404);
  }

  try {
    const data = await storage.read(`${pattern}/${filename}`);
    c.header("Content-Disposition", `attachment; filename="${filename}"`);
    c.header("Content-Type", "application/json");
    return c.body(JSON.stringify(data, null, 2));
  } catch {
    return c.json(notFoundError("file", filename), 404);
  }
});

/**
 * 記録ファイルアップロード
 * POST /__snaperro__/patterns/:pattern/files/upload
 */
controlApi.post("/patterns/:pattern/files/upload", async (c) => {
  const pattern = c.req.param("pattern");

  if (!(await checkPatternExists(pattern))) {
    return c.json(notFoundError("pattern", pattern), 404);
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
    const sequence = await storage.findNextSequence(pattern, data.endpoint);

    // buildFilePath を使ってファイルパスを構築
    const { buildFilePath, endpointToFileName } = await import("../core/storage.js");
    const filePath = buildFilePath(pattern, data.endpoint, sequence);
    const filename = `${endpointToFileName(data.endpoint)}_${String(sequence).padStart(3, "0")}.json`;

    await storage.write(filePath, data);

    // SSEイベント発行
    eventBus.emitSSE("file_created", {
      pattern,
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
 * PUT /__snaperro__/patterns/:pattern/files/:filename
 */
controlApi.put("/patterns/:pattern/files/:filename", async (c) => {
  const pattern = c.req.param("pattern");
  const filename = c.req.param("filename");

  if (!(await checkPatternExists(pattern))) {
    return c.json(notFoundError("pattern", pattern), 404);
  }

  const filePath = `${pattern}/${filename}`;

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
 * DELETE /__snaperro__/patterns/:pattern/files/:filename
 */
controlApi.delete("/patterns/:pattern/files/:filename", async (c) => {
  const pattern = c.req.param("pattern");
  const filename = c.req.param("filename");

  if (!(await checkPatternExists(pattern))) {
    return c.json(notFoundError("pattern", pattern), 404);
  }

  const filePath = `${pattern}/${filename}`;

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
    const currentPattern = state.getPattern();
    const patternNames = await storage.listPatterns();
    const folders = await storage.listFolders();
    const files = currentPattern ? await storage.getPatternFiles(currentPattern) : [];

    await stream.writeSSE({
      event: "connected",
      data: JSON.stringify({
        version: VERSION,
        mode: state.getMode(),
        currentPattern,
        patterns: patternNames,
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
