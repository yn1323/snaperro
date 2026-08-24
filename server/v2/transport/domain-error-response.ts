import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { normalizeDomainError } from "../domain/errors.js";
import { domainErrorHttpStatus } from "../domain/http-status.js";

export function domainErrorResponse(error: unknown, context: Context): Response {
  const domainError = normalizeDomainError(error);
  const status = domainErrorHttpStatus(domainError.code) as ContentfulStatusCode;
  if (domainError.retryable) context.header("Retry-After", "1");
  return context.json({ error: domainError.toProblem() }, status);
}
