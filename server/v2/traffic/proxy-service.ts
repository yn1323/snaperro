import { HeaderFieldsSchema, HttpMethodSchema } from "../../../shared/contracts-v2/primitives.js";
import type { UpstreamGatewayPort, UpstreamResponse } from "../application/ports.js";
import type { CompiledSnaperroConfigV2 } from "../config/config.js";
import { EntityNotFoundError, OperationAbortedError, UpstreamUnavailableError } from "../domain/errors.js";
import { buildUpstreamUrl, forwardRequestHeaders, sanitizeResponseHeaderFields } from "./http-forwarding.js";

export interface IncomingTrafficRequest {
  method: string;
  url: string;
  headers: Headers;
  body: ReadableStream<Uint8Array> | null;
  signal: AbortSignal;
}

export interface TrafficResponse extends UpstreamResponse {
  /** Internal work that must settle before this traffic generation can close. */
  generationCompletion?: Promise<void>;
}

function cancelBestEffort(stream: ReadableStream<Uint8Array> | null, reason?: unknown): void {
  if (!stream) return;
  try {
    void stream.cancel(reason).catch(() => undefined);
  } catch {
    // The upstream outcome remains authoritative after cleanup starts.
  }
}

const ABORTED = Symbol("upstream request aborted");

async function awaitUpstream(operation: Promise<UpstreamResponse>, signal: AbortSignal): Promise<UpstreamResponse> {
  const observed = operation.then(
    (value) => ({ status: "fulfilled" as const, value }),
    (error: unknown) => ({ status: "rejected" as const, error }),
  );
  if (signal.aborted) {
    void observed.then((late) => {
      if (late.status === "fulfilled") cancelBestEffort(late.value.body, signal.reason);
    });
    throw new OperationAbortedError("The upstream request was aborted", signal.reason);
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
      void observed.then((late) => {
        if (late.status === "fulfilled") cancelBestEffort(late.value.body, signal.reason);
      });
      throw new OperationAbortedError("The upstream request was aborted", signal.reason);
    }
    if (result.status === "rejected") throw result.error;
    return result.value;
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

export class ProxyService {
  constructor(
    private readonly config: CompiledSnaperroConfigV2,
    private readonly upstream: UpstreamGatewayPort,
    private readonly lifetimeSignal?: AbortSignal,
  ) {}

  async execute(request: IncomingTrafficRequest): Promise<TrafficResponse> {
    const method = HttpMethodSchema.safeParse(request.method.toUpperCase());
    const incomingUrl = new URL(request.url);
    const match = this.config.routeTable.match(request.method, incomingUrl.pathname);
    if (!method.success || !match) {
      throw new EntityNotFoundError("route", `${request.method.toUpperCase()} ${incomingUrl.pathname}`);
    }

    const headers = HeaderFieldsSchema.parse([...forwardRequestHeaders(request.headers, match.api.headers).entries()]);
    const signal = this.lifetimeSignal ? AbortSignal.any([request.signal, this.lifetimeSignal]) : request.signal;
    const onAbort = () => cancelBestEffort(request.body, signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
    try {
      const response = await awaitUpstream(
        this.upstream.execute({
          method: method.data,
          url: buildUpstreamUrl(match.api.target, request.url).toString(),
          headers,
          body: request.body,
          signal,
        }),
        signal,
      );
      return { ...response, headers: sanitizeResponseHeaderFields(response.headers) };
    } catch (error) {
      cancelBestEffort(request.body, error);
      if (signal.aborted) {
        throw new OperationAbortedError("The upstream request was aborted", signal.reason ?? error);
      }
      throw new UpstreamUnavailableError("The upstream request failed", error);
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  }
}
