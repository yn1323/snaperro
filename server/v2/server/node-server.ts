import type { AddressInfo, Socket } from "node:net";
import { type ServerType, serve } from "@hono/node-server";
import type { Hono } from "hono";
import type { LoggerPort } from "../application/ports.js";
import type { CompiledSnaperroConfigV2 } from "../config/config.js";
import { GenerationSupervisor } from "../runtime/generation-supervisor.js";
import { RuntimeCore, type RuntimeCoreOptions, type TrafficRuntimeGeneration } from "../runtime/runtime-core.js";
import { type CreateV2AppOptions, createV2App, type V2StableCoreApi } from "./app.js";
import { assertReloadCompatible, captureImmutableConfig, type ImmutableConfigSnapshot } from "./immutable-config.js";

export type V2ServerState = "ready" | "starting" | "running" | "stopping" | "stopped";

export interface ManagedRuntimeCore extends V2StableCoreApi {
  logger: LoggerPort;
  createTrafficGeneration(config: CompiledSnaperroConfigV2): TrafficRuntimeGeneration;
  close(): Promise<void>;
}

export type RuntimeCoreFactory = (
  config: CompiledSnaperroConfigV2,
  options?: RuntimeCoreOptions,
) => Promise<ManagedRuntimeCore>;

export interface CreateV2ServerOptions extends Omit<CreateV2AppOptions, "core" | "generations" | "config"> {
  coreOptions?: RuntimeCoreOptions;
  coreFactory?: RuntimeCoreFactory;
  serve?: typeof serve;
}

export interface V2ServerAddress {
  host: string;
  port: number;
  origin: string;
  clientUrl: string;
  demoUrl: string;
}

interface CloseableServer {
  close(callback: (error?: Error) => void): unknown;
  closeAllConnections?: () => void;
  closeIdleConnections?: () => void;
}

function isNotRunning(error: Error | undefined): boolean {
  return Boolean(error && "code" in error && error.code === "ERR_SERVER_NOT_RUNNING");
}

function errorValue(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

async function cleanupErrorWithin(
  operation: Promise<void> | void,
  timeoutMs: number,
  label: string,
): Promise<Error | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const observed = Promise.resolve(operation).then<{ error?: Error }, { error: Error }>(
    () => ({}),
    (error: unknown) => ({ error: errorValue(error) }),
  );
  try {
    const outcome = await Promise.race([
      observed,
      new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => resolve("timeout"), timeoutMs);
        timer.unref?.();
      }),
    ]);
    if (outcome === "timeout") {
      // Keep observing a late rejection after the server has honored its
      // shutdown deadline.
      void observed;
      return new Error(`${label} did not settle within ${timeoutMs}ms`);
    }
    return outcome.error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Stops accepting immediately, then destroys remaining sockets at the configured deadline. */
export async function closeNodeListener(
  server: ServerType,
  sockets: ReadonlySet<Socket>,
  timeoutMs: number,
): Promise<void> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new TypeError("timeoutMs must be a positive safe integer");
  }
  const closeable = server as CloseableServer;
  const closed = new Promise<void>((resolve, reject) => {
    try {
      closeable.close((error) => {
        if (!error || isNotRunning(error)) resolve();
        else reject(error);
      });
      closeable.closeIdleConnections?.();
    } catch (error) {
      if (error instanceof Error && isNotRunning(error)) resolve();
      else reject(error);
    }
  });

  let forced = false;
  const force = (): Error[] => {
    if (forced) return [];
    forced = true;
    const errors: Error[] = [];
    try {
      closeable.closeAllConnections?.();
    } catch (error) {
      errors.push(errorValue(error));
    }
    for (const socket of sockets) {
      try {
        // Passing an Error can emit an unhandled socket "error" event during
        // an otherwise successful forced shutdown.
        socket.destroy();
      } catch (error) {
        errors.push(errorValue(error));
      }
    }
    return errors;
  };
  let forceErrors: Error[] = [];
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<"deadline">((resolve) => {
    timer = setTimeout(() => {
      forceErrors = force();
      resolve("deadline");
    }, timeoutMs);
    timer.unref();
  });

  try {
    const outcome = await Promise.race([closed.then(() => "closed" as const), deadline]);
    if (outcome === "deadline") {
      // server.close() has already stopped accepting new connections. Some
      // adapters do not reliably invoke their callback after a forced socket
      // teardown, so that callback must not turn the configured deadline into
      // an unbounded shutdown wait.
      void closed.catch(() => undefined);
      if (forceErrors.length > 0) {
        throw new AggregateError(forceErrors, "Forced HTTP listener cleanup failed");
      }
    }
  } catch (error) {
    const fallbackErrors = force();
    if (fallbackErrors.length > 0) {
      throw new AggregateError([errorValue(error), ...fallbackErrors], "HTTP listener shutdown failed", {
        cause: error,
      });
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function urlHost(host: string): string {
  if (host === "0.0.0.0") return "127.0.0.1";
  if (host === "::") return "[::1]";
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

function serverAddress(configuredHost: string, info: AddressInfo): V2ServerAddress {
  const origin = `http://${urlHost(configuredHost)}:${info.port}`;
  return {
    host: configuredHost,
    port: info.port,
    origin,
    clientUrl: `${origin}/__snaperro__/client`,
    demoUrl: `${origin}/__snaperro__/demo`,
  };
}

export class SnaperroV2Server {
  readonly app: Hono;
  readonly core: ManagedRuntimeCore;
  readonly generations: GenerationSupervisor<TrafficRuntimeGeneration>;

  readonly #immutableConfig: ImmutableConfigSnapshot;
  readonly #serve: typeof serve;
  readonly #sockets = new Set<Socket>();
  #config: CompiledSnaperroConfigV2;
  #state: V2ServerState = "ready";
  #nodeServer: ServerType | undefined;
  #address: V2ServerAddress | undefined;
  #startPromise: Promise<V2ServerAddress> | undefined;
  #rejectStart: ((error: Error) => void) | undefined;
  #stopPromise: Promise<void> | undefined;

  constructor(options: {
    config: CompiledSnaperroConfigV2;
    core: ManagedRuntimeCore;
    generations: GenerationSupervisor<TrafficRuntimeGeneration>;
    app: Hono;
    serve: typeof serve;
  }) {
    this.#config = options.config;
    this.#immutableConfig = captureImmutableConfig(options.config);
    this.core = options.core;
    this.generations = options.generations;
    this.app = options.app;
    this.#serve = options.serve;
  }

  get state(): V2ServerState {
    return this.#state;
  }

  get address(): V2ServerAddress | undefined {
    return this.#address;
  }

  get config(): CompiledSnaperroConfigV2 {
    return this.#config;
  }

  start(): Promise<V2ServerAddress> {
    if (this.#state === "stopping" || this.#state === "stopped") {
      return Promise.reject(new Error(`Cannot start a server while it is ${this.#state}`));
    }
    if (this.#state === "running" && this.#address) return Promise.resolve(this.#address);
    if (this.#startPromise) return this.#startPromise;

    this.#state = "starting";
    this.#startPromise = this.#listen().catch((error) => {
      this.#startPromise = undefined;
      if (this.#state === "starting") this.#state = "ready";
      throw error;
    });
    return this.#startPromise;
  }

  async reload(config: CompiledSnaperroConfigV2): Promise<void> {
    if (this.#state === "stopping" || this.#state === "stopped") {
      throw new Error(`Cannot reload a server while it is ${this.#state}`);
    }
    assertReloadCompatible(this.#immutableConfig, config);

    const result = await this.generations.reload(async () => this.core.createTrafficGeneration(config));
    this.#config = config;
    if (result.previousCleanupError) {
      try {
        this.core.logger.error("Previous traffic generation cleanup failed after reload", {
          error: result.previousCleanupError,
          activeGenerationId: this.generations.activeGenerationId,
        });
      } catch {
        // The candidate is already active; an observability failure must not
        // make callers roll back configuration around the committed reload.
      }
    }
  }

  stop(): Promise<void> {
    if (this.#stopPromise) return this.#stopPromise;
    this.#stopPromise = this.#stop();
    return this.#stopPromise;
  }

  async #listen(): Promise<V2ServerAddress> {
    return new Promise<V2ServerAddress>((resolve, reject) => {
      let settled = false;
      try {
        const nodeServer = this.#serve(
          {
            fetch: this.app.fetch,
            hostname: this.#immutableConfig.host,
            port: this.#immutableConfig.port,
          },
          (info) => {
            if (settled) return;
            if (this.#state === "stopping" || this.#state === "stopped") {
              settled = true;
              this.#rejectStart = undefined;
              reject(new Error("Server stopped while it was starting"));
              return;
            }
            settled = true;
            this.#rejectStart = undefined;
            this.#address = serverAddress(this.#immutableConfig.host, info);
            this.#state = "running";
            resolve(this.#address);
          },
        );
        this.#rejectStart = (error) => {
          if (settled) return;
          settled = true;
          this.#rejectStart = undefined;
          reject(error);
        };
        this.#nodeServer = nodeServer;
        nodeServer.on("connection", (socket: Socket) => {
          this.#sockets.add(socket);
          socket.once("close", () => this.#sockets.delete(socket));
        });
        nodeServer.on("error", (error) => {
          if (!settled) {
            settled = true;
            this.#rejectStart = undefined;
            reject(error);
            return;
          }
          this.core.logger.error("HTTP server emitted an error", { error });
        });
      } catch (error) {
        settled = true;
        this.#rejectStart = undefined;
        reject(error);
      }
    });
  }

  async #stop(): Promise<void> {
    if (this.#state === "stopped") return;
    this.#state = "stopping";
    this.#rejectStart?.(new Error("Server stopped while it was starting"));
    const errors: Error[] = [];
    const listenerClose = this.#nodeServer
      ? closeNodeListener(this.#nodeServer, this.#sockets, this.#immutableConfig.shutdownTimeoutMs)
      : Promise.resolve();

    const draining = await Promise.allSettled([listenerClose, this.generations.stop()]);
    for (const result of draining) {
      if (result.status === "rejected") errors.push(errorValue(result.reason));
    }
    try {
      const coreCloseError = await cleanupErrorWithin(
        this.core.close(),
        this.#immutableConfig.shutdownTimeoutMs,
        "Runtime core shutdown",
      );
      if (coreCloseError) errors.push(coreCloseError);
    } catch (error) {
      // Covers a non-conforming adapter that throws before returning a Promise.
      errors.push(errorValue(error));
    }

    this.#sockets.clear();
    this.#nodeServer = undefined;
    this.#address = undefined;
    this.#startPromise = undefined;
    this.#state = "stopped";
    if (errors.length > 0) throw new AggregateError(errors, "Snaperro v2 server shutdown failed");
  }
}

export async function createV2Server(
  config: CompiledSnaperroConfigV2,
  options: CreateV2ServerOptions = {},
): Promise<SnaperroV2Server> {
  const coreFactory: RuntimeCoreFactory = options.coreFactory ?? RuntimeCore.create;
  const core = await coreFactory(config, options.coreOptions);
  let generations: GenerationSupervisor<TrafficRuntimeGeneration> | undefined;
  try {
    generations = new GenerationSupervisor<TrafficRuntimeGeneration>({
      drainTimeoutMs: config.server.shutdownTimeoutMs,
    });
    await generations.initialize(async () => core.createTrafficGeneration(config));
    const app = createV2App({
      core,
      generations,
      config,
      staticAssets: options.staticAssets,
      maxJsonBodyBytes: options.maxJsonBodyBytes,
      heartbeatMs: options.heartbeatMs,
    });
    return new SnaperroV2Server({
      config,
      core,
      generations,
      app,
      serve: options.serve ?? serve,
    });
  } catch (error) {
    const cleanupErrors: Error[] = [];
    const initializedGenerations = generations;
    const cleanup = [
      ...(initializedGenerations
        ? [{ label: "Traffic generation initialization cleanup", run: () => initializedGenerations.stop() }]
        : []),
      { label: "Runtime core initialization cleanup", run: () => core.close() },
    ];
    for (const step of cleanup) {
      try {
        const cleanupError = await cleanupErrorWithin(step.run(), config.server.shutdownTimeoutMs, step.label);
        if (cleanupError) cleanupErrors.push(cleanupError);
      } catch (cleanupError) {
        cleanupErrors.push(errorValue(cleanupError));
      }
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError([errorValue(error), ...cleanupErrors], "Server initialization and cleanup failed", {
        cause: error,
      });
    }
    throw error;
  }
}
