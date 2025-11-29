import type { Context } from "hono";
import { logger } from "../core/logger.js";
import { state } from "../core/state.js";
import { buildFilePath, storage } from "../core/storage.js";

/**
 * Mockモード処理
 * 保存済みのJSONファイルからレスポンスを返す
 */
export async function handleMock(c: Context): Promise<Response> {
  const method = c.req.method;
  const url = new URL(c.req.url);
  const path = url.pathname;

  // 1. 連番を取得
  const count = state.incrementCounter(method, path);

  // 2. ファイルパスを構築
  let filePath = buildFilePath(state.getPattern(), path, method, count);

  // 3. ファイル存在チェック
  if (!(await storage.exists(filePath))) {
    // 連番ファイルがなければ、最後のファイルを探す
    const lastFile = await storage.findLastFile(state.getPattern(), path, method);
    if (lastFile) {
      logger.warn(`${method} ${path} → file not found: ${method}_${count}.json, using last file`);
      filePath = lastFile;
    } else {
      logger.warn(`${method} ${path} → no mock file found`);
      return c.json(
        {
          error: "Mock file not found",
          pattern: state.getPattern(),
          path,
          method,
        },
        404,
      );
    }
  }

  try {
    // 4. ファイル読み込み
    const recordedData = await storage.read(filePath);

    logger.info(`${method} ${path} → mock → ${filePath} (${recordedData.response.status})`);

    // 5. レスポンスを返却
    return c.json(recordedData.response.body as object, recordedData.response.status as never);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Mock failed: ${message}`);
    return c.json({ error: "Failed to read mock file", message }, 500);
  }
}
