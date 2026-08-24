import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { EventSchema } from "../../../shared/contracts-v2/events.js";
import {
  EventIdSchema,
  EventSequenceSchema,
  RevisionSchema,
  RuntimeIdSchema,
} from "../../../shared/contracts-v2/primitives.js";
import type { EventHubPort, EventListener, QueryBusPort, WriteCoordinatorPort } from "../application/ports.js";
import { createEventStreamApi } from "./event-stream.js";

async function readUntil(reader: ReadableStreamDefaultReader<Uint8Array>, pattern: string): Promise<string> {
  const decoder = new TextDecoder();
  let result = "";
  while (!result.includes(pattern)) {
    const { done, value } = await reader.read();
    if (done) break;
    result += decoder.decode(value, { stream: true });
  }
  return result;
}

describe("v2 event stream", () => {
  it("rejects HEAD without opening a long-lived subscription", async () => {
    const runtimeId = RuntimeIdSchema.parse("run_1234567890abcdef");
    const events = {
      watermark: () => ({ runtimeId, sequence: EventSequenceSchema.parse(0), revision: RevisionSchema.parse(0) }),
      subscribeWithWatermark: vi.fn(),
    } as unknown as EventHubPort;
    const queries = { execute: vi.fn() } as unknown as QueryBusPort;
    const writes = {
      withCatalogWrite: (operation) => operation(),
      withScenarioWrite: (_scenarioId, operation) => operation(),
    } satisfies WriteCoordinatorPort;

    const response = await createEventStreamApi({ events, queries, writes }).request("/events", { method: "HEAD" });

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET");
    expect(events.subscribeWithWatermark).not.toHaveBeenCalled();
    expect(queries.execute).not.toHaveBeenCalled();
  });

  it("sends a snapshot before queued state events", async () => {
    const runtimeId = RuntimeIdSchema.parse("run_1234567890abcdef");
    let listener: EventListener | undefined;
    const unsubscribe = vi.fn(async () => {});
    const events = {
      watermark: () => ({ runtimeId, sequence: EventSequenceSchema.parse(0), revision: RevisionSchema.parse(0) }),
      subscribeWithWatermark: vi.fn(async (nextListener: EventListener) => {
        listener = nextListener;
        return { watermark: events.watermark(), unsubscribe };
      }),
    } as unknown as EventHubPort;
    const queries = {
      execute: vi.fn(async () => ({
        protocolVersion: 2,
        runtimeId,
        revision: RevisionSchema.parse(0),
        version: "2.0.0-test",
        mode: "smart",
        currentScenarioId: null,
        folders: {},
        scenarios: {},
      })),
    } as unknown as QueryBusPort;
    const writes = {
      withCatalogWrite: (operation) => operation(),
      withScenarioWrite: (_scenarioId, operation) => operation(),
    } satisfies WriteCoordinatorPort;
    const app = new Hono();
    app.route("/control", createEventStreamApi({ events, queries, writes, heartbeatMs: 100 }));

    const response = await app.request("/control/events");
    expect(response.status).toBe(200);
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    const connected = await readUntil(reader as ReadableStreamDefaultReader<Uint8Array>, "runtime.connected");
    expect(connected).toContain("event: runtime.connected");
    expect(connected).toContain('"mode":"smart"');

    const nextEvent = EventSchema.parse({
      protocolVersion: 2,
      runtimeId,
      id: EventIdSchema.parse("evt_1234567890abcdef"),
      sequence: EventSequenceSchema.parse(1),
      revision: RevisionSchema.parse(1),
      occurredAt: "2026-08-24T00:00:00.000Z",
      type: "mode.changed",
      payload: { mode: "record" },
    });
    await listener?.(nextEvent);
    const changed = await readUntil(reader as ReadableStreamDefaultReader<Uint8Array>, "mode.changed");
    expect(changed).toContain("event: mode.changed");

    const shuttingDown = EventSchema.parse({
      protocolVersion: 2,
      runtimeId,
      id: EventIdSchema.parse("evt_fedcba0987654321"),
      sequence: EventSequenceSchema.parse(2),
      revision: RevisionSchema.parse(1),
      occurredAt: "2026-08-24T00:00:01.000Z",
      type: "runtime.shutting-down",
      payload: { reason: "test complete" },
    });
    await listener?.(shuttingDown);
    const closed = await readUntil(reader as ReadableStreamDefaultReader<Uint8Array>, "runtime.shutting-down");
    expect(closed).toContain("event: runtime.shutting-down");
    await expect(reader?.read()).resolves.toEqual({ done: true, value: undefined });
    await vi.waitFor(() => expect(unsubscribe).toHaveBeenCalledOnce());
  });
});
