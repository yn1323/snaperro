import path from "node:path";
import type { Context } from "hono";
import { eventBus } from "../core/event-bus.js";
import { logger } from "../core/logger.js";
import type { MatchResult } from "../core/matcher.js";
import { getProxyAgent } from "../core/proxy-agent.js";
import { state } from "../core/state.js";
import { storage } from "../core/storage.js";
import type { FileData, HttpMethod } from "../types/file.js";

/**
 * Parse query parameters
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
 * Record mode handler
 * Forward requests to actual API, save responses, and return them
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
    // Get request body
    let requestBody: unknown;
    if (method !== "GET" && method !== "HEAD") {
      const text = await c.req.text();
      if (text) {
        try {
          requestBody = JSON.parse(text);
        } catch {
          requestBody = text;
        }
      }
    }

    // Copy headers (excluding cache-related headers to always get fresh responses)
    const headers = new Headers();
    const skipHeaders = ["host", "connection", "if-none-match", "if-modified-since"];
    for (const [key, value] of c.req.raw.headers.entries()) {
      if (!skipHeaders.includes(key.toLowerCase())) {
        headers.set(key, value);
      }
    }

    // Limit Accept-Encoding (Node.js doesn't support zstd/br)
    headers.set("accept-encoding", "gzip, deflate");

    // Add headers from config
    if (match.apiConfig.headers) {
      for (const [key, value] of Object.entries(match.apiConfig.headers)) {
        headers.set(key, value);
      }
    }

    // 1. Request to actual API
    const response = await fetch(targetUrl, {
      method,
      headers,
      body: requestBody ? JSON.stringify(requestBody) : undefined,
      // @ts-expect-error - dispatcher is a Node.js-specific option from undici
      dispatcher: getProxyAgent(),
    });

    // 2. Get response body (304/204 have no body)
    const responseText = await response.text();
    let responseBody: unknown = null;
    if (response.status !== 304 && response.status !== 204 && responseText) {
      try {
        responseBody = JSON.parse(responseText);
      } catch {
        responseBody = responseText;
      }
    }

    // 3. Parse query parameters
    const queryParams = parseQueryParams(url);

    // 4. Convert request headers for recording
    const requestHeaders: Record<string, string> = {};
    for (const [key, value] of c.req.raw.headers.entries()) {
      requestHeaders[key] = value;
    }

    // 5. Convert response headers for recording
    const responseHeaders: Record<string, string> = {};
    for (const [key, value] of response.headers.entries()) {
      responseHeaders[key] = value;
    }

    // 6. Create recorded data
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

    // 7. Determine file path (overwrite if exists, new file if not)
    const { filePath, isNew } = await storage.findOrCreateFile(
      pattern,
      method,
      match.matchedRoute,
      match.pathParams,
      queryParams,
      requestBody ?? null,
    );

    // 8. Save to file
    await storage.write(filePath, fileData);

    // 9. Emit SSE event
    eventBus.emitSSE(isNew ? "file_created" : "file_updated", {
      pattern,
      filename: path.basename(filePath),
      endpoint: match.matchedRoute,
      method,
    });

    const fileSize = JSON.stringify(fileData).length;
    const action = isNew ? "saved" : "updated";
    logger.info(`  → ${action} ${filePath} (${response.status}, ${storage.formatSize(fileSize)})`);

    // 10. Return response (304/204 have no body)
    if (response.status === 304 || response.status === 204) {
      return c.body(null, response.status as never);
    }
    return c.json(responseBody, response.status as never);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Record failed: ${message}`);
    return c.json({ error: "Bad Gateway", message }, 502);
  }
}
