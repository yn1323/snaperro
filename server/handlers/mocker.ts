import type { Context } from "hono";
import { logger } from "../core/logger.js";
import type { MatchResult } from "../core/matcher.js";
import { state } from "../core/state.js";
import { storage } from "../core/storage.js";
import type { SnaperroConfig } from "../types/config.js";
import { handleProxy } from "./proxy.js";
import { handleRecord } from "./recorder.js";

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
 * Mock mode handler
 * Return responses from saved JSON files
 */
export async function handleMock(c: Context, match: MatchResult, config: SnaperroConfig): Promise<Response> {
  const method = c.req.method;
  const url = new URL(c.req.url);
  const path = url.pathname;
  const pattern = state.getPattern();

  if (!pattern) {
    logger.warn(`${method} ${path} → no pattern selected`);
    return c.json(
      {
        error: "No pattern selected",
        message: "Please select a pattern first",
      },
      400,
    );
  }

  // Parse query parameters
  const queryParams = parseQueryParams(url);

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

  // Search for file with parameter matching
  const result = await storage.findMatchingFile(
    pattern,
    method,
    match.matchedRoute,
    match.pathParams,
    queryParams,
    requestBody,
  );

  if (!result) {
    const fallback = config.mockFallback ?? "404";

    // Fallback: proxy to real server
    if (fallback === "proxy") {
      logger.info(`${method} ${path} → mock fallback → proxy`);
      return handleProxy(c, match.apiConfig);
    }

    // Fallback: proxy and record
    if (fallback === "proxy&record") {
      logger.info(`${method} ${path} → mock fallback → proxy&record`);
      return handleRecord(c, match);
    }

    // Fallback: return 404 (default)
    logger.warn(`${method} ${path} → no matching mock found`);
    return c.json(
      {
        error: "No matching mock found",
        endpoint: match.matchedRoute,
        method,
        pathParams: match.pathParams,
        queryParams,
      },
      404,
    );
  }

  logger.info(`${method} ${path} → mock → ${result.filePath} (${result.fileData.response.status})`);

  // Return response (304/204 have no body)
  const status = result.fileData.response.status;
  if (status === 304 || status === 204) {
    return c.body(null, status as never);
  }
  return c.json(result.fileData.response.body as object, status as never);
}
