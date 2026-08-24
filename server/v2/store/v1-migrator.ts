import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  type BodyRef,
  BodyRefSchema,
  type CatalogSnapshot,
  CatalogSnapshotSchema,
  FolderSchema,
  type Recording,
  RecordingDraftSchema,
  RecordingSchema,
  type ScenarioManifest,
  ScenarioManifestSchema,
  ScenarioSchema,
} from "../../../shared/contracts-v2/entities.js";
import {
  type FolderId,
  HeaderFieldsSchema,
  HttpMethodSchema,
  IsoDateTimeSchema,
  QueryFieldsSchema,
  RequestFingerprintSchema,
  RevisionSchema,
  RoutePatternSchema,
  type ScenarioId,
  type Sha256,
  Sha256Schema,
  V2_SCHEMA_VERSION,
} from "../../../shared/contracts-v2/primitives.js";
import { assertCatalogSerializedLimit, assertScenarioManifestSerializedLimit } from "../domain/aggregate-limits.js";
import { normalizeRecordingRepresentation, responseAllowsBody } from "../domain/http-representation.js";
import {
  deriveRecordingRequestFingerprint,
  type FingerprintBody,
  requestFingerprint,
} from "../domain/request-fingerprint.js";
import { atomicWriteJson, fsyncDirectory } from "./atomic.js";
import { writeBlobBytes } from "./blob-store.js";
import { FilesystemStore, StoreCorruptionError } from "./filesystem-store.js";
import { migratedFolderId, migratedRecordingId, migratedScenarioId, normalizeDisplayName, sha256 } from "./ids.js";
import {
  MIGRATION_RECEIPT_FILE,
  type MigrationReceipt,
  MigrationReceiptSchema,
  readMigrationReceipt,
} from "./migration-receipt.js";
import type { ImportedV1State, MigrationEntry, MigrationIssue, MigrationScenario, V1MigrationReport } from "./types.js";

interface V1FileData {
  endpoint: string;
  method: string;
  request: {
    pathParams: Record<string, string>;
    queryParams: Record<string, string | string[]>;
    headers: Record<string, string>;
    body: unknown;
  };
  response: {
    status: number;
    headers: Record<string, string>;
    body: unknown;
  };
}

interface SourceFile {
  absolutePath: string;
  relativePath: string;
  size: number;
  sha256: Sha256;
}

interface SourceInventory {
  files: SourceFile[];
  directories: string[];
  emptyLeafDirectories: string[];
  fingerprint: Sha256;
  bytes: number;
  warnings: MigrationIssue[];
}

interface PreparedMigration {
  inventory: SourceInventory;
  sourceFingerprint: Sha256;
  stateFile: string;
  limits: V1MigrationReadLimits;
  entries: MigrationEntry[];
  scenarios: MigrationScenario[];
  warnings: MigrationIssue[];
  errors: MigrationIssue[];
  matchability: Map<string, boolean>;
  importedState?: ImportedV1State;
}

interface LegacyScenarioLocation extends MigrationScenario {
  folderSourceIdentity: string;
  scenarioSourceIdentity: string;
}

interface EncodedLegacyBody {
  bytes: Uint8Array;
  mediaType: string;
  contentEncoding: string | null;
  fingerprintBody: FingerprintBody;
}

const MIGRATION_PREVIEW_TIMESTAMP = IsoDateTimeSchema.parse("2000-01-01T00:00:00.000Z");
const HASH_CHUNK_BYTES = 64 * 1024;

export interface V1MigrationReadLimits {
  maxRecordingFileBytes: number;
  maxStateFileBytes: number;
}

export const DEFAULT_V1_MIGRATION_READ_LIMITS: Readonly<V1MigrationReadLimits> = Object.freeze({
  // v1 embeds both request and response bodies in one JSON document. This
  // matches the v2 request capture ceiling while keeping JSON.parse memory
  // bounded; larger legacy responses must be handled explicitly, not guessed.
  maxRecordingFileBytes: 256 * 1024 * 1024,
  // v1 state contains only mode and currentScenario. 1 MiB is deliberately
  // generous for valid state while preventing an unrelated file from being
  // loaded as state.
  maxStateFileBytes: 1024 * 1024,
});

function isNotFound(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function errorValue(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function resolveReadLimits(limits: Partial<V1MigrationReadLimits> | undefined): V1MigrationReadLimits {
  const resolved = {
    ...DEFAULT_V1_MIGRATION_READ_LIMITS,
    ...limits,
  };
  for (const [name, value] of Object.entries(resolved)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`${name} must be a positive safe integer`);
    }
  }
  return resolved;
}

function sizeLimitMessage(kind: "recording JSON" | "state JSON", actual: number, maximum: number): string {
  return `Legacy ${kind} exceeds the migration read limit: ${actual} bytes > ${maximum} bytes`;
}

async function hashRegularFileStreaming(filePath: string): Promise<{ digest: Sha256; size: number }> {
  const handle = await fs.open(filePath, "r");
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error(`Not a regular file: ${filePath}`);
    if (!Number.isSafeInteger(stat.size) || stat.size < 0) throw new Error(`Invalid file size: ${filePath}`);

    const hash = createHash("sha256");
    const chunk = Buffer.allocUnsafe(HASH_CHUNK_BYTES);
    let position = 0;
    while (position < stat.size) {
      const length = Math.min(chunk.byteLength, stat.size - position);
      const { bytesRead } = await handle.read(chunk, 0, length, position);
      if (bytesRead === 0) throw new Error(`Source file changed while hashing: ${filePath}`);
      hash.update(chunk.subarray(0, bytesRead));
      position += bytesRead;
    }

    const probe = Buffer.allocUnsafe(1);
    if ((await handle.read(probe, 0, 1, position)).bytesRead !== 0) {
      throw new Error(`Source file changed while hashing: ${filePath}`);
    }
    return { digest: Sha256Schema.parse(hash.digest("hex")), size: position };
  } finally {
    await handle.close();
  }
}

async function readRegularFileBounded(filePath: string, maximum: number): Promise<Buffer> {
  const handle = await fs.open(filePath, "r");
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error(`Not a regular file: ${filePath}`);
    if (!Number.isSafeInteger(stat.size) || stat.size < 0) throw new Error(`Invalid file size: ${filePath}`);
    if (stat.size > maximum) throw new Error(`File exceeds the read limit: ${stat.size} bytes > ${maximum} bytes`);

    const raw = Buffer.alloc(stat.size);
    let position = 0;
    while (position < raw.byteLength) {
      const { bytesRead } = await handle.read(raw, position, raw.byteLength - position, position);
      if (bytesRead === 0) throw new Error(`Source file changed while reading: ${filePath}`);
      position += bytesRead;
    }

    const probe = Buffer.allocUnsafe(1);
    if ((await handle.read(probe, 0, 1, position)).bytesRead !== 0) {
      throw new Error(`Source file changed while reading: ${filePath}`);
    }
    return raw;
  } finally {
    await handle.close();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === "string");
}

function isQueryRecord(value: unknown): value is Record<string, string | string[]> {
  return (
    isRecord(value) &&
    Object.values(value).every(
      (entry) => typeof entry === "string" || (Array.isArray(entry) && entry.every((item) => typeof item === "string")),
    )
  );
}

function parseV1FileData(value: unknown): V1FileData {
  if (!isRecord(value) || typeof value.endpoint !== "string" || typeof value.method !== "string") {
    throw new Error("Missing endpoint or method");
  }
  if (!isRecord(value.request)) throw new Error("Missing request object");
  if (!isStringRecord(value.request.pathParams)) throw new Error("Invalid request.pathParams");
  if (!isQueryRecord(value.request.queryParams)) throw new Error("Invalid request.queryParams");
  if (!isStringRecord(value.request.headers)) throw new Error("Invalid request.headers");
  if (!("body" in value.request)) throw new Error("Missing request.body");

  if (!isRecord(value.response)) throw new Error("Missing response object");
  if (
    !Number.isInteger(value.response.status) ||
    Number(value.response.status) < 200 ||
    Number(value.response.status) > 599
  ) {
    throw new Error("Invalid response.status");
  }
  if (!isStringRecord(value.response.headers)) throw new Error("Invalid response.headers");
  if (!("body" in value.response)) throw new Error("Missing response.body");

  return value as unknown as V1FileData;
}

function decodeLegacyPathParams(pathParams: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(pathParams).map(([name, value]) => {
      try {
        return [name, decodeURIComponent(value)];
      } catch (error) {
        throw new Error(`Invalid percent-encoding in request.pathParams[${JSON.stringify(name)}]`, { cause: error });
      }
    }),
  );
}

function headerValue(headers: Record<string, string>, name: string): string | null {
  const match = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return match?.[1] || null;
}

function isJsonMediaType(mediaType: string): boolean {
  const essence = mediaType.split(";", 1)[0].trim().toLowerCase();
  return essence === "application/json" || essence.endsWith("+json");
}

function encodeLegacyBody(value: unknown, headers: Record<string, string>): EncodedLegacyBody {
  const mediaType = headerValue(headers, "content-type") ?? "application/json";
  // v1 persisted the value returned by Fetch's decoded body readers while
  // retaining the upstream wire headers. The serialized migration bytes are
  // therefore an identity representation regardless of the legacy header.
  const contentEncoding = null;
  if (isJsonMediaType(mediaType)) {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new Error("Legacy JSON body cannot be serialized");
    return {
      bytes: Buffer.from(serialized, "utf8"),
      mediaType,
      contentEncoding,
      fingerprintBody: { kind: "json", value },
    };
  }

  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  if (serialized === undefined) throw new Error("Legacy body cannot be serialized");
  const bytes = Buffer.from(serialized, "utf8");
  return {
    bytes,
    mediaType,
    contentEncoding,
    fingerprintBody: { kind: "raw", sha256: sha256(bytes) },
  };
}

function headerFields(headers: Record<string, string>): Array<[string, string]> {
  return Object.entries(headers);
}

function queryFields(query: Record<string, string | string[]>): Array<[string, string]> {
  return Object.entries(query).flatMap(([name, value]) =>
    typeof value === "string"
      ? [[name, value] as [string, string]]
      : value.map((item): [string, string] => [name, item]),
  );
}

function previewBody(value: unknown, headers: Record<string, string>): BodyRef {
  const encoded = encodeLegacyBody(value, headers);
  return BodyRefSchema.parse({
    sha256: sha256(encoded.bytes),
    size: encoded.bytes.byteLength,
    mediaType: encoded.mediaType,
    contentEncoding: encoded.contentEncoding,
  });
}

function migrationRecordingDraft(data: V1FileData, requestBody: BodyRef | null, responseBody: BodyRef | null) {
  return normalizeRecordingRepresentation(
    RecordingDraftSchema.parse({
      route: data.endpoint,
      method: data.method.toUpperCase(),
      request: {
        pathParams: data.request.pathParams,
        query: queryFields(data.request.queryParams),
        headers: headerFields(data.request.headers),
        body: requestBody,
      },
      response: {
        status: data.response.status,
        statusText: "",
        headers: headerFields(data.response.headers),
        body: responseBody,
      },
    }),
  );
}

function previewRecording(
  data: V1FileData,
  entry: MigrationEntry,
  matchable: boolean,
  timestamp = MIGRATION_PREVIEW_TIMESTAMP,
): Recording {
  const requestBody = data.request.body === null ? null : previewBody(data.request.body, data.request.headers);
  const responseBody = responseAllowsBody(data.method, data.response.status)
    ? previewBody(data.response.body, data.response.headers)
    : null;
  return RecordingSchema.parse({
    ...migrationRecordingDraft(data, requestBody, responseBody),
    id: entry.recordingId,
    scenarioId: entry.scenarioId,
    filename: entry.logicalKey,
    requestFingerprint: RequestFingerprintSchema.parse(legacyRequestFingerprint(data)),
    matchable,
    revision: RevisionSchema.parse(0),
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

function migrationManifest(scenario: MigrationScenario, recordings: readonly Recording[]): ScenarioManifest {
  const manifest = ScenarioManifestSchema.parse({
    schemaVersion: V2_SCHEMA_VERSION,
    scenarioId: scenario.scenarioId,
    revision: RevisionSchema.parse(0),
    recordings: [...recordings],
  });
  assertScenarioManifestSerializedLimit(manifest);
  return manifest;
}

function migrationCatalog(
  scenarios: readonly MigrationScenario[],
  recordingsByScenario: ReadonlyMap<ScenarioId, readonly Recording[]>,
  importedState: ImportedV1State | undefined,
  timestamp: string,
): CatalogSnapshot {
  const folders = new Map<FolderId, MigrationScenario>();
  for (const scenario of scenarios) folders.set(scenario.folderId, scenario);
  const currentScenarioId = importedState?.currentScenario
    ? (scenarios.find((scenario) => scenario.sourceScenarioPath === importedState.currentScenario)?.scenarioId ?? null)
    : null;
  const catalog = CatalogSnapshotSchema.parse({
    schemaVersion: V2_SCHEMA_VERSION,
    revision: RevisionSchema.parse(1),
    mode: importedState?.mode ?? "smart",
    currentScenarioId,
    folders: [...folders.values()].map((folder) =>
      FolderSchema.parse({
        id: folder.folderId,
        name: folder.folderName,
        revision: RevisionSchema.parse(0),
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    ),
    scenarios: scenarios.map((scenario) =>
      ScenarioSchema.parse({
        id: scenario.scenarioId,
        folderId: scenario.folderId,
        name: scenario.scenarioName,
        revision: RevisionSchema.parse(0),
        recordingsCount: recordingsByScenario.get(scenario.scenarioId)?.length ?? 0,
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    ),
  });
  assertCatalogSerializedLimit(catalog);
  return catalog;
}

function mapLegacyScenario(pathSegments: readonly string[]): LegacyScenarioLocation {
  if (pathSegments.length === 0) throw new Error("Scenario path is empty");
  const normalizedSegments = pathSegments.map((segment) => normalizeDisplayName(segment));
  const sourceScenarioPath = pathSegments.join("/");

  if (normalizedSegments.length === 1) {
    const scenarioName = normalizedSegments[0];
    const folderName = normalizeDisplayName(`_${scenarioName}`);
    const folderSourceIdentity = `flat-folder:${pathSegments[0]}`;
    const scenarioSourceIdentity = `flat-scenario:${pathSegments[0]}`;
    return {
      sourceScenarioPath,
      folderName,
      folderId: migratedFolderId(folderSourceIdentity),
      scenarioName,
      scenarioId: migratedScenarioId(scenarioSourceIdentity),
      folderSourceIdentity,
      scenarioSourceIdentity,
    };
  }

  const folderName = normalizedSegments[0];
  const scenarioName = normalizeDisplayName(normalizedSegments.slice(1).join("/"));
  const folderSourceIdentity = `nested-folder:${pathSegments[0]}`;
  const scenarioSourceIdentity = `nested-scenario:${sourceScenarioPath}`;
  return {
    sourceScenarioPath,
    folderName,
    folderId: migratedFolderId(folderSourceIdentity),
    scenarioName,
    scenarioId: migratedScenarioId(scenarioSourceIdentity),
    folderSourceIdentity,
    scenarioSourceIdentity,
  };
}

async function loadV1File(
  file: SourceFile,
  maxRecordingFileBytes: number,
): Promise<{ raw: Uint8Array; data: V1FileData }> {
  if (file.size > maxRecordingFileBytes) {
    throw new Error(sizeLimitMessage("recording JSON", file.size, maxRecordingFileBytes));
  }
  const raw = await readRegularFileBounded(file.absolutePath, maxRecordingFileBytes);
  if (raw.byteLength !== file.size) throw new Error(`Source file changed: ${file.relativePath}`);
  if (sha256(raw) !== file.sha256) throw new Error(`Source file changed: ${file.relativePath}`);
  const data = parseV1FileData(JSON.parse(raw.toString("utf8")) as unknown);
  return {
    raw,
    data: {
      ...data,
      request: {
        ...data.request,
        // v1 stored regex captures from URL.pathname without decoding them.
        // v2 RouteTable decodes one time before fingerprinting and persistence.
        pathParams: decodeLegacyPathParams(data.request.pathParams),
      },
    },
  };
}

function legacyRequestFingerprint(data: V1FileData): string {
  const body =
    data.request.body === null
      ? ({ kind: "empty" } satisfies FingerprintBody)
      : encodeLegacyBody(data.request.body, data.request.headers).fingerprintBody;
  return requestFingerprint({
    method: data.method,
    route: data.endpoint,
    pathParams: data.request.pathParams,
    query: queryFields(data.request.queryParams),
    body,
  });
}

export interface V1MigrationOptions {
  sourceRoot: string;
  destinationRoot: string;
  dryRun?: boolean;
  stateFile?: string;
  readLimits?: Partial<V1MigrationReadLimits>;
}

export class V1MigrationError extends Error {
  constructor(
    message: string,
    readonly report: V1MigrationReport,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "V1MigrationError";
  }
}

function toPosix(relativePath: string): string {
  return relativePath.split(path.sep).join("/");
}

function compareCodeUnits(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function isInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

async function canonicalFuturePath(target: string): Promise<string> {
  let existingAncestor = path.resolve(target);
  const missingSegments: string[] = [];
  while (true) {
    try {
      return path.resolve(await fs.realpath(existingAncestor), ...missingSegments);
    } catch (error) {
      if (!isNotFound(error)) throw error;
      const parent = path.dirname(existingAncestor);
      if (parent === existingAncestor) throw error;
      missingSegments.unshift(path.basename(existingAncestor));
      existingAncestor = parent;
    }
  }
}

async function inventorySource(sourceRoot: string): Promise<SourceInventory> {
  const files: SourceFile[] = [];
  const directories: string[] = [];
  const emptyLeafDirectories: string[] = [];
  const warnings: MigrationIssue[] = [];
  const fingerprintEntries: string[] = [];

  const walk = async (directory: string): Promise<void> => {
    const relativeDirectory = toPosix(path.relative(sourceRoot, directory));
    const entries = (await fs.readdir(directory, { withFileTypes: true })).sort((left, right) =>
      compareCodeUnits(left.name, right.name),
    );
    if (relativeDirectory) {
      directories.push(relativeDirectory);
      fingerprintEntries.push(`d\0${relativeDirectory}`);
    }

    let childDirectories = 0;
    let jsonFiles = 0;
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      const relativePath = toPosix(path.relative(sourceRoot, absolutePath));
      if (entry.isSymbolicLink()) {
        const target = await fs.readlink(absolutePath).catch(() => "<unreadable>");
        fingerprintEntries.push(`l\0${relativePath}\0${target}`);
        warnings.push({ path: relativePath, message: "Symbolic link skipped" });
        continue;
      }
      if (entry.isDirectory()) {
        childDirectories += 1;
        await walk(absolutePath);
        continue;
      }
      if (!entry.isFile()) {
        fingerprintEntries.push(`s\0${relativePath}`);
        warnings.push({ path: relativePath, message: "Non-regular file skipped" });
        continue;
      }

      const hashed = await hashRegularFileStreaming(absolutePath);
      fingerprintEntries.push(`f\0${relativePath}\0${hashed.size}\0${hashed.digest}`);
      if (!entry.name.toLowerCase().endsWith(".json")) {
        if (entry.name !== ".gitkeep") warnings.push({ path: relativePath, message: "Non-JSON file skipped" });
        continue;
      }

      jsonFiles += 1;
      files.push({ absolutePath, relativePath, size: hashed.size, sha256: hashed.digest });
    }

    if (relativeDirectory && childDirectories === 0 && jsonFiles === 0) {
      emptyLeafDirectories.push(relativeDirectory);
    }
  };

  await walk(sourceRoot);
  files.sort((left, right) => compareCodeUnits(left.relativePath, right.relativePath));
  directories.sort();
  emptyLeafDirectories.sort();
  fingerprintEntries.sort();
  return {
    files,
    directories,
    emptyLeafDirectories,
    fingerprint: sha256(fingerprintEntries.join("\n")),
    bytes: files.reduce((total, file) => total + file.size, 0),
    warnings,
  };
}

async function readV1State(
  stateFile: string,
  maxStateFileBytes: number,
): Promise<{ state?: ImportedV1State; warning?: MigrationIssue; error?: MigrationIssue; fingerprint: string }> {
  let hashed: { digest: Sha256; size: number };
  try {
    hashed = await hashRegularFileStreaming(stateFile);
  } catch (error) {
    if (isNotFound(error)) return { fingerprint: "missing" };
    return {
      error: {
        path: stateFile,
        message: `Cannot read v1 state: ${error instanceof Error ? error.message : String(error)}`,
      },
      fingerprint: `unreadable:${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const fingerprint = hashed.digest;
  if (hashed.size > maxStateFileBytes) {
    return {
      error: {
        path: stateFile,
        message: sizeLimitMessage("state JSON", hashed.size, maxStateFileBytes),
      },
      fingerprint,
    };
  }

  let raw: Buffer;
  try {
    raw = await readRegularFileBounded(stateFile, maxStateFileBytes);
  } catch (error) {
    return {
      error: {
        path: stateFile,
        message: `Cannot read v1 state consistently: ${error instanceof Error ? error.message : String(error)}`,
      },
      fingerprint,
    };
  }
  if (sha256(raw) !== fingerprint) {
    return {
      error: { path: stateFile, message: "v1 state changed while it was read" },
      fingerprint,
    };
  }
  try {
    const value = JSON.parse(Buffer.from(raw).toString("utf8")) as unknown;
    if (
      !isRecord(value) ||
      !["proxy", "record", "mock", "smart"].includes(String(value.mode)) ||
      !(typeof value.currentScenario === "string" || value.currentScenario === null)
    ) {
      return { warning: { path: stateFile, message: "Invalid v1 state ignored" }, fingerprint };
    }
    return { state: value as unknown as ImportedV1State, fingerprint };
  } catch {
    return { warning: { path: stateFile, message: "Invalid v1 state JSON ignored" }, fingerprint };
  }
}

function migrationFingerprint(filesFingerprint: Sha256, stateFingerprint: string): Sha256 {
  return sha256(JSON.stringify({ filesFingerprint, stateFingerprint }));
}

async function currentMigrationFingerprint(sourceRoot: string, stateFile: string): Promise<Sha256> {
  const inventory = await inventorySource(sourceRoot);
  let stateFingerprint: string;
  try {
    stateFingerprint = (await hashRegularFileStreaming(stateFile)).digest;
  } catch (error) {
    stateFingerprint = isNotFound(error)
      ? "missing"
      : `unreadable:${error instanceof Error ? error.message : String(error)}`;
  }
  return migrationFingerprint(inventory.fingerprint, stateFingerprint);
}

function scenarioSort(left: MigrationScenario, right: MigrationScenario): number {
  return compareCodeUnits(left.folderName, right.folderName) || compareCodeUnits(left.scenarioName, right.scenarioName);
}

async function prepareMigration(options: V1MigrationOptions): Promise<PreparedMigration> {
  const sourceRoot = path.resolve(options.sourceRoot);
  const limits = resolveReadLimits(options.readLimits);
  const inventory = await inventorySource(sourceRoot);
  const entries: MigrationEntry[] = [];
  const warnings = [...inventory.warnings];
  const errors: MigrationIssue[] = [];
  const scenarios = new Map<ScenarioId, MigrationScenario>();
  const folderNames = new Map<string, FolderId>();
  const scenarioNames = new Map<string, ScenarioId>();
  const recordingIds = new Map<string, string>();
  const logicalKeys = new Map<string, string>();
  const requestFingerprints = new Map<string, string>();
  const matchability = new Map<string, boolean>();
  const recordingsByScenario = new Map<ScenarioId, Recording[]>();

  const registerScenario = (scenario: MigrationScenario, sourcePath: string): void => {
    const existingFolderId = folderNames.get(scenario.folderName.toLocaleLowerCase("en-US"));
    if (existingFolderId && existingFolderId !== scenario.folderId) {
      errors.push({
        path: sourcePath,
        message: `v1 layout maps distinct folders to the same display name: ${scenario.folderName}`,
      });
      return;
    }
    folderNames.set(scenario.folderName.toLocaleLowerCase("en-US"), scenario.folderId);

    const nameKey = `${scenario.folderId}\0${scenario.scenarioName.toLocaleLowerCase("en-US")}`;
    const existingScenarioId = scenarioNames.get(nameKey);
    if (existingScenarioId && existingScenarioId !== scenario.scenarioId) {
      errors.push({
        path: sourcePath,
        message: `v1 layout maps distinct scenarios to the same display name: ${scenario.scenarioName}`,
      });
      return;
    }
    scenarioNames.set(nameKey, scenario.scenarioId);
    scenarios.set(scenario.scenarioId, scenario);
  };

  for (const file of inventory.files) {
    if (file.size > limits.maxRecordingFileBytes) {
      errors.push({
        path: file.relativePath,
        message: sizeLimitMessage("recording JSON", file.size, limits.maxRecordingFileBytes),
      });
      continue;
    }
    const parts = file.relativePath.split("/");
    if (parts.length < 2) {
      errors.push({ path: file.relativePath, message: "JSON file is not inside a scenario directory" });
      continue;
    }

    try {
      const location = mapLegacyScenario(parts.slice(0, -1));
      const filename = parts.at(-1);
      if (!filename) throw new Error("Recording filename is empty");
      const logicalKey = filename.normalize("NFC");
      if (logicalKey.length > 255) throw new Error("Recording filename is longer than 255 characters");
      const recordingId = migratedRecordingId(`file:${file.relativePath}`);
      const existingRecordingSource = recordingIds.get(recordingId);
      if (existingRecordingSource && existingRecordingSource !== file.relativePath) {
        throw new Error(`Source identity collides with ${existingRecordingSource}`);
      }
      const logicalKeyIdentity = `${location.scenarioId}\0${logicalKey.toLocaleLowerCase("en-US")}`;
      const existingLogicalKeySource = logicalKeys.get(logicalKeyIdentity);
      if (existingLogicalKeySource && existingLogicalKeySource !== file.relativePath) {
        throw new Error(`Recording name collides with ${existingLogicalKeySource}`);
      }

      const loaded = await loadV1File(file, limits.maxRecordingFileBytes);
      HttpMethodSchema.parse(loaded.data.method.toUpperCase());
      RoutePatternSchema.parse(loaded.data.endpoint);
      HeaderFieldsSchema.parse(headerFields(loaded.data.request.headers));
      HeaderFieldsSchema.parse(headerFields(loaded.data.response.headers));
      QueryFieldsSchema.parse(queryFields(loaded.data.request.queryParams));
      const fingerprint = RequestFingerprintSchema.parse(legacyRequestFingerprint(loaded.data));
      const fingerprintIdentity = `${location.scenarioId}\0${fingerprint}`;
      const existingFingerprintSource = requestFingerprints.get(fingerprintIdentity);
      let matchable = true;
      if (existingFingerprintSource && existingFingerprintSource !== file.relativePath) {
        // v1 selected the lexicographically first filename for duplicate
        // requests. Keep that winner matchable and preserve every shadowed file
        // under its canonical identity with an explicit non-matchable marker.
        matchable = false;
        warnings.push({
          path: file.relativePath,
          message: `Duplicate request identity preserved as shadowed data; ${existingFingerprintSource} remains active`,
        });
      }

      const migrationEntry: MigrationEntry = {
        sourceRelativePath: file.relativePath,
        sourceSha256: file.sha256,
        sourceSize: file.size,
        folderName: location.folderName,
        folderId: location.folderId,
        scenarioName: location.scenarioName,
        scenarioId: location.scenarioId,
        logicalKey,
        recordingId,
      };
      const recording = previewRecording(loaded.data, migrationEntry, matchable);

      registerScenario(location, file.relativePath);
      recordingIds.set(recordingId, file.relativePath);
      logicalKeys.set(logicalKeyIdentity, file.relativePath);
      if (!existingFingerprintSource) requestFingerprints.set(fingerprintIdentity, file.relativePath);
      matchability.set(file.relativePath, matchable);
      entries.push(migrationEntry);
      const scenarioRecordings = recordingsByScenario.get(location.scenarioId) ?? [];
      scenarioRecordings.push(recording);
      recordingsByScenario.set(location.scenarioId, scenarioRecordings);
    } catch (error) {
      errors.push({
        path: file.relativePath,
        message: error instanceof Error ? error.message : "Invalid v1 JSON",
      });
    }
  }

  for (const directory of inventory.emptyLeafDirectories) {
    try {
      registerScenario(mapLegacyScenario(directory.split("/")), directory);
    } catch (error) {
      errors.push({
        path: directory,
        message: error instanceof Error ? error.message : "Invalid empty v1 scenario",
      });
    }
  }

  const stateFile = path.resolve(options.stateFile ?? path.join(path.dirname(sourceRoot), "state.json"));
  const stateResult = await readV1State(stateFile, limits.maxStateFileBytes);
  if (stateResult.warning) warnings.push(stateResult.warning);
  if (stateResult.error) errors.push(stateResult.error);
  if (
    stateResult.state?.currentScenario &&
    ![...scenarios.values()].some((scenario) => scenario.sourceScenarioPath === stateResult.state?.currentScenario)
  ) {
    warnings.push({
      path: stateFile,
      message: `Selected v1 scenario was not found and will be cleared: ${stateResult.state.currentScenario}`,
    });
  }

  const sortedScenarios = [...scenarios.values()].sort(scenarioSort);
  for (const scenario of sortedScenarios) {
    try {
      migrationManifest(scenario, recordingsByScenario.get(scenario.scenarioId) ?? []);
    } catch (error) {
      errors.push({
        path: scenario.sourceScenarioPath,
        message: `Scenario exceeds the v2 aggregate contract: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }
  try {
    migrationCatalog(sortedScenarios, recordingsByScenario, stateResult.state, MIGRATION_PREVIEW_TIMESTAMP);
  } catch (error) {
    errors.push({
      path: sourceRoot,
      message: `Catalog exceeds the v2 aggregate contract: ${error instanceof Error ? error.message : String(error)}`,
    });
  }

  return {
    inventory,
    sourceFingerprint: migrationFingerprint(inventory.fingerprint, stateResult.fingerprint),
    stateFile,
    limits,
    entries,
    scenarios: sortedScenarios,
    warnings,
    errors,
    matchability,
    importedState: stateResult.state,
  };
}

function buildReport(
  prepared: PreparedMigration,
  sourceRoot: string,
  destinationRoot: string,
  dryRun: boolean,
): V1MigrationReport {
  return {
    dryRun,
    alreadyApplied: false,
    sourceRoot,
    destinationRoot,
    sourceFingerprint: prepared.sourceFingerprint,
    sourceFiles: prepared.inventory.files.length,
    sourceBytes: prepared.inventory.bytes,
    scenarios: prepared.scenarios,
    entries: prepared.entries,
    warnings: prepared.warnings,
    errors: prepared.errors,
    sourceUnchanged: true,
  };
}

async function directoryExists(directory: string): Promise<boolean> {
  try {
    await fs.access(directory);
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

async function verifyMigrationReceipt(
  destinationRoot: string,
  fingerprint: Sha256,
  expectedEntries: readonly MigrationEntry[],
): Promise<MigrationReceipt> {
  const receipt = await readMigrationReceipt(destinationRoot);
  if (!receipt || receipt.sourceFingerprint !== fingerprint) {
    throw new StoreCorruptionError("Migration receipt does not match the v1 source");
  }
  const persistedByPath = new Map(receipt.entries.map((entry) => [entry.sourceRelativePath, entry]));
  for (const expected of expectedEntries) {
    const persisted = persistedByPath.get(expected.sourceRelativePath);
    if (
      !persisted ||
      persisted.sourceSha256 !== expected.sourceSha256 ||
      persisted.sourceSize !== expected.sourceSize ||
      persisted.folderName !== expected.folderName ||
      persisted.folderId !== expected.folderId ||
      persisted.scenarioName !== expected.scenarioName ||
      persisted.scenarioId !== expected.scenarioId ||
      persisted.logicalKey !== expected.logicalKey ||
      persisted.recordingId !== expected.recordingId
    ) {
      throw new StoreCorruptionError(
        `Migration receipt entry does not match v1 source: ${expected.sourceRelativePath}`,
      );
    }
  }
  return receipt;
}

async function persistBody(
  store: FilesystemStore,
  value: unknown,
  headers: Record<string, string>,
  cache: Map<Sha256, number>,
): Promise<Awaited<ReturnType<typeof writeBlobBytes>>> {
  const encoded = encodeLegacyBody(value, headers);
  return persistMigrationBlob(
    store,
    encoded.bytes,
    {
      mediaType: encoded.mediaType,
      contentEncoding: encoded.contentEncoding,
    },
    cache,
  );
}

async function persistMigrationBlob(
  store: FilesystemStore,
  bytes: Uint8Array,
  metadata: { mediaType: string; contentEncoding: string | null },
  cache: Map<Sha256, number>,
): Promise<BodyRef> {
  const digest = sha256(bytes);
  const existingSize = cache.get(digest);
  if (existingSize !== undefined) {
    if (existingSize !== bytes.byteLength) throw new StoreCorruptionError(`Blob digest size collision: ${digest}`);
    return BodyRefSchema.parse({
      sha256: digest,
      size: bytes.byteLength,
      mediaType: metadata.mediaType,
      contentEncoding: metadata.contentEncoding,
    });
  }
  const ref = await writeBlobBytes(store.blobs, bytes, metadata);
  cache.set(ref.sha256, ref.size);
  return ref;
}

async function buildRecording(
  store: FilesystemStore,
  file: SourceFile,
  entry: MigrationEntry,
  matchable: boolean,
  timestamp: string,
  blobCache: Map<Sha256, number>,
  maxRecordingFileBytes: number,
): Promise<Recording> {
  const { raw, data } = await loadV1File(file, maxRecordingFileBytes);
  entry.originalBlob = await persistMigrationBlob(
    store,
    raw,
    {
      mediaType: "application/json",
      contentEncoding: null,
    },
    blobCache,
  );

  const requestBody =
    data.request.body === null ? null : await persistBody(store, data.request.body, data.request.headers, blobCache);
  const responseBody = responseAllowsBody(data.method, data.response.status)
    ? await persistBody(store, data.response.body, data.response.headers, blobCache)
    : null;
  const draft = migrationRecordingDraft(data, requestBody, responseBody);
  const derivedFingerprint = await deriveRecordingRequestFingerprint(draft, (body) => store.blobs.open(body));
  const sourceFingerprint = RequestFingerprintSchema.parse(legacyRequestFingerprint(data));
  if (derivedFingerprint !== sourceFingerprint) {
    throw new Error(`Migrated request fingerprint changed while materializing ${file.relativePath}`);
  }
  return RecordingSchema.parse({
    ...draft,
    id: entry.recordingId,
    scenarioId: entry.scenarioId,
    filename: entry.logicalKey,
    requestFingerprint: derivedFingerprint,
    matchable,
    revision: RevisionSchema.parse(0),
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

export async function migrateV1Store(options: V1MigrationOptions): Promise<V1MigrationReport> {
  const sourceRoot = path.resolve(options.sourceRoot);
  const destinationRoot = path.resolve(options.destinationRoot);
  const stateFile = path.resolve(options.stateFile ?? path.join(path.dirname(sourceRoot), "state.json"));
  if (sourceRoot === destinationRoot || isInside(sourceRoot, destinationRoot)) {
    throw new Error("v2 destination must not be the v1 source or a descendant of it");
  }
  if (isInside(sourceRoot, stateFile) || isInside(stateFile, sourceRoot)) {
    throw new Error("v1 state file and v1 recording source must not overlap");
  }
  if (isInside(destinationRoot, stateFile) || isInside(stateFile, destinationRoot)) {
    throw new Error("v1 state file and v2 destination must not overlap");
  }

  const sourceStat = await fs.stat(sourceRoot).catch((error) => {
    if (isNotFound(error)) throw new Error(`v1 source does not exist: ${sourceRoot}`);
    throw error;
  });
  if (!sourceStat.isDirectory()) throw new Error(`v1 source is not a directory: ${sourceRoot}`);

  const [canonicalSourceRoot, canonicalDestinationRoot, canonicalStateFile] = await Promise.all([
    canonicalFuturePath(sourceRoot),
    canonicalFuturePath(destinationRoot),
    canonicalFuturePath(stateFile),
  ]);
  if (isInside(canonicalSourceRoot, canonicalDestinationRoot)) {
    throw new Error("v2 destination must not be the v1 source or a descendant of it");
  }
  if (isInside(canonicalSourceRoot, canonicalStateFile) || isInside(canonicalStateFile, canonicalSourceRoot)) {
    throw new Error("v1 state file and v1 recording source must not overlap");
  }
  if (
    isInside(canonicalDestinationRoot, canonicalStateFile) ||
    isInside(canonicalStateFile, canonicalDestinationRoot)
  ) {
    throw new Error("v1 state file and v2 destination must not overlap");
  }

  const prepared = await prepareMigration({ ...options, sourceRoot, destinationRoot, stateFile });
  const report = buildReport(prepared, sourceRoot, destinationRoot, options.dryRun ?? false);
  report.sourceUnchanged =
    (await currentMigrationFingerprint(sourceRoot, prepared.stateFile)) === prepared.sourceFingerprint;
  if (!report.sourceUnchanged) {
    report.errors.push({ path: sourceRoot, message: "v1 source changed during migration analysis" });
  }

  if (options.dryRun) return report;
  if (report.errors.length > 0) throw new V1MigrationError("v1 migration preflight failed", report);

  if (await directoryExists(destinationRoot)) {
    try {
      const existingStore = new FilesystemStore(destinationRoot);
      const metadata = await existingStore.readMetadata();
      if (
        metadata.importedFrom?.format !== "snaperro-v1" ||
        metadata.importedFrom.fingerprint !== report.sourceFingerprint
      ) {
        throw new StoreCorruptionError("Existing destination was not created from this v1 source fingerprint");
      }
      const receipt = await verifyMigrationReceipt(destinationRoot, report.sourceFingerprint, report.entries);
      const originals = new Map(receipt.entries.map((entry) => [entry.sourceRelativePath, entry.originalBlob]));
      for (const entry of report.entries) entry.originalBlob = originals.get(entry.sourceRelativePath);
      report.integrity = await existingStore.verifyIntegrity();
      report.alreadyApplied = report.integrity.ok;
      if (!report.integrity.ok) throw new StoreCorruptionError("Existing migrated destination failed integrity checks");
      return report;
    } catch (error) {
      report.errors.push({
        path: destinationRoot,
        message: error instanceof Error ? error.message : "Existing destination is not reusable",
      });
      throw new V1MigrationError("v2 migration destination already exists", report);
    }
  }

  const destinationParent = path.dirname(destinationRoot);
  await fs.mkdir(destinationParent, { recursive: true });
  const stagingRoot = path.join(destinationParent, `.${path.basename(destinationRoot)}.migrate.${randomUUID()}`);
  const store = new FilesystemStore(stagingRoot, { lease: { ttlMs: 120_000, waitMs: 5_000 } });
  let destinationPublished = false;

  try {
    await store.initialize({
      importedFrom: {
        format: "snaperro-v1",
        fingerprint: report.sourceFingerprint,
        filesCount: report.sourceFiles,
        bytes: report.sourceBytes,
      },
      importedState: prepared.importedState,
    });

    const timestamp = IsoDateTimeSchema.parse(new Date().toISOString());
    const recordingsByScenario = new Map<ScenarioId, Recording[]>();
    const blobCache = new Map<Sha256, number>();
    const sourceFiles = new Map(prepared.inventory.files.map((file) => [file.relativePath, file]));
    for (const entry of prepared.entries) {
      const sourceFile = sourceFiles.get(entry.sourceRelativePath);
      if (!sourceFile) throw new Error(`Prepared source file disappeared: ${entry.sourceRelativePath}`);
      const matchable = prepared.matchability.get(entry.sourceRelativePath);
      if (matchable === undefined) throw new Error(`Prepared matchability disappeared: ${entry.sourceRelativePath}`);
      const recording = await buildRecording(
        store,
        sourceFile,
        entry,
        matchable,
        timestamp,
        blobCache,
        prepared.limits.maxRecordingFileBytes,
      );
      const recordings = recordingsByScenario.get(entry.scenarioId) ?? [];
      recordings.push(recording);
      recordingsByScenario.set(entry.scenarioId, recordings);
    }

    for (const scenario of prepared.scenarios) {
      await store.manifests.create(migrationManifest(scenario, recordingsByScenario.get(scenario.scenarioId) ?? []));
    }

    const nextCatalog = migrationCatalog(prepared.scenarios, recordingsByScenario, prepared.importedState, timestamp);
    await store.catalogs.compareAndSwap(RevisionSchema.parse(0), nextCatalog);

    const receiptPath = path.join(stagingRoot, MIGRATION_RECEIPT_FILE);
    await atomicWriteJson(
      receiptPath,
      MigrationReceiptSchema.parse({
        schemaVersion: 1,
        sourceFingerprint: report.sourceFingerprint,
        sourceFiles: report.sourceFiles,
        sourceBytes: report.sourceBytes,
        entries: report.entries,
        completedAt: new Date().toISOString(),
      }),
    );

    report.integrity = await store.verifyIntegrity();
    if (!report.integrity.ok) {
      report.errors.push(...report.integrity.errors.map((message) => ({ path: stagingRoot, message })));
      throw new V1MigrationError("Migrated v2 store failed integrity checks", report);
    }

    report.sourceUnchanged =
      (await currentMigrationFingerprint(sourceRoot, prepared.stateFile)) === report.sourceFingerprint;
    if (!report.sourceUnchanged) {
      report.errors.push({ path: sourceRoot, message: "v1 source changed while data was copied" });
      throw new V1MigrationError("v1 source changed during migration", report);
    }

    await fsyncDirectory(stagingRoot);
    await fs.rename(stagingRoot, destinationRoot);
    destinationPublished = true;
    try {
      await fsyncDirectory(destinationParent);
    } catch (error) {
      report.errors.push({
        path: destinationRoot,
        message: `The v2 destination was published, but parent-directory durability could not be confirmed: ${errorValue(error).message}. Re-run migration to verify the existing destination.`,
      });
      throw new V1MigrationError("v2 migration destination was published but durability confirmation failed", report, {
        cause: error,
      });
    }
    return report;
  } catch (error) {
    if (!(error instanceof V1MigrationError)) {
      report.errors.push({ path: stagingRoot, message: errorValue(error).message });
    }

    let cleanupError: unknown;
    if (!destinationPublished) {
      try {
        await fs.rm(stagingRoot, { recursive: true, force: true });
      } catch (cleanupFailure) {
        cleanupError = cleanupFailure;
        report.errors.push({
          path: stagingRoot,
          message: `Failed to remove the incomplete migration staging directory: ${errorValue(cleanupFailure).message}`,
        });
      }
    }

    if (cleanupError !== undefined) {
      const primaryMessage = error instanceof V1MigrationError ? error.message : "v1 migration failed";
      const cleanupMessage = errorValue(cleanupError).message;
      const aggregate = new AggregateError(
        [errorValue(error), errorValue(cleanupError)],
        "v1 migration failed and staging cleanup also failed",
        { cause: error },
      );
      throw new V1MigrationError(
        `${primaryMessage}; additionally, failed to remove the incomplete migration staging directory ${stagingRoot}: ${cleanupMessage}`,
        report,
        { cause: aggregate },
      );
    }
    if (error instanceof V1MigrationError) throw error;
    throw new V1MigrationError("v1 migration failed", report, { cause: error });
  }
}
