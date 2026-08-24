import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { DOWNLOAD_CAPABILITY_BASE_PATH, V2_CONTROL_BASE_PATH } from "../../../shared/contracts-v2/transport.js";
import type {
  BlobStorePort,
  CommandBusPort,
  EventHubPort,
  GarbageCollectionPort,
  LoggerPort,
  QueryBusPort,
  WriteCoordinatorPort,
} from "../application/ports.js";
import type { CompiledSnaperroConfigV2 } from "../config/config.js";
import type { GenerationSupervisor } from "../runtime/generation-supervisor.js";
import type { TrafficRuntimeGeneration } from "../runtime/runtime-core.js";
import type { TrafficResponse } from "../traffic/proxy-service.js";
import { createBodyApi } from "../transport/body-api.js";
import { createControlApi } from "../transport/control-api.js";
import { controlSecurity } from "../transport/control-security.js";
import { createEventStreamApi } from "../transport/event-stream.js";
import { createTrafficApi } from "../transport/traffic-api.js";
import {
  type CapabilityDownloadPort,
  createDownloadApi,
  createTransferApi,
  type FolderTransferPort,
} from "../transport/transfer-api.js";
import { mountStaticAssets } from "./static-assets.js";

export const CLIENT_MOUNT_PATH = "/__snaperro__/client" as const;
export const DEMO_MOUNT_PATH = "/__snaperro__/demo" as const;

export interface V2StableCoreApi {
  commands: CommandBusPort;
  queries: QueryBusPort;
  events: EventHubPort;
  writes: WriteCoordinatorPort;
  store: { blobs: BlobStorePort; garbageCollection: GarbageCollectionPort };
  logger: LoggerPort;
  transfers: FolderTransferPort & CapabilityDownloadPort;
}

export type TrafficGenerationRunner = Pick<GenerationSupervisor<TrafficRuntimeGeneration>, "acquire">;

export interface StaticAssetRoots {
  client: string;
  demo: string;
}

export interface CreateV2AppOptions {
  core: V2StableCoreApi;
  generations: TrafficGenerationRunner;
  config: CompiledSnaperroConfigV2;
  staticAssets?: Partial<StaticAssetRoots>;
  maxJsonBodyBytes?: number;
  heartbeatMs?: number;
}

function controlUiOrigin(config: CompiledSnaperroConfigV2): string {
  const host =
    config.server.host === "0.0.0.0" ? "127.0.0.1" : config.server.host === "::" ? "[::1]" : config.server.host;
  const formattedHost = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return `http://${formattedHost}:${config.server.port}`;
}

function defaultStaticRoot(name: keyof StaticAssetRoots): string {
  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    // Library bundle: dist/index.js
    path.join(moduleDirectory, name),
    // CLI bundle: dist/cli/index.js
    path.resolve(moduleDirectory, "..", name),
    // Direct source execution: server/v2/server/app.ts
    path.resolve(moduleDirectory, "../../../dist", name),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

function releaseWithBodyLifetime(response: TrafficResponse, release: () => void): TrafficResponse {
  let bodyFinished = response.body === null;
  let generationFinished = response.generationCompletion === undefined;
  let released = false;
  const releaseIfFinished = () => {
    if (released || !bodyFinished || !generationFinished) return;
    released = true;
    release();
  };
  if (response.generationCompletion) {
    void response.generationCompletion.then(
      () => {
        generationFinished = true;
        releaseIfFinished();
      },
      () => {
        generationFinished = true;
        releaseIfFinished();
      },
    );
  }

  if (!response.body) {
    releaseIfFinished();
    return response;
  }

  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = response.body.getReader();
  } catch (error) {
    bodyFinished = true;
    releaseIfFinished();
    throw error;
  }

  const finishBody = () => {
    if (bodyFinished) return;
    bodyFinished = true;
    try {
      reader.releaseLock();
    } catch {
      // Cancellation can race a pending read. The lease is the lifecycle
      // boundary and must still be released even if the reader stays locked.
    } finally {
      releaseIfFinished();
    }
  };

  return {
    ...response,
    body: new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const chunk = await reader.read();
          if (chunk.done) {
            finishBody();
            controller.close();
          } else {
            controller.enqueue(chunk.value);
          }
        } catch (error) {
          // A response source owns its own cleanup promise. A broken source
          // must not retain the runtime-generation lease after delivery has
          // already failed.
          try {
            void reader.cancel(error).catch(() => undefined);
          } catch {
            // Cancellation is best-effort after a terminal read failure.
          }
          finishBody();
          controller.error(error);
        }
      },
      cancel(reason) {
        try {
          void reader.cancel(reason).catch(() => undefined);
        } catch {
          // Client cancellation must release the generation even when a
          // non-conforming source throws or never settles its cancellation.
        } finally {
          finishBody();
        }
      },
    }),
  };
}

export function defaultStaticAssetRoots(): StaticAssetRoots {
  return { client: defaultStaticRoot("client"), demo: defaultStaticRoot("demo") };
}

/** Builds one stable control plane whose final fallback always targets the active traffic generation. */
export function createV2App(options: CreateV2AppOptions): Hono {
  const app = new Hono();
  const roots = { ...defaultStaticAssetRoots(), ...options.staticAssets };

  app.use(
    `${V2_CONTROL_BASE_PATH}/*`,
    controlSecurity({
      serverOrigin: controlUiOrigin(options.config),
      allowedOrigins: options.config.server.allowedOrigins,
      controlToken: options.config.server.controlToken,
    }),
  );
  app.route(
    V2_CONTROL_BASE_PATH,
    createControlApi({
      commands: options.core.commands,
      queries: options.core.queries,
      maxJsonBodyBytes: options.maxJsonBodyBytes,
    }),
  );
  app.route(
    V2_CONTROL_BASE_PATH,
    createBodyApi({
      blobs: options.core.store.blobs,
      garbageCollection: options.core.store.garbageCollection,
      logger: options.core.logger,
      maxUploadBytes: options.config.storage.maxImportBytes,
      cleanupTimeoutMs: options.config.server.shutdownTimeoutMs,
    }),
  );
  app.route(
    V2_CONTROL_BASE_PATH,
    createTransferApi(options.core.transfers, { maxUploadBytes: options.config.storage.maxImportBytes }),
  );
  // This route is intentionally outside bearer middleware. The unguessable,
  // short-lived, single-use path is the only authority accepted here.
  app.route(DOWNLOAD_CAPABILITY_BASE_PATH, createDownloadApi(options.core.transfers));
  app.route(
    V2_CONTROL_BASE_PATH,
    createEventStreamApi({
      events: options.core.events,
      queries: options.core.queries,
      writes: options.core.writes,
      heartbeatMs: options.heartbeatMs,
    }),
  );

  mountStaticAssets(app, {
    mountPath: CLIENT_MOUNT_PATH,
    root: roots.client,
    missingIndexMessage: "GUI is not built. Run 'pnpm build:client' first.",
  });
  mountStaticAssets(app, {
    mountPath: DEMO_MOUNT_PATH,
    root: roots.demo,
    missingIndexMessage: "Demo is not built. Run 'pnpm build:demo' first.",
  });

  // Control-looking paths must never be interpreted as user traffic.
  app.all("/__snaperro__", (context) => context.notFound());
  app.all("/__snaperro__/*", (context) => context.notFound());

  const traffic = createTrafficApi({
    execute: async (request) => {
      const lease = options.generations.acquire();
      try {
        return releaseWithBodyLifetime(await lease.generation.traffic.execute(request), lease.release);
      } catch (error) {
        lease.release();
        throw error;
      }
    },
  });
  app.all("*", (context) => traffic.fetch(context.req.raw));
  return app;
}
