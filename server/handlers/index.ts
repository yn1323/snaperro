import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { logger } from "../core/logger.js";
import { findAvailablePort } from "../core/port.js";
import { storage } from "../core/storage.js";
import type { SnaperroConfig } from "../types/config.js";
import { controlApi } from "./control-api.js";
import { cors } from "./cors.js";
import { createHandler } from "./handler.js";

// ESM環境での__dirname相当を取得
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientDistPath = path.join(__dirname, "..", "client");
const demoDistPath = path.join(__dirname, "..", "demo");

/**
 * サーバー起動オプション
 */
export interface ServerOptions {
  config: SnaperroConfig;
  verbose?: boolean;
}

/**
 * サーバー起動結果
 */
export interface ServerInfo {
  port: number;
  guiUrl: string;
}

/**
 * サーバーを起動
 */
export function startServer(options: ServerOptions): Promise<ServerInfo> {
  return new Promise((resolve) => {
    const init = async () => {
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

      // ========================================
      // GUI配信（制御APIより先に定義）
      // ========================================
      const indexHtmlPath = path.join(clientDistPath, "index.html");

      // index.html配信
      app.get("/__snaperro__/client", (c) => {
        if (!fs.existsSync(indexHtmlPath)) {
          return c.text("GUI is not built. Run 'pnpm build:client' first.", 404);
        }
        const html = fs.readFileSync(indexHtmlPath, "utf-8");
        return c.html(html);
      });

      app.get("/__snaperro__/client/", (c) => {
        if (!fs.existsSync(indexHtmlPath)) {
          return c.text("GUI is not built. Run 'pnpm build:client' first.", 404);
        }
        const html = fs.readFileSync(indexHtmlPath, "utf-8");
        return c.html(html);
      });

      // 静的アセット配信
      app.get("/__snaperro__/client/assets/:filename", (c) => {
        const filename = c.req.param("filename");
        const filePath = path.join(clientDistPath, "assets", filename);

        if (!fs.existsSync(filePath)) {
          return c.notFound();
        }

        const content = fs.readFileSync(filePath);
        const ext = path.extname(filename).toLowerCase();
        const mimeTypes: Record<string, string> = {
          ".js": "application/javascript",
          ".css": "text/css",
          ".json": "application/json",
        };

        c.header("Content-Type", mimeTypes[ext] || "application/octet-stream");
        return c.body(content);
      });

      // ========================================
      // Demo配信
      // ========================================
      const demoIndexHtmlPath = path.join(demoDistPath, "index.html");

      app.get("/__snaperro__/demo", (c) => {
        if (!fs.existsSync(demoIndexHtmlPath)) {
          return c.text("Demo is not built. Run 'pnpm build:demo' first.", 404);
        }
        const html = fs.readFileSync(demoIndexHtmlPath, "utf-8");
        return c.html(html);
      });

      app.get("/__snaperro__/demo/", (c) => {
        if (!fs.existsSync(demoIndexHtmlPath)) {
          return c.text("Demo is not built. Run 'pnpm build:demo' first.", 404);
        }
        const html = fs.readFileSync(demoIndexHtmlPath, "utf-8");
        return c.html(html);
      });

      app.get("/__snaperro__/demo/assets/:filename", (c) => {
        const filename = c.req.param("filename");
        const filePath = path.join(demoDistPath, "assets", filename);

        if (!fs.existsSync(filePath)) {
          return c.notFound();
        }

        const content = fs.readFileSync(filePath);
        const ext = path.extname(filename).toLowerCase();
        const mimeTypes: Record<string, string> = {
          ".js": "application/javascript",
          ".css": "text/css",
          ".json": "application/json",
        };

        c.header("Content-Type", mimeTypes[ext] || "application/octet-stream");
        return c.body(content);
      });

      // ========================================
      // 制御API（/__snaperro__/*）
      // ========================================
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
          const guiUrl = `http://localhost:${port}/__snaperro__/client`;
          logger.startup(port, guiUrl);
          resolve({ port, guiUrl });
        },
      );
    };

    init();
  });
}

export { controlApi } from "./control-api.js";
export { cors } from "./cors.js";
export { createHandler } from "./handler.js";
export { handleMock } from "./mocker.js";
export { handleProxy } from "./proxy.js";
export { handleRecord } from "./recorder.js";
