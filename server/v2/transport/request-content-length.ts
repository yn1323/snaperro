import type { Context } from "hono";
import { InvalidArgumentError, PayloadLimitExceededError } from "../domain/errors.js";

export function declaredContentLength(context: Context): number | null {
  const value = context.req.header("content-length");
  if (value === undefined) return null;
  if (!/^\d+$/u.test(value)) {
    throw new InvalidArgumentError("Content-Length must be a non-negative safe integer");
  }
  const size = Number(value);
  if (!Number.isSafeInteger(size)) {
    throw new InvalidArgumentError("Content-Length must be a non-negative safe integer");
  }
  return size;
}

export function assertDeclaredContentLengthWithinLimit(context: Context, maxBytes: number): void {
  const size = declaredContentLength(context);
  if (size !== null && size > maxBytes) throw new PayloadLimitExceededError(maxBytes, size);
}
