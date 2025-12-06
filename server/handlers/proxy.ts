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

    // ヘッダーをコピー（キャッシュ関連ヘッダーを除外して常に新しいレスポンスを取得）
    const headers = new Headers();
    const skipRequestHeaders = ["host", "connection", "if-none-match", "if-modified-since"];
    for (const [key, value] of c.req.raw.headers.entries()) {
      if (!skipRequestHeaders.includes(key.toLowerCase())) {
        headers.set(key, value);
      }
    }

    // Accept-Encodingを制限（Node.jsはzstd/brをサポートしない）
    headers.set("accept-encoding", "gzip, deflate");

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

    // ヘッダーをコピー（問題のあるヘッダーを除外）
    // Content-Encoding: response.text()で解凍済みなのにgzipが残るとブラウザが再解凍を試みてエラー
    // Transfer-Encoding: chunkedなどが残ると問題
    // Content-Length: ボディサイズが変わっている可能性があるため除外
    const responseHeaders = new Headers();
    const skipResponseHeaders = ["content-encoding", "transfer-encoding", "content-length"];
    for (const [key, value] of response.headers.entries()) {
      if (!skipResponseHeaders.includes(key.toLowerCase())) {
        responseHeaders.set(key, value);
      }
    }

    // ボディを明示的に読み取る（ReadableStreamを直接渡すと消費済みで空になる問題を回避）
    const bodyText = await response.text();
    return new Response(bodyText, {
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
