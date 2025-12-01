import { serve } from "@hono/node-server";
import { Hono } from "hono";
import open from "open";
import { logger } from "../core/logger.js";
import { storage } from "../core/storage.js";
import type { SnaperroConfig } from "../types/config.js";
import { controlApi } from "./control-api.js";
import { cors } from "./cors.js";
import { guiRouter } from "./gui.js";
import { createHandler } from "./handler.js";

/**
 * サーバー起動オプション
 */
export interface ServerOptions {
  config: SnaperroConfig;
  verbose?: boolean;
  open?: boolean;
}

/**
 * サーバーを起動
 */
export async function startServer(options: ServerOptions): Promise<void> {
  const { config, verbose = false, open: shouldOpen = true } = options;
  const port = config.port ?? 3333;
  const guiUrl = `http://localhost:${port}/__snaperro__/gui/`;

  // 詳細ログ設定
  logger.setVerbose(verbose);

  // ストレージ初期化
  await storage.ensureBaseDir();

  // Honoアプリケーション作成
  const app = new Hono();

  // CORS ミドルウェア
  app.use("*", cors());

  // GUI配信（/__snaperro__/gui/*）
  app.route("/__snaperro__/gui", guiRouter);

  // 制御API（/__snaperro__/*）
  app.route("/__snaperro__", controlApi);

  // メインハンドラー（その他のリクエスト）
  const handler = createHandler(config);
  app.all("*", handler);

  // サーバー起動
  serve(
    {
      fetch: app.fetch,
      port,
    },
    () => {
      logger.startup(port, guiUrl);

      if (shouldOpen) {
        open(guiUrl);
      }
    },
  );
}

export { controlApi } from "./control-api.js";
export { cors } from "./cors.js";
export { createHandler } from "./handler.js";
export { handleMock } from "./mocker.js";
export { handleProxy } from "./proxy.js";
export { handleRecord } from "./recorder.js";
