import type { Context } from "hono";
import { logger } from "../core/logger.js";
import { findMatchingApi } from "../core/matcher.js";
import { state } from "../core/state.js";
import type { SnaperroConfig } from "../types/config.js";
import { handleMock } from "./mocker.js";
import { handleProxy } from "./proxy.js";
import { handleRecord } from "./recorder.js";

/**
 * メインリクエストハンドラー
 * モードに応じて適切なハンドラーに振り分け
 */
export function createHandler(config: SnaperroConfig) {
  return async (c: Context): Promise<Response> => {
    const method = c.req.method;
    const url = new URL(c.req.url);
    const path = url.pathname;

    // API設定からマッチするものを検索
    const match = findMatchingApi(method, path, config.apis);

    if (!match) {
      logger.warn(`${method} ${path} → no matching API found`);
      return c.json(
        {
          error: "No matching API configuration",
          path,
          method,
        },
        404,
      );
    }

    const mode = state.getMode();

    // モードに応じて処理を振り分け
    switch (mode) {
      case "proxy":
        return handleProxy(c, match.apiConfig);

      case "record":
        return handleRecord(c, match);

      case "mock":
        return handleMock(c, match);

      default:
        logger.error(`Unknown mode: ${mode}`);
        return c.json({ error: "Unknown mode" }, 500);
    }
  };
}
