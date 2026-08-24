import {
  type CatalogSnapshot,
  MAX_CATALOG_FOLDERS,
  MAX_CATALOG_SCENARIOS,
  type Recording,
} from "../../../shared/contracts-v2/entities.js";
import type { EventDraft, EventType } from "../../../shared/contracts-v2/events.js";
import { ByteSizeSchema, type Revision } from "../../../shared/contracts-v2/primitives.js";
import { AggregateLimitExceededError, RevisionConflictError } from "../domain/errors.js";
import type { EventHubPort, LoggerPort, OperationContext } from "./ports.js";

const DEFAULT_BEST_EFFORT_TIMEOUT_MS = 5_000;

export function canonicalName(name: string): string {
  return name.normalize("NFC").toLocaleLowerCase("en-US");
}

export function assertExpectedRevision(current: Revision, expected: Revision): void {
  if (current !== expected) throw new RevisionConflictError(expected, current);
}

export function assertExpectedCatalogRevision(catalog: CatalogSnapshot, expected: Revision): void {
  assertExpectedRevision(catalog.revision, expected);
}

export function assertAggregateLimit(resource: string, limit: number, actual: number): void {
  if (actual > limit) throw new AggregateLimitExceededError(resource, limit, actual);
}

export function assertCatalogCapacity(
  catalog: CatalogSnapshot,
  additions: { folders?: number; scenarios?: number },
): void {
  assertAggregateLimit("catalog folders", MAX_CATALOG_FOLDERS, catalog.folders.length + (additions.folders ?? 0));
  assertAggregateLimit(
    "catalog scenarios",
    MAX_CATALOG_SCENARIOS,
    catalog.scenarios.length + (additions.scenarios ?? 0),
  );
}

export function toRecordingSummary(recording: Recording) {
  const sizeBytes = ByteSizeSchema.parse((recording.request.body?.size ?? 0) + (recording.response.body?.size ?? 0));
  return {
    id: recording.id,
    scenarioId: recording.scenarioId,
    filename: recording.filename,
    endpoint: recording.route,
    method: recording.method,
    sizeBytes,
    updatedAt: recording.updatedAt,
    contentRevision: recording.revision,
  };
}

export async function publishCommittedEvent<Type extends EventType>(
  events: EventHubPort,
  logger: LoggerPort,
  draft: EventDraft<Type>,
  _context: OperationContext,
): Promise<void> {
  try {
    await events.publish(draft);
  } catch (error) {
    try {
      logger.error("State was committed but its realtime event could not be published", {
        eventType: draft.type,
        revision: draft.revision,
        error,
      });
    } catch {
      // Observability must never change the result of an already committed command.
    }
  }
}

export async function runBestEffortPostCommit(
  operation: () => Promise<unknown>,
  logger: LoggerPort,
  message: string,
  fields: Readonly<Record<string, unknown>> = {},
  timeoutMs: number = DEFAULT_BEST_EFFORT_TIMEOUT_MS,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const observed = Promise.resolve()
      .then(operation)
      .then(
        () => ({ status: "fulfilled" as const, error: undefined }),
        (error: unknown) => ({ status: "rejected" as const, error }),
      );
    const result = await Promise.race([
      observed,
      new Promise<{ status: "timed-out"; error: Error }>((resolve) => {
        timer = setTimeout(
          () =>
            resolve({
              status: "timed-out",
              error: new Error(`Best-effort cleanup did not settle within ${timeoutMs}ms`),
            }),
          timeoutMs,
        );
        timer.unref?.();
      }),
    ]);
    if (result.status === "fulfilled") return;
    try {
      logger.error(message, { ...fields, error: result.error });
    } catch {
      // Observability must never change the result of an already committed command.
    }
  } catch (error) {
    try {
      logger.error(message, { ...fields, error });
    } catch {
      // Observability must never change the result of an already committed command.
    }
  } finally {
    if (timer) clearTimeout(timer);
  }
}
