import { RevisionConflictError as DomainRevisionConflictError, PersistenceError } from "../domain/errors.js";

export class StoreCorruptionError extends PersistenceError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = "StoreCorruptionError";
  }
}

export { DomainRevisionConflictError as RevisionConflictError };
