import { z } from "zod/v4";

/** Persistent format version for the v2 store and wire contracts. */
export const V2_SCHEMA_VERSION = 2 as const;
export const SchemaVersionSchema = z.literal(V2_SCHEMA_VERSION);

/**
 * Stable identifiers are opaque, type-prefixed values. Random UUID material is
 * used for new entities and a source-identity hash is used during migration.
 * Display names never participate in identity or storage paths.
 */
const opaqueId = <Prefix extends string, Brand extends string>(prefix: Prefix, _brand: Brand) =>
  z
    .string()
    .regex(new RegExp(`^${prefix}_[A-Za-z0-9_-]{16,128}$`, "u"))
    .brand<Brand>();

export const FolderIdSchema = opaqueId("fld", "FolderId");
export const ScenarioIdSchema = opaqueId("scn", "ScenarioId");
export const RecordingIdSchema = opaqueId("rec", "RecordingId");
export const RuntimeIdSchema = opaqueId("run", "RuntimeId");
export const CommandIdSchema = opaqueId("cmd", "CommandId");
export const RequestIdSchema = opaqueId("req", "RequestId");
export const TransferIdSchema = opaqueId("xfer", "TransferId");
export const EventIdSchema = opaqueId("evt", "EventId");

export type FolderId = z.infer<typeof FolderIdSchema>;
export type ScenarioId = z.infer<typeof ScenarioIdSchema>;
export type RecordingId = z.infer<typeof RecordingIdSchema>;
export type RuntimeId = z.infer<typeof RuntimeIdSchema>;
export type CommandId = z.infer<typeof CommandIdSchema>;
export type RequestId = z.infer<typeof RequestIdSchema>;
export type TransferId = z.infer<typeof TransferIdSchema>;
export type EventId = z.infer<typeof EventIdSchema>;

/** Revisions are persisted optimistic-concurrency tokens. */
export const RevisionSchema = z.number().int().nonnegative().safe().brand<"Revision">();
export const EventSequenceSchema = z.number().int().nonnegative().safe().brand<"EventSequence">();

export type Revision = z.infer<typeof RevisionSchema>;
export type EventSequence = z.infer<typeof EventSequenceSchema>;

export function nextRevision(revision: Revision): Revision {
  return RevisionSchema.parse(revision + 1);
}

export const IsoDateTimeSchema = z.iso.datetime({ offset: true });
export type IsoDateTime = z.infer<typeof IsoDateTimeSchema>;

function hasNoControlCharacters(value: string): boolean {
  return Array.from(value).every((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && codePoint >= 0x20 && codePoint !== 0x7f;
  });
}

export const DisplayNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine(hasNoControlCharacters, "Control characters are not allowed");

export const MAX_METADATA_COLLECTION_ENTRIES = 256;
export const MAX_METADATA_COMPONENT_BYTES = 8 * 1024;
export const MAX_METADATA_COLLECTION_BYTES = 256 * 1024;

const MetadataComponentSchema = z
  .string()
  .refine(
    (value) => new TextEncoder().encode(value).byteLength <= MAX_METADATA_COMPONENT_BYTES,
    `UTF-8 value must not exceed ${MAX_METADATA_COMPONENT_BYTES} bytes`,
  );

function aggregateUtf8Bytes(entries: Iterable<readonly [string, string]>): number {
  let total = 0;
  const encoder = new TextEncoder();
  for (const [name, value] of entries) total += encoder.encode(name).byteLength + encoder.encode(value).byteLength;
  return total;
}

function boundedMetadataFields(maxEntries = MAX_METADATA_COLLECTION_ENTRIES) {
  return z
    .array(z.tuple([MetadataComponentSchema, MetadataComponentSchema]))
    .max(maxEntries)
    .refine(
      (entries) => aggregateUtf8Bytes(entries) <= MAX_METADATA_COLLECTION_BYTES,
      `Combined UTF-8 metadata must not exceed ${MAX_METADATA_COLLECTION_BYTES} bytes`,
    );
}

export const HttpMethodSchema = z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]);
export type HttpMethod = z.infer<typeof HttpMethodSchema>;

export const FinalHttpStatusSchema = z.number().int().min(200).max(599);
export type FinalHttpStatus = z.infer<typeof FinalHttpStatusSchema>;

export const ModeSchema = z.enum(["proxy", "record", "mock", "smart"]);
export type Mode = z.infer<typeof ModeSchema>;

export const RoutePatternSchema = z.string().startsWith("/").min(1).max(2_048);
export const HttpHeaderNameSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/u, "Invalid HTTP header name");
export const HttpHeaderValueSchema = z
  .string()
  .max(8_192)
  .regex(/^[\t\x20-\x7e\x80-\xff]*$/u, "Invalid HTTP header value");
export const HttpReasonPhraseSchema = z
  .string()
  .max(1_024)
  .regex(/^[\t\x20-\x7e\x80-\xff]*$/u, "Invalid HTTP status text");
export const HeaderFieldsSchema = z
  .array(z.tuple([HttpHeaderNameSchema, HttpHeaderValueSchema]))
  .max(MAX_METADATA_COLLECTION_ENTRIES)
  .refine(
    (entries) => aggregateUtf8Bytes(entries) <= MAX_METADATA_COLLECTION_BYTES,
    `Combined UTF-8 headers must not exceed ${MAX_METADATA_COLLECTION_BYTES} bytes`,
  );
export const QueryFieldsSchema = boundedMetadataFields();
export const PathParamsSchema = z
  .record(MetadataComponentSchema, MetadataComponentSchema)
  .refine(
    (fields) => Object.keys(fields).length <= MAX_METADATA_COLLECTION_ENTRIES,
    `Path parameters must not exceed ${MAX_METADATA_COLLECTION_ENTRIES} entries`,
  )
  .refine(
    (fields) => aggregateUtf8Bytes(Object.entries(fields)) <= MAX_METADATA_COLLECTION_BYTES,
    `Combined UTF-8 path parameters must not exceed ${MAX_METADATA_COLLECTION_BYTES} bytes`,
  );

export type HeaderFields = z.infer<typeof HeaderFieldsSchema>;
export type QueryFields = z.infer<typeof QueryFieldsSchema>;
export type PathParams = z.infer<typeof PathParamsSchema>;

export const Sha256Schema = z
  .string()
  .regex(/^[a-f0-9]{64}$/u)
  .brand<"Sha256">();
export const RequestFingerprintSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/u)
  .brand<"RequestFingerprint">();

export type Sha256 = z.infer<typeof Sha256Schema>;
export type RequestFingerprint = z.infer<typeof RequestFingerprintSchema>;

export const ByteSizeSchema = z.number().int().nonnegative().safe();
export const HttpStatusSchema = z.number().int().min(100).max(599);
export const CursorSchema = z.string().min(1).max(2_048).brand<"Cursor">();
export const PageSizeSchema = z.number().int().min(1).max(200);

export type Cursor = z.infer<typeof CursorSchema>;
