import { type Event, EventSchema, V2_CONTROL_BASE_PATH, V2_RELATIVE_PATHS } from "../contracts";
import { ApiError, normalizeFetchError } from "./api-error";
import { type AuthorizationProvider, apiErrorFromResponse } from "./http-client";
import { type ParsedSseMessage, SseParser, SseParserLimitError } from "./sse-parser";

export type RealtimeConnectionStatus = "connecting" | "connected" | "reconnecting" | "stopped";

export interface RealtimeClientHandlers {
  onEvent: (event: Event) => void | Promise<void>;
  onStatus?: (status: RealtimeConnectionStatus) => void;
  onError?: (error: ApiError) => void;
}

export interface RealtimeSubscribeOptions {
  signal: AbortSignal;
}

export interface V2RealtimeClientOptions {
  url?: string;
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  authorization?: AuthorizationProvider;
  headers?: HeadersInit;
  initialRetryMs?: number;
  maxRetryMs?: number;
  maxEventBytes?: number;
  maxLineBytes?: number;
  sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}

const MAX_ERROR_BYTES = 64 * 1024;
const ABORTED_READ = Symbol("aborted SSE read");

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.replace(/\/+$/u, "") : value;
}

function defaultSleep(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const complete = () => {
      signal.removeEventListener("abort", abort);
      resolve();
    };
    const timeout = globalThis.setTimeout(complete, milliseconds);
    const abort = () => {
      globalThis.clearTimeout(timeout);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}

function cancelWithoutWaiting(reader: ReadableStreamDefaultReader<Uint8Array>, reason: unknown): void {
  try {
    void reader.cancel(reason).catch(() => undefined);
  } catch {
    // A streaming protocol error must still reach reconnect/stop handling when
    // a non-conforming source throws or never settles cancellation.
  }
}

async function readWithAbort(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
): Promise<ReadableStreamReadResult<Uint8Array> | typeof ABORTED_READ> {
  if (signal.aborted) {
    cancelWithoutWaiting(reader, signal.reason);
    return ABORTED_READ;
  }

  let didAbort = false;
  let resolveAbort!: (value: typeof ABORTED_READ) => void;
  const aborted = new Promise<typeof ABORTED_READ>((resolve) => {
    resolveAbort = resolve;
  });
  const onAbort = () => {
    if (didAbort) return;
    didAbort = true;
    cancelWithoutWaiting(reader, signal.reason);
    resolveAbort(ABORTED_READ);
  };
  signal.addEventListener("abort", onAbort, { once: true });
  if (signal.aborted) onAbort();
  if (didAbort) {
    signal.removeEventListener("abort", onAbort);
    return ABORTED_READ;
  }

  let pendingRead: Promise<ReadableStreamReadResult<Uint8Array>>;
  try {
    pendingRead = reader.read();
  } catch (error) {
    signal.removeEventListener("abort", onAbort);
    throw error;
  }
  // Promise.race no longer owns this read after abort wins. Keep an explicit
  // rejection observer so a late non-conforming stream failure is contained.
  void pendingRead.catch(() => undefined);
  try {
    return await Promise.race([pendingRead, aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

function releaseReaderWithoutThrowing(reader: ReadableStreamDefaultReader<Uint8Array>): void {
  try {
    reader.releaseLock();
  } catch {
    // An abort must not wait for or be replaced by a non-conforming pending
    // read. Cancellation above remains best-effort in that case.
  }
}

function parseMessage(message: ParsedSseMessage): Event {
  let value: unknown;
  try {
    value = JSON.parse(message.data);
  } catch (cause) {
    throw new ApiError("SSE message contained malformed JSON", {
      code: "INVALID_RESPONSE",
      cause,
    });
  }

  const parsed = EventSchema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError("SSE message did not match the v2 event contract", {
      code: "INVALID_RESPONSE",
      cause: parsed.error,
    });
  }
  if (message.event !== "message" && message.event !== parsed.data.type) {
    throw new ApiError(`SSE event name ${message.event} did not match payload type ${parsed.data.type}`, {
      code: "INVALID_RESPONSE",
    });
  }
  if (message.id !== null && message.id !== parsed.data.id) {
    throw new ApiError("SSE id did not match the event envelope", {
      code: "INVALID_RESPONSE",
    });
  }
  return parsed.data;
}

export class V2RealtimeClient {
  readonly url: string;
  readonly #fetch: typeof globalThis.fetch;
  readonly #authorization: AuthorizationProvider | undefined;
  readonly #headers: Headers;
  readonly #initialRetryMs: number;
  readonly #maxRetryMs: number;
  readonly #sleep: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  readonly #maxEventBytes: number | undefined;
  readonly #maxLineBytes: number | undefined;

  constructor(options: V2RealtimeClientOptions = {}) {
    const baseUrl = trimTrailingSlash(options.baseUrl ?? V2_CONTROL_BASE_PATH);
    this.url = options.url ?? `${baseUrl}${V2_RELATIVE_PATHS.events}`;
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#authorization = options.authorization;
    this.#headers = new Headers(options.headers);
    this.#initialRetryMs = options.initialRetryMs ?? 1_000;
    this.#maxRetryMs = options.maxRetryMs ?? 30_000;
    if (!Number.isSafeInteger(this.#initialRetryMs) || this.#initialRetryMs < 0) {
      throw new TypeError("initialRetryMs must be a non-negative safe integer");
    }
    if (!Number.isSafeInteger(this.#maxRetryMs) || this.#maxRetryMs < this.#initialRetryMs) {
      throw new TypeError("maxRetryMs must be a safe integer greater than or equal to initialRetryMs");
    }
    this.#sleep = options.sleep ?? defaultSleep;
    this.#maxEventBytes = options.maxEventBytes;
    this.#maxLineBytes = options.maxLineBytes;
  }

  async #requestHeaders(): Promise<Headers> {
    const headers = new Headers(this.#headers);
    headers.set("Accept", "text/event-stream");
    headers.set("Cache-Control", "no-cache");
    const authorization = await this.#authorization?.();
    if (authorization) headers.set("Authorization", authorization);
    return headers;
  }

  /**
   * Every HTTP connection starts from the server's fresh runtime.connected
   * snapshot. Event replay is therefore intentionally not requested here.
   */
  async subscribe(handlers: RealtimeClientHandlers, options: RealtimeSubscribeOptions): Promise<void> {
    let retryMs = this.#initialRetryMs;
    let retryAttempt = 0;
    let hasConnected = false;

    while (!options.signal.aborted) {
      handlers.onStatus?.(hasConnected ? "reconnecting" : "connecting");
      try {
        const response = await this.#fetch(this.url, {
          method: "GET",
          headers: await this.#requestHeaders(),
          signal: options.signal,
          credentials: "same-origin",
        });
        if (!response.ok) throw await apiErrorFromResponse(response, MAX_ERROR_BYTES);
        if (!response.headers.get("content-type")?.toLowerCase().includes("text/event-stream")) {
          throw new ApiError("SSE response had an invalid content type", {
            code: "INVALID_RESPONSE",
            status: response.status,
          });
        }
        if (!response.body) {
          throw new ApiError("SSE response did not contain a stream", {
            code: "INVALID_RESPONSE",
            status: response.status,
          });
        }

        handlers.onStatus?.("connected");
        hasConnected = true;
        const parser = new SseParser({ maxEventBytes: this.#maxEventBytes, maxLineBytes: this.#maxLineBytes });
        const reader = response.body.getReader();
        let receivedEvent = false;
        const deliver = async (message: ParsedSseMessage) => {
          const event = parseMessage(message);
          try {
            await handlers.onEvent(event);
          } catch (error) {
            if (error instanceof ApiError) throw error;
            throw new ApiError("Realtime event handler failed", { code: "STREAM_ERROR", cause: error });
          }
          receivedEvent = true;
        };
        try {
          while (!options.signal.aborted) {
            const read = await readWithAbort(reader, options.signal);
            if (read === ABORTED_READ) break;
            const { value, done } = read;
            if (done) break;
            const messages = parser.push(value);
            if (parser.retry !== null) retryMs = Math.min(parser.retry, this.#maxRetryMs);
            for (const message of messages) {
              if (options.signal.aborted) break;
              await deliver(message);
            }
          }
          if (!options.signal.aborted) {
            const messages = parser.finish();
            if (parser.retry !== null) retryMs = Math.min(parser.retry, this.#maxRetryMs);
            for (const message of messages) {
              if (options.signal.aborted) break;
              await deliver(message);
            }
          }
        } catch (error) {
          cancelWithoutWaiting(reader, error);
          if (error instanceof SseParserLimitError) {
            throw new ApiError("SSE response exceeded the streaming safety limit", {
              code: "STREAM_ERROR",
              retryable: true,
              details: { kind: error.kind, limitBytes: error.limitBytes, actualBytes: error.actualBytes },
              cause: error,
            });
          }
          throw error;
        } finally {
          releaseReaderWithoutThrowing(reader);
        }

        if (options.signal.aborted) break;
        retryAttempt = receivedEvent ? 0 : retryAttempt + 1;
      } catch (error) {
        const apiError = normalizeFetchError(error);
        if (apiError.code === "ABORTED" || options.signal.aborted) break;
        handlers.onError?.(apiError);
        if (!apiError.retryable || apiError.code === "INVALID_RESPONSE") {
          handlers.onStatus?.("stopped");
          throw apiError;
        }
        retryAttempt += 1;
      }

      handlers.onStatus?.("reconnecting");
      const delay = Math.min(retryMs * 2 ** Math.max(0, retryAttempt - 1), this.#maxRetryMs);
      try {
        await this.#sleep(delay, options.signal);
      } catch (error) {
        if (!options.signal.aborted) throw normalizeFetchError(error);
      }
    }

    handlers.onStatus?.("stopped");
  }
}
