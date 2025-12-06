import type { Context } from "hono";
import { logger } from "../core/logger.js";
import { getProxyAgent } from "../core/proxy-agent.js";
import type { ApiConfig } from "../types/config.js";

/**
 * Proxy mode handler
 * Forward requests to actual API and return responses as-is
 */
export async function handleProxy(c: Context, apiConfig: ApiConfig): Promise<Response> {
  const method = c.req.method;
  const url = new URL(c.req.url);
  const path = url.pathname + url.search;

  const targetUrl = `${apiConfig.target}${path}`;

  logger.info(`${method} ${path} → proxy → ${targetUrl}`);

  const startTime = Date.now();

  try {
    // Get request body
    let body: string | null = null;
    if (method !== "GET" && method !== "HEAD") {
      body = await c.req.text();
    }

    // Copy headers (excluding cache-related headers to always get fresh responses)
    const headers = new Headers();
    const skipRequestHeaders = ["host", "connection", "if-none-match", "if-modified-since"];
    for (const [key, value] of c.req.raw.headers.entries()) {
      if (!skipRequestHeaders.includes(key.toLowerCase())) {
        headers.set(key, value);
      }
    }

    // Limit Accept-Encoding (Node.js doesn't support zstd/br)
    headers.set("accept-encoding", "gzip, deflate");

    // Add headers from config
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
      // @ts-expect-error - dispatcher is a Node.js-specific option from undici
      dispatcher: getProxyAgent(),
    });

    const elapsed = Date.now() - startTime;
    logger.info(`  → ${response.status} (${elapsed}ms)`);

    // Copy headers (excluding problematic headers)
    // Content-Encoding: Already decompressed by response.text() but gzip remains causing browser re-decompression error
    // Transfer-Encoding: Issues with chunked etc. remaining
    // Content-Length: Excluded because body size may have changed
    const responseHeaders = new Headers();
    const skipResponseHeaders = ["content-encoding", "transfer-encoding", "content-length"];
    for (const [key, value] of response.headers.entries()) {
      if (!skipResponseHeaders.includes(key.toLowerCase())) {
        responseHeaders.set(key, value);
      }
    }

    // Explicitly read body (avoid issue of empty body when passing ReadableStream directly)
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
