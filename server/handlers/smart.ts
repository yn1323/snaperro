import type { Context } from "hono";
import { logger } from "../core/logger.js";
import type { MatchResult } from "../core/matcher.js";
import { parseQueryParams, parseRequestBody } from "../core/request-utils.js";
import { state } from "../core/state.js";
import { storage } from "../core/storage.js";
import type { SnaperroConfig } from "../types/config.js";
import { handleRecord } from "./recorder.js";

/**
 * Smart mode handler
 * Return mock if exists, otherwise proxy & record
 */
export async function handleSmart(c: Context, match: MatchResult, config: SnaperroConfig): Promise<Response> {
  const method = c.req.method;
  const url = new URL(c.req.url);
  const path = url.pathname;
  const scenario = state.getScenario();

  // 1. Scenario is required
  if (!scenario) {
    logger.warn(`${method} ${path} → no scenario selected`);
    return c.json(
      {
        error: "No scenario selected",
        message: "Please select a scenario first",
      },
      400,
    );
  }

  // 2. Parse query parameters and request body
  const queryParams = parseQueryParams(url);
  const requestBody = await parseRequestBody(method, () => c.req.text());

  // 3. Search for existing mock
  const result = await storage.findMatchingFile(
    scenario,
    method,
    match.matchedRoute,
    match.pathParams,
    queryParams,
    requestBody,
  );

  // 4. If mock exists, return it
  if (result) {
    logger.info(`${method} ${path} → smart → mock → ${result.filePath} (${result.fileData.response.status})`);

    const status = result.fileData.response.status;
    if (status === 304 || status === 204) {
      return c.body(null, status as never);
    }
    return c.json(result.fileData.response.body as object, status as never);
  }

  // 5. If no mock, proxy & record
  logger.info(`${method} ${path} → smart → record`);
  return handleRecord(c, match, config);
}
