import { describe, expect, it } from "vitest";
import { BodyRefSchema, RecordingDraftSchema } from "../../../shared/contracts-v2/entities.js";
import type { HeaderFields } from "../../../shared/contracts-v2/primitives.js";
import { InvalidArgumentError } from "./errors.js";
import { normalizeRecordingRepresentation, normalizeTrafficResponseHeaders } from "./http-representation.js";

const body = BodyRefSchema.parse({
  sha256: "a".repeat(64),
  size: 7,
  mediaType: "application/json",
  contentEncoding: null,
});

function draft() {
  return RecordingDraftSchema.parse({
    route: "/users",
    method: "POST",
    request: {
      pathParams: {},
      query: [],
      headers: [
        ["Content-Type", "text/plain"],
        ["content-length", "999"],
        ["content-encoding", "gzip"],
        ["x-request-id", "one"],
      ],
      body,
    },
    response: {
      status: 200,
      statusText: "OK",
      headers: [
        ["content-type", "text/html"],
        ["content-length", "1"],
        ["x-response-id", "two"],
      ],
      body: { ...body, mediaType: "text/plain", contentEncoding: "br" },
    },
  });
}

describe("normalizeRecordingRepresentation", () => {
  it("makes BodyRef the single source of truth for representation headers", () => {
    const normalized = normalizeRecordingRepresentation(draft());

    expect(normalized.request.headers).toEqual([
      ["x-request-id", "one"],
      ["content-type", "application/json"],
      ["content-length", "7"],
    ]);
    expect(normalized.response.headers).toEqual([
      ["x-response-id", "two"],
      ["content-type", "text/plain"],
      ["content-encoding", "br"],
      ["content-length", "7"],
    ]);
  });

  it("keeps HEAD response representation metadata but removes bodyless request framing", () => {
    const input = draft();
    const bodyless = RecordingDraftSchema.parse({
      ...input,
      method: "HEAD",
      request: { ...input.request, body: null },
      response: { ...input.response, body: null },
    });

    const normalized = normalizeRecordingRepresentation(bodyless);
    expect(normalized.request.headers).toEqual([
      ["Content-Type", "text/plain"],
      ["x-request-id", "one"],
    ]);
    expect(normalized.response.headers).toEqual(bodyless.response.headers);
  });

  it.each([200, 204, 205])("removes stale framing from a bodyless HTTP %s response", (status) => {
    const input = draft();
    const bodyless = RecordingDraftSchema.parse({
      ...input,
      request: { ...input.request, body: null },
      response: { ...input.response, status, body: null },
    });

    const normalized = normalizeRecordingRepresentation(bodyless);
    expect(normalized.request.headers).toEqual([
      ["Content-Type", "text/plain"],
      ["x-request-id", "one"],
    ]);
    expect(normalized.response.headers).toEqual([
      ["content-type", "text/html"],
      ["x-response-id", "two"],
    ]);
  });

  it("preserves representation metadata for a bodyless HTTP 304", () => {
    const input = draft();
    const bodyless = RecordingDraftSchema.parse({
      ...input,
      response: { ...input.response, status: 304, body: null },
    });

    expect(normalizeRecordingRepresentation(bodyless).response.headers).toEqual(bodyless.response.headers);
  });

  it("rejects a persisted response body for HEAD", () => {
    const input = draft();

    expect(() => normalizeRecordingRepresentation(RecordingDraftSchema.parse({ ...input, method: "HEAD" }))).toThrow(
      InvalidArgumentError,
    );
  });

  it("rejects bodies forbidden by HTTP response semantics", () => {
    const input = draft();
    for (const status of [204, 205, 304]) {
      expect(() =>
        normalizeRecordingRepresentation(
          RecordingDraftSchema.parse({ ...input, response: { ...input.response, status } }),
        ),
      ).toThrow(InvalidArgumentError);
    }
  });

  it("removes forbidden wire framing for 204/205 but preserves HEAD and 304 representation metadata", () => {
    const headers: HeaderFields = [
      ["content-type", "application/json"],
      ["content-encoding", "gzip"],
      ["content-length", "999"],
    ];

    expect(normalizeTrafficResponseHeaders("GET", 204, [...headers])).toEqual([["content-type", "application/json"]]);
    expect(normalizeTrafficResponseHeaders("GET", 205, [...headers])).toEqual([["content-type", "application/json"]]);
    expect(normalizeTrafficResponseHeaders("HEAD", 200, [...headers])).toEqual([...headers]);
    expect(normalizeTrafficResponseHeaders("GET", 304, [...headers])).toEqual([...headers]);
  });
});
