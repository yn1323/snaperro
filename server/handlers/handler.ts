import type { Context } from "hono";
import { logger } from "../core/logger.js";
import { findMatchingApi } from "../core/matcher.js";
import { state } from "../core/state.js";
import type { SnaperroConfig } from "../types/config.js";
import { handleMock } from "./mocker.js";
import { handleProxy } from "./proxy.js";
import { handleRecord } from "./recorder.js";
import { handleSmart } from "./smart.js";

/**
 * Main request handler
 * Route to appropriate handler based on mode
 */
export function createHandler(config: SnaperroConfig) {
  return async (c: Context): Promise<Response> => {
    const method = c.req.method;
    const url = new URL(c.req.url);
    const path = url.pathname;

    // Find matching API from config
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

    // Route based on mode
    switch (mode) {
      case "proxy":
        return handleProxy(c, match.apiConfig);

      case "record":
        return handleRecord(c, match, config);

      case "mock":
        return handleMock(c, match, config);

      case "smart":
        return handleSmart(c, match, config);

      default:
        logger.error(`Unknown mode: ${mode}`);
        return c.json({ error: "Unknown mode" }, 500);
    }
  };
}
