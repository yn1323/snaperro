import { VERSION } from "../../version.js";
import {
  ApplicationCommandBus,
  ApplicationQueryBus,
  ApplicationQueryService,
  CatalogService,
  FolderImportService,
  RecordingImportService,
  RecordingService,
  ScenarioService,
} from "../application/index.js";
import type {
  CommandBusPort,
  EventHubPort,
  LoggerPort,
  QueryBusPort,
  WriteCoordinatorPort,
} from "../application/ports.js";
import type { CompiledSnaperroConfigV2 } from "../config/config.js";
import { InMemoryEventHub } from "../events/in-memory-event-hub.js";
import { FilesystemStore } from "../store/filesystem-store.js";
import { MockService } from "../traffic/mock-service.js";
import { ProxyService } from "../traffic/proxy-service.js";
import { RecordService } from "../traffic/record-service.js";
import { ApplicationRecordingCapture } from "../traffic/recording-capture.js";
import { TrafficService } from "../traffic/traffic-service.js";
import { FilesystemTransferService } from "../transfer/filesystem-transfer-service.js";
import { maskProxyUrl, resolveUpstreamProxy } from "../upstream/proxy-environment.js";
import { UndiciUpstreamGateway } from "../upstream/undici-upstream-gateway.js";
import type { RuntimeGeneration } from "./generation-supervisor.js";
import { ConsoleLogger, ProcessWriteCoordinator, RandomIdGenerator, SystemClock } from "./system-adapters.js";

export interface RuntimeCoreOptions {
  verbose?: boolean;
  logger?: LoggerPort;
}

export interface TrafficRuntimeGeneration extends RuntimeGeneration {
  readonly traffic: TrafficService;
}

type Cleanup = () => Promise<void>;

function errorValue(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

async function runCleanupStepWithin(step: Cleanup, timeoutMs: number, position: number): Promise<Error | undefined> {
  let operation: Promise<void>;
  try {
    operation = Promise.resolve(step());
  } catch (error) {
    return errorValue(error);
  }
  const observed = operation.then(
    () => undefined,
    (error: unknown) => errorValue(error),
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      observed,
      new Promise<Error>((resolve) => {
        timer = setTimeout(
          () =>
            resolve(
              new Error(`Runtime core initialization cleanup step ${position} did not settle within ${timeoutMs}ms`),
            ),
          timeoutMs,
        );
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function runCleanupSteps(steps: readonly Cleanup[], timeoutMs: number): Promise<Error[]> {
  const errors: Error[] = [];
  for (const [index, step] of steps.entries()) {
    const error = await runCleanupStepWithin(step, timeoutMs, index + 1);
    if (error) errors.push(error);
  }
  return errors;
}

async function runCleanupStepsConcurrently(steps: readonly Cleanup[]): Promise<Error[]> {
  const pending = steps.map((step) => {
    try {
      return Promise.resolve(step());
    } catch (error) {
      return Promise.reject(error);
    }
  });
  const results = await Promise.allSettled(pending);
  return results.flatMap((result) => (result.status === "rejected" ? [errorValue(result.reason)] : []));
}

function initializationFailure(error: unknown, cleanupErrors: readonly Error[]): unknown {
  if (cleanupErrors.length === 0) return error;
  return new AggregateError([errorValue(error), ...cleanupErrors], "Runtime core initialization and cleanup failed", {
    cause: error,
  });
}

export class RuntimeCore {
  readonly store: FilesystemStore;
  readonly writes: WriteCoordinatorPort;
  readonly events: EventHubPort;
  readonly commands: CommandBusPort;
  readonly queries: QueryBusPort;
  readonly transfers: FilesystemTransferService;
  readonly logger: LoggerPort;

  readonly #ids: RandomIdGenerator;
  readonly #clock: SystemClock;
  readonly #capture: ApplicationRecordingCapture;
  readonly #mock: MockService;
  readonly #unsubscribeGc: () => Promise<void>;
  #closed = false;
  #closePromise: Promise<void> | undefined;

  private constructor(options: {
    store: FilesystemStore;
    writes: WriteCoordinatorPort;
    events: EventHubPort;
    commands: CommandBusPort;
    queries: QueryBusPort;
    transfers: FilesystemTransferService;
    logger: LoggerPort;
    ids: RandomIdGenerator;
    clock: SystemClock;
    capture: ApplicationRecordingCapture;
    mock: MockService;
    unsubscribeGc: () => Promise<void>;
  }) {
    this.store = options.store;
    this.writes = options.writes;
    this.events = options.events;
    this.commands = options.commands;
    this.queries = options.queries;
    this.transfers = options.transfers;
    this.logger = options.logger;
    this.#ids = options.ids;
    this.#clock = options.clock;
    this.#capture = options.capture;
    this.#mock = options.mock;
    this.#unsubscribeGc = options.unsubscribeGc;
  }

  static async create(config: CompiledSnaperroConfigV2, options: RuntimeCoreOptions = {}): Promise<RuntimeCore> {
    const logger = options.logger ?? new ConsoleLogger({ verbose: options.verbose });
    const ids = new RandomIdGenerator();
    const clock = new SystemClock();
    const store = new FilesystemStore(config.storage.root, {
      pinCleanupTimeoutMs: config.server.shutdownTimeoutMs,
    });
    const cleanup: Cleanup[] = [() => store.garbageCollection.close()];
    try {
      await store.initialize();
      await store.garbageCollection.schedule();
      const initialCatalog = await store.catalogs.read();
      const runtimeId = ids.nextRuntimeId();
      const events = new InMemoryEventHub({
        runtimeId,
        initialRevision: initialCatalog.revision,
        now: () => clock.now(),
        shutdownTimeoutMs: config.server.shutdownTimeoutMs,
      });
      cleanup.unshift(() => events.close());
      const writes = new ProcessWriteCoordinator(store.lease);
      const transfers = new FilesystemTransferService({
        root: config.storage.root,
        maxUploadBytes: config.storage.maxImportBytes,
        blobs: store.blobs,
        manifests: store.manifests,
        ids,
        clock,
        shutdownTimeoutMs: config.server.shutdownTimeoutMs,
      });
      cleanup.unshift(() => transfers.close());
      await transfers.ready();

      const shared = { catalogs: store.catalogs, manifests: store.manifests, writes, events, ids, clock, logger };
      const catalog = new CatalogService(shared);
      const scenarios = new ScenarioService(shared);
      const recordings = new RecordingService({
        ...shared,
        blobs: store.blobs,
        commits: store.commits,
        garbageCollection: store.garbageCollection,
      });
      const folderImport = new FolderImportService({
        ...shared,
        blobs: store.blobs,
        imports: transfers,
        garbageCollection: store.garbageCollection,
      });
      const recordingImport = new RecordingImportService({
        recordings: { create: (command, context) => recordings.create(command, context) },
        imports: transfers,
        garbageCollection: store.garbageCollection,
        logger,
      });
      const commands = new ApplicationCommandBus({
        catalog: {
          setMode: (command, context) => catalog.setMode(command, context),
          selectScenario: (command, context) => catalog.selectScenario(command, context),
          createFolder: (command, context) => catalog.createFolder(command, context),
          renameFolder: (command, context) => catalog.renameFolder(command, context),
          deleteFolder: (command, context) => catalog.deleteFolder(command, context),
        },
        scenarios: {
          create: (command, context) => scenarios.create(command, context),
          rename: (command, context) => scenarios.rename(command, context),
          duplicate: (command, context) => scenarios.duplicate(command, context),
          delete: (command, context) => scenarios.delete(command, context),
        },
        recordings: {
          create: (command, context) => recordings.create(command, context),
          update: (command, context) => recordings.update(command, context),
          delete: (command, context) => recordings.delete(command, context),
        },
        recordingImport,
        folderImport,
      });
      const queryService = new ApplicationQueryService({
        blobs: store.blobs,
        catalogs: store.catalogs,
        manifests: store.manifests,
        folderExports: transfers,
        recordingExports: transfers,
        bodyDownloads: transfers,
        runtimeId,
        version: VERSION,
        pinCleanupTimeoutMs: config.server.shutdownTimeoutMs,
      });
      const queries = new ApplicationQueryBus(queryService.handlers());
      const capture = new ApplicationRecordingCapture({ recordings });
      const mock = new MockService(store.manifests, store.blobs);

      let garbageCollection = Promise.resolve();
      const unsubscribeGc = await events.subscribe(async (event) => {
        if (event.type !== "folder.deleted" && event.type !== "scenario.deleted") return;
        garbageCollection = garbageCollection
          .then(() => store.garbageCollection.schedule())
          .catch((error) => logger.error("Background garbage collection failed", { error }));
        await garbageCollection;
      });
      cleanup.unshift(unsubscribeGc);

      return new RuntimeCore({
        store,
        writes,
        events,
        commands,
        queries,
        transfers,
        logger,
        ids,
        clock,
        capture,
        mock,
        unsubscribeGc,
      });
    } catch (error) {
      throw initializationFailure(error, await runCleanupSteps(cleanup, config.server.shutdownTimeoutMs));
    }
  }

  createTrafficGeneration(config: CompiledSnaperroConfigV2): TrafficRuntimeGeneration {
    if (this.#closed) throw new Error("Runtime core is closed");
    const resolvedProxy = resolveUpstreamProxy(config.proxy.url);
    if (resolvedProxy) {
      this.logger.info("Upstream proxy configured", {
        source: resolvedProxy.source,
        url: maskProxyUrl(resolvedProxy.url),
      });
    }
    const upstream = new UndiciUpstreamGateway(resolvedProxy?.url);
    const lifetime = new AbortController();
    const proxy = new ProxyService(config, upstream, lifetime.signal);
    const record = new RecordService({
      config,
      blobs: this.store.blobs,
      capture: this.#capture,
      proxy,
      lifetimeSignal: lifetime.signal,
    });
    const traffic = new TrafficService({
      config,
      catalogs: this.store.catalogs,
      proxy,
      mock: this.#mock,
      record,
      events: this.events,
      ids: this.#ids,
      clock: this.#clock,
      logger: this.logger,
      lifetimeSignal: lifetime.signal,
    });

    return {
      id: this.#ids.nextRuntimeId(),
      traffic,
      abort: async (reason) => {
        lifetime.abort(reason);
        await upstream.destroy(reason);
      },
      close: async () => {
        lifetime.abort(new Error("Traffic generation closed"));
        await upstream.close();
      },
    };
  }

  close(): Promise<void> {
    if (this.#closePromise) return this.#closePromise;
    this.#closed = true;
    this.#closePromise = this.#close();
    return this.#closePromise;
  }

  async #close(): Promise<void> {
    try {
      await this.events.publish({
        type: "runtime.shutting-down",
        revision: this.events.watermark().revision,
        payload: { reason: "Server shutdown" },
      });
    } catch (error) {
      try {
        this.logger.error("Shutdown event could not be published", { error });
      } catch {
        // Cleanup must continue even when diagnostics are unavailable.
      }
    }
    const cleanupErrors = await runCleanupStepsConcurrently([
      this.#unsubscribeGc,
      () => this.transfers.close(),
      () => this.events.close(),
      () => this.store.garbageCollection.close(),
    ]);
    if (cleanupErrors.length > 0) {
      throw new AggregateError(cleanupErrors, "Runtime core shutdown failed");
    }
  }
}
