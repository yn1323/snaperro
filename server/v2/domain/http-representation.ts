import type { BodyRef, RecordingDraft } from "../../../shared/contracts-v2/entities.js";
import type { HeaderFields } from "../../../shared/contracts-v2/primitives.js";
import { InvalidArgumentError } from "./errors.js";

const REPRESENTATION_HEADERS = new Set(["content-encoding", "content-length", "content-type"]);
const BODY_FRAMING_HEADERS = new Set(["content-encoding", "content-length"]);

/** HTTP responses whose payload bytes may be persisted and replayed. */
export function responseAllowsBody(method: string, status: number): boolean {
  return method.toUpperCase() !== "HEAD" && status >= 200 && ![204, 205, 304].includes(status);
}

function withBodyMetadata(headers: HeaderFields, body: BodyRef): HeaderFields {
  const result = headers.filter(([name]) => !REPRESENTATION_HEADERS.has(name.toLowerCase()));
  if (body.mediaType) result.push(["content-type", body.mediaType]);
  if (body.contentEncoding) result.push(["content-encoding", body.contentEncoding]);
  result.push(["content-length", String(body.size)]);
  return result;
}

function withoutBodyFraming(headers: HeaderFields): HeaderFields {
  return headers.filter(([name]) => !BODY_FRAMING_HEADERS.has(name.toLowerCase()));
}

/** Removes framing that would describe bytes forbidden on the wire. */
export function normalizeTrafficResponseHeaders(method: string, status: number, headers: HeaderFields): HeaderFields {
  return method.toUpperCase() !== "HEAD" && (status === 204 || status === 205) ? withoutBodyFraming(headers) : headers;
}

/**
 * BodyRef is the canonical representation metadata for persisted bytes.
 * Synchronizing the HTTP fields at the application boundary prevents edited
 * metadata from producing a fingerprint or response that disagrees with the
 * actual blob.
 */
export function normalizeRecordingRepresentation(recording: RecordingDraft): RecordingDraft {
  if (recording.response.body && !responseAllowsBody(recording.method, recording.response.status)) {
    const response = recording.method === "HEAD" ? "HEAD responses" : `HTTP ${recording.response.status} responses`;
    throw new InvalidArgumentError(`${response} cannot contain a body`);
  }

  return {
    ...recording,
    request: recording.request.body
      ? { ...recording.request, headers: withBodyMetadata(recording.request.headers, recording.request.body) }
      : { ...recording.request, headers: withoutBodyFraming(recording.request.headers) },
    response: recording.response.body
      ? { ...recording.response, headers: withBodyMetadata(recording.response.headers, recording.response.body) }
      : recording.method === "HEAD" || recording.response.status === 304
        ? recording.response
        : { ...recording.response, headers: withoutBodyFraming(recording.response.headers) },
  };
}
