import { describe, expect, it } from "vitest";
import { RevisionSchema } from "../../../shared/contracts-v2/primitives.js";
import {
  DomainError,
  EntityNotFoundError,
  isDomainError,
  normalizeDomainError,
  RevisionConflictError,
} from "./errors.js";

describe("v2 domain errors", () => {
  it("serializes without introducing HTTP concerns", () => {
    const error = new EntityNotFoundError("Scenario", "scn_0123456789abcdef");

    expect(error.toProblem()).toEqual({
      code: "NOT_FOUND",
      message: "Scenario was not found",
      retryable: false,
      details: { entity: "Scenario", id: "scn_0123456789abcdef" },
    });
    expect("status" in error.toProblem()).toBe(false);
  });

  it("marks optimistic-concurrency failures as retryable", () => {
    const error = new RevisionConflictError(RevisionSchema.parse(2), RevisionSchema.parse(3));

    expect(error.code).toBe("REVISION_CONFLICT");
    expect(error.retryable).toBe(true);
    expect(error.details).toEqual({ expected: 2, actual: 3 });
    expect(Object.isFrozen(error.details)).toBe(true);
  });

  it("preserves known errors and normalizes unknown failures", () => {
    const known = new EntityNotFoundError("Folder", "fld_0123456789abcdef");
    expect(isDomainError(known)).toBe(true);
    expect(normalizeDomainError(known)).toBe(known);

    const cause = new Error("disk exploded");
    const normalized = normalizeDomainError(cause);
    expect(normalized).toBeInstanceOf(DomainError);
    expect(normalized.code).toBe("INTERNAL");
    expect(normalized.cause).toBe(cause);
  });
});
