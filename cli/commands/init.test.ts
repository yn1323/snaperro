import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FilesystemStore } from "../../server/v2/store/filesystem-store.js";
import { initCommand } from "./init.js";

const directories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe("initCommand", () => {
  it("creates an idempotent v2 project without a legacy store", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "snaperro-init-v2-"));
    directories.push(cwd);

    await initCommand({ cwd });
    const store = new FilesystemStore(path.join(cwd, ".snaperro", "v2"));
    const firstCatalog = await store.catalogs.read();

    expect(firstCatalog.folders.map((folder) => folder.name)).toEqual(["Samples"]);
    expect(firstCatalog.scenarios.map((scenario) => scenario.name)).toEqual(["demo", "demo-empty", "demo-error"]);
    expect(firstCatalog.currentScenarioId).toBe(
      firstCatalog.scenarios.find((scenario) => scenario.name === "demo")?.id,
    );
    expect(firstCatalog.scenarios.reduce((total, scenario) => total + scenario.recordingsCount, 0)).toBeGreaterThan(0);
    await expect(fs.access(path.join(cwd, ".snaperro", "files"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.readFile(path.join(cwd, "snaperro.config.ts"), "utf8")).resolves.toContain("configVersion: 2");
    await expect(fs.readFile(path.join(cwd, ".gitignore"), "utf8")).resolves.toContain(".snaperro/v2/");

    await initCommand({ cwd });

    expect(await store.catalogs.read()).toEqual(firstCatalog);
    expect((await store.verifyIntegrity()).ok).toBe(true);
  }, 15_000);

  it("stops before writing any v2 project files when legacy data needs migration", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "snaperro-init-legacy-"));
    directories.push(cwd);
    const legacyFile = path.join(cwd, ".snaperro", "files", "legacy", "users.json");
    await fs.mkdir(path.dirname(legacyFile), { recursive: true });
    await fs.writeFile(legacyFile, "{}\n", "utf8");

    await expect(initCommand({ cwd })).rejects.toThrow("snaperro migrate --dry-run");

    await expect(fs.readFile(legacyFile, "utf8")).resolves.toBe("{}\n");
    await expect(fs.access(path.join(cwd, ".snaperro", "v2"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.access(path.join(cwd, "snaperro.config.ts"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.access(path.join(cwd, ".gitignore"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("allows initialization when the legacy root contains only .gitkeep", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "snaperro-init-empty-legacy-"));
    directories.push(cwd);
    const legacyRoot = path.join(cwd, ".snaperro", "files");
    await fs.mkdir(legacyRoot, { recursive: true });
    await fs.writeFile(path.join(legacyRoot, ".gitkeep"), "", "utf8");

    await initCommand({ cwd });

    await expect(fs.access(path.join(cwd, ".snaperro", "v2", "store.json"))).resolves.toBeUndefined();
    await expect(fs.readFile(path.join(legacyRoot, ".gitkeep"), "utf8")).resolves.toBe("");
  }, 15_000);

  it("adds an active ignore rule when only commented or negated lookalikes exist", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "snaperro-init-gitignore-"));
    directories.push(cwd);
    const gitignorePath = path.join(cwd, ".gitignore");
    await fs.writeFile(gitignorePath, "# .snaperro/v2/\n!.snaperro/v2/\n", "utf8");

    await initCommand({ cwd });

    const lines = (await fs.readFile(gitignorePath, "utf8")).split(/\r?\n/u);
    expect(lines.filter((line) => line === ".snaperro/v2/")).toHaveLength(1);
  }, 15_000);

  it("preserves an existing .gitignore when reading it fails for a reason other than missing", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "snaperro-init-gitignore-error-"));
    directories.push(cwd);
    await initCommand({ cwd });
    const gitignorePath = path.join(cwd, ".gitignore");
    const original = "keep-this-rule\n";
    await fs.writeFile(gitignorePath, original, "utf8");

    const realReadFile = fs.readFile.bind(fs);
    const readError = Object.assign(new Error("simulated .gitignore read failure"), { code: "EIO" });
    const readSpy = vi.spyOn(fs, "readFile").mockImplementation(async (...args: Parameters<typeof fs.readFile>) => {
      if (String(args[0]) === gitignorePath) throw readError;
      return realReadFile(...args);
    });

    await expect(initCommand({ cwd })).rejects.toBe(readError);
    readSpy.mockRestore();
    await expect(fs.readFile(gitignorePath, "utf8")).resolves.toBe(original);
  }, 15_000);

  it("does not overwrite config or ignore rules created by another initializer", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "snaperro-init-race-"));
    directories.push(cwd);
    const configPath = path.join(cwd, "snaperro.config.ts");
    const gitignorePath = path.join(cwd, ".gitignore");
    const realWriteFile = fs.writeFile.bind(fs);
    let racedConfig = false;
    let racedGitignore = false;
    vi.spyOn(fs, "writeFile").mockImplementation(async (...args: Parameters<typeof fs.writeFile>) => {
      const target = String(args[0]);
      const options = args[2];
      const exclusive = typeof options === "object" && options !== null && "flag" in options && options.flag === "wx";
      if (target === configPath && exclusive && !racedConfig) {
        racedConfig = true;
        await realWriteFile(configPath, "// created concurrently\n", "utf8");
      }
      if (target === gitignorePath && exclusive && !racedGitignore) {
        racedGitignore = true;
        await realWriteFile(gitignorePath, "keep-this-rule\n", "utf8");
      }
      return realWriteFile(...args);
    });

    await initCommand({ cwd });

    expect(await fs.readFile(configPath, "utf8")).toBe("// created concurrently\n");
    expect(await fs.readFile(gitignorePath, "utf8")).toContain("keep-this-rule\n");
    expect(await fs.readFile(gitignorePath, "utf8")).toContain(".snaperro/v2/");
  }, 15_000);

  it("reports a published sample store and safely completes on retry after parent fsync failure", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "snaperro-init-durability-"));
    directories.push(cwd);
    const storageParent = path.join(cwd, ".snaperro");
    const storageRoot = path.join(storageParent, "v2");
    const realOpen = fs.open.bind(fs);
    const durabilityError = Object.assign(new Error("simulated parent fsync failure"), { code: "EIO" });
    vi.spyOn(fs, "open").mockImplementation(async (...args: Parameters<typeof fs.open>) => {
      if (String(args[0]) === storageParent && args[1] === "r") {
        return {
          sync: async () => {
            throw durabilityError;
          },
          close: async () => undefined,
        } as unknown as Awaited<ReturnType<typeof fs.open>>;
      }
      return realOpen(...args);
    });

    await expect(initCommand({ cwd })).rejects.toThrow("sample store was published at");
    await expect(fs.access(path.join(storageRoot, "store.json"))).resolves.toBeUndefined();
    await expect(fs.access(path.join(cwd, "snaperro.config.ts"))).rejects.toMatchObject({ code: "ENOENT" });

    vi.restoreAllMocks();
    await initCommand({ cwd });
    const store = new FilesystemStore(storageRoot);
    expect((await store.verifyIntegrity()).ok).toBe(true);
    await expect(fs.readFile(path.join(cwd, "snaperro.config.ts"), "utf8")).resolves.toContain("configVersion: 2");
    await expect(fs.readFile(path.join(cwd, ".gitignore"), "utf8")).resolves.toContain(".snaperro/v2/");
  }, 15_000);

  it("keeps the init failure primary and exposes a failed staging cleanup", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "snaperro-init-cleanup-"));
    directories.push(cwd);
    const storageParent = path.join(cwd, ".snaperro");
    const storageRoot = path.join(storageParent, "v2");
    const realRename = fs.rename.bind(fs);
    const realRm = fs.rm.bind(fs);
    const initError = Object.assign(new Error("simulated sample store rename failure"), { code: "EIO" });
    const cleanupError = Object.assign(new Error("simulated staging cleanup failure"), { code: "EACCES" });
    vi.spyOn(fs, "rename").mockImplementation(async (...args: Parameters<typeof fs.rename>) => {
      if (String(args[1]) === storageRoot) throw initError;
      return realRename(...args);
    });
    vi.spyOn(fs, "rm").mockImplementation(async (...args: Parameters<typeof fs.rm>) => {
      const target = String(args[0]);
      if (path.dirname(target) === storageParent && path.basename(target).startsWith(".v2.init.")) {
        throw cleanupError;
      }
      return realRm(...args);
    });

    const failure = await initCommand({ cwd }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AggregateError);
    if (!(failure instanceof AggregateError)) throw new Error("Expected AggregateError");
    expect(failure.message).toContain("simulated sample store rename failure");
    expect(failure.message).toContain("simulated staging cleanup failure");
    expect(failure.errors).toEqual([initError, cleanupError]);
    await expect(fs.access(storageRoot)).rejects.toMatchObject({ code: "ENOENT" });
    const siblings = await fs.readdir(storageParent);
    expect(siblings.some((entry) => entry.startsWith(".v2.init."))).toBe(true);
  }, 15_000);
});
