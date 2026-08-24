import {
  DEMO_RESPONSE_PREVIEW_LIMIT_BYTES,
  emptyResponsePreview,
  type ResponsePreview,
  readResponsePreview,
  responseHasBody,
} from "./response-preview";
import { type ErrorInfo, invalidJsonErrorInfo, problemErrorInfo, responseTooLargeErrorInfo } from "./traffic-errors";

export type DemoTrafficOutcome =
  | { response: { status: number; preview: ResponsePreview }; error: null }
  | { response: null; error: ErrorInfo };

export async function executeDemoTraffic(
  fetch: typeof globalThis.fetch,
  url: string,
  method: string,
  requestBody: unknown | undefined,
  signal: AbortSignal,
): Promise<DemoTrafficOutcome> {
  const hasRequestBody = requestBody !== undefined;
  const result = await fetch(url, {
    method,
    headers: hasRequestBody ? { "Content-Type": "application/json" } : undefined,
    body: hasRequestBody ? JSON.stringify(requestBody) : undefined,
    signal,
  });

  const hasResponseBody = responseHasBody(result.status);
  const preview = hasResponseBody ? await readResponsePreview(result) : emptyResponsePreview(0);
  let parsedBody: unknown = null;
  if (hasResponseBody && !preview.truncated) {
    try {
      parsedBody = JSON.parse(preview.text);
    } catch {
      return { response: null, error: invalidJsonErrorInfo(url, result.status, result.statusText) };
    }
  }

  if (!result.ok) {
    return {
      response: null,
      error: preview.truncated
        ? responseTooLargeErrorInfo(url, result.status, result.statusText, DEMO_RESPONSE_PREVIEW_LIMIT_BYTES)
        : problemErrorInfo(parsedBody, url, result.status, result.statusText),
    };
  }
  return { response: { status: result.status, preview }, error: null };
}

export interface LatestExecutionHandlers<Result> {
  onSuccess: (result: Result) => void;
  onError: (error: unknown) => void;
  onSettled: () => void;
}

/** Aborts superseded work and fences every asynchronous completion callback. */
export class LatestExecution {
  #generation = 0;
  #controller: AbortController | null = null;

  async run<Result>(
    operation: (signal: AbortSignal) => Promise<Result>,
    handlers: LatestExecutionHandlers<Result>,
  ): Promise<void> {
    const generation = ++this.#generation;
    this.#controller?.abort();
    const controller = new AbortController();
    this.#controller = controller;

    try {
      let result: Result;
      try {
        result = await operation(controller.signal);
      } catch (error) {
        if (generation === this.#generation) handlers.onError(error);
        return;
      }
      if (generation === this.#generation) handlers.onSuccess(result);
    } finally {
      if (generation === this.#generation) {
        this.#controller = null;
        handlers.onSettled();
      }
    }
  }

  cancel(): void {
    this.#generation += 1;
    this.#controller?.abort();
    this.#controller = null;
  }
}
