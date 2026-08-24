import {
  type BodyRef,
  type Recording,
  type RecordingDraft,
  RecordingDraftSchema,
} from "../../../shared/contracts-v2/entities.js";
import type { HeaderFields, ScenarioId } from "../../../shared/contracts-v2/primitives.js";
import type { BlobStorePort, BlobWriteSessionPort, OperationContext } from "../application/ports.js";
import type { CompiledSnaperroConfigV2 } from "../config/config.js";
import { OperationAbortedError } from "../domain/errors.js";
import { responseAllowsBody } from "../domain/http-representation.js";
import { createPersistedBodyStream, type PersistedBodyStream } from "./persisted-body-stream.js";
import { maskRecordedHeaders, type PreparedTrafficRequest } from "./prepared-request.js";
import type { TrafficResponse } from "./proxy-service.js";
import type { RecordingCapturePort } from "./recording-capture.js";

export interface ProxyTrafficPort {
  execute(request: PreparedTrafficRequest["incoming"]): Promise<TrafficResponse>;
}

export interface RecordServiceDependencies {
  config: CompiledSnaperroConfigV2;
  blobs: BlobStorePort;
  capture: RecordingCapturePort;
  proxy: ProxyTrafficPort;
  lifetimeSignal?: AbortSignal;
}

export type RecordCaptureState =
  | { state: "saved"; scenarioId: ScenarioId; recording: Recording }
  | { state: "pending"; scenarioId: ScenarioId; completion: Promise<Recording> };

export interface RecordExecution {
  response: TrafficResponse;
  capture: RecordCaptureState;
}

function failedCapture(scenarioId: ScenarioId, error: unknown): RecordCaptureState {
  const completion = Promise.reject<Recording>(error);
  void completion.catch(() => undefined);
  return { state: "pending", scenarioId, completion };
}

function headerValue(headers: HeaderFields, name: string): string | null {
  const normalized = name.toLowerCase();
  return headers.find(([header]) => header.toLowerCase() === normalized)?.[1] ?? null;
}

function hasResponseBody(method: string, response: TrafficResponse): boolean {
  return responseAllowsBody(method, response.status) && response.body !== null;
}

function observeCleanup(operation: () => Promise<unknown> | unknown): void {
  try {
    void Promise.resolve(operation()).catch(() => undefined);
  } catch {
    // Cleanup cannot replace or delay the traffic outcome.
  }
}

const ABORTED = Symbol("recording operation aborted");

async function awaitWithAbort<Result>(
  operation: PromiseLike<Result> | Result,
  context: OperationContext,
  disposeLateResult?: (result: Result) => Promise<unknown> | unknown,
): Promise<Result> {
  const observed = Promise.resolve(operation).then(
    (value) => ({ status: "fulfilled" as const, value }),
    (error: unknown) => ({ status: "rejected" as const, error }),
  );
  const signal = context.signal;
  if (!signal) {
    const result = await observed;
    if (result.status === "rejected") throw result.error;
    return result.value;
  }
  if (signal.aborted) {
    if (disposeLateResult) {
      void observed.then((late) => {
        if (late.status === "fulfilled") observeCleanup(() => disposeLateResult(late.value));
      });
    }
    throw new OperationAbortedError(undefined, signal.reason);
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
      throw new OperationAbortedError(undefined, signal.reason);
    }
    if (result.status === "rejected") throw result.error;
    return result.value;
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

function cancelBodyBestEffort(body: ReadableStream<Uint8Array> | null, reason?: unknown): void {
  if (!body) return;
  observeCleanup(() => body.cancel(reason));
}

async function persistRequestBody(
  blobs: BlobStorePort,
  request: PreparedTrafficRequest,
  context: OperationContext,
): Promise<BodyRef | null> {
  if (request.body.size === 0) return null;
  let session: BlobWriteSessionPort | undefined;
  try {
    session = await awaitWithAbort(
      blobs.beginWrite(
        {
          mediaType: request.incoming.headers.get("content-type"),
          contentEncoding: request.incoming.headers.get("content-encoding"),
        },
        context,
      ),
      context,
      (lateSession) => lateSession.abort(context.signal?.reason),
    );
    const stream = request.body.createWebStream();
    if (!stream) throw new Error("A non-empty request spool did not provide a stream");
    await awaitWithAbort(stream.pipeTo(session.writable, { signal: context.signal }), context);
    return await awaitWithAbort(session.commit(context), context);
  } catch (error) {
    if (session) observeCleanup(() => session?.abort(error));
    if (context.signal?.aborted) throw new OperationAbortedError(undefined, error);
    throw error;
  }
}

function requestSignal(
  completeOnClientDisconnect: boolean,
  clientSignal: AbortSignal,
  lifetimeSignal?: AbortSignal,
): AbortSignal {
  if (!lifetimeSignal) return completeOnClientDisconnect ? new AbortController().signal : clientSignal;
  return completeOnClientDisconnect ? lifetimeSignal : AbortSignal.any([clientSignal, lifetimeSignal]);
}

export class RecordService {
  constructor(private readonly dependencies: RecordServiceDependencies) {}

  async execute(request: PreparedTrafficRequest, scenarioId: ScenarioId): Promise<RecordExecution> {
    const signal = requestSignal(
      this.dependencies.config.recording.completeOnClientDisconnect,
      request.incoming.signal,
      this.dependencies.lifetimeSignal,
    );
    const context = { signal };
    let requestBody: BodyRef | null = null;
    let requestPersistenceFailed = false;
    let requestPersistenceError: unknown;
    try {
      requestBody = await persistRequestBody(this.dependencies.blobs, request, context);
    } catch (error) {
      if (signal.aborted) throw error;
      requestPersistenceFailed = true;
      requestPersistenceError = error;
    }
    const upstream = await awaitWithAbort(
      this.dependencies.proxy.execute({
        ...request.incoming,
        body: request.body.createWebStream(),
        signal,
      }),
      context,
      (lateResponse) => cancelBodyBestEffort(lateResponse.body, signal.reason),
    );
    const maskNames = [
      ...this.dependencies.config.recording.maskRequestHeaders,
      ...request.match.api.maskRequestHeaders,
    ];

    const baseDraft = {
      route: request.match.route,
      method: request.method,
      request: {
        pathParams: request.match.pathParams,
        query: request.query,
        headers: maskRecordedHeaders(request.requestHeaders, maskNames),
        body: requestBody,
      },
      response: {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: upstream.headers,
        body: null,
      },
    } satisfies RecordingDraft;

    const capture = (body: BodyRef | null): Promise<Recording> =>
      awaitWithAbort(
        this.dependencies.capture.upsert(
          {
            scenarioId,
            recording: RecordingDraftSchema.parse({
              ...baseDraft,
              response: { ...baseDraft.response, body },
            }),
          },
          context,
        ),
        context,
      );

    if (!hasResponseBody(request.method, upstream)) {
      if (upstream.body) observeCleanup(() => upstream.body?.cancel());
      const response = { ...upstream, body: null };
      if (requestPersistenceFailed) {
        return { response, capture: failedCapture(scenarioId, requestPersistenceError) };
      }
      try {
        const recording = await capture(null);
        return { response, capture: { state: "saved", scenarioId, recording } };
      } catch (error) {
        if (signal.aborted) throw error;
        return { response, capture: failedCapture(scenarioId, error) };
      }
    }

    if (requestPersistenceFailed) {
      return { response: upstream, capture: failedCapture(scenarioId, requestPersistenceError) };
    }

    let session: BlobWriteSessionPort;
    try {
      session = await awaitWithAbort(
        this.dependencies.blobs.beginWrite(
          {
            mediaType: headerValue(upstream.headers, "content-type"),
            contentEncoding: headerValue(upstream.headers, "content-encoding"),
          },
          context,
        ),
        context,
        (lateSession) => lateSession.abort(signal.reason),
      );
    } catch (error) {
      if (signal.aborted) {
        cancelBodyBestEffort(upstream.body, signal.reason);
        throw error;
      }
      return { response: upstream, capture: failedCapture(scenarioId, error) };
    }

    let persisted: PersistedBodyStream;
    try {
      persisted = createPersistedBodyStream(upstream.body as ReadableStream<Uint8Array>, session, {
        signal,
        completeOnCancel: this.dependencies.config.recording.completeOnClientDisconnect,
      });
    } catch (error) {
      observeCleanup(() => session.abort(error));
      return { response: upstream, capture: failedCapture(scenarioId, error) };
    }
    return {
      response: { ...upstream, body: persisted.body },
      capture: { state: "pending", scenarioId, completion: persisted.completion.then(capture) },
    };
  }
}
