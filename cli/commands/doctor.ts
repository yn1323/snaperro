import fs from "node:fs/promises";
import path from "node:path";
import type { CompiledSnaperroConfigV2 } from "../../server/v2/config/config.js";
import { loadConfigV2 } from "../../server/v2/config/loader.js";
import { FilesystemStore } from "../../server/v2/store/filesystem-store.js";
import { inspectMigrationReadiness } from "../../server/v2/store/migration-readiness.js";
import type { IntegrityReport, StoreMetadata } from "../../server/v2/store/types.js";
import { type CommandOutput, errorSummary, printable, processCommandOutput, writeJson } from "../command-output.js";
import { EnvFileOverlay } from "./start.js";

export interface DoctorCommandOptions {
  config?: string;
  env?: string;
  json?: boolean;
}

type DoctorCheckStatus = "pass" | "warning" | "fail" | "skip";

export interface DoctorCheck {
  name: "node" | "config" | "storage" | "legacy" | "metadata" | "integrity";
  status: DoctorCheckStatus;
  code?: string;
  message: string;
  details?: unknown;
}

interface DoctorStore {
  readMetadata(): Promise<StoreMetadata>;
  verifyIntegrity(): Promise<IntegrityReport>;
}

export interface DoctorCommandDependencies {
  cwd?: string;
  nodeVersion?: string;
  loadConfig?: (
    configPath: string,
  ) => Promise<Pick<CompiledSnaperroConfigV2, "storage"> & Partial<Pick<CompiledSnaperroConfigV2, "configDirectory">>>;
  createStore?: (root: string) => DoctorStore;
  createEnvironment?: (filePath: string) => Pick<EnvFileOverlay, "reload" | "restore">;
  output?: CommandOutput;
}

export interface DoctorCommandResult {
  command: "doctor";
  ok: boolean;
  configPath: string;
  storageRoot: string;
  legacySource: string;
  checks: DoctorCheck[];
}

function nodeVersionIsSupported(version: string): boolean {
  const match = /^v?(\d+)\.(\d+)(?:\.|$)/u.exec(version);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > 22 || (major === 22 && minor >= 12);
}

interface PathInspection {
  kind: "missing" | "directory" | "other";
  error?: { name: string; message: string };
}

async function inspectPath(target: string): Promise<PathInspection> {
  try {
    return { kind: (await fs.stat(target)).isDirectory() ? "directory" : "other" };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return { kind: "missing" };
    return { kind: "missing", error: errorSummary(error) };
  }
}

function checkLine(check: DoctorCheck): string {
  const label = check.status.toUpperCase();
  const code = check.code ? ` (${printable(check.code)})` : "";
  return `[${label}] ${check.name}${code}: ${printable(check.message)}`;
}

function writeHumanResult(output: CommandOutput, result: DoctorCommandResult): void {
  const lines = [
    result.ok ? "Doctor checks passed." : "Doctor found blocking problems.",
    `Config: ${printable(result.configPath)}`,
    `Storage: ${printable(result.storageRoot)}`,
    ...result.checks.map(checkLine),
  ];
  const integrity = result.checks.find((check) => check.name === "integrity")?.details as IntegrityReport | undefined;
  if (integrity) {
    const counts = integrity.counts;
    lines.push(
      `  counts: folders=${counts.folders} scenarios=${counts.scenarios} recordings=${counts.recordings} blobs=${counts.referencedBlobs}`,
      ...integrity.warnings.map((message) => `  warning: ${printable(message)}`),
      ...integrity.errors.map((message) => `  error: ${printable(message)}`),
    );
  }
  const message = `${lines.join("\n")}\n`;
  if (result.ok) output.stdout(message);
  else output.stderr(message);
}

export async function doctorCommand(
  options: DoctorCommandOptions,
  dependencies: DoctorCommandDependencies = {},
): Promise<number> {
  const cwd = dependencies.cwd ?? process.cwd();
  const nodeVersion = dependencies.nodeVersion ?? process.versions.node;
  const output = dependencies.output ?? processCommandOutput;
  const loadConfig = dependencies.loadConfig ?? ((target: string) => loadConfigV2(target, { disableCache: true }));
  const createStore = dependencies.createStore ?? ((root: string) => new FilesystemStore(root));
  const configPath = path.resolve(cwd, options.config ?? "snaperro.config.ts");
  const envPath = options.env ? path.resolve(cwd, options.env) : path.join(path.dirname(configPath), ".env");
  const environment = dependencies.createEnvironment?.(envPath) ?? new EnvFileOverlay(envPath);
  let legacySource = path.resolve(path.dirname(configPath), ".snaperro/files");
  let storageRoot = path.resolve(path.dirname(configPath), ".snaperro/v2");
  const checks: DoctorCheck[] = [];

  checks.push(
    nodeVersionIsSupported(nodeVersion)
      ? { name: "node", status: "pass", message: `Node.js ${nodeVersion} satisfies >=22.12` }
      : {
          name: "node",
          status: "fail",
          code: "UnsupportedNode",
          message: `Node.js ${nodeVersion} does not satisfy >=22.12`,
        },
  );

  try {
    await environment.reload();
    const config = await loadConfig(configPath);
    legacySource = path.resolve(config.configDirectory ?? path.dirname(configPath), ".snaperro/files");
    storageRoot = path.isAbsolute(config.storage.root)
      ? config.storage.root
      : path.resolve(path.dirname(configPath), config.storage.root);
    checks.push({ name: "config", status: "pass", message: "v2 config loaded successfully" });
  } catch (error) {
    const summary = errorSummary(error);
    checks.push({
      name: "config",
      status: "fail",
      code: "ConfigInvalid",
      message: `${summary.name}: ${summary.message}`,
    });
  } finally {
    environment.restore();
  }

  const [storageInspection, legacyInspection, migrationReadiness] = await Promise.all([
    inspectPath(storageRoot),
    inspectPath(legacySource),
    inspectMigrationReadiness(legacySource, storageRoot),
  ]);
  const storageKind = storageInspection.kind;
  if (storageInspection.error) {
    checks.push({
      name: "storage",
      status: "fail",
      code: "StorageUnreadable",
      message: `${storageInspection.error.name}: ${storageInspection.error.message}`,
    });
  }

  if (!checks.some((check) => check.name === "storage")) {
    if (storageKind === "directory") {
      checks.push({ name: "storage", status: "pass", message: "v2 storage directory exists" });
    } else if (storageKind === "other") {
      checks.push({
        name: "storage",
        status: "fail",
        code: "StorageInvalid",
        message: "Configured v2 storage path is not a directory",
      });
    } else if (migrationReadiness.status === "migration-required") {
      checks.push({
        name: "storage",
        status: "fail",
        code: "MigrationRequired",
        message: 'Only v1 data exists; run "snaperro migrate" before starting v2',
      });
    } else {
      checks.push({
        name: "storage",
        status: "fail",
        code: "StorageMissing",
        message: "Configured v2 storage directory does not exist",
      });
    }
  }

  if (legacyInspection.error || migrationReadiness.legacySource === "invalid") {
    checks.push({
      name: "legacy",
      status: "fail",
      code: "LegacySourceUnreadable",
      message: legacyInspection.error
        ? `${legacyInspection.error.name}: ${legacyInspection.error.message}`
        : "The legacy source path is not a readable directory",
    });
  } else if (migrationReadiness.legacySource === "migratable") {
    checks.push({
      name: "legacy",
      status: migrationReadiness.status === "migration-conflict" ? "fail" : "warning",
      code: migrationReadiness.status === "migration-conflict" ? "MigrationConflict" : "LegacySourcePresent",
      message:
        migrationReadiness.status === "migration-conflict"
          ? "Migratable v1 data conflicts with a v2 destination that has no matching migration provenance"
          : "A migratable v1 source is present and remains unchanged",
    });
  } else if (migrationReadiness.legacySource === "empty") {
    checks.push({ name: "legacy", status: "pass", message: "No migratable data was found in the legacy source" });
  } else {
    checks.push({ name: "legacy", status: "pass", message: "No legacy source directory was found" });
  }

  if (storageKind !== "directory") {
    checks.push(
      { name: "metadata", status: "skip", message: "Skipped because v2 storage is unavailable" },
      { name: "integrity", status: "skip", message: "Skipped because v2 storage is unavailable" },
    );
  } else {
    const store = createStore(storageRoot);
    try {
      const metadata = await store.readMetadata();
      checks.push({
        name: "metadata",
        status: "pass",
        message: `Store metadata is valid (schema ${metadata.schemaVersion})`,
        details: { schemaVersion: metadata.schemaVersion, storeId: metadata.storeId },
      });
    } catch (error) {
      const summary = errorSummary(error);
      checks.push({
        name: "metadata",
        status: "fail",
        code: "MetadataInvalid",
        message: `${summary.name}: ${summary.message}`,
      });
    }

    try {
      const integrity = await store.verifyIntegrity();
      checks.push({
        name: "integrity",
        status: integrity.ok ? (integrity.warnings.length > 0 ? "warning" : "pass") : "fail",
        code: integrity.ok ? (integrity.warnings.length > 0 ? "IntegrityWarnings" : undefined) : "IntegrityFailed",
        message: integrity.ok
          ? integrity.warnings.length > 0
            ? `Integrity passed with ${integrity.warnings.length} warning(s)`
            : "Store integrity passed"
          : `Store integrity failed with ${integrity.errors.length} error(s)`,
        details: integrity,
      });
    } catch (error) {
      const summary = errorSummary(error);
      checks.push({
        name: "integrity",
        status: "fail",
        code: "IntegrityFailed",
        message: `${summary.name}: ${summary.message}`,
      });
    }
  }

  const result: DoctorCommandResult = {
    command: "doctor",
    ok: !checks.some((check) => check.status === "fail"),
    configPath,
    storageRoot,
    legacySource,
    checks,
  };
  if (options.json) writeJson(output, result);
  else writeHumanResult(output, result);
  return result.ok ? 0 : 1;
}
