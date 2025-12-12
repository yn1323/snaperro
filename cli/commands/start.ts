import path from "node:path";
import type { ServerType } from "@hono/node-server";
import { consola } from "consola";
import { config as dotenvConfig } from "dotenv";
import open from "open";
import { loadConfig } from "../../server/core/config.js";
import { ConfigWatcher } from "../../server/core/watcher.js";
import { shutdownServer, startServer } from "../../server/handlers/index.js";

interface StartOptions {
  port?: string;
  verbose?: boolean;
  config?: string;
  env?: string;
  watch?: boolean;
}

/**
 * Reload .env file with override
 */
function reloadDotenv(envPath: string): void {
  dotenvConfig({ path: envPath, override: true });
}

/**
 * start command
 * Start the server with optional file watching
 */
export async function startCommand(options: StartOptions): Promise<void> {
  const configPath = path.resolve(process.cwd(), options.config ?? "snaperro.config.ts");
  const configDir = path.dirname(configPath);
  const envPath = options.env ? path.resolve(process.cwd(), options.env) : path.join(configDir, ".env");

  // Load initial .env
  dotenvConfig({ path: envPath });

  let currentServer: ServerType | null = null;
  let isRestarting = false;
  let watcher: ConfigWatcher | null = null;

  /**
   * Start or restart the server
   */
  const startOrRestart = async (isInitial = false): Promise<void> => {
    if (isRestarting) {
      consola.debug("Already restarting, skipping...");
      return;
    }

    isRestarting = true;

    try {
      // Shutdown existing server
      if (currentServer) {
        await shutdownServer(currentServer);
        currentServer = null;
      }

      // Reload .env file
      if (!isInitial) {
        reloadDotenv(envPath);
      }

      consola.start("Loading config file...");

      // Load config with cache disabled for reload
      const config = await loadConfig(configPath, !isInitial);

      // Override with command line options
      if (options.port) {
        config.port = Number.parseInt(options.port, 10);
      }

      const serverInfo = await startServer({
        config,
        verbose: options.verbose ?? false,
      });

      currentServer = serverInfo.server;

      // Open browser only on initial start
      if (isInitial) {
        await open(serverInfo.guiUrl);
      }
    } catch (error) {
      if (error instanceof Error) {
        consola.error(error.message);
      } else {
        consola.error("Failed to start server");
      }

      // On reload failure, keep the old server running if possible
      if (!isInitial && !currentServer) {
        consola.error("Server restart failed. Please fix the config and save again.");
      }

      // Exit on initial start failure
      if (isInitial) {
        process.exit(1);
      }
    } finally {
      isRestarting = false;
    }
  };

  // Initial start
  await startOrRestart(true);

  // Setup file watcher (enabled by default, can be disabled with --no-watch)
  if (options.watch !== false) {
    watcher = new ConfigWatcher({
      configPath,
      envPath,
      debounceMs: 1000,
      onConfigChange: () => startOrRestart(false),
    });
    watcher.start();
  }

  // Handle graceful shutdown signals
  const handleShutdown = async (signal: string) => {
    consola.info(`Received ${signal}, shutting down...`);

    if (watcher) {
      await watcher.stop();
    }

    if (currentServer) {
      await shutdownServer(currentServer);
    }

    process.exit(0);
  };

  process.on("SIGINT", () => handleShutdown("SIGINT"));
  process.on("SIGTERM", () => handleShutdown("SIGTERM"));
}
