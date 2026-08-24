import { z } from "zod/v4";

export const DomainErrorCodeSchema = z.enum([
  "INVALID_ARGUMENT",
  "NOT_FOUND",
  "ALREADY_EXISTS",
  "REVISION_CONFLICT",
  "INVARIANT_VIOLATION",
  "STORE_LOCKED",
  "MIGRATION_REQUIRED",
  "MIGRATION_FAILED",
  "PAYLOAD_LIMIT_EXCEEDED",
  "ORIGIN_FORBIDDEN",
  "UNAUTHORIZED",
  "UPSTREAM_UNAVAILABLE",
  "PERSISTENCE_FAILURE",
  "ABORTED",
  "INTERNAL",
]);

export type DomainErrorCode = z.infer<typeof DomainErrorCodeSchema>;

export const ProblemSchema = z
  .object({
    code: DomainErrorCodeSchema,
    message: z.string().min(1),
    retryable: z.boolean(),
    details: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type Problem = z.infer<typeof ProblemSchema>;
