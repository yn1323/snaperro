import type { BodyRef, CatalogSnapshot } from "../../../shared/contracts-v2/entities.js";
import type { FolderId, RecordingId, Revision, ScenarioId, Sha256 } from "../../../shared/contracts-v2/primitives.js";

export const STORE_SCHEMA_VERSION = 2 as const;

export interface ImportedV1State {
  mode: "proxy" | "record" | "mock" | "smart";
  currentScenario: string | null;
}

export interface ImportedStoreSource {
  format: "snaperro-v1";
  fingerprint: Sha256;
  filesCount: number;
  bytes: number;
}

/** Immutable store identity and migration provenance. */
export interface StoreMetadata {
  schemaVersion: typeof STORE_SCHEMA_VERSION;
  storeId: string;
  createdAt: string;
  catalogFile: "catalog.json";
  manifestDirectory: "manifests";
  blobDirectory: "blobs/sha256";
  blobAlgorithm: "sha256";
  importedFrom?: ImportedStoreSource;
  importedState?: ImportedV1State;
}

/**
 * Internal on-disk catalog. `manifestRevisions` is the visibility pointer;
 * everything else is the canonical shared CatalogSnapshot.
 */
export type PersistedCatalog = CatalogSnapshot & {
  manifestRevisions: Record<string, Revision>;
};

export interface IntegrityCounts {
  folders: number;
  scenarios: number;
  manifests: number;
  recordings: number;
  referencedBlobs: number;
  orphanBlobs: number;
  orphanManifests: number;
}

export interface IntegrityReport {
  ok: boolean;
  errors: string[];
  warnings: string[];
  counts: IntegrityCounts;
}

export interface MigrationEntry {
  sourceRelativePath: string;
  sourceSha256: Sha256;
  sourceSize: number;
  folderName: string;
  folderId: FolderId;
  scenarioName: string;
  scenarioId: ScenarioId;
  logicalKey: string;
  recordingId: RecordingId;
  originalBlob?: BodyRef;
}

export interface MigrationScenario {
  sourceScenarioPath: string;
  folderName: string;
  folderId: FolderId;
  scenarioName: string;
  scenarioId: ScenarioId;
}

export interface MigrationIssue {
  path: string;
  message: string;
}

export interface V1MigrationReport {
  dryRun: boolean;
  alreadyApplied: boolean;
  sourceRoot: string;
  destinationRoot: string;
  sourceFingerprint: Sha256;
  sourceFiles: number;
  sourceBytes: number;
  scenarios: MigrationScenario[];
  entries: MigrationEntry[];
  warnings: MigrationIssue[];
  errors: MigrationIssue[];
  sourceUnchanged: boolean;
  integrity?: IntegrityReport;
}
