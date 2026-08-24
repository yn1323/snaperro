import { z } from "zod/v4";
import { BodyRefSchema } from "./entities.js";
import { ByteSizeSchema, DisplayNameSchema, IsoDateTimeSchema, Sha256Schema, TransferIdSchema } from "./primitives.js";

function isSafeArchiveFilename(value: string): boolean {
  return Array.from(value).every((character) => {
    const codePoint = character.codePointAt(0);
    return (
      character !== "/" && character !== "\\" && codePoint !== undefined && codePoint >= 0x20 && codePoint !== 0x7f
    );
  });
}

export const SafeDownloadFilenameSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine(isSafeArchiveFilename, "Filename must not contain path separators or controls");

export const DownloadTicketSchema = z
  .object({
    downloadPath: z.string().regex(/^\/__snaperro__\/downloads\/[A-Za-z0-9_-]{43}$/u),
    expiresAt: IsoDateTimeSchema,
    filename: SafeDownloadFilenameSchema,
    mediaType: z.string().min(1).max(255),
    size: ByteSizeSchema,
  })
  .strict();

export type DownloadTicket = z.infer<typeof DownloadTicketSchema>;

/** Metadata derived from the raw body upload request headers. */
export const BodyUploadMetadataSchema = z
  .object({
    mediaType: z.string().min(1).max(255).nullable(),
    contentEncoding: z.string().min(1).max(100).nullable(),
  })
  .strict();

export type BodyUploadMetadata = z.infer<typeof BodyUploadMetadataSchema>;

/** The raw body upload endpoint returns the canonical content-addressed reference. */
export const BodyUploadResultSchema = BodyRefSchema;
export type BodyUploadResult = z.infer<typeof BodyUploadResultSchema>;

/** Metadata validated before streaming a folder archive into the import staging area. */
export const FolderImportUploadMetadataSchema = z
  .object({
    filename: SafeDownloadFilenameSchema,
    mediaType: z.literal("application/zip"),
  })
  .strict();

export type FolderImportUploadMetadata = z.infer<typeof FolderImportUploadMetadataSchema>;

export const StagedFolderImportSchema = z
  .object({
    transferId: TransferIdSchema,
    suggestedName: DisplayNameSchema,
    scenariosCount: z.number().int().nonnegative().safe(),
    size: ByteSizeSchema,
    sha256: Sha256Schema,
  })
  .strict();

export type StagedFolderImport = z.infer<typeof StagedFolderImportSchema>;

export const RecordingImportUploadMetadataSchema = z
  .object({
    filename: SafeDownloadFilenameSchema,
    mediaType: z.literal("application/zip"),
  })
  .strict();

export type RecordingImportUploadMetadata = z.infer<typeof RecordingImportUploadMetadataSchema>;

export const StagedRecordingImportSchema = z
  .object({
    transferId: TransferIdSchema,
    /** Logical recording name from the manifest; it is not used as a filesystem path or attachment filename. */
    filename: z.string().min(1).max(255),
    size: ByteSizeSchema,
    sha256: Sha256Schema,
  })
  .strict();

export type StagedRecordingImport = z.infer<typeof StagedRecordingImportSchema>;
