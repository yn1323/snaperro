import dayjs from "dayjs";
import type { Context } from "hono";
import { logger } from "../core/logger.js";
import { state } from "../core/state.js";
import { buildFilePath, storage } from "../core/storage.js";
import type { ApiConfig } from "../types/config.js";
import type { RecordedData } from "../types/recording.js";

/**
 * Recordモード処理
 * 実際のAPIにリクエストを転送し、レスポンスを保存して返す
 */
export async function handleRecord(c: Context, apiConfig: ApiConfig): Promise<Response> {
  const method = c.req.method;
  const url = new URL(c.req.url);
  const path = url.pathname;
  const targetUrl = `${apiConfig.target}${url.pathname}${url.search}`;

  logger.info(`${method} ${path} → record`);

  try {
    // リクエストボディを取得
    let requestBody: unknown;
    if (method !== "GET" && method !== "HEAD") {
      const text = await c.req.raw.clone().text();
      if (text) {
        try {
          requestBody = JSON.parse(text);
        } catch {
          requestBody = text;
        }
      }
    }

    // ヘッダーをコピー
    const headers = new Headers();
    for (const [key, value] of c.req.raw.headers.entries()) {
      const lowerKey = key.toLowerCase();
      if (lowerKey !== "host" && lowerKey !== "connection") {
        headers.set(key, value);
      }
    }

    // 設定のヘッダーを付与
    if (apiConfig.headers) {
      for (const [key, value] of Object.entries(apiConfig.headers)) {
        headers.set(key, value);
      }
    }

    // 1. 実APIにリクエスト
    const response = await fetch(targetUrl, {
      method,
      headers,
      body: requestBody ? JSON.stringify(requestBody) : undefined,
    });

    // 2. レスポンスボディを取得
    const responseText = await response.text();
    let responseBody: unknown;
    try {
      responseBody = JSON.parse(responseText);
    } catch {
      responseBody = responseText;
    }

    // 3. 連番を取得
    const count = state.incrementCounter(method, path);

    // 4. リクエストヘッダーを記録用に変換
    const requestHeaders: Record<string, string> = {};
    for (const [key, value] of c.req.raw.headers.entries()) {
      requestHeaders[key] = value;
    }

    // 5. レスポンスヘッダーを記録用に変換
    const responseHeaders: Record<string, string> = {};
    for (const [key, value] of response.headers.entries()) {
      responseHeaders[key] = value;
    }

    // 6. 録画データを作成
    const recordedData: RecordedData = {
      request: {
        method,
        url: path,
        headers: requestHeaders,
        body: requestBody,
      },
      response: {
        status: response.status,
        headers: responseHeaders,
        body: responseBody,
      },
      recordedAt: dayjs().toISOString(),
    };

    // 7. ファイルに保存
    const filePath = buildFilePath(state.getPattern(), path, method, count);
    await storage.write(filePath, recordedData);

    const fileSize = JSON.stringify(recordedData).length;
    logger.info(`  → saved ${filePath} (${response.status}, ${storage.formatSize(fileSize)})`);

    // 8. レスポンスを返却
    return c.json(responseBody, response.status as never);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Record failed: ${message}`);
    return c.json({ error: "Bad Gateway", message }, 502);
  }
}
