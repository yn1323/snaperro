import type { Context } from "hono";
import { InvalidArgumentError, OperationAbortedError, PayloadLimitExceededError } from "../domain/errors.js";
import { assertDeclaredContentLengthWithinLimit } from "./request-content-length.js";

export async function readLimitedJson(context: Context, maxBytes: number): Promise<unknown> {
  const contentType = context.req.header("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new InvalidArgumentError("Content-Type must be application/json");
  }

  assertDeclaredContentLengthWithinLimit(context, maxBytes);

  const reader = context.req.raw.body?.getReader();
  if (!reader) throw new InvalidArgumentError("A JSON request body is required");
  const signal = context.req.raw.signal;
  const abortedToken = Symbol("JSON request aborted");
  let resolveAborted: (value: typeof abortedToken) => void = () => undefined;
  const aborted = new Promise<typeof abortedToken>((resolve) => {
    resolveAborted = resolve;
  });
  const cancel = (reason: unknown) => {
    try {
      void reader.cancel(reason).catch(() => undefined);
    } catch {
      // The request error remains authoritative after cancellation starts.
    }
  };
  const onAbort = () => {
    cancel(signal?.reason);
    resolveAborted(abortedToken);
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) onAbort();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    while (true) {
      if (signal?.aborted) throw new OperationAbortedError(undefined, signal.reason);
      const read = reader.read().then(
        (value) => ({ status: "fulfilled" as const, value }),
        (error: unknown) => ({ status: "rejected" as const, error }),
      );
      const result = signal ? await Promise.race([read, aborted]) : await read;
      if (result === abortedToken) throw new OperationAbortedError(undefined, signal?.reason);
      if (result.status === "rejected") throw result.error;
      const { done, value } = result.value;
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        const error = new PayloadLimitExceededError(maxBytes, received);
        // An untrusted request stream may never settle its underlying cancel
        // algorithm. The size limit must still produce a prompt 413 response.
        cancel(error);
        throw error;
      }
      chunks.push(value);
    }
  } catch (error) {
    cancel(error);
    throw error;
  } finally {
    signal?.removeEventListener("abort", onAbort);
    try {
      reader.releaseLock();
    } catch {
      // A non-conforming source may retain its pending read after abort.
    }
  }

  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch (error) {
    throw new InvalidArgumentError("Request body is not valid JSON", {
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}
