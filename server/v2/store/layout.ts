import path from "node:path";
import {
  type CatalogSnapshot,
  CatalogSnapshotSchema,
  MAX_CATALOG_SERIALIZED_BYTES,
  MAX_SCENARIO_MANIFEST_BYTES,
  type ScenarioManifest,
  ScenarioManifestSchema,
} from "../../../shared/contracts-v2/entities.js";
import {
  nextRevision,
  type Revision,
  RevisionSchema,
  type ScenarioId,
  ScenarioIdSchema,
  V2_SCHEMA_VERSION,
} from "../../../shared/contracts-v2/primitives.js";
import type { OperationContext } from "../application/ports.js";
import { OperationAbortedError } from "../domain/errors.js";
import { atomicWriteFile, atomicWriteJson } from "./atomic.js";
import { FileReadLimitError, readFileBounded } from "./bounded-file.js";
import { StoreCorruptionError } from "./errors.js";
import type { PersistedCatalog } from "./types.js";

export const STORE_METADATA_FILE = "store.json";
export const CATALOG_FILE = "catalog.json";
export const MANIFEST_DIRECTORY = "manifests";
export const BLOB_DIRECTORY = "blobs/sha256";

export class StoreLayout {
  readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  get metadataPath(): string {
    return path.join(this.root, STORE_METADATA_FILE);
  }

  get catalogPath(): string {
    return path.join(this.root, CATALOG_FILE);
  }

  get manifestRoot(): string {
    return path.join(this.root, MANIFEST_DIRECTORY);
  }

  get blobRoot(): string {
    return path.join(this.root, "blobs", "sha256");
  }

  get blobTempRoot(): string {
    return path.join(this.root, ".tmp", "blobs");
  }

  get requestSpoolRoot(): string {
    return path.join(this.root, "tmp");
  }

  manifestDirectory(scenarioId: ScenarioId): string {
    return path.join(this.manifestRoot, ScenarioIdSchema.parse(scenarioId));
  }

  manifestPath(scenarioId: ScenarioId, revision: Revision): string {
    const validRevision = RevisionSchema.parse(revision);
    return path.join(this.manifestDirectory(scenarioId), `${String(validRevision).padStart(16, "0")}.json`);
  }

  manifestGarbageMarker(scenarioId: ScenarioId): string {
    return path.join(this.root, "gc", "manifests", `${ScenarioIdSchema.parse(scenarioId)}.json`);
  }

  blobPath(sha256: string): string {
    return path.join(this.blobRoot, sha256.slice(0, 2), sha256);
  }

  blobMetadataPath(sha256: string): string {
    return `${this.blobPath(sha256)}.meta.json`;
  }
}

export function throwIfAborted(context: OperationContext = {}): void {
  if (context.signal?.aborted) {
    throw new OperationAbortedError("The store operation was aborted", context.signal.reason);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function emptyCatalog(): PersistedCatalog {
  return {
    schemaVersion: V2_SCHEMA_VERSION,
    revision: RevisionSchema.parse(0),
    mode: "smart",
    currentScenarioId: null,
    folders: [],
    scenarios: [],
    manifestRevisions: {},
  };
}

export function parsePersistedCatalog(value: unknown): PersistedCatalog {
  if (!isRecord(value) || !isRecord(value.manifestRevisions)) {
    throw new StoreCorruptionError("Store catalog is not a valid persisted catalog");
  }

  const snapshot = CatalogSnapshotSchema.safeParse({
    schemaVersion: value.schemaVersion,
    revision: value.revision,
    mode: value.mode,
    currentScenarioId: value.currentScenarioId,
    folders: value.folders,
    scenarios: value.scenarios,
  });
  if (!snapshot.success) {
    throw new StoreCorruptionError(`Store catalog failed validation: ${snapshot.error.message}`);
  }

  const manifestRevisions: Record<string, Revision> = {};
  for (const [scenarioId, revision] of Object.entries(value.manifestRevisions)) {
    const parsedScenarioId = ScenarioIdSchema.safeParse(scenarioId);
    const parsedRevision = RevisionSchema.safeParse(revision);
    if (!parsedScenarioId.success || !parsedRevision.success) {
      throw new StoreCorruptionError(`Store catalog has an invalid manifest pointer: ${scenarioId}`);
    }
    manifestRevisions[parsedScenarioId.data] = parsedRevision.data;
  }

  const visibleScenarioIds = new Set(snapshot.data.scenarios.map((scenario) => scenario.id));
  for (const scenario of snapshot.data.scenarios) {
    const manifestRevision = manifestRevisions[scenario.id];
    if (manifestRevision === undefined) {
      throw new StoreCorruptionError(`Store catalog is missing a manifest pointer: ${scenario.id}`);
    }
    if (scenario.revision !== manifestRevision) {
      throw new StoreCorruptionError(
        `Store catalog scenario revision does not match its manifest pointer: ${scenario.id}`,
      );
    }
  }
  for (const scenarioId of Object.keys(manifestRevisions)) {
    if (!visibleScenarioIds.has(ScenarioIdSchema.parse(scenarioId))) {
      throw new StoreCorruptionError(`Store catalog points to a deleted scenario manifest: ${scenarioId}`);
    }
  }

  return { ...snapshot.data, manifestRevisions };
}

export function catalogSnapshot(catalog: PersistedCatalog): CatalogSnapshot {
  return CatalogSnapshotSchema.parse({
    schemaVersion: catalog.schemaVersion,
    revision: catalog.revision,
    mode: catalog.mode,
    currentScenarioId: catalog.currentScenarioId,
    folders: catalog.folders,
    scenarios: catalog.scenarios,
  });
}

export async function readPersistedCatalog(layout: StoreLayout): Promise<PersistedCatalog> {
  let value: unknown;
  try {
    value = JSON.parse((await readFileBounded(layout.catalogPath, MAX_CATALOG_SERIALIZED_BYTES)).toString("utf8"));
  } catch (error) {
    if (error instanceof FileReadLimitError) {
      throw new StoreCorruptionError(
        `Store catalog exceeds the ${MAX_CATALOG_SERIALIZED_BYTES}-byte read limit`,
        error,
      );
    }
    throw new StoreCorruptionError("Cannot read the store catalog", error);
  }
  return parsePersistedCatalog(value);
}

export function serializePersistedCatalog(catalog: PersistedCatalog): string {
  const parsed = parsePersistedCatalog(catalog);
  const serialized = `${JSON.stringify(parsed)}\n`;
  const bytes = Buffer.byteLength(serialized, "utf8");
  if (bytes > MAX_CATALOG_SERIALIZED_BYTES) {
    throw new StoreCorruptionError(`Store catalog exceeds the ${MAX_CATALOG_SERIALIZED_BYTES}-byte persistence limit`);
  }
  return serialized;
}

export async function writePersistedCatalog(layout: StoreLayout, catalog: PersistedCatalog): Promise<void> {
  await atomicWriteFile(layout.catalogPath, serializePersistedCatalog(catalog));
}

export async function readManifestGeneration(
  layout: StoreLayout,
  scenarioId: ScenarioId,
  revision: Revision,
): Promise<ScenarioManifest> {
  let value: unknown;
  try {
    value = JSON.parse(
      (await readFileBounded(layout.manifestPath(scenarioId, revision), MAX_SCENARIO_MANIFEST_BYTES)).toString("utf8"),
    );
  } catch (error) {
    if (error instanceof FileReadLimitError) {
      throw new StoreCorruptionError(`Scenario manifest exceeds the read limit: ${scenarioId}@${revision}`, error);
    }
    if (error instanceof StoreCorruptionError) throw error;
    throw new StoreCorruptionError(`Cannot read scenario manifest ${scenarioId}@${revision}`, error);
  }
  const parsed = ScenarioManifestSchema.safeParse(value);
  if (!parsed.success || parsed.data.scenarioId !== scenarioId || parsed.data.revision !== revision) {
    throw new StoreCorruptionError(`Scenario manifest failed validation: ${scenarioId}@${revision}`);
  }
  return parsed.data;
}

export interface StageManifestGenerationOptions {
  /**
   * The caller has fenced and re-read this visible revision under the global
   * store lease. A differing next generation is therefore a crash orphan and
   * may be replaced; the visible generation itself remains immutable.
   */
  replaceCrashOrphanAfter?: Revision;
}

export async function stageManifestGeneration(
  layout: StoreLayout,
  manifest: ScenarioManifest,
  options: StageManifestGenerationOptions = {},
): Promise<void> {
  const parsed = ScenarioManifestSchema.parse(manifest);
  const target = layout.manifestPath(parsed.scenarioId, parsed.revision);
  try {
    const existing = (await readFileBounded(target, MAX_SCENARIO_MANIFEST_BYTES)).toString("utf8");
    if (existing !== `${JSON.stringify(parsed, null, 2)}\n`) {
      const visibleRevision = options.replaceCrashOrphanAfter;
      if (visibleRevision !== undefined && parsed.revision === nextRevision(visibleRevision)) {
        await atomicWriteJson(target, parsed);
        return;
      }
      throw new StoreCorruptionError(
        `Immutable manifest generation already differs: ${parsed.scenarioId}@${parsed.revision}`,
      );
    }
    return;
  } catch (error) {
    if (error instanceof StoreCorruptionError) throw error;
    if (error instanceof FileReadLimitError) {
      throw new StoreCorruptionError(
        `Immutable manifest generation exceeds the read limit: ${parsed.scenarioId}@${parsed.revision}`,
        error,
      );
    }
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  await atomicWriteJson(target, parsed);
}
