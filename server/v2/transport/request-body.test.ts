import type { Context } from "hono";
import { describe, expect, it, vi } from "vitest";
import { InvalidArgumentError, OperationAbortedError, PayloadLimitExceededError } from "../domain/errors.js";
import { readLimitedJson } from "./request-body.js";

describe("readLimitedJson", () => {
  it.each([
    "-1",
    "1.5",
    "3, 3",
    "9007199254740992",
  ])("rejects an invalid declared Content-Length (%s)", async (contentLength) => {
    const context = {
      req: {
        header: (name: string) =>
          name.toLowerCase() === "content-type"
            ? "application/json"
            : name.toLowerCase() === "content-length"
              ? contentLength
              : undefined,
        raw: { body: new Blob(["{}"]).stream() },
      },
    } as unknown as Context;

    await expect(readLimitedJson(context, 4)).rejects.toBeInstanceOf(InvalidArgumentError);
  });

  it("rejects an oversized request without awaiting an uncooperative stream cancellation", async () => {
    const cancel = vi.fn(() => new Promise<void>(() => undefined));
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(5));
      },
      cancel,
    });
    const context = {
      req: {
        header: (name: string) => (name.toLowerCase() === "content-type" ? "application/json" : undefined),
        raw: { body },
      },
    } as unknown as Context;

    let failure: unknown;
    void readLimitedJson(context, 4).catch((error: unknown) => {
      failure = error;
    });

    await vi.waitFor(() => expect(failure).toBeInstanceOf(PayloadLimitExceededError));
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("rejects an aborted pending read without awaiting source cancellation", async () => {
    const controller = new AbortController();
    let markPullStarted: (() => void) | undefined;
    const pullStarted = new Promise<void>((resolve) => {
      markPullStarted = resolve;
    });
    const cancel = vi.fn(() => new Promise<void>(() => undefined));
    const body = new ReadableStream<Uint8Array>({
      pull() {
        markPullStarted?.();
        return new Promise<void>(() => undefined);
      },
      cancel,
    });
    const context = {
      req: {
        header: (name: string) => (name.toLowerCase() === "content-type" ? "application/json" : undefined),
        raw: { body, signal: controller.signal },
      },
    } as unknown as Context;

    const reading = readLimitedJson(context, 4);
    await pullStarted;
    controller.abort(new Error("client disconnected"));

    await expect(reading).rejects.toBeInstanceOf(OperationAbortedError);
    expect(cancel).toHaveBeenCalled();
  });
});
