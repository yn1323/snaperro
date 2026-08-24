import type { RequestRecordingOutcome, SettledRequestRecordingOutcome } from "../../../shared/contracts-v2/entities.js";
import {
  HttpMethodSchema,
  type RecordingId,
  type RequestId,
  type ScenarioId,
} from "../../../shared/contracts-v2/primitives.js";
import type {
  CatalogRepositoryPort,
  ClockPort,
  EventHubPort,
  IdGeneratorPort,
  LoggerPort,
  OperationContext,
} from "../application/ports.js";
import type { CompiledSnaperroConfigV2 } from "../config/config.js";
import {
  DomainError,
  EntityNotFoundError,
  InvalidArgumentError,
  isDomainError,
  normalizeDomainError,
} from "../domain/errors.js";
import { domainErrorHttpStatus } from "../domain/http-status.js";
import type { MockService } from "./mock-service.js";
import { type PreparedTrafficRequest, prepareTrafficRequest } from "./prepared-request.js";
import type { IncomingTrafficRequest, TrafficResponse } from "./proxy-service.js";
import type { RecordCaptureState, RecordService } from "./record-service.js";

export interface TrafficProxyPort {
  execute(request: IncomingTrafficRequest): Promise<TrafficResponse>;
}

export interface TrafficMockPort {
  find(
    request: PreparedTrafficRequest,
    scenarioId: ScenarioId,
    context?: OperationContext,
  ): ReturnType<MockService["find"]>;
}

export interface TrafficRecordPort {
  execute(request: PreparedTrafficRequest, scenarioId: ScenarioId): ReturnType<RecordService["execute"]>;
}

export interface TrafficServiceDependencies {
  config: CompiledSnaperroConfigV2;
  catalogs: CatalogRepositoryPort;
  proxy: TrafficProxyPort;
  mock: TrafficMockPort;
  record: TrafficRecordPort;
  events: EventHubPort;
  ids: IdGeneratorPort;
  clock: ClockPort;
  logger: LoggerPort;
  lifetimeSignal?: AbortSignal;
  nowMilliseconds?: () => number;
  prepare?: (request: IncomingTrafficRequest) => Promise<PreparedTrafficRequest>;
}

interface TrafficOutcome {
  response: TrafficResponse;
  action: "proxy" | "record" | "mock" | "smart";
  subAction?: "proxy" | "record" | "mock";
  matchedRecordingId?: RecordingId;
  capture: { state: "not-attempted" } | RecordCaptureState;
}

interface TrafficTelemetry {
  action: TrafficOutcome["action"];
  subAction?: TrafficOutcome["subAction"];
  recordingAttempted: boolean;
}

const ABORTED = Symbol("traffic operation aborted");

function observeCleanup(operation: () => Promise<unknown> | unknown): void {
  try {
    void Promise.resolve(operation()).catch(() => undefined);
  } catch {
    // A late resource must not retain the aborted request.
  }
}

async function awaitWithSignal<Result>(
  operation: PromiseLike<Result> | Result,
  signal: AbortSignal,
  disposeLateResult?: (result: Result) => Promise<unknown> | unknown,
): Promise<Result> {
  const observed = Promise.resolve(operation).then(
    (value) => ({ status: "fulfilled" as const, value }),
    (error: unknown) => ({ status: "rejected" as const, error }),
  );
  if (signal.aborted) {
    if (disposeLateResult) {
      void observed.then((late) => {
        if (late.status === "fulfilled") observeCleanup(() => disposeLateResult(late.value));
      });
    }
    throw signal.reason;
  }
  let resolveAborted: (value: typeof ABORTED) => void = () => undefined;
  const aborted = new Promise<typeof ABORTED>((resolve) => {
    resolveAborted = resolve;
  });
  const onAbort = () => resolveAborted(ABORTED);
  signal.addEventListener("abort", onAbort, { once: true });
  if (signal.aborted) onAbort();
  try {
    const result = await Promise.race([observed, aborted]);
    if (result === ABORTED) {
      if (disposeLateResult) {
        void observed.then((late) => {
          if (late.status === "fulfilled") observeCleanup(() => disposeLateResult(late.value));
        });
      }
      throw signal.reason;
    }
    if (result.status === "rejected") throw result.error;
    return result.value;
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

export class TrafficService {
  readonly #nowMilliseconds: () => number;
  readonly #prepare: (request: IncomingTrafficRequest) => Promise<PreparedTrafficRequest>;

  constructor(private readonly dependencies: TrafficServiceDependencies) {
    this.#nowMilliseconds = dependencies.nowMilliseconds ?? (() => performance.now());
    this.#prepare = dependencies.prepare ?? ((request) => prepareTrafficRequest(this.dependencies.config, request));
  }

  async execute(incoming: IncomingTrafficRequest): Promise<TrafficResponse> {
    const request = this.dependencies.lifetimeSignal
      ? {
          ...incoming,
          signal: AbortSignal.any([incoming.signal, this.dependencies.lifetimeSignal]),
        }
      : incoming;
    const startedAt = this.#nowMilliseconds();
    const catalog = await awaitWithSignal(this.dependencies.catalogs.read({ signal: request.signal }), request.signal);
    const selectedScenarioId = catalog.currentScenarioId;
    const requestId = this.dependencies.ids.nextRequestId();
    const telemetry: TrafficTelemetry = {
      action: catalog.mode,
      recordingAttempted: false,
    };
    let outcome: TrafficOutcome | undefined;
    try {
      switch (catalog.mode) {
        case "proxy":
          outcome = {
            response: await this.dependencies.proxy.execute(request),
            action: "proxy",
            capture: { state: "not-attempted" },
          };
          break;
        case "record":
          if (!selectedScenarioId) throw this.#noScenarioSelected();
          telemetry.recordingAttempted = true;
          outcome = await this.#withPrepared(request, async (prepared) => {
            const execution = await this.dependencies.record.execute(prepared, selectedScenarioId);
            return {
              response: execution.response,
              action: "record" as const,
              capture: execution.capture,
            };
          });
          break;
        case "mock":
          if (!selectedScenarioId) throw this.#noScenarioSelected();
          outcome = await this.#executeMock(request, selectedScenarioId, telemetry);
          break;
        case "smart":
          if (!selectedScenarioId) throw this.#noScenarioSelected();
          outcome = await this.#executeSmart(request, selectedScenarioId, telemetry);
          break;
      }
      const requestLogPublished = this.#publishRequestLog(requestId, request, startedAt, outcome.response.status, {
        action: outcome.action,
        ...(outcome.subAction ? { subAction: outcome.subAction } : {}),
        ...(outcome.matchedRecordingId ? { matchedRecordingId: outcome.matchedRecordingId } : {}),
        recordingOutcome: this.#recordingOutcome(outcome.capture),
      });
      const generationCompletion = this.#observePendingCapture(requestId, outcome.capture, requestLogPublished);
      await requestLogPublished;
      return generationCompletion ? { ...outcome.response, generationCompletion } : outcome.response;
    } catch (error) {
      const normalized = isDomainError(error)
        ? error
        : new DomainError("INTERNAL", "An unexpected traffic error occurred", { cause: error });
      await this.#publishRequestLog(requestId, request, startedAt, domainErrorHttpStatus(normalized.code), {
        action: telemetry.action,
        ...(telemetry.subAction ? { subAction: telemetry.subAction } : {}),
        recordingOutcome: telemetry.recordingAttempted
          ? { state: "failed", problem: normalized.toProblem() }
          : { state: "not-attempted" },
      });
      throw error;
    }
  }

  async #executeMock(
    request: IncomingTrafficRequest,
    scenarioId: ScenarioId,
    telemetry: TrafficTelemetry,
  ): Promise<TrafficOutcome> {
    return this.#withPrepared(request, async (prepared) => {
      const match = await this.dependencies.mock.find(prepared, scenarioId, { signal: request.signal });
      if (match) {
        return {
          response: match.response,
          action: "mock",
          matchedRecordingId: match.recording.id,
          capture: { state: "not-attempted" },
        };
      }

      switch (this.dependencies.config.mock.fallback) {
        case "proxy":
          telemetry.subAction = "proxy";
          return {
            response: await this.dependencies.proxy.execute({ ...request, body: prepared.body.createWebStream() }),
            action: "mock",
            subAction: "proxy",
            capture: { state: "not-attempted" },
          };
        case "proxy&record": {
          telemetry.subAction = "record";
          telemetry.recordingAttempted = true;
          const execution = await this.dependencies.record.execute(prepared, scenarioId);
          return {
            response: execution.response,
            action: "mock",
            subAction: "record",
            capture: execution.capture,
          };
        }
        default:
          throw new EntityNotFoundError("mock", prepared.fingerprint);
      }
    });
  }

  async #executeSmart(
    request: IncomingTrafficRequest,
    scenarioId: ScenarioId,
    telemetry: TrafficTelemetry,
  ): Promise<TrafficOutcome> {
    return this.#withPrepared(request, async (prepared) => {
      const match = await this.dependencies.mock.find(prepared, scenarioId, { signal: request.signal });
      if (match) {
        telemetry.subAction = "mock";
        return {
          response: match.response,
          action: "smart",
          subAction: "mock",
          matchedRecordingId: match.recording.id,
          capture: { state: "not-attempted" },
        };
      }
      telemetry.subAction = "record";
      telemetry.recordingAttempted = true;
      const execution = await this.dependencies.record.execute(prepared, scenarioId);
      return {
        response: execution.response,
        action: "smart",
        subAction: "record",
        capture: execution.capture,
      };
    });
  }

  #noScenarioSelected(): InvalidArgumentError {
    return new InvalidArgumentError("No scenario is selected", { field: "currentScenarioId" });
  }

  async #withPrepared<Result>(
    request: IncomingTrafficRequest,
    operation: (prepared: PreparedTrafficRequest) => Promise<Result>,
  ): Promise<Result> {
    const prepared = await awaitWithSignal(this.#prepare(request), request.signal, (latePrepared) =>
      latePrepared.dispose(),
    );
    try {
      return await operation(prepared);
    } finally {
      await prepared.dispose();
    }
  }

  async #publishRequestLog(
    requestId: RequestId,
    request: IncomingTrafficRequest,
    startedAt: number,
    status: number,
    outcome: Pick<TrafficOutcome, "action" | "subAction" | "matchedRecordingId"> & {
      recordingOutcome: RequestRecordingOutcome;
    },
  ): Promise<void> {
    const method = HttpMethodSchema.safeParse(request.method.toUpperCase());
    if (!method.success) return;
    const path = new URL(request.url).pathname.slice(0, 8_192) || "/";
    try {
      await this.dependencies.events.publish({
        type: "request.completed",
        revision: this.dependencies.events.watermark().revision,
        payload: {
          id: requestId,
          timestamp: this.dependencies.clock.now(),
          method: method.data,
          path: path.startsWith("/") ? path : `/${path}`,
          action: outcome.action,
          ...(outcome.subAction ? { subAction: outcome.subAction } : {}),
          status,
          ...(outcome.matchedRecordingId ? { matchedRecordingId: outcome.matchedRecordingId } : {}),
          recordingOutcome: outcome.recordingOutcome,
          durationMs: Math.max(0, this.#nowMilliseconds() - startedAt),
        },
      });
    } catch (error) {
      try {
        this.dependencies.logger.error("Request log event could not be published", { error });
      } catch {
        // Observability must not affect traffic delivery.
      }
    }
  }

  #recordingOutcome(capture: TrafficOutcome["capture"]): RequestRecordingOutcome {
    switch (capture.state) {
      case "not-attempted":
        return capture;
      case "pending":
        return { state: "pending" };
      case "saved":
        return { state: "saved", recordingId: capture.recording.id };
    }
  }

  #observePendingCapture(
    requestId: RequestId,
    capture: TrafficOutcome["capture"],
    requestLogPublished: Promise<void>,
  ): Promise<void> | undefined {
    if (capture.state !== "pending") return undefined;
    return capture.completion.then(
      async (recording) => {
        await requestLogPublished;
        await this.#publishRecordingOutcome(requestId, capture.scenarioId, {
          state: "saved",
          recordingId: recording.id,
        });
      },
      async (error: unknown) => {
        await requestLogPublished;
        await this.#publishRecordingOutcome(requestId, capture.scenarioId, {
          state: "failed",
          problem: normalizeDomainError(error).toProblem(),
        });
      },
    );
  }

  async #publishRecordingOutcome(
    requestId: RequestId,
    scenarioId: RecordCaptureState["scenarioId"],
    recordingOutcome: SettledRequestRecordingOutcome,
  ): Promise<void> {
    try {
      await this.dependencies.events.publish({
        type: "recording.outcome",
        revision: this.dependencies.events.watermark().revision,
        payload: { requestId, scenarioId, recordingOutcome },
      });
    } catch (error) {
      try {
        this.dependencies.logger.error("Recording outcome event could not be published", { error });
      } catch {
        // Observability must not affect traffic delivery.
      }
    }
  }
}
