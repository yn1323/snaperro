import fs from "node:fs/promises";
import path from "node:path";
import { consola } from "consola";
import { parse } from "dotenv";
import open from "open";
import type { CompiledSnaperroConfigV2 } from "../../server/v2/config/config.js";
import { loadConfigV2 } from "../../server/v2/config/loader.js";
import { ConfigWatcherV2, type ConfigWatcherV2Options } from "../../server/v2/config/watcher.js";
import { createV2Server, type SnaperroV2Server } from "../../server/v2/server/index.js";
import { assertMigrationReadiness } from "../../server/v2/store/migration-readiness.js";

export interface StartOptions {
  port?: string;
  verbose?: boolean;
  config?: string;
  env?: string;
  watch?: boolean;
  skipBrowser?: boolean;
}

export interface StartedSnaperroCommand {
  readonly server: SnaperroV2Server;
  readonly configPath: string;
  readonly envPath: string;
  stop(): Promise<void>;
}

interface StartWatcher {
  start(): void;
  stop(): Promise<void>;
}

export interface StartCommandDependencies {
  loadConfig?: typeof loadConfigV2;
  createServer?: typeof createV2Server;
  createWatcher?: (options: ConfigWatcherV2Options) => StartWatcher;
  openBrowser?: (url: string) => Promise<unknown>;
  createEnvironment?: (filePath: string) => EnvFileOverlay;
}

function errorValue(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error ? String(error.code) : undefined;
}

function parsePort(port: string | undefined): number | undefined {
  if (port === undefined) return undefined;
  if (!/^\d+$/u.test(port)) throw new TypeError(`Invalid port: ${port}`);
  const parsed = Number(port);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65_535) throw new TypeError(`Invalid port: ${port}`);
  return parsed;
}

export function applyStartOverrides(config: CompiledSnaperroConfigV2, options: StartOptions): CompiledSnaperroConfigV2 {
  const port = parsePort(options.port);
  if (port === undefined && !options.skipBrowser) return config;
  return {
    ...config,
    server: {
      ...config.server,
      ...(port === undefined ? {} : { port }),
      ...(options.skipBrowser ? { openBrowser: false } : {}),
    },
  };
}

/** Refuses an implicit v1-to-v2 conversion while allowing an empty new project. */
export async function assertMigrationReady(config: CompiledSnaperroConfigV2): Promise<void> {
  const legacySource = path.join(config.configDirectory, ".snaperro", "files");
  await assertMigrationReadiness(legacySource, config.storage.root);
}

/** Applies .env as an overlay without permanently replacing shell variables. */
export class EnvFileOverlay {
  readonly #original = new Map<string, string | undefined>();
  readonly #applied = new Set<string>();
  #lifecycleGeneration = 0;

  constructor(
    readonly filePath: string,
    private readonly environment: NodeJS.ProcessEnv = process.env,
  ) {}

  async #readValues(): Promise<Record<string, string>> {
    try {
      return parse(await fs.readFile(this.filePath));
    } catch (error) {
      if (errorCode(error) === "ENOENT") return {};
      throw error;
    }
  }

  #apply(values: Readonly<Record<string, string>>): void {
    for (const [name, value] of Object.entries(values)) {
      if (!this.#original.has(name)) this.#original.set(name, this.environment[name]);
      if (this.#original.get(name) === undefined) {
        this.environment[name] = value;
        this.#applied.add(name);
      }
    }
  }

  #replace(values: Readonly<Record<string, string>>): void {
    this.#restoreApplied();
    this.#apply(values);
  }

  #restoreApplied(): void {
    for (const name of this.#applied) {
      const original = this.#original.get(name);
      if (original === undefined) delete this.environment[name];
      else this.environment[name] = original;
    }
    this.#applied.clear();
  }

  async reload(): Promise<void> {
    const generation = this.#lifecycleGeneration;
    const values = await this.#readValues();
    if (generation !== this.#lifecycleGeneration) throw new Error("Environment reload was cancelled");
    this.#replace(values);
  }

  /** Keeps the candidate overlay only when the complete reload succeeds. */
  async withReloadedEnvironment<Result>(operation: () => Promise<Result>): Promise<Result> {
    const generation = this.#lifecycleGeneration;
    const values = await this.#readValues();
    if (generation !== this.#lifecycleGeneration) throw new Error("Environment reload was cancelled");
    const previous = Object.fromEntries([...this.#applied].map((name) => [name, this.environment[name] ?? ""]));
    this.#replace(values);
    try {
      return await operation();
    } catch (error) {
      if (generation === this.#lifecycleGeneration) this.#replace(previous);
      throw error;
    }
  }

  restore(): void {
    this.#lifecycleGeneration += 1;
    this.#restoreApplied();
  }
}

export async function startCommand(
  options: StartOptions,
  dependencies: StartCommandDependencies = {},
): Promise<StartedSnaperroCommand> {
  const configPath = path.resolve(process.cwd(), options.config ?? "snaperro.config.ts");
  const envPath = options.env ? path.resolve(process.cwd(), options.env) : path.join(path.dirname(configPath), ".env");
  const environment = dependencies.createEnvironment?.(envPath) ?? new EnvFileOverlay(envPath);
  const loadConfig = dependencies.loadConfig ?? loadConfigV2;
  const createServer = dependencies.createServer ?? createV2Server;
  const createWatcher = dependencies.createWatcher ?? ((watcherOptions) => new ConfigWatcherV2(watcherOptions));
  const openBrowser = dependencies.openBrowser ?? open;
  let server: SnaperroV2Server | undefined;
  let watcher: StartWatcher | undefined;
  let stopping: Promise<void> | undefined;
  let stopRequested = false;
  let handleSignal: ((signal: NodeJS.Signals) => void) | undefined;

  const stop = (): Promise<void> => {
    if (stopping) return stopping;
    stopRequested = true;
    stopping = (async () => {
      if (handleSignal) {
        process.removeListener("SIGINT", handleSignal);
        process.removeListener("SIGTERM", handleSignal);
      }
      // Invoke each cleanup behind its own Promise boundary so a
      // non-conforming synchronous throw cannot prevent the others starting.
      const settled = await Promise.allSettled([
        Promise.resolve().then(() => watcher?.stop()),
        Promise.resolve().then(() => server?.stop()),
        Promise.resolve().then(() => environment.restore()),
      ]);
      const errors = settled
        .filter((result): result is PromiseRejectedResult => result.status === "rejected")
        .map((result) => errorValue(result.reason));
      if (errors.length > 0) throw new AggregateError(errors, "Snaperro command shutdown failed");
    })();
    return stopping;
  };

  try {
    await environment.reload();
    const initial = applyStartOverrides(await loadConfig(configPath), options);
    await assertMigrationReady(initial);
    server = await createServer(initial, { coreOptions: { verbose: options.verbose } });
    const address = await server.start();
    consola.success(`snaperro 2.0 is running at ${address.origin}`);
    consola.info(`GUI: ${address.clientUrl}`);
    consola.info(`Demo: ${address.demoUrl}`);

    if (initial.server.openBrowser) {
      // Browser launch is auxiliary and controlled by an external process. It
      // must not delay watcher/signal installation or make startup unbounded.
      void openBrowser(address.clientUrl).catch((error: unknown) => {
        consola.warn(`Could not open the browser: ${error instanceof Error ? error.message : String(error)}`);
      });
    }

    if (options.watch !== false) {
      watcher = createWatcher({
        paths: [configPath, envPath],
        onChange: async () => {
          await environment.withReloadedEnvironment(async () => {
            const candidate = applyStartOverrides(await loadConfig(configPath, { disableCache: true }), options);
            if (stopRequested) throw new Error("Configuration reload was cancelled during shutdown");
            await server?.reload(candidate);
          });
          consola.success("Configuration reloaded");
        },
        shutdownTimeoutMs: initial.server.shutdownTimeoutMs,
        onError: (error) => {
          consola.error(
            `Configuration reload failed; the active runtime was kept: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        },
      });
      watcher.start();
    }

    handleSignal = (signal: NodeJS.Signals) => {
      consola.info(`Received ${signal}; shutting down`);
      void stop().catch((error: unknown) => {
        consola.error(`Shutdown failed: ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
      });
    };
    process.once("SIGINT", handleSignal);
    process.once("SIGTERM", handleSignal);

    return { server, configPath, envPath, stop };
  } catch (error) {
    try {
      await stop();
    } catch (cleanupError) {
      throw new AggregateError([errorValue(error), errorValue(cleanupError)], "Snaperro startup and cleanup failed", {
        cause: error,
      });
    }
    throw error;
  }
}
