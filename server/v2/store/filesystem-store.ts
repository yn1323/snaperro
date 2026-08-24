import { createHash, randomUUID } from "node:crypto";
import { createReadStream, type Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { BodyRef } from "../../../shared/contracts-v2/entities.js";
import {
  IsoDateTimeSchema,
  ScenarioIdSchema,
  type Sha256,
  Sha256Schema,
} from "../../../shared/contracts-v2/primitives.js";
import { atomicWriteJson } from "./atomic.js";
import { BlobPinRegistry } from "./blob-pin-registry.js";
import { FilesystemBlobStore, readBlobMetadata } from "./blob-store.js";
import { FileReadLimitError, MAX_STORE_METADATA_BYTES, readFileBounded } from "./bounded-file.js";
import { StoreCorruptionError } from "./errors.js";
import { FilesystemGarbageCollector, type FilesystemGarbageCollectorOptions } from "./garbage-collector.js";
import {
  BLOB_DIRECTORY,
  CATALOG_FILE,
  emptyCatalog,
  MANIFEST_DIRECTORY,
  readManifestGeneration,
  readPersistedCatalog,
  STORE_METADATA_FILE,
  StoreLayout,
  writePersistedCatalog,
} from "./layout.js";
import type { LeaseOptions } from "./lease.js";
import { readMigrationReceipt } from "./migration-receipt.js";
import {
  FilesystemCatalogRepository,
  FilesystemRecordingCommitRepository,
  FilesystemScenarioManifestRepository,
} from "./repositories.js";
import { cleanupOrphanedBlobStaging, cleanupOrphanedRequestSpools } from "./request-spool-cleanup.js";
import { FilesystemStoreLease } from "./store-lease.js";
import {
  type ImportedStoreSource,
  type ImportedV1State,
  type IntegrityReport,
  type PersistedCatalog,
  STORE_SCHEMA_VERSION,
  type StoreMetadata,
} from "./types.js";

export interface InitializeStoreOptions {
  importedFrom?: ImportedStoreSource;
  importedState?: ImportedV1State;
}

export interface FilesystemStoreOptions {
  lease?: LeaseOptions;
  now?: () => Date;
  pinCleanupTimeoutMs?: number;
  /** @internal Deterministic process-liveness probe for orphan spool cleanup. */
  orphanedFileProcessAlive?: (pid: number) => boolean;
  garbageCollection?: Omit<FilesystemGarbageCollectorOptions, "lease">;
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error ? String(error.code) : undefined;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if (errorCode(error) === "ENOENT") return false;
    throw error;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseStoreMetadata(value: unknown): StoreMetadata {
  if (
    !isRecord(value) ||
    value.schemaVersion !== STORE_SCHEMA_VERSION ||
    typeof value.storeId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value.storeId) ||
    !IsoDateTimeSchema.safeParse(value.createdAt).success ||
    value.catalogFile !== CATALOG_FILE ||
    value.manifestDirectory !== MANIFEST_DIRECTORY ||
    value.blobDirectory !== BLOB_DIRECTORY ||
    value.blobAlgorithm !== "sha256"
  ) {
    throw new StoreCorruptionError("Unsupported or invalid store metadata");
  }

  if (value.importedFrom !== undefined) {
    if (
      !isRecord(value.importedFrom) ||
      value.importedFrom.format !== "snaperro-v1" ||
      !Sha256Schema.safeParse(value.importedFrom.fingerprint).success ||
      !Number.isSafeInteger(value.importedFrom.filesCount) ||
      Number(value.importedFrom.filesCount) < 0 ||
      !Number.isSafeInteger(value.importedFrom.bytes) ||
      Number(value.importedFrom.bytes) < 0
    ) {
      throw new StoreCorruptionError("Store metadata has invalid migration provenance");
    }
  }
  if (
    value.importedState !== undefined &&
    (!isRecord(value.importedState) ||
      !["proxy", "record", "mock", "smart"].includes(String(value.importedState.mode)) ||
      !(typeof value.importedState.currentScenario === "string" || value.importedState.currentScenario === null))
  ) {
    throw new StoreCorruptionError("Store metadata has invalid imported v1 state");
  }

  return value as unknown as StoreMetadata;
}

async function fileSha256(filePath: string): Promise<{ sha256: Sha256; size: number }> {
  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of createReadStream(filePath)) {
    const bytes = chunk as Buffer;
    hash.update(bytes);
    size += bytes.byteLength;
  }
  return { sha256: Sha256Schema.parse(hash.digest("hex")), size };
}

export class FilesystemStore {
  readonly root: string;
  readonly layout: StoreLayout;
  readonly catalogs: FilesystemCatalogRepository;
  readonly manifests: FilesystemScenarioManifestRepository;
  readonly commits: FilesystemRecordingCommitRepository;
  readonly blobs: FilesystemBlobStore;
  readonly lease: FilesystemStoreLease;
  readonly garbageCollection: FilesystemGarbageCollector;
  private readonly leaseOptions: LeaseOptions;
  private readonly now: () => Date;
  private readonly orphanedFileProcessAlive?: (pid: number) => boolean;

  constructor(root: string, options: FilesystemStoreOptions = {}) {
    this.layout = new StoreLayout(root);
    this.root = this.layout.root;
    this.leaseOptions = options.lease ?? {};
    this.now = options.now ?? (() => new Date());
    this.orphanedFileProcessAlive = options.orphanedFileProcessAlive;
    this.lease = new FilesystemStoreLease(this.layout, { lease: this.leaseOptions });
    this.catalogs = new FilesystemCatalogRepository(this.layout, this.lease);
    this.manifests = new FilesystemScenarioManifestRepository(this.layout, this.lease);
    this.commits = new FilesystemRecordingCommitRepository(this.layout, this.lease);
    const pins = new BlobPinRegistry(this.layout, {
      lease: this.leaseOptions,
      storeLease: this.lease,
      pendingTtlMs: options.garbageCollection?.pendingPinTtlMs,
      activeTtlMs: options.garbageCollection?.activePinTtlMs,
      now: options.garbageCollection?.now,
    });
    this.blobs = new FilesystemBlobStore(this.layout, {
      lease: this.leaseOptions,
      pins,
      pinCleanupTimeoutMs: options.pinCleanupTimeoutMs,
    });
    this.garbageCollection = new FilesystemGarbageCollector(this.layout, this.blobs, {
      ...options.garbageCollection,
      lease: this.leaseOptions,
      pins,
    });
  }

  async initialize(options: InitializeStoreOptions = {}): Promise<StoreMetadata> {
    return this.lease.withVisibilityFence(async () => {
      await Promise.all([
        cleanupOrphanedRequestSpools(this.layout.requestSpoolRoot, this.orphanedFileProcessAlive),
        cleanupOrphanedBlobStaging(this.layout.blobTempRoot, this.orphanedFileProcessAlive),
      ]);
      const metadataExists = await fileExists(this.layout.metadataPath);
      const catalogExists = await fileExists(this.layout.catalogPath);
      if (metadataExists) {
        if (!catalogExists) {
          throw new StoreCorruptionError("Store initialization is incomplete: store/catalog pair is missing");
        }
        const metadata = await this.readMetadata();
        await readPersistedCatalog(this.layout);
        return metadata;
      }

      const createdAt = IsoDateTimeSchema.parse(this.now().toISOString());
      const metadata: StoreMetadata = {
        schemaVersion: STORE_SCHEMA_VERSION,
        storeId: randomUUID(),
        createdAt,
        catalogFile: CATALOG_FILE,
        manifestDirectory: MANIFEST_DIRECTORY,
        blobDirectory: BLOB_DIRECTORY,
        blobAlgorithm: "sha256",
        importedFrom: options.importedFrom,
        importedState: options.importedState,
      };
      const catalog = emptyCatalog();
      if (options.importedState) catalog.mode = options.importedState.mode;

      // store.json is the commit marker for initialization. A crash after the
      // initial catalog rename but before this marker is safe to resume only
      // when the orphan catalog is exactly the expected empty seed.
      if (catalogExists) {
        const orphanCatalog = await readPersistedCatalog(this.layout);
        if (JSON.stringify(orphanCatalog) !== JSON.stringify(catalog)) {
          throw new StoreCorruptionError("Store initialization has an unexpected catalog without store metadata");
        }
      } else {
        await writePersistedCatalog(this.layout, catalog);
      }
      await atomicWriteJson(this.layout.metadataPath, metadata);
      return metadata;
    });
  }

  async readMetadata(): Promise<StoreMetadata> {
    let parsed: unknown;
    try {
      parsed = JSON.parse((await readFileBounded(this.layout.metadataPath, MAX_STORE_METADATA_BYTES)).toString("utf8"));
    } catch (error) {
      if (error instanceof FileReadLimitError) {
        throw new StoreCorruptionError(`${STORE_METADATA_FILE} exceeds the read limit`, error);
      }
      throw new StoreCorruptionError(`Cannot read ${STORE_METADATA_FILE}`, error);
    }
    return parseStoreMetadata(parsed);
  }

  async verifyIntegrity(): Promise<IntegrityReport> {
    const errors: string[] = [];
    const warnings: string[] = [];
    const emptyCounts = {
      folders: 0,
      scenarios: 0,
      manifests: 0,
      recordings: 0,
      referencedBlobs: 0,
      orphanBlobs: 0,
      orphanManifests: 0,
    };

    let catalog: PersistedCatalog;
    let metadata: StoreMetadata;
    try {
      metadata = await this.readMetadata();
      catalog = await readPersistedCatalog(this.layout);
    } catch (error) {
      return {
        ok: false,
        errors: [error instanceof Error ? error.message : String(error)],
        warnings,
        counts: emptyCounts,
      };
    }

    const referenced = new Map<string, BodyRef>();
    const recordingScenarioIds = new Map<string, string>();
    const visibleManifestPaths = new Set<string>();
    let recordings = 0;
    for (const scenario of catalog.scenarios) {
      const revision = catalog.manifestRevisions[scenario.id];
      if (revision === undefined) continue;
      visibleManifestPaths.add(this.layout.manifestPath(scenario.id, revision));
      try {
        const manifest = await readManifestGeneration(this.layout, scenario.id, revision);
        recordings += manifest.recordings.length;
        if (manifest.recordings.length !== scenario.recordingsCount) {
          errors.push(`Scenario recording count does not match its manifest: ${scenario.id}`);
        }
        for (const recording of manifest.recordings) {
          const previousScenarioId = recordingScenarioIds.get(recording.id);
          if (previousScenarioId && previousScenarioId !== recording.scenarioId) {
            errors.push(`Recording ID is reused across scenarios: ${recording.id}`);
          }
          recordingScenarioIds.set(recording.id, recording.scenarioId);
          for (const ref of [recording.request.body, recording.response.body]) {
            if (!ref) continue;
            const previous = referenced.get(ref.sha256);
            if (previous && previous.size !== ref.size) errors.push(`Blob reference size mismatch: ${ref.sha256}`);
            referenced.set(ref.sha256, ref);
          }
        }
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }
    try {
      const receipt = await readMigrationReceipt(this.root);
      if (metadata.importedFrom && !receipt) {
        errors.push("A v1-imported store is missing its migration receipt");
      } else if (receipt && metadata.importedFrom) {
        if (
          receipt.sourceFingerprint !== metadata.importedFrom.fingerprint ||
          receipt.sourceFiles !== metadata.importedFrom.filesCount ||
          receipt.sourceBytes !== metadata.importedFrom.bytes
        ) {
          errors.push("Migration receipt does not match store provenance");
        }
      }
      for (const entry of receipt?.entries ?? []) {
        referenced.set(entry.originalBlob.sha256, entry.originalBlob);
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }

    for (const ref of referenced.values()) {
      try {
        const actual = await fileSha256(this.layout.blobPath(ref.sha256));
        if (actual.sha256 !== ref.sha256 || actual.size !== ref.size) {
          errors.push(`Blob failed integrity validation: ${ref.sha256}`);
        }
        const metadata = await readBlobMetadata(this.layout, ref.sha256);
        if (metadata.size !== ref.size) {
          errors.push(`Blob metadata failed integrity validation: ${ref.sha256}`);
        }
      } catch (error) {
        errors.push(`Cannot verify blob ${ref.sha256}: ${error instanceof Error ? error.message : error}`);
      }
    }

    const actualBlobs = new Set<string>();
    let blobPrefixes: Dirent[] = [];
    try {
      blobPrefixes = await fs.readdir(this.layout.blobRoot, { withFileTypes: true });
    } catch (error) {
      if (errorCode(error) !== "ENOENT")
        errors.push(`Cannot scan blobs: ${error instanceof Error ? error.message : error}`);
    }
    for (const prefix of blobPrefixes) {
      if (!prefix.isDirectory()) {
        warnings.push(`Unexpected entry in blob root: ${prefix.name}`);
        continue;
      }
      for (const entry of await fs.readdir(path.join(this.layout.blobRoot, prefix.name), { withFileTypes: true })) {
        if (!entry.isFile() || entry.name.endsWith(".meta.json")) continue;
        const digest = Sha256Schema.safeParse(entry.name);
        if (!digest.success || prefix.name !== entry.name.slice(0, 2)) {
          warnings.push(`Unexpected blob path: ${prefix.name}/${entry.name}`);
          continue;
        }
        actualBlobs.add(digest.data);
      }
    }
    const orphanBlobs = [...actualBlobs].filter((digest) => !referenced.has(digest));
    if (orphanBlobs.length > 0) warnings.push(`${orphanBlobs.length} unreferenced blob(s) found`);

    let manifestFiles = 0;
    let orphanManifests = 0;
    let manifestDirectories: Dirent[] = [];
    try {
      manifestDirectories = await fs.readdir(this.layout.manifestRoot, { withFileTypes: true });
    } catch (error) {
      if (errorCode(error) !== "ENOENT") {
        errors.push(`Cannot scan manifests: ${error instanceof Error ? error.message : error}`);
      }
    }
    for (const directory of manifestDirectories) {
      if (!directory.isDirectory() || !ScenarioIdSchema.safeParse(directory.name).success) {
        warnings.push(`Unexpected entry in manifest root: ${directory.name}`);
        continue;
      }
      for (const entry of await fs.readdir(path.join(this.layout.manifestRoot, directory.name), {
        withFileTypes: true,
      })) {
        if (!entry.isFile() || !/^\d{16}\.json$/u.test(entry.name)) {
          warnings.push(`Unexpected manifest path: ${directory.name}/${entry.name}`);
          continue;
        }
        manifestFiles += 1;
        const fullPath = path.join(this.layout.manifestRoot, directory.name, entry.name);
        if (!visibleManifestPaths.has(fullPath)) orphanManifests += 1;
      }
    }
    if (orphanManifests > 0) warnings.push(`${orphanManifests} unreferenced manifest generation(s) found`);

    return {
      ok: errors.length === 0,
      errors,
      warnings,
      counts: {
        folders: catalog.folders.length,
        scenarios: catalog.scenarios.length,
        manifests: manifestFiles,
        recordings,
        referencedBlobs: referenced.size,
        orphanBlobs: orphanBlobs.length,
        orphanManifests,
      },
    };
  }
}

export { StoreCorruptionError } from "./errors.js";
