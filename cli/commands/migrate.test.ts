import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CommandOutput } from "../command-output.js";
import { migrateCommand } from "./migrate.js";

function captureOutput(): { output: CommandOutput; stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    output: {
      stdout: (message) => stdout.push(message),
      stderr: (message) => stderr.push(message),
    },
  };
}

function v1File() {
  return {
    endpoint: "/users",
    method: "GET",
    request: { pathParams: {}, queryParams: {}, headers: {}, body: null },
    response: { status: 200, headers: { "content-type": "application/json" }, body: [{ id: 1 }] },
  };
}

describe("migrateCommand", () => {
  let cwd: string;
  let sourceFile: string;
  let original: string;

  beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), "snaperro-migrate-command-"));
    sourceFile = path.join(cwd, ".snaperro", "files", "demo", "users_001.json");
    await fs.mkdir(path.dirname(sourceFile), { recursive: true });
    original = `${JSON.stringify(v1File(), null, 2)}\n`;
    await fs.writeFile(sourceFile, original, "utf8");
    await fs.writeFile(
      path.join(cwd, ".snaperro", "state.json"),
      `${JSON.stringify({ mode: "mock", currentScenario: "demo" })}\n`,
      "utf8",
    );
  });

  afterEach(async () => {
    await fs.rm(cwd, { recursive: true, force: true });
  });

  it("uses safe defaults and emits a machine-readable dry-run report without writes", async () => {
    const capture = captureOutput();
    const code = await migrateCommand({ dryRun: true, json: true }, { cwd, output: capture.output });

    expect(code).toBe(0);
    expect(capture.stderr).toEqual([]);
    const result = JSON.parse(capture.stdout.join("")) as {
      ok: boolean;
      result: string;
      report: { sourceRoot: string; destinationRoot: string; integrity?: unknown };
    };
    expect(result).toMatchObject({ ok: true, result: "dry-run" });
    expect(result.report.sourceRoot).toBe(path.join(cwd, ".snaperro", "files"));
    expect(result.report.destinationRoot).toBe(path.join(cwd, ".snaperro", "v2"));
    expect(result.report.integrity).toBeUndefined();
    await expect(fs.access(path.join(cwd, ".snaperro", "v2"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await fs.readFile(sourceFile, "utf8")).toBe(original);
  });

  it("migrates once, verifies integrity, and reports an idempotent repeat", async () => {
    const first = captureOutput();
    expect(await migrateCommand({}, { cwd, output: first.output })).toBe(0);
    expect(first.stdout.join("")).toContain("Migration completed successfully");
    expect(await fs.readFile(sourceFile, "utf8")).toBe(original);

    const repeated = captureOutput();
    expect(await migrateCommand({ json: true }, { cwd, output: repeated.output })).toBe(0);
    const result = JSON.parse(repeated.stdout.join("")) as {
      result: string;
      report: { alreadyApplied: boolean; integrity: { ok: boolean } };
    };
    expect(result).toMatchObject({
      result: "already-applied",
      report: { alreadyApplied: true, integrity: { ok: true } },
    });
  });

  it("fails closed for invalid source data and an unrelated existing destination", async () => {
    await fs.writeFile(sourceFile, "{broken", "utf8");
    const invalid = captureOutput();
    expect(await migrateCommand({ dryRun: true }, { cwd, output: invalid.output })).toBe(1);
    expect(invalid.stderr.join("")).toContain("Migration dry run failed");
    await expect(fs.access(path.join(cwd, ".snaperro", "v2"))).rejects.toMatchObject({ code: "ENOENT" });

    await fs.writeFile(sourceFile, original, "utf8");
    const destination = path.join(cwd, "existing-v2");
    await fs.mkdir(destination);
    const marker = path.join(destination, "keep.txt");
    await fs.writeFile(marker, "owned by user", "utf8");
    const existing = captureOutput();
    expect(await migrateCommand({ destination, json: true }, { cwd, output: existing.output })).toBe(1);
    expect(JSON.parse(existing.stdout.join(""))).toMatchObject({ ok: false, result: "failed" });
    expect(await fs.readFile(marker, "utf8")).toBe("owned by user");
    expect(await fs.readFile(sourceFile, "utf8")).toBe(original);
  });
});
