import type { Context } from "hono";
import { logger } from "../core/logger.js";
import type { ApiConfig } from "../types/config.js";

/**
 * Proxyモード処理
 * 実際のAPIにリクエストを転送し、レスポンスをそのまま返す
 */
export async function handleProxy(c: Context, apiConfig: ApiConfig): Promise<Response> {
  const method = c.req.method;
  const url = new URL(c.req.url);
  const path = url.pathname + url.search;

  const targetUrl = `${apiConfig.target}${path}`;

  logger.info(`${method} ${path} → proxy → ${targetUrl}`);

  const startTime = Date.now();

  try {
    // リクエストボディを取得
    let body: string | null = null;
    if (method !== "GET" && method !== "HEAD") {
      body = await c.req.raw.clone().text();
    }

    // ヘッダーをコピー（Host等を除外）
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

    logger.debugHeaders(Object.fromEntries(headers.entries()));

    const response = await fetch(targetUrl, {
      method,
      headers,
      body,
    });

    const elapsed = Date.now() - startTime;
    logger.info(`  → ${response.status} (${elapsed}ms)`);

    // ヘッダーをコピー（fetchのレスポンスヘッダーはimmutableのため）
    const responseHeaders = new Headers();
    for (const [key, value] of response.headers.entries()) {
      responseHeaders.set(key, value);
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Proxy failed: ${message}`);
    return c.json({ error: "Bad Gateway", message }, 502);
  }
}
