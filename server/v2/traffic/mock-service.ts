import type { Recording } from "../../../shared/contracts-v2/entities.js";
import type { ScenarioId } from "../../../shared/contracts-v2/primitives.js";
import type { BlobStorePort, OperationContext, ScenarioManifestRepositoryPort } from "../application/ports.js";
import { OperationAbortedError } from "../domain/errors.js";
import { responseAllowsBody } from "../domain/http-representation.js";
import { sanitizeResponseHeaderFields } from "./http-forwarding.js";
import type { PreparedTrafficRequest } from "./prepared-request.js";
import type { TrafficResponse } from "./proxy-service.js";

export interface MockResolution {
  scenarioId: ScenarioId;
  recording: Recording;
  response: TrafficResponse;
}

function releaseBestEffort(release: (() => Promise<void>) | undefined): void {
  if (!release) return;
  try {
    void release().catch(() => undefined);
  } catch {
    // The opened body stream already owns its lifetime pin.
  }
}

function cancelBestEffort(stream: ReadableStream<Uint8Array>, reason?: unknown): void {
  try {
    void stream.cancel(reason).catch(() => undefined);
  } catch {
    // A late mock body must not retain the aborted lookup.
  }
}

const ABORTED = Symbol("mock lookup aborted");

async function awaitWithAbort<Result>(
  operation: PromiseLike<Result> | Result,
  context: OperationContext,
  disposeLateResult?: (result: Result) => void,
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
        if (late.status === "fulfilled") disposeLateResult(late.value);
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
          if (late.status === "fulfilled") disposeLateResult(late.value);
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

export class MockService {
  constructor(
    private readonly manifests: ScenarioManifestRepositoryPort,
    private readonly blobs: BlobStorePort,
  ) {}

  async find(
    request: PreparedTrafficRequest,
    scenarioId: ScenarioId,
    context: OperationContext = {},
  ): Promise<MockResolution | null> {
    const manifest = await awaitWithAbort(this.manifests.read(scenarioId, context), context);
    const recording = manifest.recordings.find(
      (candidate) => candidate.matchable && candidate.requestFingerprint === request.fingerprint,
    );
    if (!recording) return null;

    const bodyAllowed = responseAllowsBody(request.method, recording.response.status);
    const responseBody = bodyAllowed ? recording.response.body : null;
    const pin = responseBody
      ? await awaitWithAbort(this.blobs.pin?.(responseBody, context), context, (latePin) =>
          releaseBestEffort(latePin ? () => latePin.release() : undefined),
        )
      : undefined;
    let body: ReadableStream<Uint8Array> | null;
    try {
      body = responseBody
        ? await awaitWithAbort(this.blobs.open(responseBody, context), context, (lateBody) =>
            cancelBestEffort(lateBody, context.signal?.reason),
          )
        : null;
      if (context.signal?.aborted) {
        if (body) cancelBestEffort(body, context.signal.reason);
        throw new OperationAbortedError(undefined, context.signal.reason);
      }
    } finally {
      releaseBestEffort(pin ? () => pin.release() : undefined);
    }
    return {
      scenarioId,
      recording,
      response: {
        status: recording.response.status,
        statusText: recording.response.statusText,
        headers: sanitizeResponseHeaderFields(recording.response.headers),
        body,
      },
    };
  }
}
