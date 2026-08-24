import path from "node:path";
import {
  type HeaderFields,
  HeaderFieldsSchema,
  type HttpMethod,
  HttpMethodSchema,
  type QueryFields,
  QueryFieldsSchema,
  type RequestFingerprint,
  RequestFingerprintSchema,
} from "../../../shared/contracts-v2/primitives.js";
import type { CompiledSnaperroConfigV2, V2ApiConfig } from "../config/config.js";
import { EntityNotFoundError, OperationAbortedError, PayloadLimitExceededError } from "../domain/errors.js";
import {
  type FingerprintBody,
  isJsonMediaType,
  MAX_CANONICAL_JSON_BYTES,
  requestFingerprint,
} from "../domain/request-fingerprint.js";
import { BodyLimitExceededError, type BodySpool, spoolBody } from "./body-spool.js";
import type { IncomingTrafficRequest } from "./proxy-service.js";
import type { RouteMatch } from "./route-table.js";

export interface PreparedTrafficRequest {
  method: HttpMethod;
  incoming: IncomingTrafficRequest;
  match: RouteMatch<V2ApiConfig>;
  query: QueryFields;
  requestHeaders: HeaderFields;
  body: BodySpool;
  fingerprint: RequestFingerprint;
  dispose(): Promise<void>;
}

async function fingerprintBody(body: BodySpool, contentType: string | null): Promise<FingerprintBody> {
  if (body.size === 0) return { kind: "empty" };
  if (!isJsonMediaType(contentType) || body.size > MAX_CANONICAL_JSON_BYTES) {
    return { kind: "raw", sha256: body.sha256 };
  }

  try {
    return { kind: "json", value: JSON.parse(new TextDecoder().decode(await body.bytes())) };
  } catch {
    // Invalid JSON is still valid traffic. Preserve and match it byte-for-byte.
    return { kind: "raw", sha256: body.sha256 };
  }
}

export async function prepareTrafficRequest(
  config: CompiledSnaperroConfigV2,
  incoming: IncomingTrafficRequest,
  spoolDirectory = path.join(config.storage.root, "tmp"),
): Promise<PreparedTrafficRequest> {
  const url = new URL(incoming.url);
  const method = HttpMethodSchema.safeParse(incoming.method.toUpperCase());
  const match = config.routeTable.match(incoming.method, url.pathname);
  if (!method.success || !match) {
    throw new EntityNotFoundError("route", `${incoming.method.toUpperCase()} ${url.pathname}`);
  }

  let body: BodySpool;
  try {
    body = await spoolBody(incoming.body, {
      directory: spoolDirectory,
      maxBytes: config.recording.maxRequestBodyBytes,
      cleanupTimeoutMs: config.server.shutdownTimeoutMs,
      signal: incoming.signal,
    });
  } catch (error) {
    if (error instanceof BodyLimitExceededError) {
      throw new PayloadLimitExceededError(error.limit, error.received);
    }
    if (incoming.signal.aborted) throw new OperationAbortedError(undefined, error);
    throw error;
  }

  try {
    const query = QueryFieldsSchema.parse([...url.searchParams.entries()]);
    const requestHeaders = HeaderFieldsSchema.parse([...incoming.headers.entries()]);
    const fingerprint = RequestFingerprintSchema.parse(
      requestFingerprint({
        method: method.data,
        route: match.route,
        pathParams: match.pathParams,
        query,
        body: await fingerprintBody(body, incoming.headers.get("content-type")),
      }),
    );
    return {
      method: method.data,
      incoming,
      match,
      query,
      requestHeaders,
      body,
      fingerprint,
      dispose: () => body.dispose(),
    };
  } catch (error) {
    await body.dispose();
    throw error;
  }
}

export function maskRecordedHeaders(headers: HeaderFields, names: readonly string[]): HeaderFields {
  const masked = new Set(names.map((name) => name.toLowerCase()));
  return headers.map(([name, value]) => [name, masked.has(name.toLowerCase()) ? "***" : value]);
}
