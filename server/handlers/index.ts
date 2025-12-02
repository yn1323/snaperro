import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { logger } from "../core/logger.js";
import { findAvailablePort } from "../core/port.js";
import { storage } from "../core/storage.js";
import type { SnaperroConfig } from "../types/config.js";
import { controlApi } from "./control-api.js";
import { cors } from "./cors.js";
import { createHandler } from "./handler.js";

/**
 * サーバー起動オプション
 */
export interface ServerOptions {
  config: SnaperroConfig;
  verbose?: boolean;
}

/**
 * サーバーを起動
 */
export async function startServer(options: ServerOptions): Promise<void> {
  const { config, verbose = false } = options;
  const requestedPort = config.port ?? 3333;

  // 詳細ログ設定
  logger.setVerbose(verbose);

  // 空きポートを探す（最大10回試行）
  const port = await findAvailablePort(requestedPort);

  if (port !== requestedPort) {
    logger.info(`ポート ${requestedPort} は使用中のため、${port} を使用します`);
  }

  // ストレージ初期化
  await storage.ensureBaseDir();

  // Honoアプリケーション作成
  const app = new Hono();

  // CORS ミドルウェア
  app.use("*", cors());

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
      logger.startup(port);
    },
  );
}

export { controlApi } from "./control-api.js";
export { cors } from "./cors.js";
export { createHandler } from "./handler.js";
export { handleMock } from "./mocker.js";
export { handleProxy } from "./proxy.js";
export { handleRecord } from "./recorder.js";
