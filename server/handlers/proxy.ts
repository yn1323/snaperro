import type { Context } from "hono";
import { logger } from "../core/logger.js";
import { getProxyAgent } from "../core/proxy-agent.js";
import { copyRequestHeaders, parseRequestBody } from "../core/request-utils.js";
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
    // Get request body (without JSON parsing for proxy)
    const body = (await parseRequestBody(method, () => c.req.text(), false)) as string | null;

    // Copy headers (excluding cache-related headers to always get fresh responses)
    const headers = copyRequestHeaders(c.req.raw.headers, apiConfig.headers);

    logger.debugHeaders(Object.fromEntries(headers.entries()));

    const response = await fetch(targetUrl, {
      method,
      headers,
      body,
      // @ts-expect-error - undici@7 ProxyAgent type differs from undici-types@6 in @types/node
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
