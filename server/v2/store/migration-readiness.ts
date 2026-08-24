import type { Stats } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { MigrationRequiredError } from "../domain/errors.js";
import { FilesystemStore } from "./filesystem-store.js";

export type LegacySourceKind = "missing" | "empty" | "migratable" | "invalid";
export type V2DestinationKind = "missing" | "incomplete" | "native" | "migrated" | "invalid";
export type MigrationReadinessStatus = "ready" | "migration-required" | "migration-conflict";

export interface MigrationReadiness {
  legacySource: LegacySourceKind;
  destination: V2DestinationKind;
  status: MigrationReadinessStatus;
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error ? String(error.code) : undefined;
}

/**
 * Mirrors the v1 inventory boundary without reading recording bodies.
 *
 * A JSON file at any level is migration input. Every real child directory also
 * contains (or is itself) a leaf scenario, including a directory containing
 * only `.gitkeep`. Files such as a root-level `.gitkeep` are ignored by the v1
 * migrator and therefore do not make an otherwise empty source actionable.
 */
export async function inspectLegacySource(sourceRoot: string): Promise<LegacySourceKind> {
  let stat: Stats;
  try {
    stat = await fs.stat(sourceRoot);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return "missing";
    return "invalid";
  }
  if (!stat.isDirectory()) return "invalid";

  try {
    const entries = await fs.readdir(sourceRoot, { withFileTypes: true });
    return entries.some(
      (entry) => entry.isDirectory() || (entry.isFile() && entry.name.toLowerCase().endsWith(".json")),
    )
      ? "migratable"
      : "empty";
  } catch {
    return "invalid";
  }
}

async function inspectDestination(destinationRoot: string): Promise<V2DestinationKind> {
  let stat: Stats;
  try {
    stat = await fs.stat(destinationRoot);
  } catch (error) {
    return errorCode(error) === "ENOENT" ? "missing" : "invalid";
  }
  if (!stat.isDirectory()) return "invalid";

  try {
    const metadataStat = await fs.stat(path.join(destinationRoot, "store.json"));
    if (!metadataStat.isFile()) return "invalid";
  } catch (error) {
    return errorCode(error) === "ENOENT" ? "incomplete" : "invalid";
  }

  try {
    const metadata = await new FilesystemStore(destinationRoot).readMetadata();
    return metadata.importedFrom?.format === "snaperro-v1" ? "migrated" : "native";
  } catch {
    return "invalid";
  }
}

/** Shared, read-only decision used by init, start, and doctor. */
export async function inspectMigrationReadiness(
  sourceRoot: string,
  destinationRoot: string,
): Promise<MigrationReadiness> {
  const [legacySource, destination] = await Promise.all([
    inspectLegacySource(sourceRoot),
    inspectDestination(destinationRoot),
  ]);

  let status: MigrationReadinessStatus = "ready";
  if (legacySource === "invalid") status = "migration-conflict";
  else if (legacySource === "migratable" && destination === "missing") status = "migration-required";
  else if (legacySource === "migratable" && destination !== "migrated") status = "migration-conflict";

  return { legacySource, destination, status };
}

export async function assertMigrationReadiness(sourceRoot: string, destinationRoot: string): Promise<void> {
  const readiness = await inspectMigrationReadiness(sourceRoot, destinationRoot);
  if (readiness.status === "ready") return;
  throw new MigrationRequiredError(sourceRoot, {
    destinationRoot,
    conflict: readiness.status === "migration-conflict",
  });
}
