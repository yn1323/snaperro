import { z } from "zod/v4";
import {
  BodyRefSchema,
  FolderSchema,
  MAX_CATALOG_FOLDERS,
  MAX_CATALOG_SCENARIOS,
  RecordingSchema,
  RecordingSummarySchema,
  ScenarioSchema,
  ServerSnapshotSchema,
} from "./entities.js";
import {
  CursorSchema,
  FolderIdSchema,
  PageSizeSchema,
  RecordingIdSchema,
  RevisionSchema,
  ScenarioIdSchema,
  V2_SCHEMA_VERSION,
} from "./primitives.js";
import { DownloadTicketSchema, SafeDownloadFilenameSchema } from "./transfers.js";

export const QUERY_TYPES = [
  "runtime.snapshot",
  "folder.list",
  "folder.export",
  "scenario.list",
  "scenario.get",
  "recording.list",
  "recording.search",
  "recording.get",
  "recording.body",
  "recording.export",
  "body.download",
] as const;

export const QueryTypeSchema = z.enum(QUERY_TYPES);

const queryEnvelopeShape = { protocolVersion: z.literal(V2_SCHEMA_VERSION) };
const pageShape = {
  cursor: CursorSchema.optional(),
  limit: PageSizeSchema.default(50),
};

export const RuntimeSnapshotQuerySchema = z
  .object({ ...queryEnvelopeShape, type: z.literal("runtime.snapshot") })
  .strict();

export const ListFoldersQuerySchema = z.object({ ...queryEnvelopeShape, type: z.literal("folder.list") }).strict();

export const ExportFolderQuerySchema = z
  .object({ ...queryEnvelopeShape, type: z.literal("folder.export"), folderId: FolderIdSchema })
  .strict();

export const ListScenariosQuerySchema = z
  .object({ ...queryEnvelopeShape, type: z.literal("scenario.list"), folderId: FolderIdSchema.optional() })
  .strict();

export const GetScenarioQuerySchema = z
  .object({ ...queryEnvelopeShape, type: z.literal("scenario.get"), scenarioId: ScenarioIdSchema })
  .strict();

export const ListRecordingsQuerySchema = z
  .object({
    ...queryEnvelopeShape,
    ...pageShape,
    type: z.literal("recording.list"),
    scenarioId: ScenarioIdSchema,
  })
  .strict();

export const SearchRecordingsQuerySchema = z
  .object({
    ...queryEnvelopeShape,
    ...pageShape,
    type: z.literal("recording.search"),
    scenarioId: ScenarioIdSchema,
    text: z.string().trim().min(1).max(500),
  })
  .strict();

export const GetRecordingQuerySchema = z
  .object({
    ...queryEnvelopeShape,
    type: z.literal("recording.get"),
    scenarioId: ScenarioIdSchema,
    recordingId: RecordingIdSchema,
  })
  .strict();

export const GetRecordingBodyQuerySchema = z
  .object({
    ...queryEnvelopeShape,
    type: z.literal("recording.body"),
    scenarioId: ScenarioIdSchema,
    recordingId: RecordingIdSchema,
    target: z.enum(["request", "response"]),
  })
  .strict();

export const ExportRecordingQuerySchema = z
  .object({
    ...queryEnvelopeShape,
    type: z.literal("recording.export"),
    scenarioId: ScenarioIdSchema,
    recordingId: RecordingIdSchema,
  })
  .strict();

export const DownloadBodyQuerySchema = z
  .object({
    ...queryEnvelopeShape,
    type: z.literal("body.download"),
    body: BodyRefSchema,
    filename: SafeDownloadFilenameSchema,
  })
  .strict();

export const QuerySchema = z.discriminatedUnion("type", [
  RuntimeSnapshotQuerySchema,
  ListFoldersQuerySchema,
  ExportFolderQuerySchema,
  ListScenariosQuerySchema,
  GetScenarioQuerySchema,
  ListRecordingsQuerySchema,
  SearchRecordingsQuerySchema,
  GetRecordingQuerySchema,
  GetRecordingBodyQuerySchema,
  ExportRecordingQuerySchema,
  DownloadBodyQuerySchema,
]);

export type Query = z.infer<typeof QuerySchema>;
export type QueryType = Query["type"];
export type QueryOf<Type extends QueryType> = Extract<Query, { type: Type }>;

const revisionResultShape = { revision: RevisionSchema };
const recordingPageSchema = z
  .object({
    ...revisionResultShape,
    scenarioRevision: RevisionSchema,
    items: z.array(RecordingSummarySchema),
    nextCursor: CursorSchema.nullable(),
  })
  .strict();

export const QueryResultSchemas = {
  "runtime.snapshot": ServerSnapshotSchema,
  "folder.list": z.object({ ...revisionResultShape, folders: z.array(FolderSchema).max(MAX_CATALOG_FOLDERS) }).strict(),
  "folder.export": z
    .object({
      ...revisionResultShape,
      download: DownloadTicketSchema,
    })
    .strict(),
  "scenario.list": z
    .object({ ...revisionResultShape, scenarios: z.array(ScenarioSchema).max(MAX_CATALOG_SCENARIOS) })
    .strict(),
  "scenario.get": z.object({ ...revisionResultShape, scenario: ScenarioSchema }).strict(),
  "recording.list": recordingPageSchema,
  "recording.search": recordingPageSchema,
  "recording.get": z
    .object({ ...revisionResultShape, scenarioRevision: RevisionSchema, recording: RecordingSchema })
    .strict(),
  "recording.body": z
    .object({
      ...revisionResultShape,
      recordingId: RecordingIdSchema,
      target: z.enum(["request", "response"]),
      body: BodyRefSchema.nullable(),
    })
    .strict(),
  "recording.export": z.object({ ...revisionResultShape, download: DownloadTicketSchema }).strict(),
  "body.download": z.object({ ...revisionResultShape, download: DownloadTicketSchema }).strict(),
} satisfies Record<QueryType, z.ZodType>;

export type QueryResultMap = {
  [Type in QueryType]: z.infer<(typeof QueryResultSchemas)[Type]>;
};

export type QueryResult<Type extends QueryType> = QueryResultMap[Type];
