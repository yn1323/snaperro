import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FilesystemStore } from "../../server/v2/store/filesystem-store.js";
import { newFolderId, newScenarioId } from "../../server/v2/store/ids.js";
import {
  CatalogSnapshotSchema,
  FolderSchema,
  ScenarioManifestSchema,
  ScenarioSchema,
} from "../../shared/contracts-v2/entities.js";
import { RevisionSchema, V2_SCHEMA_VERSION } from "../../shared/contracts-v2/primitives.js";
import type { CommandOutput } from "../command-output.js";
import { doctorCommand } from "./doctor.js";
import { EnvFileOverlay } from "./start.js";

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

async function treeDigest(root: string): Promise<string> {
  const records: string[] = [];
  const walk = async (directory: string): Promise<void> => {
    for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      const target = path.join(directory, entry.name);
      const relative = path.relative(root, target).split(path.sep).join("/");
      if (entry.isDirectory()) {
        records.push(`d:${relative}`);
        await walk(target);
      } else if (entry.isFile()) {
        records.push(
          `${relative}:${createHash("sha256")
            .update(await fs.readFile(target))
            .digest("hex")}`,
        );
      }
    }
  };
  await walk(root);
  return createHash("sha256").update(records.join("\n")).digest("hex");
}

describe("doctorCommand", () => {
  let cwd: string;
  let storageRoot: string;

  beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), "snaperro-doctor-command-"));
    storageRoot = path.join(cwd, "store");
  });

  afterEach(async () => {
    await fs.rm(cwd, { recursive: true, force: true });
  });

  const loadConfig = async () => ({ storage: { root: storageRoot, maxImportBytes: 1024 } });

  it("validates a healthy store in JSON mode without modifying it", async () => {
    await new FilesystemStore(storageRoot).initialize();
    const before = await treeDigest(storageRoot);
    const capture = captureOutput();

    const code = await doctorCommand(
      { json: true },
      { cwd, nodeVersion: "22.12.0", loadConfig, output: capture.output },
    );

    expect(code).toBe(0);
    expect(capture.stderr).toEqual([]);
    const result = JSON.parse(capture.stdout.join("")) as {
      ok: boolean;
      checks: Array<{ name: string; status: string }>;
    };
    expect(result.ok).toBe(true);
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "metadata", status: "pass" }),
        expect.objectContaining({ name: "integrity", status: "pass" }),
      ]),
    );
    expect(await treeDigest(storageRoot)).toBe(before);
  });

  it("loads the default config-adjacent env file and restores the process overlay", async () => {
    await new FilesystemStore(storageRoot).initialize();
    const environment: NodeJS.ProcessEnv = { SHELL_VALUE: "from-shell" };
    await fs.writeFile(path.join(cwd, ".env"), "DOCTOR_FILE_VALUE=from-file\nSHELL_VALUE=ignored\n", "utf8");
    const capture = captureOutput();

    const code = await doctorCommand(
      { json: true },
      {
        cwd,
        nodeVersion: "22.12.0",
        createEnvironment: (filePath) => new EnvFileOverlay(filePath, environment),
        loadConfig: async () => {
          expect(environment).toEqual({ DOCTOR_FILE_VALUE: "from-file", SHELL_VALUE: "from-shell" });
          return { storage: { root: storageRoot, maxImportBytes: 1024 } };
        },
        output: capture.output,
      },
    );

    expect(code).toBe(0);
    expect(environment).toEqual({ SHELL_VALUE: "from-shell" });
  });

  it("reports a catalog/manifest revision mismatch and refuses to initialize it", async () => {
    const store = new FilesystemStore(storageRoot);
    await store.initialize();
    const folderId = newFolderId();
    const scenarioId = newScenarioId();
    const zero = RevisionSchema.parse(0);
    const one = RevisionSchema.parse(1);
    await store.manifests.create(
      ScenarioManifestSchema.parse({
        schemaVersion: V2_SCHEMA_VERSION,
        scenarioId,
        revision: zero,
        recordings: [],
      }),
    );
    const folder = FolderSchema.parse({
      id: folderId,
      name: "Folder",
      revision: zero,
      createdAt: "2026-08-24T00:00:00.000Z",
      updatedAt: "2026-08-24T00:00:00.000Z",
    });
    const scenario = ScenarioSchema.parse({
      id: scenarioId,
      folderId,
      name: "Scenario",
      revision: zero,
      recordingsCount: 0,
      createdAt: "2026-08-24T00:00:00.000Z",
      updatedAt: "2026-08-24T00:00:00.000Z",
    });
    await store.catalogs.compareAndSwap(
      zero,
      CatalogSnapshotSchema.parse({
        schemaVersion: V2_SCHEMA_VERSION,
        revision: one,
        mode: "smart",
        currentScenarioId: scenarioId,
        folders: [folder],
        scenarios: [scenario],
      }),
    );

    const catalogPath = path.join(storageRoot, "catalog.json");
    const persisted = JSON.parse(await fs.readFile(catalogPath, "utf8")) as {
      scenarios: Array<{ revision: number }>;
    };
    if (!persisted.scenarios[0]) throw new Error("Expected persisted scenario");
    persisted.scenarios[0].revision = 1;
    await fs.writeFile(catalogPath, `${JSON.stringify(persisted, null, 2)}\n`, "utf8");
    const before = await treeDigest(storageRoot);

    await expect(store.catalogs.read()).rejects.toThrow(/manifest pointer/u);
    await expect(new FilesystemStore(storageRoot).initialize()).rejects.toThrow(/manifest pointer/u);
    const capture = captureOutput();
    const code = await doctorCommand(
      { json: true },
      { cwd, nodeVersion: "22.12.0", loadConfig, output: capture.output },
    );

    expect(code).toBe(1);
    const result = JSON.parse(capture.stdout.join("")) as {
      checks: Array<{ name: string; status: string; code?: string; details?: { errors?: string[] } }>;
    };
    expect(result.checks).toContainEqual(
      expect.objectContaining({
        name: "integrity",
        status: "fail",
        code: "IntegrityFailed",
        details: expect.objectContaining({
          errors: expect.arrayContaining([expect.stringMatching(/manifest pointer/u)]),
        }),
      }),
    );
    expect(await treeDigest(storageRoot)).toBe(before);
  });

  it("reports MigrationRequired when only the legacy source exists and creates nothing", async () => {
    const legacy = path.join(cwd, ".snaperro", "files", "demo");
    await fs.mkdir(legacy, { recursive: true });
    const capture = captureOutput();

    const code = await doctorCommand({}, { cwd, nodeVersion: "22.12.0", loadConfig, output: capture.output });

    expect(code).toBe(1);
    expect(capture.stderr.join("")).toContain("MigrationRequired");
    await expect(fs.access(storageRoot)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("fails when migratable legacy data is paired with a native v2 store", async () => {
    await new FilesystemStore(storageRoot).initialize();
    await fs.mkdir(path.join(cwd, ".snaperro", "files", "legacy"), { recursive: true });
    const capture = captureOutput();

    const code = await doctorCommand(
      { json: true },
      { cwd, nodeVersion: "22.12.0", loadConfig, output: capture.output },
    );

    expect(code).toBe(1);
    expect(JSON.parse(capture.stdout.join(""))).toMatchObject({
      ok: false,
      checks: expect.arrayContaining([
        expect.objectContaining({ name: "legacy", status: "fail", code: "MigrationConflict" }),
      ]),
    });
  });

  it("does not report a root-level legacy .gitkeep as pending migration", async () => {
    await new FilesystemStore(storageRoot).initialize();
    const legacyRoot = path.join(cwd, ".snaperro", "files");
    await fs.mkdir(legacyRoot, { recursive: true });
    await fs.writeFile(path.join(legacyRoot, ".gitkeep"), "", "utf8");
    const capture = captureOutput();

    const code = await doctorCommand(
      { json: true },
      { cwd, nodeVersion: "22.12.0", loadConfig, output: capture.output },
    );

    expect(code).toBe(0);
    expect(JSON.parse(capture.stdout.join(""))).toMatchObject({
      checks: expect.arrayContaining([expect.objectContaining({ name: "legacy", status: "pass" })]),
    });
  });

  it("resolves the legacy source beside an explicitly selected config", async () => {
    const projectRoot = path.join(cwd, "nested-project");
    const nestedStorage = path.join(projectRoot, ".snaperro", "v2");
    await new FilesystemStore(nestedStorage).initialize();
    await fs.mkdir(path.join(projectRoot, ".snaperro", "files", "legacy"), { recursive: true });
    const capture = captureOutput();

    const code = await doctorCommand(
      { config: path.join(projectRoot, "snaperro.config.ts"), json: true },
      {
        cwd,
        nodeVersion: "22.12.0",
        loadConfig: async () => ({
          configDirectory: projectRoot,
          storage: { root: nestedStorage, maxImportBytes: 1024 },
        }),
        output: capture.output,
      },
    );

    expect(code).toBe(1);
    expect(JSON.parse(capture.stdout.join(""))).toMatchObject({
      legacySource: path.join(projectRoot, ".snaperro", "files"),
      checks: expect.arrayContaining([expect.objectContaining({ code: "MigrationConflict" })]),
    });
  });

  it("fails an unsupported Node version while continuing the read-only store checks", async () => {
    await new FilesystemStore(storageRoot).initialize();
    const capture = captureOutput();

    const code = await doctorCommand(
      { json: true },
      { cwd, nodeVersion: "22.11.0", loadConfig, output: capture.output },
    );

    expect(code).toBe(1);
    const result = JSON.parse(capture.stdout.join("")) as {
      checks: Array<{ name: string; status: string; code?: string }>;
    };
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "node", status: "fail", code: "UnsupportedNode" }),
        expect.objectContaining({ name: "integrity", status: "pass" }),
      ]),
    );
  });

  it("reports config loading failures as structured JSON", async () => {
    const capture = captureOutput();
    const configPath = path.join("nested", "snaperro.config.ts");
    const code = await doctorCommand(
      { config: configPath, json: true },
      {
        cwd,
        nodeVersion: "23.0.0",
        loadConfig: async () => {
          throw new Error("invalid config");
        },
        output: capture.output,
      },
    );

    expect(code).toBe(1);
    expect(JSON.parse(capture.stdout.join(""))).toMatchObject({
      ok: false,
      storageRoot: path.join(cwd, "nested", ".snaperro", "v2"),
      checks: expect.arrayContaining([expect.objectContaining({ name: "config", code: "ConfigInvalid" })]),
    });
  });
});
