import fs from "node:fs";
import path from "node:path";
import { type FSWatcher, watch } from "chokidar";
import { logger } from "./logger.js";

export interface WatcherOptions {
  configPath: string;
  envPath: string;
  debounceMs?: number;
  onConfigChange: () => void;
}

/**
 * Find all .env files in a directory
 * Returns absolute paths of .env, .env.local, .env.development, etc.
 */
function findEnvFiles(dir: string): string[] {
  try {
    const files = fs.readdirSync(dir);
    return files.filter((f) => f === ".env" || f.startsWith(".env.")).map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

/**
 * Config file watcher
 * Monitors .env* files and snaperro.config.ts for changes
 */
export class ConfigWatcher {
  private watcher: FSWatcher | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private readonly debounceMs: number;
  private readonly onConfigChange: () => void;
  private readonly watchPaths: string[];

  constructor(options: WatcherOptions) {
    this.debounceMs = options.debounceMs ?? 1000;
    this.onConfigChange = options.onConfigChange;

    const configDir = path.dirname(options.configPath);

    // Watch targets:
    // 1. snaperro.config.ts (exact path)
    // 2. Existing .env files in the config directory (found at startup)
    const envFiles = findEnvFiles(configDir);
    this.watchPaths = [options.configPath, ...envFiles];
  }

  /**
   * Start watching files
   */
  start(): void {
    if (this.watcher) {
      return;
    }

    logger.info("Starting config file watcher...");

    this.watcher = watch(this.watchPaths, {
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 50,
      },
    });

    this.watcher.on("change", (filePath) => {
      this.handleChange(filePath, "changed");
    });

    this.watcher.on("add", (filePath) => {
      this.handleChange(filePath, "added");
    });

    this.watcher.on("unlink", (filePath) => {
      this.handleChange(filePath, "removed");
    });

    this.watcher.on("error", (error: unknown) => {
      logger.error("Watcher error", error instanceof Error ? error : undefined);
    });

    logger.debug(`Watching: ${this.watchPaths.join(", ")}`);
  }

  /**
   * Handle file change with debounce
   */
  private handleChange(filePath: string, event: string): void {
    const fileName = path.basename(filePath);
    logger.info(`Config file ${event}: ${fileName}`);

    // Clear existing timer
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    // Set new debounced callback
    this.debounceTimer = setTimeout(() => {
      logger.info("Restarting server due to config change...");
      this.onConfigChange();
    }, this.debounceMs);
  }

  /**
   * Stop watching files
   */
  async stop(): Promise<void> {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
      logger.debug("Config file watcher stopped");
    }
  }
}
