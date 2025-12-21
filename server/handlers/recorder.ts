import path from "node:path";
import type { Context } from "hono";
import { eventBus } from "../core/event-bus.js";
import { logger } from "../core/logger.js";
import { getMergedMaskHeaders, maskHeaders } from "../core/mask.js";
import type { MatchResult } from "../core/matcher.js";
import { getProxyAgent } from "../core/proxy-agent.js";
import { copyRequestHeaders, parseQueryParams, parseRequestBody } from "../core/request-utils.js";
import { state } from "../core/state.js";
import { storage } from "../core/storage.js";
import type { SnaperroConfig } from "../types/config.js";
import type { FileData, HttpMethod } from "../types/file.js";

/**
 * Record mode handler
 * Forward requests to actual API, save responses, and return them
 */
export async function handleRecord(c: Context, match: MatchResult, config: SnaperroConfig): Promise<Response> {
  const method = c.req.method;
  const url = new URL(c.req.url);
  const requestPath = url.pathname;
  const scenario = state.getScenario();
  const targetUrl = `${match.apiConfig.target}${url.pathname}${url.search}`;

  if (!scenario) {
    logger.warn(`${method} ${requestPath} → no scenario selected`);
    return c.json(
      {
        error: "No scenario selected",
        message: "Please select a scenario first",
      },
      400,
    );
  }

  logger.debug(`${method} ${requestPath} → record`);

  const startTime = Date.now();

  try {
    // Get request body
    const requestBody = await parseRequestBody(method, () => c.req.text());

    // Copy headers (excluding cache-related headers to always get fresh responses)
    const headers = copyRequestHeaders(c.req.raw.headers, match.apiConfig.headers);

    // 1. Request to actual API
    const response = await fetch(targetUrl, {
      method,
      headers,
      body: requestBody ? JSON.stringify(requestBody) : undefined,
      // @ts-expect-error - undici@7 ProxyAgent type differs from undici-types@6 in @types/node
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

    // 4. Convert request headers for recording (with masking)
    const rawRequestHeaders: Record<string, string> = {};
    for (const [key, value] of c.req.raw.headers.entries()) {
      rawRequestHeaders[key] = value;
    }
    const requestHeaders = maskHeaders(
      rawRequestHeaders,
      getMergedMaskHeaders(config.maskRequestHeaders, match.apiConfig.maskRequestHeaders),
    );

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

    // 7. Determine file path and save atomically (prevents race conditions)
    const { filePath, isNew } = await storage.findAndWriteAtomic(
      scenario,
      method,
      match.matchedRoute,
      match.pathParams,
      queryParams,
      requestBody ?? null,
      fileData,
    );

    // 9. Emit SSE event
    eventBus.emitSSE(isNew ? "file_created" : "file_updated", {
      scenario,
      filename: path.basename(filePath),
      endpoint: match.matchedRoute,
      method,
    });

    const elapsed = Date.now() - startTime;
    logger.request({
      method,
      path: requestPath,
      action: "record",
      status: response.status,
      filePath: path.basename(filePath),
      duration: elapsed,
    });

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
