import type { QueryResult } from "../../../shared/contracts-v2/queries.js";
import { InvariantViolationError } from "../domain/errors.js";
import type {
  EventHubPort,
  EventListener,
  EventWatermark,
  OperationContext,
  QueryBusPort,
  Unsubscribe,
  WriteCoordinatorPort,
} from "./ports.js";

export interface SnapshotSubscriptionDependencies {
  events: EventHubPort;
  queries: QueryBusPort;
  writes: WriteCoordinatorPort;
}

export interface SnapshotSubscription {
  snapshot: QueryResult<"runtime.snapshot">;
  watermark: EventWatermark;
  unsubscribe: Unsubscribe;
}

/**
 * Opens a realtime subscription at the exact catalog state returned by the
 * snapshot. State commands use the same write barrier, so none can commit in
 * the query-to-subscribe interval.
 */
export async function openSnapshotSubscription(
  dependencies: SnapshotSubscriptionDependencies,
  listener: EventListener,
  context: OperationContext = {},
): Promise<SnapshotSubscription> {
  return dependencies.writes.withCatalogWrite(async () => {
    const snapshot = await dependencies.queries.execute<"runtime.snapshot">(
      { protocolVersion: 2, type: "runtime.snapshot" },
      context,
    );
    const subscription = await dependencies.events.subscribeWithWatermark(listener, context);

    if (
      subscription.watermark.runtimeId !== snapshot.runtimeId ||
      subscription.watermark.revision > snapshot.revision
    ) {
      await subscription.unsubscribe().catch(() => undefined);
      throw new InvariantViolationError("Event watermark does not match the runtime snapshot", {
        snapshotRuntimeId: snapshot.runtimeId,
        eventRuntimeId: subscription.watermark.runtimeId,
        snapshotRevision: snapshot.revision,
        eventRevision: subscription.watermark.revision,
      });
    }
    return { snapshot, ...subscription };
  }, context);
}
