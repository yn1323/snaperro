import path from "node:path";
import type { MigrationIssue, V1MigrationReport } from "../../server/v2/store/types.js";
import { migrateV1Store, V1MigrationError, type V1MigrationOptions } from "../../server/v2/store/v1-migrator.js";
import { type CommandOutput, errorSummary, printable, processCommandOutput, writeJson } from "../command-output.js";

export interface MigrateCommandOptions {
  source?: string;
  destination?: string;
  state?: string;
  dryRun?: boolean;
  json?: boolean;
}

export interface MigrateCommandDependencies {
  cwd?: string;
  migrate?: (options: V1MigrationOptions) => Promise<V1MigrationReport>;
  output?: CommandOutput;
}

export interface MigrateCommandResult {
  command: "migrate";
  ok: boolean;
  dryRun: boolean;
  sourceRoot: string;
  destinationRoot: string;
  stateFile: string;
  result: "dry-run" | "migrated" | "already-applied" | "failed";
  report?: V1MigrationReport;
  error?: { name: string; message: string };
}

const MAX_HUMAN_ISSUES = 100;

function issueLines(label: string, issues: readonly MigrationIssue[]): string[] {
  if (issues.length === 0) return [`${label}: 0`];
  const shown = issues.slice(0, MAX_HUMAN_ISSUES);
  const lines = [
    `${label}: ${issues.length}`,
    ...shown.map((issue) => `  - ${printable(issue.path)}: ${printable(issue.message)}`),
  ];
  if (shown.length < issues.length) lines.push(`  - ... ${issues.length - shown.length} more`);
  return lines;
}

function reportLines(report: V1MigrationReport): string[] {
  const lines = [
    `Source: ${printable(report.sourceRoot)}`,
    `Destination: ${printable(report.destinationRoot)}`,
    `Preflight: ${report.errors.length === 0 && report.sourceUnchanged ? "passed" : "failed"}`,
    `Source files: ${report.sourceFiles}`,
    `Source bytes: ${report.sourceBytes}`,
    `Scenarios: ${report.scenarios.length}`,
    `Source unchanged: ${report.sourceUnchanged ? "yes" : "no"}`,
    ...issueLines("Warnings", report.warnings),
    ...issueLines("Errors", report.errors),
  ];
  if (report.integrity) {
    const counts = report.integrity.counts;
    lines.push(
      `Integrity: ${report.integrity.ok ? "passed" : "failed"}`,
      `  folders=${counts.folders} scenarios=${counts.scenarios} recordings=${counts.recordings} blobs=${counts.referencedBlobs}`,
      ...issueLines(
        "  Integrity warnings",
        report.integrity.warnings.map((message) => ({ path: "store", message })),
      ),
      ...issueLines(
        "  Integrity errors",
        report.integrity.errors.map((message) => ({ path: "store", message })),
      ),
    );
  } else {
    lines.push("Integrity: not run");
  }
  return lines;
}

function writeHumanResult(output: CommandOutput, result: MigrateCommandResult): void {
  const heading = result.dryRun
    ? result.ok
      ? "Migration dry run passed; no files were written."
      : "Migration dry run failed; no files were written."
    : result.result === "already-applied"
      ? "Migration was already applied and the destination is valid."
      : result.result === "migrated"
        ? "Migration completed successfully; the v1 source was not modified."
        : "Migration failed; the v1 source was not modified.";
  const lines = [heading, `State: ${printable(result.stateFile)}`];
  if (!result.report) {
    lines.push(`Source: ${printable(result.sourceRoot)}`, `Destination: ${printable(result.destinationRoot)}`);
  }
  if (result.error) lines.push(`Failure: ${printable(result.error.name)}: ${printable(result.error.message)}`);
  if (result.report) lines.push(...reportLines(result.report));
  const message = `${lines.join("\n")}\n`;
  if (result.ok) output.stdout(message);
  else output.stderr(message);
}

export async function migrateCommand(
  options: MigrateCommandOptions,
  dependencies: MigrateCommandDependencies = {},
): Promise<number> {
  const cwd = dependencies.cwd ?? process.cwd();
  const output = dependencies.output ?? processCommandOutput;
  const migrate = dependencies.migrate ?? migrateV1Store;
  const migrationOptions: V1MigrationOptions = {
    sourceRoot: path.resolve(cwd, options.source ?? ".snaperro/files"),
    destinationRoot: path.resolve(cwd, options.destination ?? ".snaperro/v2"),
    stateFile: path.resolve(cwd, options.state ?? ".snaperro/state.json"),
    dryRun: options.dryRun ?? false,
  };

  let result: MigrateCommandResult;
  try {
    const report = await migrate(migrationOptions);
    const integrityPassed = report.dryRun ? (report.integrity?.ok ?? true) : report.integrity?.ok === true;
    const ok = report.errors.length === 0 && report.sourceUnchanged && integrityPassed;
    result = {
      command: "migrate",
      ok,
      dryRun: migrationOptions.dryRun ?? false,
      sourceRoot: migrationOptions.sourceRoot,
      destinationRoot: migrationOptions.destinationRoot,
      stateFile: migrationOptions.stateFile ?? path.resolve(cwd, ".snaperro/state.json"),
      result: ok ? (report.dryRun ? "dry-run" : report.alreadyApplied ? "already-applied" : "migrated") : "failed",
      report,
    };
  } catch (error) {
    result = {
      command: "migrate",
      ok: false,
      dryRun: migrationOptions.dryRun ?? false,
      sourceRoot: migrationOptions.sourceRoot,
      destinationRoot: migrationOptions.destinationRoot,
      stateFile: migrationOptions.stateFile ?? path.resolve(cwd, ".snaperro/state.json"),
      result: "failed",
      error: errorSummary(error),
      report: error instanceof V1MigrationError ? error.report : undefined,
    };
  }

  if (options.json) writeJson(output, result);
  else writeHumanResult(output, result);
  return result.ok ? 0 : 1;
}
