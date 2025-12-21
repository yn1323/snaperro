import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type ServerType, serve } from "@hono/node-server";
import { Hono } from "hono";
import { logger } from "../core/logger.js";
import { findAvailablePort } from "../core/port.js";
import { initializeProxyAgent } from "../core/proxy-agent.js";
import { state } from "../core/state.js";
import { storage } from "../core/storage.js";
import type { SnaperroConfig } from "../types/config.js";
import { controlApi } from "./control-api.js";
import { cors } from "./cors.js";
import { createHandler } from "./handler.js";

// Get __dirname equivalent in ESM environment
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientDistPath = path.join(__dirname, "..", "client");
const demoDistPath = path.join(__dirname, "..", "demo");

/**
 * Server startup options
 */
export interface ServerOptions {
  config: SnaperroConfig;
  verbose?: boolean;
}

/**
 * Server startup result
 */
export interface ServerInfo {
  port: number;
  guiUrl: string;
  server: ServerType;
}

/**
 * Gracefully shutdown the server
 */
export function shutdownServer(server: ServerType): Promise<void> {
  return new Promise((resolve, reject) => {
    logger.info("Shutting down server...");

    server.close((err) => {
      if (err) {
        logger.error("Error during server shutdown", err);
        reject(err);
      } else {
        logger.debug("Server shutdown complete");
        resolve();
      }
    });

    // Force close after timeout (5 seconds)
    setTimeout(() => {
      // logger.warn("Forcing server shutdown after timeout");
      resolve();
    }, 2000);
  });
}

/**
 * Start the server
 */
export function startServer(options: ServerOptions): Promise<ServerInfo> {
  return new Promise((resolve) => {
    const init = async () => {
      const { config, verbose = false } = options;
      const requestedPort = config.port ?? 3333;

      // Verbose logging setup
      logger.setVerbose(verbose);

      // Initialize upstream proxy agent
      initializeProxyAgent(config);

      // Find available port (max 10 attempts)
      const port = await findAvailablePort(requestedPort);

      if (port !== requestedPort) {
        logger.info(`Port ${requestedPort} is in use, using ${port} instead`);
      }

      // Initialize storage
      await storage.ensureBaseDir();

      // Migrate root scenarios to folder structure
      await storage.migrateRootScenarios();

      // Load persisted state (mode and scenario)
      await state.load();

      // Create Hono application
      const app = new Hono();

      // CORS middleware
      app.use("*", cors());

      // ========================================
      // GUI serving (defined before control API)
      // ========================================
      const indexHtmlPath = path.join(clientDistPath, "index.html");

      // Serve index.html
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

      // Serve static assets
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
      // Demo serving
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
      // Control API (/__snaperro__/*)
      // ========================================
      app.route("/__snaperro__", controlApi);

      // Main handler (other requests)
      const handler = createHandler(config);
      app.all("*", handler);

      // Start server
      const server = serve(
        {
          fetch: app.fetch,
          port,
        },
        () => {
          const guiUrl = `http://localhost:${port}/__snaperro__/client`;
          const demoUrl = `http://localhost:${port}/__snaperro__/demo`;
          logger.startup(port, guiUrl, demoUrl);
          resolve({ port, guiUrl, server });
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
