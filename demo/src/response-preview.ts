export const DEMO_RESPONSE_PREVIEW_LIMIT_BYTES = 512 * 1024;

export interface ResponsePreview {
  text: string;
  bytesRead: number;
  contentLength: number | null;
  truncated: boolean;
}

function responseContentLength(response: Response): number | null {
  const value = response.headers.get("content-length");
  if (!value) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function cancelWithoutWaiting(cancel: () => Promise<void>): void {
  try {
    void cancel().catch(() => undefined);
  } catch {
    // The bounded preview is already complete. Stream cleanup is best-effort
    // and must not leave the demo request pending indefinitely.
  }
}

export function emptyResponsePreview(contentLength: number | null = null): ResponsePreview {
  return { text: "", bytesRead: 0, contentLength, truncated: false };
}

export function responseHasBody(status: number): boolean {
  return status !== 204 && status !== 205 && status !== 304;
}

/**
 * Reads only the bounded prefix used by the demo UI. A declared oversized body
 * is cancelled before its first chunk, while an unknown-length body is
 * cancelled as soon as the limit is crossed.
 */
export async function readResponsePreview(
  response: Response,
  limit = DEMO_RESPONSE_PREVIEW_LIMIT_BYTES,
): Promise<ResponsePreview> {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new TypeError("Preview limit must be a positive safe integer");
  const contentLength = responseContentLength(response);
  if (contentLength !== null && contentLength > limit) {
    if (response.body) cancelWithoutWaiting(() => response.body?.cancel() ?? Promise.resolve());
    return { text: "", bytesRead: 0, contentLength, truncated: true };
  }
  if (!response.body) return emptyResponsePreview(contentLength);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let bytesRead = 0;
  let truncated = false;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const remaining = limit - bytesRead;
      if (value.byteLength > remaining) {
        if (remaining > 0) {
          chunks.push(decoder.decode(value.subarray(0, remaining), { stream: true }));
          bytesRead += remaining;
        }
        truncated = true;
        cancelWithoutWaiting(() => reader.cancel());
        break;
      }
      chunks.push(decoder.decode(value, { stream: true }));
      bytesRead += value.byteLength;
    }
    chunks.push(decoder.decode());
    return { text: chunks.join(""), bytesRead, contentLength, truncated };
  } finally {
    reader.releaseLock();
  }
}
