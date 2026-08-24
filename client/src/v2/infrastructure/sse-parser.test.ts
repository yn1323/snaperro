import { describe, expect, it } from "vitest";

import { SseParser } from "./sse-parser";

const encoder = new TextEncoder();

describe("SseParser", () => {
  it("parses UTF-8, CRLF, and fields split across arbitrary chunk boundaries", () => {
    const parser = new SseParser();
    const bytes = encoder.encode(
      "\uFEFF: heartbeat\r\nretry: 250\r\nid: evt_aaaaaaaaaaaaaaaa\r\nevent: custom\r\ndata: first\r\ndata: 世界\r\n\r\n",
    );
    const messages = [];

    for (const byte of bytes) messages.push(...parser.push(Uint8Array.of(byte)));
    messages.push(...parser.finish());

    expect(messages).toEqual([
      {
        event: "custom",
        data: "first\n世界",
        id: "evt_aaaaaaaaaaaaaaaa",
        retry: 250,
      },
    ]);
    expect(parser.lastEventId).toBe("evt_aaaaaaaaaaaaaaaa");
    expect(parser.retry).toBe(250);
  });

  it("dispatches multiple events from one chunk and persists or resets the event id", () => {
    const parser = new SseParser();
    const messages = parser.push(encoder.encode("id: first\ndata: one\n\ndata: two\n\nid:\ndata: three\n\n"));

    expect(messages).toEqual([
      { event: "message", data: "one", id: "first", retry: null },
      { event: "message", data: "two", id: "first", retry: null },
      { event: "message", data: "three", id: "", retry: null },
    ]);
    expect(parser.lastEventId).toBe("");
  });

  it("retains standalone retry directives and ignores invalid values", () => {
    const parser = new SseParser();

    expect(parser.push(encoder.encode("retry: 1500\n\n"))).toEqual([]);
    expect(parser.retry).toBe(1500);
    expect(parser.push(encoder.encode("retry: -1\nretry: 999999999999999999999999\n\n"))).toEqual([]);
    expect(parser.retry).toBe(1500);

    expect(parser.push(encoder.encode("data: final"))).toEqual([]);
    expect(parser.finish()).toEqual([{ event: "message", data: "final", id: null, retry: 1500 }]);
  });

  it("rejects an unterminated line by UTF-8 bytes without retaining unbounded input", () => {
    const parser = new SseParser({ maxLineBytes: 8, maxEventBytes: 64 });

    parser.push(encoder.encode("data: "));
    expect(() => parser.push(encoder.encode("世界"))).toThrowError(
      expect.objectContaining({ kind: "line", limitBytes: 8, actualBytes: 9 }),
    );
  });

  it("rejects a multi-line event whose aggregate bytes exceed the event limit", () => {
    const parser = new SseParser({ maxLineBytes: 32, maxEventBytes: 20 });

    parser.push(encoder.encode("data: one\n"));
    expect(() => parser.push(encoder.encode("data: two\n\n"))).toThrowError(
      expect.objectContaining({ kind: "event", limitBytes: 20 }),
    );
  });
});
