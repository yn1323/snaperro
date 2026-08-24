import { z } from "zod/v4";
import { FolderSchema, RecordingDraftSchema, RecordingSchema, ScenarioSchema } from "./entities.js";
import {
  CommandIdSchema,
  DisplayNameSchema,
  FolderIdSchema,
  ModeSchema,
  RecordingIdSchema,
  RevisionSchema,
  ScenarioIdSchema,
  TransferIdSchema,
  V2_SCHEMA_VERSION,
} from "./primitives.js";

export const COMMAND_TYPES = [
  "mode.set",
  "scenario.select",
  "folder.create",
  "folder.rename",
  "folder.delete",
  "folder.import",
  "scenario.create",
  "scenario.rename",
  "scenario.duplicate",
  "scenario.delete",
  "recording.create",
  "recording.import",
  "recording.update",
  "recording.delete",
] as const;

export const CommandTypeSchema = z.enum(COMMAND_TYPES);

const commandEnvelopeShape = {
  protocolVersion: z.literal(V2_SCHEMA_VERSION),
  commandId: CommandIdSchema,
};

const catalogCommandShape = {
  ...commandEnvelopeShape,
  expectedRevision: RevisionSchema,
};

export const SetModeCommandSchema = z
  .object({ ...catalogCommandShape, type: z.literal("mode.set"), mode: ModeSchema })
  .strict();

export const SelectScenarioCommandSchema = z
  .object({
    ...catalogCommandShape,
    type: z.literal("scenario.select"),
    scenarioId: ScenarioIdSchema.nullable(),
  })
  .strict();

export const CreateFolderCommandSchema = z
  .object({ ...catalogCommandShape, type: z.literal("folder.create"), name: DisplayNameSchema })
  .strict();

export const RenameFolderCommandSchema = z
  .object({
    ...catalogCommandShape,
    type: z.literal("folder.rename"),
    folderId: FolderIdSchema,
    name: DisplayNameSchema,
  })
  .strict();

export const DeleteFolderCommandSchema = z
  .object({ ...catalogCommandShape, type: z.literal("folder.delete"), folderId: FolderIdSchema })
  .strict();

/** Commits a previously validated and staged archive import. */
export const ImportFolderCommandSchema = z
  .object({
    ...catalogCommandShape,
    type: z.literal("folder.import"),
    transferId: TransferIdSchema,
    name: DisplayNameSchema,
  })
  .strict();

export const CreateScenarioCommandSchema = z
  .object({
    ...catalogCommandShape,
    type: z.literal("scenario.create"),
    folderId: FolderIdSchema,
    name: DisplayNameSchema,
  })
  .strict();

export const RenameScenarioCommandSchema = z
  .object({
    ...catalogCommandShape,
    type: z.literal("scenario.rename"),
    scenarioId: ScenarioIdSchema,
    name: DisplayNameSchema,
  })
  .strict();

export const DuplicateScenarioCommandSchema = z
  .object({
    ...catalogCommandShape,
    type: z.literal("scenario.duplicate"),
    scenarioId: ScenarioIdSchema,
    destinationFolderId: FolderIdSchema,
    name: DisplayNameSchema,
  })
  .strict();

export const DeleteScenarioCommandSchema = z
  .object({ ...catalogCommandShape, type: z.literal("scenario.delete"), scenarioId: ScenarioIdSchema })
  .strict();

export const CreateRecordingCommandSchema = z
  .object({
    ...commandEnvelopeShape,
    type: z.literal("recording.create"),
    scenarioId: ScenarioIdSchema,
    expectedScenarioRevision: RevisionSchema,
    filename: z.string().min(1).max(255),
    recording: RecordingDraftSchema,
  })
  .strict();

export const ImportRecordingCommandSchema = z
  .object({
    ...commandEnvelopeShape,
    type: z.literal("recording.import"),
    scenarioId: ScenarioIdSchema,
    expectedScenarioRevision: RevisionSchema,
    transferId: TransferIdSchema,
  })
  .strict();

export const UpdateRecordingCommandSchema = z
  .object({
    ...commandEnvelopeShape,
    type: z.literal("recording.update"),
    scenarioId: ScenarioIdSchema,
    recordingId: RecordingIdSchema,
    expectedScenarioRevision: RevisionSchema,
    expectedContentRevision: RevisionSchema,
    filename: z.string().min(1).max(255),
    recording: RecordingDraftSchema,
  })
  .strict();

export const DeleteRecordingCommandSchema = z
  .object({
    ...commandEnvelopeShape,
    type: z.literal("recording.delete"),
    scenarioId: ScenarioIdSchema,
    recordingId: RecordingIdSchema,
    expectedScenarioRevision: RevisionSchema,
    expectedContentRevision: RevisionSchema,
  })
  .strict();

export const CommandSchema = z.discriminatedUnion("type", [
  SetModeCommandSchema,
  SelectScenarioCommandSchema,
  CreateFolderCommandSchema,
  RenameFolderCommandSchema,
  DeleteFolderCommandSchema,
  ImportFolderCommandSchema,
  CreateScenarioCommandSchema,
  RenameScenarioCommandSchema,
  DuplicateScenarioCommandSchema,
  DeleteScenarioCommandSchema,
  CreateRecordingCommandSchema,
  ImportRecordingCommandSchema,
  UpdateRecordingCommandSchema,
  DeleteRecordingCommandSchema,
]);

export type Command = z.infer<typeof CommandSchema>;
export type CommandType = Command["type"];
export type CommandOf<Type extends CommandType> = Extract<Command, { type: Type }>;

const revisionResultShape = { revision: RevisionSchema };

export const CommandResultSchemas = {
  "mode.set": z.object({ ...revisionResultShape, mode: ModeSchema }).strict(),
  "scenario.select": z.object({ ...revisionResultShape, currentScenarioId: ScenarioIdSchema.nullable() }).strict(),
  "folder.create": z.object({ ...revisionResultShape, folder: FolderSchema }).strict(),
  "folder.rename": z.object({ ...revisionResultShape, folder: FolderSchema }).strict(),
  "folder.delete": z
    .object({
      ...revisionResultShape,
      folderId: FolderIdSchema,
      deletedScenarioIds: z.array(ScenarioIdSchema),
    })
    .strict(),
  "folder.import": z
    .object({ ...revisionResultShape, folder: FolderSchema, recordingsInvalidated: z.literal(true) })
    .strict(),
  "scenario.create": z.object({ ...revisionResultShape, scenario: ScenarioSchema }).strict(),
  "scenario.rename": z.object({ ...revisionResultShape, scenario: ScenarioSchema }).strict(),
  "scenario.duplicate": z.object({ ...revisionResultShape, scenario: ScenarioSchema }).strict(),
  "scenario.delete": z.object({ ...revisionResultShape, scenarioId: ScenarioIdSchema }).strict(),
  "recording.create": z
    .object({ ...revisionResultShape, scenarioRevision: RevisionSchema, recording: RecordingSchema })
    .strict(),
  "recording.import": z
    .object({ ...revisionResultShape, scenarioRevision: RevisionSchema, recording: RecordingSchema })
    .strict(),
  "recording.update": z
    .object({ ...revisionResultShape, scenarioRevision: RevisionSchema, recording: RecordingSchema })
    .strict(),
  "recording.delete": z
    .object({
      ...revisionResultShape,
      scenarioRevision: RevisionSchema,
      scenarioId: ScenarioIdSchema,
      recordingId: RecordingIdSchema,
    })
    .strict(),
} satisfies Record<CommandType, z.ZodType>;

export type CommandResultMap = {
  [Type in CommandType]: z.infer<(typeof CommandResultSchemas)[Type]>;
};

export type CommandResult<Type extends CommandType> = CommandResultMap[Type];
