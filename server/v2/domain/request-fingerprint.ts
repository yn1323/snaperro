import { createHash } from "node:crypto";
import type { BodyRef, RecordingDraft } from "../../../shared/contracts-v2/entities.js";
import {
  type QueryFields,
  type RequestFingerprint,
  RequestFingerprintSchema,
} from "../../../shared/contracts-v2/primitives.js";
import { OperationAbortedError } from "./errors.js";

export const MAX_CANONICAL_JSON_BYTES = 4 * 1024 * 1024;

export type FingerprintBody = { kind: "empty" } | { kind: "json"; value: unknown } | { kind: "raw"; sha256: string };

export interface RequestFingerprintInput {
  method: string;
  route: string;
  pathParams: Readonly<Record<string, string>>;
  query: QueryFields;
  body: FingerprintBody;
}

/** Locale-independent total order over exact JavaScript strings. */
function compareCodeUnits(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

export type FingerprintedRecordingDraft = RecordingDraft & { requestFingerprint: RequestFingerprint };

export type OpenRecordedBody = (body: BodyRef) => Promise<ReadableStream<Uint8Array>>;

const ABORTED = Symbol("request fingerprint aborted");

function cancelStreamBestEffort(stream: ReadableStream<Uint8Array>, reason?: unknown): void {
  try {
    void stream.cancel(reason).catch(() => undefined);
  } catch {
    // The fingerprint outcome remains authoritative after cleanup starts.
  }
}

async function awaitWithSignal<Result>(
  operation: PromiseLike<Result> | Result,
  signal?: AbortSignal,
  disposeLateResult?: (result: Result) => void,
): Promise<Result> {
  const observed = Promise.resolve(operation).then(
    (value) => ({ status: "fulfilled" as const, value }),
    (error: unknown) => ({ status: "rejected" as const, error }),
  );
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

function canonicalize(value: unknown, seen: Set<object>): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "undefined") return null;
  if (typeof value === "bigint" || typeof value === "function" || typeof value === "symbol") {
    throw new TypeError(`Unsupported JSON value: ${typeof value}`);
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) throw new TypeError("Cannot fingerprint a cyclic JSON value");
    seen.add(value);
    try {
      return value.map((item) => canonicalize(item, seen));
    } finally {
      seen.delete(value);
    }
  }

  if (typeof value === "object") {
    if (seen.has(value)) throw new TypeError("Cannot fingerprint a cyclic JSON value");
    seen.add(value);
    try {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .filter(([, item]) => typeof item !== "undefined")
          .sort(([left], [right]) => compareCodeUnits(left, right))
          .map(([key, item]) => [key, canonicalize(item, seen)]),
      );
    } finally {
      seen.delete(value);
    }
  }

  throw new TypeError("Unsupported request body");
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value, new Set()));
}

function canonicalStringRecord(value: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => compareCodeUnits(left, right)));
}

function canonicalQueryFields(value: QueryFields): QueryFields {
  return [...value].sort(([leftName, leftValue], [rightName, rightValue]) => {
    return compareCodeUnits(leftName, rightName) || compareCodeUnits(leftValue, rightValue);
  });
}

export function isJsonMediaType(contentType: string | null): boolean {
  if (!contentType) return false;
  const mediaType = contentType.split(";", 1)[0].trim().toLowerCase();
  return mediaType === "application/json" || mediaType.endsWith("+json");
}

export function requestFingerprint(input: RequestFingerprintInput): RequestFingerprint {
  const payload = canonicalJson({
    method: input.method.toUpperCase(),
    route: input.route,
    pathParams: canonicalStringRecord(input.pathParams),
    query: canonicalQueryFields(input.query),
    body:
      input.body.kind === "json"
        ? { kind: "json", value: input.body.value }
        : input.body.kind === "raw"
          ? { kind: "raw", sha256: input.body.sha256 }
          : { kind: "empty" },
  });

  return RequestFingerprintSchema.parse(createHash("sha256").update(payload).digest("hex"));
}

async function readRecordedBody(
  body: BodyRef,
  open: OpenRecordedBody,
  parseJson: boolean,
  signal?: AbortSignal,
): Promise<FingerprintBody> {
  const stream = await awaitWithSignal(open(body), signal, (lateStream) =>
    cancelStreamBestEffort(lateStream, signal?.reason),
  );
  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = stream.getReader();
  } catch (error) {
    cancelStreamBestEffort(stream, error);
    throw error;
  }
  const chunks: Uint8Array[] | null = parseJson ? [] : null;
  const hash = createHash("sha256");
  let received = 0;
  try {
    while (true) {
      if (signal?.aborted) throw new OperationAbortedError(undefined, signal.reason);
      const { done, value } = await awaitWithSignal(reader.read(), signal);
      if (done) break;
      received += value.byteLength;
      if (received > body.size || (chunks && received > MAX_CANONICAL_JSON_BYTES)) {
        throw new Error("Recorded request body exceeded its declared fingerprinting size");
      }
      hash.update(value);
      chunks?.push(value);
    }
  } catch (error) {
    // Integrity/abort failures are already terminal. Do not let an external
    // stream's cleanup promise keep the command or shutdown path pending.
    try {
      void reader.cancel(error).catch(() => undefined);
    } catch {
      // Cancellation is best-effort after the fingerprint operation failed.
    }
    throw error;
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // A non-conforming source may retain its pending read after abort.
    }
  }

  if (received !== body.size || hash.digest("hex") !== body.sha256) {
    throw new Error("Recorded request body failed its fingerprint integrity check");
  }
  if (received === 0) return { kind: "empty" };
  if (!chunks) return { kind: "raw", sha256: body.sha256 };
  try {
    return { kind: "json", value: JSON.parse(new TextDecoder().decode(Buffer.concat(chunks, received))) };
  } catch {
    return { kind: "raw", sha256: body.sha256 };
  }
}

export async function fingerprintBodyFromReference(
  body: BodyRef | null,
  open: OpenRecordedBody,
  signal?: AbortSignal,
): Promise<FingerprintBody> {
  if (!body) return { kind: "empty" };
  const parseJson = isJsonMediaType(body.mediaType) && body.size <= MAX_CANONICAL_JSON_BYTES;
  return readRecordedBody(body, open, parseJson, signal);
}

export async function deriveRecordingRequestFingerprint(
  recording: RecordingDraft,
  open: OpenRecordedBody,
  signal?: AbortSignal,
): Promise<RequestFingerprint> {
  return requestFingerprint({
    method: recording.method,
    route: recording.route,
    pathParams: recording.request.pathParams,
    query: recording.request.query,
    body: await fingerprintBodyFromReference(recording.request.body, open, signal),
  });
}

export async function fingerprintRecordingDraft(
  recording: RecordingDraft,
  open: OpenRecordedBody,
  signal?: AbortSignal,
): Promise<FingerprintedRecordingDraft> {
  return {
    ...recording,
    requestFingerprint: await deriveRecordingRequestFingerprint(recording, open, signal),
  };
}
