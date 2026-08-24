import { STATUS_CODES } from "node:http";
import { Readable } from "node:stream";
import { Agent, type Dispatcher, ProxyAgent, request } from "undici";
import type { HeaderFields } from "../../../shared/contracts-v2/primitives.js";
import type { UpstreamGatewayPort, UpstreamRequest, UpstreamResponse } from "../application/ports.js";

function requestHeaders(fields: HeaderFields): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};
  for (const [name, value] of fields) {
    const key = name.toLowerCase();
    const existing = result[key];
    result[key] = existing === undefined ? value : Array.isArray(existing) ? [...existing, value] : [existing, value];
  }
  return result;
}

function responseHeaders(fields: Record<string, string | string[] | undefined>): HeaderFields {
  const result: Array<[string, string]> = [];
  for (const [name, value] of Object.entries(fields)) {
    if (Array.isArray(value)) {
      for (const item of value) result.push([name, item]);
    } else if (value !== undefined) {
      result.push([name, value]);
    }
  }
  return result;
}

export class UndiciUpstreamGateway implements UpstreamGatewayPort {
  readonly #dispatcher: Dispatcher;
  #shutdown: Promise<void> | undefined;

  constructor(proxyUrl?: string, dispatcher?: Dispatcher) {
    this.#dispatcher = dispatcher ?? (proxyUrl ? new ProxyAgent(proxyUrl) : new Agent());
  }

  async execute(input: UpstreamRequest): Promise<UpstreamResponse> {
    if (this.#shutdown) throw new Error("Upstream gateway is closed");
    const response = await request(input.url, {
      method: input.method,
      headers: requestHeaders(input.headers),
      body: input.body ? Readable.fromWeb(input.body as never) : null,
      signal: input.signal,
      dispatcher: this.#dispatcher,
    });

    return {
      status: response.statusCode,
      statusText: STATUS_CODES[response.statusCode] ?? "",
      headers: responseHeaders(response.headers),
      body: response.body ? (Readable.toWeb(response.body) as ReadableStream<Uint8Array>) : null,
    };
  }

  close(): Promise<void> {
    return this.#shutdown ?? this.#startShutdown(() => this.#dispatcher.close());
  }

  destroy(reason: Error): Promise<void> {
    return this.#shutdown ?? this.#startShutdown(() => this.#dispatcher.destroy(reason));
  }

  #startShutdown(operation: () => Promise<void>): Promise<void> {
    let shutdown: Promise<void>;
    try {
      shutdown = operation();
    } catch (error) {
      return Promise.reject(error);
    }
    this.#shutdown = shutdown;
    void shutdown.catch(() => {
      // A failed close has not established the closed invariant. Retain
      // concurrency idempotency for the attempt, then allow a later retry.
      if (this.#shutdown === shutdown) this.#shutdown = undefined;
    });
    return shutdown;
  }
}
