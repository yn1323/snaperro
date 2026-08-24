import path from "node:path";
import { z } from "zod/v4";
import { BodyRefSchema } from "../../../shared/contracts-v2/entities.js";
import {
  ByteSizeSchema,
  DisplayNameSchema,
  FolderIdSchema,
  IsoDateTimeSchema,
  RecordingIdSchema,
  ScenarioIdSchema,
  Sha256Schema,
} from "../../../shared/contracts-v2/primitives.js";
import { FileReadLimitError, MAX_MIGRATION_RECEIPT_BYTES, readFileBounded } from "./bounded-file.js";
import { StoreCorruptionError } from "./errors.js";

export const MIGRATION_RECEIPT_FILE = "migration-v1.json";

export const PersistedMigrationEntrySchema = z
  .object({
    sourceRelativePath: z.string().min(1),
    sourceSha256: Sha256Schema,
    sourceSize: ByteSizeSchema,
    folderName: DisplayNameSchema,
    folderId: FolderIdSchema,
    scenarioName: DisplayNameSchema,
    scenarioId: ScenarioIdSchema,
    logicalKey: z.string().min(1).max(255),
    recordingId: RecordingIdSchema,
    originalBlob: BodyRefSchema,
  })
  .strict()
  .superRefine((entry, context) => {
    if (entry.originalBlob.sha256 !== entry.sourceSha256 || entry.originalBlob.size !== entry.sourceSize) {
      context.addIssue({ code: "custom", message: "Original blob does not match the v1 source file" });
    }
  });

export const MigrationReceiptSchema = z
  .object({
    schemaVersion: z.literal(1),
    sourceFingerprint: Sha256Schema,
    sourceFiles: z.number().int().nonnegative().safe(),
    sourceBytes: ByteSizeSchema,
    entries: z.array(PersistedMigrationEntrySchema),
    completedAt: IsoDateTimeSchema,
  })
  .strict()
  .superRefine((receipt, context) => {
    const serializedBytes = Buffer.byteLength(`${JSON.stringify(receipt, null, 2)}\n`, "utf8");
    if (serializedBytes > MAX_MIGRATION_RECEIPT_BYTES) {
      context.addIssue({
        code: "custom",
        message: `Migration receipt must not exceed ${MAX_MIGRATION_RECEIPT_BYTES} serialized bytes`,
      });
      return;
    }
    if (receipt.entries.length !== receipt.sourceFiles) {
      context.addIssue({ code: "custom", message: "Migration entry count does not match sourceFiles" });
    }
    const totalBytes = receipt.entries.reduce((total, entry) => total + entry.sourceSize, 0);
    if (!Number.isSafeInteger(totalBytes) || totalBytes !== receipt.sourceBytes) {
      context.addIssue({ code: "custom", message: "Migration entry bytes do not match sourceBytes" });
    }
    const paths = new Set<string>();
    const recordingIds = new Set<string>();
    for (const [index, entry] of receipt.entries.entries()) {
      if (paths.has(entry.sourceRelativePath)) {
        context.addIssue({ code: "custom", message: "Source paths must be unique", path: ["entries", index] });
      }
      if (recordingIds.has(entry.recordingId)) {
        context.addIssue({ code: "custom", message: "Recording IDs must be unique", path: ["entries", index] });
      }
      paths.add(entry.sourceRelativePath);
      recordingIds.add(entry.recordingId);
    }
  });

export type MigrationReceipt = z.infer<typeof MigrationReceiptSchema>;

export async function readMigrationReceipt(root: string): Promise<MigrationReceipt | null> {
  const receiptPath = path.join(root, MIGRATION_RECEIPT_FILE);
  let raw: Buffer;
  try {
    raw = await readFileBounded(receiptPath, MAX_MIGRATION_RECEIPT_BYTES);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    if (error instanceof FileReadLimitError) {
      throw new StoreCorruptionError("The v1 migration receipt exceeds the read limit", error);
    }
    throw new StoreCorruptionError("Cannot read the v1 migration receipt", error);
  }

  let value: unknown;
  try {
    value = JSON.parse(raw.toString("utf8")) as unknown;
  } catch (error) {
    throw new StoreCorruptionError("The v1 migration receipt is not valid JSON", error);
  }
  const parsed = MigrationReceiptSchema.safeParse(value);
  if (!parsed.success) {
    throw new StoreCorruptionError(`The v1 migration receipt failed validation: ${parsed.error.message}`);
  }
  return parsed.data;
}
