import type { DomainErrorCode, Problem } from "../../../shared/contracts-v2/errors.js";
import type { Revision } from "../../../shared/contracts-v2/primitives.js";

export interface DomainErrorOptions {
  cause?: unknown;
  details?: Readonly<Record<string, unknown>>;
  retryable?: boolean;
}

/** Framework-neutral failure returned by domain and application services. */
export class DomainError<Code extends DomainErrorCode = DomainErrorCode> extends Error {
  readonly code: Code;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly retryable: boolean;

  constructor(code: Code, message: string, options: DomainErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.code = code;
    this.details = options.details === undefined ? undefined : Object.freeze({ ...options.details });
    this.retryable = options.retryable ?? false;
  }

  toProblem(): Problem {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      ...(this.details === undefined ? {} : { details: { ...this.details } }),
    };
  }
}

export class InvalidArgumentError extends DomainError<"INVALID_ARGUMENT"> {
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("INVALID_ARGUMENT", message, { details });
  }
}

export class EntityNotFoundError extends DomainError<"NOT_FOUND"> {
  constructor(entity: string, id: string) {
    super("NOT_FOUND", `${entity} was not found`, { details: { entity, id } });
  }
}

export class EntityAlreadyExistsError extends DomainError<"ALREADY_EXISTS"> {
  constructor(entity: string, identity: string) {
    super("ALREADY_EXISTS", `${entity} already exists`, { details: { entity, identity } });
  }
}

export class RevisionConflictError extends DomainError<"REVISION_CONFLICT"> {
  constructor(expected: Revision, actual: Revision) {
    super("REVISION_CONFLICT", "The entity was changed by another operation", {
      details: { expected, actual },
      retryable: true,
    });
  }
}

export class InvariantViolationError extends DomainError<"INVARIANT_VIOLATION"> {
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("INVARIANT_VIOLATION", message, { details });
  }
}

export class StoreLockedError extends DomainError<"STORE_LOCKED"> {
  readonly storeRoot: string;
  readonly owner?: string;

  constructor(storeRoot: string, owner?: string) {
    // The filesystem path and lease token are useful to local diagnostics but
    // must not be serialized onto the user-traffic or control HTTP surface.
    super("STORE_LOCKED", "The v2 store is already in use", { retryable: true });
    this.storeRoot = storeRoot;
    this.owner = owner;
  }
}

export class MigrationRequiredError extends DomainError<"MIGRATION_REQUIRED"> {
  constructor(sourceRoot: string, options: { destinationRoot?: string; conflict?: boolean } = {}) {
    const message = options.conflict
      ? `Legacy v1 data conflicts with the existing v2 destination${
          options.destinationRoot ? ` at ${options.destinationRoot}` : ""
        }. Back up or move the destination, then run "snaperro migrate --dry-run" and "snaperro migrate".`
      : 'The v1 store must be migrated first. Run "snaperro migrate --dry-run" and then "snaperro migrate".';
    super("MIGRATION_REQUIRED", message, {
      details: {
        sourceRoot,
        ...(options.destinationRoot === undefined ? {} : { destinationRoot: options.destinationRoot }),
        conflict: options.conflict ?? false,
      },
    });
  }
}

export class MigrationFailedError extends DomainError<"MIGRATION_FAILED"> {
  constructor(message: string, options: DomainErrorOptions = {}) {
    super("MIGRATION_FAILED", message, options);
  }
}

export class PayloadLimitExceededError extends DomainError<"PAYLOAD_LIMIT_EXCEEDED"> {
  constructor(limitBytes: number, actualBytes?: number) {
    super("PAYLOAD_LIMIT_EXCEEDED", "The payload exceeds the configured limit", {
      details: { limitBytes, ...(actualBytes === undefined ? {} : { actualBytes }) },
    });
  }
}

export class AggregateLimitExceededError extends DomainError<"PAYLOAD_LIMIT_EXCEEDED"> {
  constructor(resource: string, limit: number, actual: number) {
    super("PAYLOAD_LIMIT_EXCEEDED", `The ${resource} aggregate exceeds the supported limit`, {
      details: { resource, limit, actual },
    });
  }
}

export class UpstreamUnavailableError extends DomainError<"UPSTREAM_UNAVAILABLE"> {
  constructor(message: string, cause?: unknown) {
    super("UPSTREAM_UNAVAILABLE", message, { cause, retryable: true });
  }
}

export class PersistenceError extends DomainError<"PERSISTENCE_FAILURE"> {
  constructor(message: string, cause?: unknown) {
    super("PERSISTENCE_FAILURE", message, { cause });
  }
}

export class OperationAbortedError extends DomainError<"ABORTED"> {
  constructor(message = "The operation was aborted", cause?: unknown) {
    super("ABORTED", message, { cause, retryable: true });
  }
}

export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}

export function normalizeDomainError(error: unknown): DomainError {
  if (isDomainError(error)) return error;
  return new DomainError("INTERNAL", "An unexpected error occurred", { cause: error });
}
