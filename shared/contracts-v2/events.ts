import { z } from "zod/v4";
import {
  FolderSummarySchema,
  RecordingSummarySchema,
  RequestLogSchema,
  ScenarioSummarySchema,
  ServerSnapshotSchema,
  SettledRequestRecordingOutcomeSchema,
} from "./entities.js";
import {
  CommandIdSchema,
  EventIdSchema,
  EventSequenceSchema,
  FolderIdSchema,
  IsoDateTimeSchema,
  ModeSchema,
  RecordingIdSchema,
  RequestIdSchema,
  RevisionSchema,
  RuntimeIdSchema,
  ScenarioIdSchema,
  V2_SCHEMA_VERSION,
} from "./primitives.js";

export const EVENT_TYPES = [
  "runtime.connected",
  "runtime.shutting-down",
  "mode.changed",
  "scenario.current-changed",
  "folder.upserted",
  "folder.deleted",
  "scenario.upserted",
  "scenario.deleted",
  "recording.upserted",
  "recording.deleted",
  "request.completed",
  "recording.outcome",
] as const;

export const STATE_EVENT_TYPES = [
  "mode.changed",
  "scenario.current-changed",
  "folder.upserted",
  "folder.deleted",
  "scenario.upserted",
  "scenario.deleted",
  "recording.upserted",
  "recording.deleted",
] as const;

export const EventTypeSchema = z.enum(EVENT_TYPES);
export const StateEventTypeSchema = z.enum(STATE_EVENT_TYPES);

const eventEnvelopeShape = {
  protocolVersion: z.literal(V2_SCHEMA_VERSION),
  runtimeId: RuntimeIdSchema,
  id: EventIdSchema,
  sequence: EventSequenceSchema,
  /** State revision after this event. Telemetry events retain the current revision. */
  revision: RevisionSchema,
  occurredAt: IsoDateTimeSchema,
  correlationId: CommandIdSchema.optional(),
};

function eventSchema<const Type extends string, Payload extends z.ZodType>(type: Type, payload: Payload) {
  return z.object({ ...eventEnvelopeShape, type: z.literal(type), payload }).strict();
}

export const RuntimeConnectedEventSchema = eventSchema("runtime.connected", ServerSnapshotSchema).superRefine(
  (event, context) => {
    if (event.runtimeId !== event.payload.runtimeId) {
      context.addIssue({ code: "custom", message: "Runtime IDs must match", path: ["payload", "runtimeId"] });
    }
    if (event.revision !== event.payload.revision) {
      context.addIssue({ code: "custom", message: "Snapshot revisions must match", path: ["payload", "revision"] });
    }
  },
);

export const RuntimeShuttingDownEventSchema = eventSchema(
  "runtime.shutting-down",
  z.object({ reason: z.string().min(1).max(500) }).strict(),
);
export const ModeChangedEventSchema = eventSchema("mode.changed", z.object({ mode: ModeSchema }).strict());
export const CurrentScenarioChangedEventSchema = eventSchema(
  "scenario.current-changed",
  z.object({ scenarioId: ScenarioIdSchema.nullable() }).strict(),
);
export const FolderUpsertedEventSchema = eventSchema(
  "folder.upserted",
  z
    .object({
      folder: FolderSummarySchema,
      /** Bulk catalog/recording metadata changed and consumers must install a fresh snapshot. */
      recordingsInvalidated: z.literal(true).optional(),
    })
    .strict(),
);
export const FolderDeletedEventSchema = eventSchema("folder.deleted", z.object({ folderId: FolderIdSchema }).strict());
export const ScenarioUpsertedEventSchema = eventSchema(
  "scenario.upserted",
  z
    .object({
      scenario: ScenarioSummarySchema,
      /** Bulk recording metadata changed and consumers must refresh this scenario page. */
      recordingsInvalidated: z.literal(true).optional(),
    })
    .strict(),
);
export const ScenarioDeletedEventSchema = eventSchema(
  "scenario.deleted",
  z.object({ scenarioId: ScenarioIdSchema }).strict(),
);
export const RecordingUpsertedEventSchema = eventSchema(
  "recording.upserted",
  z.object({ recording: RecordingSummarySchema, scenarioRevision: RevisionSchema }).strict(),
);
export const RecordingDeletedEventSchema = eventSchema(
  "recording.deleted",
  z.object({ recordingId: RecordingIdSchema, scenarioId: ScenarioIdSchema, scenarioRevision: RevisionSchema }).strict(),
);
export const RequestCompletedEventSchema = eventSchema("request.completed", RequestLogSchema);
export const RecordingOutcomeEventSchema = eventSchema(
  "recording.outcome",
  z
    .object({
      requestId: RequestIdSchema,
      scenarioId: ScenarioIdSchema,
      recordingOutcome: SettledRequestRecordingOutcomeSchema,
    })
    .strict(),
);

export const EventSchema = z.discriminatedUnion("type", [
  RuntimeConnectedEventSchema,
  RuntimeShuttingDownEventSchema,
  ModeChangedEventSchema,
  CurrentScenarioChangedEventSchema,
  FolderUpsertedEventSchema,
  FolderDeletedEventSchema,
  ScenarioUpsertedEventSchema,
  ScenarioDeletedEventSchema,
  RecordingUpsertedEventSchema,
  RecordingDeletedEventSchema,
  RequestCompletedEventSchema,
  RecordingOutcomeEventSchema,
]);

export type Event = z.infer<typeof EventSchema>;
export type EventType = Event["type"];
export type EventOf<Type extends EventType> = Extract<Event, { type: Type }>;

/** Event type to payload type. Adding an event without a payload mapping is impossible. */
export type EventMap = {
  [Type in EventType]: EventOf<Type>["payload"];
};

export type EventPayload<Type extends EventType> = EventMap[Type];
export type StateEvent = Extract<Event, { type: (typeof STATE_EVENT_TYPES)[number] }>;

export type EventDraft<Type extends EventType = EventType> = Type extends EventType
  ? Omit<EventOf<Type>, "id" | "occurredAt" | "protocolVersion" | "runtimeId" | "sequence">
  : never;
