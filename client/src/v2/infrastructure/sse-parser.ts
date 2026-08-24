export interface ParsedSseMessage {
  event: string;
  data: string;
  id: string | null;
  retry: number | null;
}

export const DEFAULT_MAX_SSE_LINE_BYTES = 4 * 1024 * 1024;
export const DEFAULT_MAX_SSE_EVENT_BYTES = 4 * 1024 * 1024;

export interface SseParserOptions {
  maxLineBytes?: number;
  maxEventBytes?: number;
}

export class SseParserLimitError extends Error {
  constructor(
    readonly kind: "line" | "event",
    readonly limitBytes: number,
    readonly actualBytes: number,
  ) {
    super(`SSE ${kind} exceeded ${limitBytes} bytes`);
    this.name = "SseParserLimitError";
  }
}

export class SseParser {
  readonly #decoder = new TextDecoder();
  readonly #encoder = new TextEncoder();
  readonly #maxLineBytes: number;
  readonly #maxEventBytes: number;
  #buffer = "";
  #dataLines: string[] = [];
  #eventName = "message";
  #lastEventId: string | null = null;
  #retry: number | null = null;
  #started = false;
  #lineBytes = 0;
  #eventBytes = 0;

  constructor(options: SseParserOptions = {}) {
    this.#maxLineBytes = options.maxLineBytes ?? DEFAULT_MAX_SSE_LINE_BYTES;
    this.#maxEventBytes = options.maxEventBytes ?? DEFAULT_MAX_SSE_EVENT_BYTES;
    for (const [name, value] of [
      ["maxLineBytes", this.#maxLineBytes],
      ["maxEventBytes", this.#maxEventBytes],
    ] as const) {
      if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${name} must be a positive safe integer`);
    }
  }

  get lastEventId(): string | null {
    return this.#lastEventId;
  }

  get retry(): number | null {
    return this.#retry;
  }

  push(chunk: Uint8Array): ParsedSseMessage[] {
    const messages: ParsedSseMessage[] = [];
    // Decode in bounded pieces even when a custom fetch implementation returns
    // one attacker-controlled giant chunk.
    for (let offset = 0; offset < chunk.byteLength; offset += 64 * 1024) {
      const part = chunk.subarray(offset, Math.min(chunk.byteLength, offset + 64 * 1024));
      this.#trackLineBytes(part);
      this.#buffer += this.#decoder.decode(part, { stream: true });
      messages.push(...this.#drainLines(false));
    }
    return messages;
  }

  finish(): ParsedSseMessage[] {
    this.#buffer += this.#decoder.decode();
    const messages = this.#drainLines(true);
    const pending = this.#dispatch();
    if (pending) messages.push(pending);
    return messages;
  }

  #drainLines(finishing: boolean): ParsedSseMessage[] {
    const messages: ParsedSseMessage[] = [];
    while (this.#buffer.length > 0) {
      const lineBreak = this.#nextLineBreak(finishing);
      if (!lineBreak) break;
      const line = this.#buffer.slice(0, lineBreak.index);
      this.#buffer = this.#buffer.slice(lineBreak.index + lineBreak.length);
      const message = this.#processLine(line, lineBreak.length);
      if (message) messages.push(message);
    }

    if (finishing && this.#buffer.length > 0) {
      const message = this.#processLine(this.#buffer, 0);
      this.#buffer = "";
      if (message) messages.push(message);
    }
    return messages;
  }

  #nextLineBreak(finishing: boolean): { index: number; length: number } | null {
    for (let index = 0; index < this.#buffer.length; index++) {
      const character = this.#buffer[index];
      if (character === "\n") return { index, length: 1 };
      if (character === "\r") {
        if (index + 1 >= this.#buffer.length && !finishing) return null;
        return { index, length: this.#buffer[index + 1] === "\n" ? 2 : 1 };
      }
    }
    return null;
  }

  #processLine(rawLine: string, delimiterBytes: number): ParsedSseMessage | null {
    this.#eventBytes += this.#encoder.encode(rawLine).byteLength + delimiterBytes;
    if (this.#eventBytes > this.#maxEventBytes) {
      throw new SseParserLimitError("event", this.#maxEventBytes, this.#eventBytes);
    }
    let line = rawLine;
    if (!this.#started) {
      this.#started = true;
      if (line.charCodeAt(0) === 0xfeff) line = line.slice(1);
    }

    if (line === "") return this.#dispatch();
    if (line.startsWith(":")) return null;

    const separator = line.indexOf(":");
    const field = separator === -1 ? line : line.slice(0, separator);
    let value = separator === -1 ? "" : line.slice(separator + 1);
    if (value.startsWith(" ")) value = value.slice(1);

    switch (field) {
      case "event":
        this.#eventName = value;
        break;
      case "data":
        this.#dataLines.push(value);
        break;
      case "id":
        if (!value.includes("\0")) this.#lastEventId = value;
        break;
      case "retry":
        if (/^\d+$/u.test(value)) {
          const retry = Number(value);
          if (Number.isSafeInteger(retry)) this.#retry = retry;
        }
        break;
    }
    return null;
  }

  #dispatch(): ParsedSseMessage | null {
    this.#eventBytes = 0;
    if (this.#dataLines.length === 0) {
      this.#eventName = "message";
      return null;
    }
    const message: ParsedSseMessage = {
      event: this.#eventName || "message",
      data: this.#dataLines.join("\n"),
      id: this.#lastEventId,
      retry: this.#retry,
    };
    this.#dataLines = [];
    this.#eventName = "message";
    return message;
  }

  #trackLineBytes(chunk: Uint8Array): void {
    for (const byte of chunk) {
      if (byte === 0x0a || byte === 0x0d) {
        this.#lineBytes = 0;
        continue;
      }
      this.#lineBytes += 1;
      if (this.#lineBytes > this.#maxLineBytes) {
        throw new SseParserLimitError("line", this.#maxLineBytes, this.#lineBytes);
      }
    }
  }
}
