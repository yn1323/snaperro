import type { DomainErrorCode } from "../../../shared/contracts-v2/errors.js";

const STATUS_BY_CODE = {
  INVALID_ARGUMENT: 400,
  NOT_FOUND: 404,
  ALREADY_EXISTS: 409,
  REVISION_CONFLICT: 409,
  INVARIANT_VIOLATION: 409,
  STORE_LOCKED: 423,
  MIGRATION_REQUIRED: 503,
  MIGRATION_FAILED: 500,
  PAYLOAD_LIMIT_EXCEEDED: 413,
  ORIGIN_FORBIDDEN: 403,
  UNAUTHORIZED: 401,
  UPSTREAM_UNAVAILABLE: 502,
  PERSISTENCE_FAILURE: 500,
  ABORTED: 408,
  INTERNAL: 500,
} as const satisfies Readonly<Record<DomainErrorCode, number>>;

export type DomainErrorHttpStatus = (typeof STATUS_BY_CODE)[DomainErrorCode];

export function domainErrorHttpStatus(code: DomainErrorCode): DomainErrorHttpStatus {
  return STATUS_BY_CODE[code];
}
