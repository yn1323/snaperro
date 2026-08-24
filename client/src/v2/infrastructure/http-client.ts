import { z } from "zod/v4";

import {
  type BodyRef,
  type BodyUploadMetadata,
  BodyUploadMetadataSchema,
  BodyUploadResultSchema,
  type Command,
  type CommandResult,
  CommandResultSchemas,
  CommandSchema,
  type FolderImportUploadMetadata,
  FolderImportUploadMetadataSchema,
  MAX_CONTROL_JSON_BYTES,
  ProblemSchema,
  type Query,
  type QueryResult,
  QueryResultSchemas,
  QuerySchema,
  type RecordingImportUploadMetadata,
  RecordingImportUploadMetadataSchema,
  type ServerSnapshot,
  type StagedFolderImport,
  StagedFolderImportSchema,
  type StagedRecordingImport,
  StagedRecordingImportSchema,
  V2_CONTROL_BASE_PATH,
  V2_RELATIVE_PATHS,
  V2_SCHEMA_VERSION,
} from "../contracts";
import { ApiError, normalizeFetchError } from "./api-error";

const ProblemEnvelopeSchema = z.object({ error: ProblemSchema }).strict();
const DEFAULT_MAX_JSON_BYTES = MAX_CONTROL_JSON_BYTES;

function isRetryableHttpStatus(status: number): boolean {
  return status >= 500 || status === 408 || status === 429;
}

export type AuthorizationProvider = () => string | null | undefined | Promise<string | null | undefined>;
export interface VersionedAuthorization {
  value: string | null | undefined;
  epoch: number;
}
export type HttpAuthorizationProvider = () =>
  | string
  | null
  | undefined
  | VersionedAuthorization
  | Promise<string | null | undefined | VersionedAuthorization>;
export type HttpBody = NonNullable<RequestInit["body"]>;
export type HttpHeaders = ConstructorParameters<typeof Headers>[0];

export interface UnauthorizedRequestContext {
  authorizationEpoch: number | null;
}

export interface V2HttpClientOptions {
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  authorization?: HttpAuthorizationProvider;
  headers?: HttpHeaders;
  maxJsonBytes?: number;
  onUnauthorized?: (error: ApiError, context: UnauthorizedRequestContext) => void;
}

export interface RequestOptions {
  signal?: AbortSignal;
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.replace(/\/+$/u, "") : value;
}

function contentLength(response: Response): number | null {
  const value = response.headers.get("content-length");
  if (!value) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function cancelWithoutWaiting(cancel: () => Promise<void>): void {
  try {
    void cancel().catch(() => undefined);
  } catch {
    // The size-limit error is authoritative even when a non-conforming stream
    // throws synchronously or never settles its cancellation algorithm.
  }
}

async function readLimitedText(response: Response, limit: number): Promise<string> {
  const declaredLength = contentLength(response);
  if (declaredLength !== null && declaredLength > limit) {
    if (response.body) cancelWithoutWaiting(() => response.body?.cancel() ?? Promise.resolve());
    throw new ApiError(`Response exceeds the ${limit} byte JSON limit`, {
      code: "RESPONSE_TOO_LARGE",
      status: response.status,
      retryable: isRetryableHttpStatus(response.status),
      details: { limit, contentLength: declaredLength },
    });
  }

  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) {
        cancelWithoutWaiting(() => reader.cancel());
        throw new ApiError(`Response exceeds the ${limit} byte JSON limit`, {
          code: "RESPONSE_TOO_LARGE",
          status: response.status,
          retryable: isRetryableHttpStatus(response.status),
          details: { limit, receivedBytes: bytes },
        });
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join("");
  } finally {
    reader.releaseLock();
  }
}

function parseJson(text: string, code: "INVALID_RESPONSE" | "HTTP_ERROR", status: number): unknown {
  try {
    return JSON.parse(text);
  } catch (cause) {
    throw new ApiError(code === "HTTP_ERROR" ? `Request failed with HTTP ${status}` : "Response was not valid JSON", {
      code,
      status,
      retryable: code === "HTTP_ERROR" && status >= 500,
      cause,
      details: text ? { responseSnippet: text.slice(0, 200) } : undefined,
    });
  }
}

export async function apiErrorFromResponse(response: Response, maxBytes: number): Promise<ApiError> {
  let text: string;
  try {
    text = await readLimitedText(response, maxBytes);
  } catch (error) {
    return error instanceof ApiError
      ? error
      : new ApiError(`Request failed with HTTP ${response.status}`, {
          code: "HTTP_ERROR",
          status: response.status,
          retryable: isRetryableHttpStatus(response.status),
          cause: error,
        });
  }

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return new ApiError(`Request failed with HTTP ${response.status}`, {
      code: "HTTP_ERROR",
      status: response.status,
      retryable: isRetryableHttpStatus(response.status),
      details: text ? { responseSnippet: text.slice(0, 200) } : undefined,
    });
  }

  const problem = ProblemEnvelopeSchema.safeParse(value);
  return problem.success
    ? ApiError.fromProblem(problem.data.error, response.status)
    : new ApiError(`Request failed with HTTP ${response.status}`, {
        code: "HTTP_ERROR",
        status: response.status,
        retryable: isRetryableHttpStatus(response.status),
      });
}

export class V2HttpClient {
  readonly baseUrl: string;
  readonly #fetch: typeof globalThis.fetch;
  readonly #authorization: HttpAuthorizationProvider | undefined;
  readonly #headers: Headers;
  readonly #maxJsonBytes: number;
  readonly #onUnauthorized: ((error: ApiError, context: UnauthorizedRequestContext) => void) | undefined;

  constructor(options: V2HttpClientOptions = {}) {
    this.baseUrl = trimTrailingSlash(options.baseUrl ?? V2_CONTROL_BASE_PATH);
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#authorization = options.authorization;
    this.#headers = new Headers(options.headers);
    this.#maxJsonBytes = options.maxJsonBytes ?? DEFAULT_MAX_JSON_BYTES;
    if (!Number.isSafeInteger(this.#maxJsonBytes) || this.#maxJsonBytes < 1) {
      throw new TypeError("maxJsonBytes must be a positive safe integer");
    }
    this.#onUnauthorized = options.onUnauthorized;
  }

  #normalizeError(error: unknown, authorizationEpoch: number | null): ApiError {
    const normalized = normalizeFetchError(error);
    if (normalized.status === 401 || normalized.code === "UNAUTHORIZED") {
      this.#onUnauthorized?.(normalized, { authorizationEpoch });
      return new ApiError("A valid control token is required", {
        code: "UNAUTHORIZED",
        status: 401,
        retryable: false,
      });
    }
    return normalized;
  }

  async #requestHeaders(extra?: HttpHeaders): Promise<{ headers: Headers; authorizationEpoch: number | null }> {
    const headers = new Headers(this.#headers);
    if (extra) {
      for (const [key, value] of new Headers(extra)) headers.set(key, value);
    }
    const provided = await this.#authorization?.();
    const authorization = typeof provided === "object" && provided !== null ? provided.value : provided;
    const authorizationEpoch = typeof provided === "object" && provided !== null ? provided.epoch : null;
    if (authorization) headers.set("Authorization", authorization);
    return { headers, authorizationEpoch };
  }

  async #postJson(url: string, payload: unknown, schema: z.ZodType, options?: RequestOptions): Promise<unknown> {
    let authorizationEpoch: number | null = null;
    try {
      const request = await this.#requestHeaders({
        Accept: "application/json",
        "Content-Type": "application/json",
      });
      authorizationEpoch = request.authorizationEpoch;
      const response = await this.#fetch(url, {
        method: "POST",
        headers: request.headers,
        body: JSON.stringify(payload),
        signal: options?.signal,
        credentials: "same-origin",
      });
      if (!response.ok) throw await apiErrorFromResponse(response, this.#maxJsonBytes);

      const text = await readLimitedText(response, this.#maxJsonBytes);
      const value = parseJson(text, "INVALID_RESPONSE", response.status);
      const parsed = schema.safeParse(value);
      if (!parsed.success) {
        throw new ApiError("Response did not match the v2 contract", {
          code: "INVALID_RESPONSE",
          status: response.status,
          cause: parsed.error,
        });
      }
      return parsed.data;
    } catch (error) {
      throw this.#normalizeError(error, authorizationEpoch);
    }
  }

  async #postRaw(
    url: string,
    body: HttpBody,
    headers: HttpHeaders,
    schema: z.ZodType,
    options?: RequestOptions,
  ): Promise<unknown> {
    let authorizationEpoch: number | null = null;
    try {
      const requestHeaders = new Headers(headers);
      requestHeaders.set("Accept", "application/json");
      const request = await this.#requestHeaders(requestHeaders);
      authorizationEpoch = request.authorizationEpoch;
      const response = await this.#fetch(url, {
        method: "POST",
        headers: request.headers,
        body,
        signal: options?.signal,
        credentials: "same-origin",
      });
      if (!response.ok) throw await apiErrorFromResponse(response, this.#maxJsonBytes);
      const value = parseJson(await readLimitedText(response, this.#maxJsonBytes), "INVALID_RESPONSE", response.status);
      const parsed = schema.safeParse(value);
      if (!parsed.success) {
        throw new ApiError("Response did not match the v2 contract", {
          code: "INVALID_RESPONSE",
          status: response.status,
          cause: parsed.error,
        });
      }
      return parsed.data;
    } catch (error) {
      throw this.#normalizeError(error, authorizationEpoch);
    }
  }

  async command<const Input extends Command>(
    input: Input,
    options?: RequestOptions,
  ): Promise<CommandResult<Input["type"]>> {
    const parsed = CommandSchema.safeParse(input);
    if (!parsed.success) {
      throw new ApiError("Command did not match the v2 contract", {
        code: "INVALID_REQUEST",
        cause: parsed.error,
      });
    }
    const schema = CommandResultSchemas[parsed.data.type];
    return (await this.#postJson(
      `${this.baseUrl}${V2_RELATIVE_PATHS.commands}`,
      parsed.data,
      schema,
      options,
    )) as CommandResult<Input["type"]>;
  }

  async query<const Input extends Query>(input: Input, options?: RequestOptions): Promise<QueryResult<Input["type"]>> {
    const parsed = QuerySchema.safeParse(input);
    if (!parsed.success) {
      throw new ApiError("Query did not match the v2 contract", {
        code: "INVALID_REQUEST",
        cause: parsed.error,
      });
    }
    const schema = QueryResultSchemas[parsed.data.type];
    return (await this.#postJson(
      `${this.baseUrl}${V2_RELATIVE_PATHS.queries}`,
      parsed.data,
      schema,
      options,
    )) as QueryResult<Input["type"]>;
  }

  snapshot(options?: RequestOptions): Promise<ServerSnapshot> {
    return this.query({ protocolVersion: V2_SCHEMA_VERSION, type: "runtime.snapshot" }, options);
  }

  async uploadBody(body: HttpBody, metadata: BodyUploadMetadata, options?: RequestOptions): Promise<BodyRef> {
    const parsed = BodyUploadMetadataSchema.safeParse(metadata);
    if (!parsed.success) {
      throw new ApiError("Body upload metadata did not match the v2 contract", {
        code: "INVALID_REQUEST",
        cause: parsed.error,
      });
    }
    const headers = new Headers({ "Content-Type": parsed.data.mediaType ?? "application/octet-stream" });
    if (parsed.data.contentEncoding) headers.set("Content-Encoding", parsed.data.contentEncoding);
    return (await this.#postRaw(
      `${this.baseUrl}${V2_RELATIVE_PATHS.bodies}`,
      body,
      headers,
      BodyUploadResultSchema,
      options,
    )) as BodyRef;
  }

  async stageFolderImport(
    body: HttpBody,
    metadata: FolderImportUploadMetadata,
    options?: RequestOptions,
  ): Promise<StagedFolderImport> {
    const parsed = FolderImportUploadMetadataSchema.safeParse(metadata);
    if (!parsed.success) {
      throw new ApiError("Folder import metadata did not match the v2 contract", {
        code: "INVALID_REQUEST",
        cause: parsed.error,
      });
    }
    const url = `${this.baseUrl}${V2_RELATIVE_PATHS.folderImports}?filename=${encodeURIComponent(parsed.data.filename)}`;
    return (await this.#postRaw(
      url,
      body,
      { "Content-Type": parsed.data.mediaType },
      StagedFolderImportSchema,
      options,
    )) as StagedFolderImport;
  }

  async stageRecordingImport(
    body: HttpBody,
    metadata: RecordingImportUploadMetadata,
    options?: RequestOptions,
  ): Promise<StagedRecordingImport> {
    const parsed = RecordingImportUploadMetadataSchema.safeParse(metadata);
    if (!parsed.success) {
      throw new ApiError("Recording import metadata did not match the v2 contract", {
        code: "INVALID_REQUEST",
        cause: parsed.error,
      });
    }
    const url = `${this.baseUrl}${V2_RELATIVE_PATHS.recordingImports}?filename=${encodeURIComponent(parsed.data.filename)}`;
    return (await this.#postRaw(
      url,
      body,
      { "Content-Type": parsed.data.mediaType },
      StagedRecordingImportSchema,
      options,
    )) as StagedRecordingImport;
  }
}
