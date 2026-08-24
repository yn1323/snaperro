import { EventSchema, ServerSnapshotSchema, V2_SCHEMA_VERSION } from "@snaperro/shared/contracts-v2/index.js";

export * from "@snaperro/shared/contracts-v2/index.js";

export { EventSchema as RealtimeEventSchema, ServerSnapshotSchema, V2_SCHEMA_VERSION as PROTOCOL_VERSION };
export type { Event as RealtimeEvent } from "@snaperro/shared/contracts-v2/index.js";

export function parseServerSnapshot(value: unknown) {
  return ServerSnapshotSchema.parse(value);
}

export function parseRealtimeEvent(value: unknown) {
  return EventSchema.parse(value);
}
