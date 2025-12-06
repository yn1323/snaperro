import type { Context } from "hono";
import { logger } from "../core/logger.js";
import type { MatchResult } from "../core/matcher.js";
import { state } from "../core/state.js";
import { storage } from "../core/storage.js";

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
 * Mockモード処理
 * 保存済みのJSONファイルからレスポンスを返す
 */
export async function handleMock(c: Context, match: MatchResult): Promise<Response> {
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

  // クエリパラメータを解析
  const queryParams = parseQueryParams(url);

  // パラメータマッチングでファイルを検索
  const result = await storage.findMatchingFile(pattern, method, match.matchedRoute, match.pathParams, queryParams);

  if (!result) {
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

  // レスポンスを返却（304/204はボディなし）
  const status = result.fileData.response.status;
  if (status === 304 || status === 204) {
    return c.body(null, status as never);
  }
  return c.json(result.fileData.response.body as object, status as never);
}
