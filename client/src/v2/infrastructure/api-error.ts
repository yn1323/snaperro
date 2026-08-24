import type { DomainErrorCode, Problem } from "../contracts";

export type ClientErrorCode =
  | "ABORTED"
  | "NETWORK_ERROR"
  | "INVALID_REQUEST"
  | "INVALID_RESPONSE"
  | "HTTP_ERROR"
  | "RESPONSE_TOO_LARGE"
  | "STREAM_ERROR";

export type ApiErrorCode = DomainErrorCode | ClientErrorCode;

export interface ApiErrorOptions {
  code: ApiErrorCode;
  status?: number;
  retryable?: boolean;
  details?: Record<string, unknown>;
  cause?: unknown;
}

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number | null;
  readonly retryable: boolean;
  readonly details: Record<string, unknown> | undefined;
  readonly cause: unknown;

  constructor(message: string, options: ApiErrorOptions) {
    super(message);
    this.name = "ApiError";
    this.code = options.code;
    this.status = options.status ?? null;
    this.retryable = options.retryable ?? false;
    this.details = options.details;
    this.cause = options.cause;
  }

  static fromProblem(problem: Problem, status: number): ApiError {
    return new ApiError(problem.message, {
      code: problem.code,
      status,
      retryable: problem.retryable,
      details: problem.details,
    });
  }
}

export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

export function normalizeFetchError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (isAbortError(error)) {
    return new ApiError("The request was aborted", { code: "ABORTED", cause: error });
  }
  return new ApiError(error instanceof Error ? error.message : "Network request failed", {
    code: "NETWORK_ERROR",
    retryable: true,
    cause: error,
  });
}
