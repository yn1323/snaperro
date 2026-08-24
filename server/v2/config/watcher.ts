import path from "node:path";
import { type FSWatcher, watch } from "chokidar";

export interface ConfigWatcherPort {
  on(event: "all", listener: (eventName: string, changedPath: string) => void): ConfigWatcherPort;
  on(event: "error", listener: (error: unknown) => void): ConfigWatcherPort;
  close(): Promise<void>;
}

export interface ConfigWatcherV2Options {
  paths: readonly string[];
  debounceMs?: number;
  shutdownTimeoutMs?: number;
  onChange(): Promise<void> | void;
  onError?(error: unknown): void;
  watch?: (paths: readonly string[]) => ConfigWatcherPort;
}

function defaultWatch(paths: readonly string[]): FSWatcher {
  return watch([...paths], { ignoreInitial: true });
}

/** Serializes reloads and coalesces each burst of config/env filesystem events. */
export class ConfigWatcherV2 {
  readonly #paths: ReadonlySet<string>;
  readonly #debounceMs: number;
  readonly #onChange: () => Promise<void> | void;
  readonly #onError: (error: unknown) => void;
  readonly #watch: (paths: readonly string[]) => ConfigWatcherPort;
  readonly #shutdownTimeoutMs: number;
  #watcher: ConfigWatcherPort | undefined;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #reload = Promise.resolve();
  #stopped = false;
  #stopPromise: Promise<void> | undefined;

  constructor(options: ConfigWatcherV2Options) {
    if (options.paths.length === 0) throw new TypeError("Config watcher requires at least one path");
    this.#paths = new Set(options.paths.map((entry) => path.resolve(entry)));
    this.#debounceMs = options.debounceMs ?? 300;
    this.#shutdownTimeoutMs = options.shutdownTimeoutMs ?? 5_000;
    if (!Number.isSafeInteger(this.#debounceMs) || this.#debounceMs < 0) {
      throw new TypeError("Config watcher debounceMs must be a non-negative safe integer");
    }
    if (!Number.isSafeInteger(this.#shutdownTimeoutMs) || this.#shutdownTimeoutMs < 1) {
      throw new TypeError("Config watcher shutdownTimeoutMs must be a positive safe integer");
    }
    this.#onChange = options.onChange;
    this.#onError = options.onError ?? (() => undefined);
    this.#watch = options.watch ?? defaultWatch;
  }

  start(): void {
    if (this.#watcher) return;
    if (this.#stopped) throw new Error("A stopped config watcher cannot be restarted");
    const watchedPaths = [...this.#paths];
    this.#watcher = this.#watch(watchedPaths);
    this.#watcher.on("all", (_event, changedPath) => {
      if (this.#paths.has(path.resolve(changedPath))) this.#schedule();
    });
    this.#watcher.on("error", (error) => this.#onError(error));
  }

  stop(): Promise<void> {
    if (this.#stopPromise) return this.#stopPromise;
    this.#stopped = true;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#stopPromise = this.#stop();
    return this.#stopPromise;
  }

  async #stop(): Promise<void> {
    const watcher = this.#watcher;
    this.#watcher = undefined;
    const settling = Promise.allSettled([watcher?.close() ?? Promise.resolve(), this.#reload]);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), this.#shutdownTimeoutMs);
      timer.unref?.();
    });
    const outcome = await Promise.race([settling, timeout]);
    if (timer) clearTimeout(timer);
    if (outcome === "timeout") {
      throw new Error(`Configuration watcher did not settle within ${this.#shutdownTimeoutMs}ms`);
    }
    const errors = outcome
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result) => (result.reason instanceof Error ? result.reason : new Error(String(result.reason))));
    if (errors.length > 0) throw new AggregateError(errors, "Configuration watcher shutdown failed");
  }

  #schedule(): void {
    if (this.#stopped) return;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      this.#reload = this.#reload.then(() => this.#onChange()).catch((error) => this.#onError(error));
    }, this.#debounceMs);
  }
}
