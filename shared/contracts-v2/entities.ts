import { z } from "zod/v4";
import { ProblemSchema } from "./errors.js";
import {
  ByteSizeSchema,
  DisplayNameSchema,
  FinalHttpStatusSchema,
  FolderIdSchema,
  HeaderFieldsSchema,
  HttpMethodSchema,
  HttpReasonPhraseSchema,
  IsoDateTimeSchema,
  ModeSchema,
  PathParamsSchema,
  QueryFieldsSchema,
  RecordingIdSchema,
  RequestFingerprintSchema,
  RequestIdSchema,
  RevisionSchema,
  RoutePatternSchema,
  RuntimeIdSchema,
  ScenarioIdSchema,
  SchemaVersionSchema,
  Sha256Schema,
  V2_SCHEMA_VERSION,
} from "./primitives.js";

export const BodyRefSchema = z
  .object({
    sha256: Sha256Schema,
    size: ByteSizeSchema,
    mediaType: z.string().min(1).max(255).nullable(),
    contentEncoding: z.string().min(1).max(100).nullable(),
  })
  .strict();

export type BodyRef = z.infer<typeof BodyRefSchema>;

export const FolderSchema = z
  .object({
    id: FolderIdSchema,
    name: DisplayNameSchema,
    revision: RevisionSchema,
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
  })
  .strict();

export type Folder = z.infer<typeof FolderSchema>;

export const FolderSummarySchema = FolderSchema.pick({ id: true, name: true });
export type FolderSummary = z.infer<typeof FolderSummarySchema>;

export const ScenarioSchema = z
  .object({
    id: ScenarioIdSchema,
    folderId: FolderIdSchema,
    name: DisplayNameSchema,
    revision: RevisionSchema,
    recordingsCount: z.number().int().nonnegative().safe(),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
  })
  .strict();

export type Scenario = z.infer<typeof ScenarioSchema>;

export const ScenarioSummarySchema = ScenarioSchema.pick({ id: true, folderId: true, name: true });
export type ScenarioSummary = z.infer<typeof ScenarioSummarySchema>;

export const RecordedRequestSchema = z
  .object({
    pathParams: PathParamsSchema,
    query: QueryFieldsSchema,
    headers: HeaderFieldsSchema,
    body: BodyRefSchema.nullable(),
  })
  .strict();

export const RecordedResponseSchema = z
  .object({
    status: FinalHttpStatusSchema,
    statusText: HttpReasonPhraseSchema,
    headers: HeaderFieldsSchema,
    body: BodyRefSchema.nullable(),
  })
  .strict();

export type RecordedRequest = z.infer<typeof RecordedRequestSchema>;
export type RecordedResponse = z.infer<typeof RecordedResponseSchema>;

export const RecordingDraftSchema = z
  .object({
    route: RoutePatternSchema,
    method: HttpMethodSchema,
    request: RecordedRequestSchema,
    response: RecordedResponseSchema,
  })
  .strict();

export type RecordingDraft = z.infer<typeof RecordingDraftSchema>;

export const RecordingSchema = RecordingDraftSchema.extend({
  requestFingerprint: RequestFingerprintSchema,
  /** False only for preserved data that must never participate in mock selection. */
  matchable: z.boolean().default(true),
  id: RecordingIdSchema,
  scenarioId: ScenarioIdSchema,
  filename: z.string().min(1).max(255),
  revision: RevisionSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
}).strict();

export type Recording = z.infer<typeof RecordingSchema>;

export const RecordingSummarySchema = z
  .object({
    id: RecordingIdSchema,
    scenarioId: ScenarioIdSchema,
    filename: z.string().min(1).max(255),
    endpoint: RoutePatternSchema,
    method: HttpMethodSchema,
    sizeBytes: ByteSizeSchema,
    updatedAt: IsoDateTimeSchema,
    contentRevision: RevisionSchema,
  })
  .strict();

export type RecordingSummary = z.infer<typeof RecordingSummarySchema>;

/** Transport and persistence bounds shared by every catalog/manifest writer. */
export const MAX_CATALOG_FOLDERS = 1_024;
export const MAX_CATALOG_SCENARIOS = 4_096;
export const MAX_SCENARIO_RECORDINGS = 1_000;
export const MAX_CATALOG_SERIALIZED_BYTES = 3 * 1024 * 1024;
export const MAX_SCENARIO_MANIFEST_BYTES = 16 * 1024 * 1024;

export function serializedJsonUtf8Bytes(value: unknown, pretty = false): number {
  return new TextEncoder().encode(JSON.stringify(value, null, pretty ? 2 : undefined)).byteLength;
}

function canonicalName(value: string): string {
  return value.normalize("NFC").toLocaleLowerCase("en-US");
}

export const ScenarioManifestSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    scenarioId: ScenarioIdSchema,
    revision: RevisionSchema,
    recordings: z.array(RecordingSchema).max(MAX_SCENARIO_RECORDINGS),
  })
  .strict()
  .superRefine((manifest, context) => {
    const serializedBytes = serializedJsonUtf8Bytes(manifest, true);
    if (serializedBytes > MAX_SCENARIO_MANIFEST_BYTES) {
      context.addIssue({
        code: "custom",
        message: `Scenario manifest must not exceed ${MAX_SCENARIO_MANIFEST_BYTES} serialized bytes`,
        path: ["recordings"],
      });
      return;
    }
    const ids = new Set<string>();
    const fingerprints = new Set<string>();
    const fingerprintFirstIndexes = new Map<string, number>();
    const filenames = new Set<string>();

    for (const [index, recording] of manifest.recordings.entries()) {
      if (recording.scenarioId !== manifest.scenarioId) {
        context.addIssue({
          code: "custom",
          message: "Recording belongs to a different scenario",
          path: ["recordings", index, "scenarioId"],
        });
      }
      if (ids.has(recording.id)) {
        context.addIssue({
          code: "custom",
          message: "Recording IDs must be unique",
          path: ["recordings", index, "id"],
        });
      }
      if (recording.matchable && fingerprints.has(recording.requestFingerprint)) {
        context.addIssue({
          code: "custom",
          message: "Request fingerprints must be unique within a scenario",
          path: ["recordings", index, "requestFingerprint"],
        });
      }
      const filenameKey = canonicalName(recording.filename);
      if (filenames.has(filenameKey)) {
        context.addIssue({
          code: "custom",
          message: "Recording filenames must be unique within a scenario",
          path: ["recordings", index, "filename"],
        });
      }
      ids.add(recording.id);
      if (!fingerprintFirstIndexes.has(recording.requestFingerprint)) {
        fingerprintFirstIndexes.set(recording.requestFingerprint, index);
      }
      if (recording.matchable) fingerprints.add(recording.requestFingerprint);
      filenames.add(filenameKey);
    }

    // Every persisted request identity has exactly one active mock candidate.
    // v1 duplicates remain present as non-matchable shadows and are promoted
    // atomically when their active winner disappears or changes identity.
    for (const [fingerprint, index] of fingerprintFirstIndexes) {
      if (!fingerprints.has(fingerprint)) {
        context.addIssue({
          code: "custom",
          message: "Each request fingerprint must have one matchable recording",
          path: ["recordings", index, "matchable"],
        });
      }
    }
  });

export type ScenarioManifest = z.infer<typeof ScenarioManifestSchema>;

export const CatalogSnapshotSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    revision: RevisionSchema,
    mode: ModeSchema,
    currentScenarioId: ScenarioIdSchema.nullable(),
    folders: z.array(FolderSchema).max(MAX_CATALOG_FOLDERS),
    scenarios: z.array(ScenarioSchema).max(MAX_CATALOG_SCENARIOS),
  })
  .strict()
  .superRefine((catalog, context) => {
    const serializedBytes = serializedJsonUtf8Bytes(catalog);
    if (serializedBytes > MAX_CATALOG_SERIALIZED_BYTES) {
      context.addIssue({
        code: "custom",
        message: `Catalog must not exceed ${MAX_CATALOG_SERIALIZED_BYTES} serialized bytes`,
      });
      return;
    }
    const folderIds = new Set<string>();
    const folderNames = new Set<string>();
    const scenarioIds = new Set<string>();
    const scenarioNamesByFolder = new Set<string>();

    for (const [index, folder] of catalog.folders.entries()) {
      if (folderIds.has(folder.id)) {
        context.addIssue({ code: "custom", message: "Folder IDs must be unique", path: ["folders", index, "id"] });
      }
      const folderNameKey = canonicalName(folder.name);
      if (folderNames.has(folderNameKey)) {
        context.addIssue({ code: "custom", message: "Folder names must be unique", path: ["folders", index, "name"] });
      }
      folderIds.add(folder.id);
      folderNames.add(folderNameKey);
    }

    for (const [index, scenario] of catalog.scenarios.entries()) {
      if (!folderIds.has(scenario.folderId)) {
        context.addIssue({
          code: "custom",
          message: "Scenario references an unknown folder",
          path: ["scenarios", index, "folderId"],
        });
      }
      if (scenarioIds.has(scenario.id)) {
        context.addIssue({ code: "custom", message: "Scenario IDs must be unique", path: ["scenarios", index, "id"] });
      }
      const nameKey = `${scenario.folderId}\u0000${canonicalName(scenario.name)}`;
      if (scenarioNamesByFolder.has(nameKey)) {
        context.addIssue({
          code: "custom",
          message: "Scenario names must be unique within a folder",
          path: ["scenarios", index, "name"],
        });
      }
      scenarioIds.add(scenario.id);
      scenarioNamesByFolder.add(nameKey);
    }

    if (catalog.currentScenarioId !== null && !scenarioIds.has(catalog.currentScenarioId)) {
      context.addIssue({
        code: "custom",
        message: "Current scenario must exist in the catalog",
        path: ["currentScenarioId"],
      });
    }
  });

export type CatalogSnapshot = z.infer<typeof CatalogSnapshotSchema>;

export const ServerSnapshotSchema = z
  .object({
    protocolVersion: z.literal(V2_SCHEMA_VERSION),
    runtimeId: RuntimeIdSchema,
    revision: RevisionSchema,
    version: z.string().min(1),
    mode: ModeSchema,
    currentScenarioId: ScenarioIdSchema.nullable(),
    folders: z
      .record(FolderIdSchema, FolderSummarySchema)
      .refine((folders) => Object.keys(folders).length <= MAX_CATALOG_FOLDERS, "Too many folders"),
    scenarios: z
      .record(ScenarioIdSchema, ScenarioSummarySchema)
      .refine((scenarios) => Object.keys(scenarios).length <= MAX_CATALOG_SCENARIOS, "Too many scenarios"),
  })
  .strict()
  .superRefine((snapshot, context) => {
    const serializedBytes = serializedJsonUtf8Bytes(snapshot);
    if (serializedBytes > MAX_CATALOG_SERIALIZED_BYTES) {
      context.addIssue({
        code: "custom",
        message: `Server snapshot must not exceed ${MAX_CATALOG_SERIALIZED_BYTES} serialized bytes`,
      });
      return;
    }
    for (const [id, folder] of Object.entries(snapshot.folders)) {
      if (id !== folder.id) {
        context.addIssue({ code: "custom", message: "Folder key must match its ID", path: ["folders", id, "id"] });
      }
    }
    for (const [id, scenario] of Object.entries(snapshot.scenarios)) {
      if (id !== scenario.id) {
        context.addIssue({ code: "custom", message: "Scenario key must match its ID", path: ["scenarios", id, "id"] });
      }
      if (!(scenario.folderId in snapshot.folders)) {
        context.addIssue({
          code: "custom",
          message: "Scenario references an unknown folder",
          path: ["scenarios", id, "folderId"],
        });
      }
    }
    if (snapshot.currentScenarioId !== null && !(snapshot.currentScenarioId in snapshot.scenarios)) {
      context.addIssue({
        code: "custom",
        message: "Current scenario must exist in the snapshot",
        path: ["currentScenarioId"],
      });
    }
  });

export type ServerSnapshot = z.infer<typeof ServerSnapshotSchema>;
export const RuntimeSnapshotSchema = ServerSnapshotSchema;
export type RuntimeSnapshot = ServerSnapshot;

export const RequestActionSchema = z.enum(["proxy", "record", "mock", "smart"]);
export const RequestSubActionSchema = z.enum(["proxy", "record", "mock"]);

export const RequestRecordingNotAttemptedSchema = z.object({ state: z.literal("not-attempted") }).strict();
export const RequestRecordingPendingSchema = z.object({ state: z.literal("pending") }).strict();
export const RequestRecordingSavedSchema = z
  .object({ state: z.literal("saved"), recordingId: RecordingIdSchema })
  .strict();
export const RequestRecordingFailedSchema = z.object({ state: z.literal("failed"), problem: ProblemSchema }).strict();
export const RequestRecordingOutcomeSchema = z.discriminatedUnion("state", [
  RequestRecordingNotAttemptedSchema,
  RequestRecordingPendingSchema,
  RequestRecordingSavedSchema,
  RequestRecordingFailedSchema,
]);
export const SettledRequestRecordingOutcomeSchema = z.discriminatedUnion("state", [
  RequestRecordingSavedSchema,
  RequestRecordingFailedSchema,
]);

export type RequestRecordingOutcome = z.infer<typeof RequestRecordingOutcomeSchema>;
export type SettledRequestRecordingOutcome = z.infer<typeof SettledRequestRecordingOutcomeSchema>;

export const RequestLogSchema = z
  .object({
    id: RequestIdSchema,
    timestamp: IsoDateTimeSchema,
    method: HttpMethodSchema,
    path: z.string().startsWith("/").max(8_192),
    action: RequestActionSchema,
    subAction: RequestSubActionSchema.optional(),
    status: FinalHttpStatusSchema,
    /** The recording selected for a mock hit; this never implies a write. */
    matchedRecordingId: RecordingIdSchema.optional(),
    /** Capture lifecycle for this traffic request, independent of a mock hit. */
    recordingOutcome: RequestRecordingOutcomeSchema,
    durationMs: z.number().nonnegative().finite(),
  })
  .strict();

export type RequestLog = z.infer<typeof RequestLogSchema>;
