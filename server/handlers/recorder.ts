import path from "node:path";
import type { Context } from "hono";
import { eventBus } from "../core/event-bus.js";
import { logger } from "../core/logger.js";
import type { MatchResult } from "../core/matcher.js";
import { state } from "../core/state.js";
import { storage } from "../core/storage.js";
import type { FileData, HttpMethod } from "../types/file.js";

/**
 * クエリパラメータを解析
 */
function parseQueryParams(url: URL): Record<string, string | string[]> {
  const params: Record<string, string | string[]> = {};
  for (const [key, value] of url.searchParams.entries()) {
    const existing = params[key];
    if (existing) {
      params[key] = Array.isArray(existing) ? [...existing, value] : [existing, value];
    } else {
      params[key] = value;
    }
  }
  return params;
}

/**
 * Recordモード処理
 * 実際のAPIにリクエストを転送し、レスポンスを保存して返す
 */
export async function handleRecord(c: Context, match: MatchResult): Promise<Response> {
  const method = c.req.method;
  const url = new URL(c.req.url);
  const requestPath = url.pathname;
  const pattern = state.getPattern();
  const targetUrl = `${match.apiConfig.target}${url.pathname}${url.search}`;

  if (!pattern) {
    logger.warn(`${method} ${requestPath} → no pattern selected`);
    return c.json(
      {
        error: "No pattern selected",
        message: "Please select a pattern first",
      },
      400,
    );
  }

  logger.info(`${method} ${requestPath} → record`);

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
    if (match.apiConfig.headers) {
      for (const [key, value] of Object.entries(match.apiConfig.headers)) {
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

    // 3. クエリパラメータを解析
    const queryParams = parseQueryParams(url);

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

    // 6. 記録データを作成
    const fileData: FileData = {
      endpoint: match.matchedRoute,
      method: method as HttpMethod,
      request: {
        pathParams: match.pathParams,
        queryParams,
        headers: requestHeaders,
        body: requestBody ?? null,
      },
      response: {
        status: response.status,
        headers: responseHeaders,
        body: responseBody,
      },
    };

    // 7. ファイルパスを決定（既存なら上書き、新規なら新ファイル）
    const { filePath, isNew } = await storage.findOrCreateFile(
      pattern,
      method,
      match.matchedRoute,
      match.pathParams,
      queryParams,
    );

    // 8. ファイルに保存
    await storage.write(filePath, fileData);

    // 9. SSEイベント発行
    eventBus.emitSSE(isNew ? "file_created" : "file_updated", {
      pattern,
      filename: path.basename(filePath),
      endpoint: match.matchedRoute,
      method,
    });

    const fileSize = JSON.stringify(fileData).length;
    const action = isNew ? "saved" : "updated";
    logger.info(`  → ${action} ${filePath} (${response.status}, ${storage.formatSize(fileSize)})`);

    // 9. レスポンスを返却
    return c.json(responseBody, response.status as never);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Record failed: ${message}`);
    return c.json({ error: "Bad Gateway", message }, 502);
  }
}
