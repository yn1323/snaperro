import path from "node:path";
import { consola } from "consola";
import { config as dotenvConfig } from "dotenv";
import open from "open";
import { loadConfig } from "../../server/core/config.js";
import { startServer } from "../../server/handlers/index.js";

interface StartOptions {
  port?: string;
  verbose?: boolean;
  config?: string;
  env?: string;
}

/**
 * start command
 * Start the server
 */
export async function startCommand(options: StartOptions): Promise<void> {
  const configPath = path.resolve(process.cwd(), options.config ?? "snaperro.config.ts");

  // Load .env file before config
  const configDir = path.dirname(configPath);
  const envPath = options.env ? path.resolve(process.cwd(), options.env) : path.join(configDir, ".env");
  dotenvConfig({ path: envPath });

  consola.start("Loading config file...");

  try {
    const config = await loadConfig(configPath);

    // Override with command line options
    if (options.port) {
      config.port = Number.parseInt(options.port, 10);
    }

    const serverInfo = await startServer({
      config,
      verbose: options.verbose ?? false,
    });

    // Open browser automatically
    await open(serverInfo.guiUrl);
  } catch (error) {
    if (error instanceof Error) {
      consola.error(error.message);
    } else {
      consola.error("Failed to start server");
    }
    process.exit(1);
  }
}
