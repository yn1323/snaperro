import { z } from "zod/v4";
import {
  MAX_CATALOG_SCENARIOS,
  MAX_SCENARIO_RECORDINGS,
  RecordingDraftSchema,
} from "../../../shared/contracts-v2/entities.js";
import { DisplayNameSchema, IsoDateTimeSchema, V2_SCHEMA_VERSION } from "../../../shared/contracts-v2/primitives.js";

export const FolderArchiveRecordingSchema = z
  .object({
    filename: z.string().min(1).max(255),
    matchable: z.boolean().default(true),
    recording: RecordingDraftSchema,
  })
  .strict();

export const FolderArchiveScenarioSchema = z
  .object({
    name: DisplayNameSchema,
    recordings: z.array(FolderArchiveRecordingSchema).max(MAX_SCENARIO_RECORDINGS),
  })
  .strict();

export const FolderArchiveSchema = z
  .object({
    format: z.literal("snaperro-folder"),
    formatVersion: z.literal(V2_SCHEMA_VERSION),
    exportedAt: IsoDateTimeSchema,
    folderName: DisplayNameSchema,
    scenarios: z.array(FolderArchiveScenarioSchema).max(MAX_CATALOG_SCENARIOS),
  })
  .strict()
  .superRefine((archive, context) => {
    const scenarioNames = new Set<string>();
    for (const [scenarioIndex, scenario] of archive.scenarios.entries()) {
      const scenarioName = scenario.name.normalize("NFC").toLocaleLowerCase("en-US");
      if (scenarioNames.has(scenarioName)) {
        context.addIssue({
          code: "custom",
          message: "Scenario names must be unique",
          path: ["scenarios", scenarioIndex, "name"],
        });
      }
      scenarioNames.add(scenarioName);

      const filenames = new Set<string>();
      for (const [recordingIndex, recording] of scenario.recordings.entries()) {
        const filename = recording.filename.normalize("NFC").toLocaleLowerCase("en-US");
        if (filenames.has(filename)) {
          context.addIssue({
            code: "custom",
            message: "Recording filenames must be unique within a scenario",
            path: ["scenarios", scenarioIndex, "recordings", recordingIndex, "filename"],
          });
        }
        filenames.add(filename);
      }
    }
  });

export type FolderArchive = z.infer<typeof FolderArchiveSchema>;

export const RecordingArchiveSchema = z
  .object({
    format: z.literal("snaperro-recording"),
    formatVersion: z.literal(V2_SCHEMA_VERSION),
    exportedAt: IsoDateTimeSchema,
    filename: z.string().min(1).max(255),
    recording: RecordingDraftSchema,
  })
  .strict();

export type RecordingArchive = z.infer<typeof RecordingArchiveSchema>;
