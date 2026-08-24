import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { type SSEStreamingApi, streamSSE } from "hono/streaming";
import { type Event, EventSchema } from "../../../shared/contracts-v2/events.js";
import { EventIdSchema } from "../../../shared/contracts-v2/primitives.js";
import { V2_RELATIVE_PATHS } from "../../../shared/contracts-v2/transport.js";
import type { EventHubPort, QueryBusPort, WriteCoordinatorPort } from "../application/ports.js";
import { openSnapshotSubscription } from "../application/snapshot-subscription.js";
import { domainErrorResponse } from "./domain-error-response.js";

export interface EventStreamDependencies {
  events: EventHubPort;
  queries: QueryBusPort;
  writes: WriteCoordinatorPort;
  heartbeatMs?: number;
  now?: () => string;
}

async function writeEvent(stream: SSEStreamingApi, event: Event): Promise<void> {
  await stream.writeSSE({
    id: event.id,
    event: event.type,
    data: JSON.stringify(event),
  });
}

function waitForHeartbeat(signal: AbortSignal, heartbeatMs: number): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", aborted);
      resolve(true);
    }, heartbeatMs);
    const aborted = () => {
      clearTimeout(timeout);
      resolve(false);
    };
    signal.addEventListener("abort", aborted, { once: true });
  });
}

export function createEventStreamApi(dependencies: EventStreamDependencies): Hono {
  const app = new Hono();
  const heartbeatMs = dependencies.heartbeatMs ?? 15_000;
  const now = dependencies.now ?? (() => new Date().toISOString());
  if (!Number.isSafeInteger(heartbeatMs) || heartbeatMs < 100) {
    throw new Error("heartbeatMs must be an integer of at least 100 milliseconds");
  }
  app.onError(domainErrorResponse);

  app.use(V2_RELATIVE_PATHS.events, async (context, next) => {
    if (context.req.method !== "HEAD") return next();
    context.header("Allow", "GET");
    return context.body(null, 405);
  });

  app.get(V2_RELATIVE_PATHS.events, (context) =>
    streamSSE(context, async (stream) => {
      const connectionController = new AbortController();
      stream.onAbort(() => connectionController.abort(new Error("SSE client disconnected")));

      let releaseSnapshot = () => {};
      const snapshotWritten = new Promise<void>((resolve) => {
        releaseSnapshot = resolve;
      });
      let writeQueue = Promise.resolve();
      const { snapshot, watermark, unsubscribe } = await openSnapshotSubscription(
        dependencies,
        async (event) => {
          writeQueue = writeQueue.then(async () => {
            await snapshotWritten;
            await writeEvent(stream, event);
            if (event.type === "runtime.shutting-down") {
              connectionController.abort(new Error("Runtime shut down"));
            }
          });
          try {
            await writeQueue;
          } catch (error) {
            connectionController.abort(error);
            throw error;
          }
        },
        { signal: connectionController.signal },
      );

      try {
        const connected = EventSchema.parse({
          protocolVersion: 2,
          runtimeId: snapshot.runtimeId,
          id: EventIdSchema.parse(`evt_${randomUUID().replaceAll("-", "")}`),
          sequence: watermark.sequence,
          revision: snapshot.revision,
          occurredAt: now(),
          type: "runtime.connected",
          payload: snapshot,
        });
        await writeEvent(stream, connected);
        releaseSnapshot();
        await writeQueue;

        while (await waitForHeartbeat(connectionController.signal, heartbeatMs)) {
          await stream.write(": keep-alive\n\n");
        }
      } finally {
        releaseSnapshot();
        await unsubscribe();
      }
    }),
  );

  return app;
}
