import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { compileConfigV2 } from "../../server/v2/config/config.js";
import { MigrationRequiredError } from "../../server/v2/domain/errors.js";
import { FilesystemStore } from "../../server/v2/store/filesystem-store.js";
import { Sha256Schema } from "../../shared/contracts-v2/primitives.js";
import {
  applyStartOverrides,
  assertMigrationReady,
  EnvFileOverlay,
  type StartCommandDependencies,
  startCommand,
} from "./start.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

async function project() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "snaperro-start-v2-"));
  directories.push(directory);
  return directory;
}

function config(directory: string) {
  return compileConfigV2(
    { configVersion: 2, server: { openBrowser: false }, apis: {} },
    path.join(directory, "snaperro.config.ts"),
  );
}

describe("v2 start preparation", () => {
  it("validates CLI port overrides", async () => {
    const directory = await project();
    expect(applyStartOverrides(config(directory), { port: "4444" }).server.port).toBe(4444);
    expect(applyStartOverrides(config(directory), { skipBrowser: true }).server.openBrowser).toBe(false);
    expect(() => applyStartOverrides(config(directory), { port: "0" })).toThrow("Invalid port");
    expect(() => applyStartOverrides(config(directory), { port: "12x" })).toThrow("Invalid port");
  });

  it("requires explicit migration when only a v1 source exists", async () => {
    const directory = await project();
    await fs.mkdir(path.join(directory, ".snaperro", "files", "legacy"), { recursive: true });

    await expect(assertMigrationReady(config(directory))).rejects.toBeInstanceOf(MigrationRequiredError);

    await new FilesystemStore(path.join(directory, ".snaperro", "v2")).initialize({
      importedFrom: {
        format: "snaperro-v1",
        fingerprint: Sha256Schema.parse("a".repeat(64)),
        filesCount: 0,
        bytes: 0,
      },
    });
    await expect(assertMigrationReady(config(directory))).resolves.toBeUndefined();
  });

  it("rejects legacy data paired with an unrelated native v2 store", async () => {
    const directory = await project();
    await fs.mkdir(path.join(directory, ".snaperro", "files", "legacy"), { recursive: true });
    await new FilesystemStore(path.join(directory, ".snaperro", "v2")).initialize();

    await expect(assertMigrationReady(config(directory))).rejects.toMatchObject({
      code: "MIGRATION_REQUIRED",
      details: { conflict: true },
    });
  });

  it("ignores a root-level legacy .gitkeep", async () => {
    const directory = await project();
    const legacyRoot = path.join(directory, ".snaperro", "files");
    await fs.mkdir(legacyRoot, { recursive: true });
    await fs.writeFile(path.join(legacyRoot, ".gitkeep"), "", "utf8");

    await expect(assertMigrationReady(config(directory))).resolves.toBeUndefined();
  });

  it("reloads env values while preserving shell-owned variables", async () => {
    const directory = await project();
    const envPath = path.join(directory, ".env");
    const environment: NodeJS.ProcessEnv = { SHELL_VALUE: "from-shell" };
    const overlay = new EnvFileOverlay(envPath, environment);
    await fs.writeFile(envPath, "FILE_VALUE=one\nSHELL_VALUE=ignored\n");

    await overlay.reload();
    expect(environment).toEqual({ FILE_VALUE: "one", SHELL_VALUE: "from-shell" });
    await fs.writeFile(envPath, "FILE_VALUE=two\nADDED=later\n");
    await overlay.reload();
    expect(environment).toEqual({ FILE_VALUE: "two", ADDED: "later", SHELL_VALUE: "from-shell" });

    overlay.restore();
    expect(environment).toEqual({ SHELL_VALUE: "from-shell" });
  });

  it("rolls back a candidate env overlay when config reload fails", async () => {
    const directory = await project();
    const envPath = path.join(directory, ".env");
    const environment: NodeJS.ProcessEnv = { SHELL_VALUE: "from-shell" };
    const overlay = new EnvFileOverlay(envPath, environment);
    await fs.writeFile(envPath, "FILE_VALUE=old\nREMOVED_ON_SUCCESS=old\nSHELL_VALUE=ignored\n");
    await overlay.reload();

    await fs.writeFile(envPath, "FILE_VALUE=candidate\nADDED_BY_CANDIDATE=new\nSHELL_VALUE=still-ignored\n");
    await expect(
      overlay.withReloadedEnvironment(async () => {
        expect(environment).toEqual({
          FILE_VALUE: "candidate",
          ADDED_BY_CANDIDATE: "new",
          SHELL_VALUE: "from-shell",
        });
        throw new Error("candidate runtime failed");
      }),
    ).rejects.toThrow("candidate runtime failed");

    expect(environment).toEqual({
      FILE_VALUE: "old",
      REMOVED_ON_SUCCESS: "old",
      SHELL_VALUE: "from-shell",
    });

    await overlay.withReloadedEnvironment(async () => undefined);
    expect(environment).toEqual({
      FILE_VALUE: "candidate",
      ADDED_BY_CANDIDATE: "new",
      SHELL_VALUE: "from-shell",
    });
  });

  it("restores the environment and stops every initialized resource when watcher startup fails", async () => {
    const directory = await project();
    const configPath = path.join(directory, "snaperro.config.ts");
    const envPath = path.join(directory, ".env");
    const environment: NodeJS.ProcessEnv = { SHELL_VALUE: "from-shell" };
    const overlay = new EnvFileOverlay(envPath, environment);
    await fs.writeFile(envPath, "FILE_VALUE=from-file\nSHELL_VALUE=ignored\n", "utf8");
    const compiled = config(directory);
    const serverStop = vi.fn(async () => {
      throw new Error("server stop failed");
    });
    const server = {
      start: vi.fn(async () => ({
        host: "127.0.0.1",
        port: 3333,
        origin: "http://127.0.0.1:3333",
        clientUrl: "http://127.0.0.1:3333/__snaperro__/client",
        demoUrl: "http://127.0.0.1:3333/__snaperro__/demo",
      })),
      stop: serverStop,
      reload: vi.fn(),
    };
    const watcherStartError = new Error("watcher start failed");
    const watcherStop = vi.fn(async () => {
      throw new Error("watcher stop failed");
    });
    const dependencies: StartCommandDependencies = {
      createEnvironment: () => overlay,
      loadConfig: vi.fn(async () => compiled),
      createServer: vi.fn(async () => server as never),
      createWatcher: () => ({
        start: vi.fn(() => {
          throw watcherStartError;
        }),
        stop: watcherStop,
      }),
    };

    const failure = await startCommand({ config: configPath, env: envPath, skipBrowser: true }, dependencies).catch(
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as Error & { cause?: unknown }).cause).toBe(watcherStartError);
    expect((failure as AggregateError).errors).toEqual([
      watcherStartError,
      expect.objectContaining({
        errors: [
          expect.objectContaining({ message: "watcher stop failed" }),
          expect.objectContaining({ message: "server stop failed" }),
        ],
      }),
    ]);
    expect(watcherStop).toHaveBeenCalledOnce();
    expect(serverStop).toHaveBeenCalledOnce();
    expect(watcherStop.mock.invocationCallOrder[0]).toBeLessThan(serverStop.mock.invocationCallOrder[0] ?? 0);
    expect(environment).toEqual({ SHELL_VALUE: "from-shell" });
  });

  it("removes signal listeners and restores the environment even when shutdown steps fail", async () => {
    const directory = await project();
    const configPath = path.join(directory, "snaperro.config.ts");
    const envPath = path.join(directory, ".env");
    const environment: NodeJS.ProcessEnv = {};
    const overlay = new EnvFileOverlay(envPath, environment);
    await fs.writeFile(envPath, "FILE_VALUE=from-file\n", "utf8");
    const serverStop = vi.fn(async () => {
      throw new Error("server stop failed");
    });
    const watcherStop = vi.fn(async () => {
      throw new Error("watcher stop failed");
    });
    const beforeSigint = process.listenerCount("SIGINT");
    const beforeSigterm = process.listenerCount("SIGTERM");
    const started = await startCommand(
      { config: configPath, env: envPath, skipBrowser: true },
      {
        createEnvironment: () => overlay,
        loadConfig: vi.fn(async () => config(directory)),
        createServer: vi.fn(
          async () =>
            ({
              start: vi.fn(async () => ({
                host: "127.0.0.1",
                port: 3333,
                origin: "http://127.0.0.1:3333",
                clientUrl: "http://127.0.0.1:3333/__snaperro__/client",
                demoUrl: "http://127.0.0.1:3333/__snaperro__/demo",
              })),
              stop: serverStop,
              reload: vi.fn(),
            }) as never,
        ),
        createWatcher: () => ({ start: vi.fn(), stop: watcherStop }),
      },
    );
    expect(process.listenerCount("SIGINT")).toBe(beforeSigint + 1);
    expect(process.listenerCount("SIGTERM")).toBe(beforeSigterm + 1);

    const first = started.stop();
    const second = started.stop();
    expect(first).toBe(second);
    await expect(first).rejects.toMatchObject({
      errors: [
        expect.objectContaining({ message: "watcher stop failed" }),
        expect.objectContaining({ message: "server stop failed" }),
      ],
    });

    expect(watcherStop).toHaveBeenCalledOnce();
    expect(serverStop).toHaveBeenCalledOnce();
    expect(watcherStop.mock.invocationCallOrder[0]).toBeLessThan(serverStop.mock.invocationCallOrder[0] ?? 0);
    expect(process.listenerCount("SIGINT")).toBe(beforeSigint);
    expect(process.listenerCount("SIGTERM")).toBe(beforeSigterm);
    expect(environment).toEqual({});
  });

  it("stops the server and restores the environment while watcher shutdown is still pending", async () => {
    const directory = await project();
    const configPath = path.join(directory, "snaperro.config.ts");
    const envPath = path.join(directory, ".env");
    const environment: NodeJS.ProcessEnv = {};
    const overlay = new EnvFileOverlay(envPath, environment);
    await fs.writeFile(envPath, "FILE_VALUE=from-file\n", "utf8");
    let finishWatcherStop: (() => void) | undefined;
    const watcherStop = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishWatcherStop = resolve;
        }),
    );
    const serverStop = vi.fn(async () => undefined);
    const started = await startCommand(
      { config: configPath, env: envPath, skipBrowser: true },
      {
        createEnvironment: () => overlay,
        loadConfig: vi.fn(async () => config(directory)),
        createServer: vi.fn(
          async () =>
            ({
              start: vi.fn(async () => ({
                host: "127.0.0.1",
                port: 3333,
                origin: "http://127.0.0.1:3333",
                clientUrl: "http://127.0.0.1:3333/__snaperro__/client",
                demoUrl: "http://127.0.0.1:3333/__snaperro__/demo",
              })),
              stop: serverStop,
              reload: vi.fn(),
            }) as never,
        ),
        createWatcher: () => ({ start: vi.fn(), stop: watcherStop }),
      },
    );

    const stopping = started.stop();
    await vi.waitFor(() => expect(serverStop).toHaveBeenCalledOnce());
    expect(environment).toEqual({});
    finishWatcherStop?.();
    await stopping;
  });

  it("still stops the server and restores the environment when watcher stop throws synchronously", async () => {
    const directory = await project();
    const configPath = path.join(directory, "snaperro.config.ts");
    const envPath = path.join(directory, ".env");
    const environment: NodeJS.ProcessEnv = {};
    const overlay = new EnvFileOverlay(envPath, environment);
    await fs.writeFile(envPath, "FILE_VALUE=from-file\n", "utf8");
    const watcherError = new Error("watcher stop threw");
    const serverStop = vi.fn(async () => undefined);
    const started = await startCommand(
      { config: configPath, env: envPath, skipBrowser: true },
      {
        createEnvironment: () => overlay,
        loadConfig: vi.fn(async () => config(directory)),
        createServer: vi.fn(
          async () =>
            ({
              start: vi.fn(async () => ({
                host: "127.0.0.1",
                port: 3333,
                origin: "http://127.0.0.1:3333",
                clientUrl: "http://127.0.0.1:3333/__snaperro__/client",
                demoUrl: "http://127.0.0.1:3333/__snaperro__/demo",
              })),
              stop: serverStop,
              reload: vi.fn(),
            }) as never,
        ),
        createWatcher: () => ({
          start: vi.fn(),
          stop: vi.fn(() => {
            throw watcherError;
          }),
        }),
      },
    );

    await expect(started.stop()).rejects.toMatchObject({ errors: [watcherError] });
    expect(serverStop).toHaveBeenCalledOnce();
    expect(environment).toEqual({});
  });

  it("finishes startup without awaiting an uncooperative browser launcher", async () => {
    const directory = await project();
    const configPath = path.join(directory, "snaperro.config.ts");
    const compiled = config(directory);
    const browserEnabled = {
      ...compiled,
      server: { ...compiled.server, openBrowser: true },
    };
    const serverStop = vi.fn(async () => undefined);
    const started = await startCommand(
      { config: configPath, watch: false },
      {
        loadConfig: vi.fn(async () => browserEnabled),
        createServer: vi.fn(
          async () =>
            ({
              start: vi.fn(async () => ({
                host: "127.0.0.1",
                port: 3333,
                origin: "http://127.0.0.1:3333",
                clientUrl: "http://127.0.0.1:3333/__snaperro__/client",
                demoUrl: "http://127.0.0.1:3333/__snaperro__/demo",
              })),
              stop: serverStop,
              reload: vi.fn(),
            }) as never,
        ),
        openBrowser: vi.fn(() => new Promise<never>(() => undefined)),
      },
    );

    await started.stop();
    expect(serverStop).toHaveBeenCalledOnce();
  });
});
