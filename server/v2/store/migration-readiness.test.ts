import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Sha256Schema } from "../../../shared/contracts-v2/primitives.js";
import { FilesystemStore } from "./filesystem-store.js";
import { inspectLegacySource, inspectMigrationReadiness } from "./migration-readiness.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

async function project(): Promise<{ root: string; source: string; destination: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "snaperro-readiness-"));
  directories.push(root);
  return {
    root,
    source: path.join(root, ".snaperro", "files"),
    destination: path.join(root, ".snaperro", "v2"),
  };
}

describe("migration readiness", () => {
  it("does not treat an empty root or a root-level .gitkeep as migratable data", async () => {
    const paths = await project();
    await fs.mkdir(paths.source, { recursive: true });
    expect(await inspectLegacySource(paths.source)).toBe("empty");
    await fs.writeFile(path.join(paths.source, ".gitkeep"), "", "utf8");

    expect(await inspectLegacySource(paths.source)).toBe("empty");
    await expect(inspectMigrationReadiness(paths.source, paths.destination)).resolves.toMatchObject({
      status: "ready",
    });
  });

  it("treats an empty scenario directory as migration input", async () => {
    const paths = await project();
    await fs.mkdir(path.join(paths.source, "empty-scenario"), { recursive: true });
    await fs.writeFile(path.join(paths.source, "empty-scenario", ".gitkeep"), "", "utf8");

    await expect(inspectMigrationReadiness(paths.source, paths.destination)).resolves.toEqual({
      legacySource: "migratable",
      destination: "missing",
      status: "migration-required",
    });
  });

  it("distinguishes an unrelated native store from a v1-migrated destination", async () => {
    const paths = await project();
    await fs.mkdir(path.join(paths.source, "scenario"), { recursive: true });
    const native = new FilesystemStore(paths.destination);
    await native.initialize();
    await expect(inspectMigrationReadiness(paths.source, paths.destination)).resolves.toMatchObject({
      destination: "native",
      status: "migration-conflict",
    });

    const migratedRoot = path.join(paths.root, ".snaperro", "migrated");
    await new FilesystemStore(migratedRoot).initialize({
      importedFrom: {
        format: "snaperro-v1",
        fingerprint: Sha256Schema.parse("a".repeat(64)),
        filesCount: 0,
        bytes: 0,
      },
    });
    await expect(inspectMigrationReadiness(paths.source, migratedRoot)).resolves.toMatchObject({
      destination: "migrated",
      status: "ready",
    });
  });
});
