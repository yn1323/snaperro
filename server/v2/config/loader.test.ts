import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type ConfigLoadError, loadConfigV2 } from "./loader.js";

const directories: string[] = [];

async function tempDirectory(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(process.cwd(), ".config-loader-"));
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe("loadConfigV2", () => {
  it("loads TypeScript and resolves storage relative to the config file", async () => {
    const directory = await tempDirectory();
    const configPath = path.join(directory, "snaperro.config.ts");
    await fs.writeFile(
      configPath,
      `export default {
        configVersion: 2,
        storage: { root: "data" },
        apis: { jsonPlaceholder: { name: "Users", target: "https://example.com", routes: ["/users"] } }
      }`,
    );

    const config = await loadConfigV2(configPath);

    expect(config.storage.root).toBe(path.join(directory, "data"));
    expect(config.routeTable.match("GET", "/users")?.apiKey).toBe("jsonPlaceholder");
  });

  it("does not serve a stale module after cache is disabled", async () => {
    const directory = await tempDirectory();
    const configPath = path.join(directory, "snaperro.config.ts");
    const source = (port: number) => `export default { configVersion: 2, server: { port: ${port} }, apis: {} }`;
    await fs.writeFile(configPath, source(3333));
    expect((await loadConfigV2(configPath)).server.port).toBe(3333);
    await fs.writeFile(configPath, source(4444));
    expect((await loadConfigV2(configPath, { disableCache: true })).server.port).toBe(4444);
  });

  it("reports the resolved path for a missing config", async () => {
    const missing = path.resolve("does-not-exist.config.ts");
    await expect(loadConfigV2(missing)).rejects.toMatchObject({
      name: "ConfigLoadError",
      configPath: missing,
    } satisfies Partial<ConfigLoadError>);
  });

  it("does not misreport a missing imported dependency as a missing config", async () => {
    const directory = await tempDirectory();
    const configPath = path.join(directory, "snaperro.config.ts");
    await fs.writeFile(configPath, `import "definitely-missing-snaperro-test-package"; export default {}`);

    await expect(loadConfigV2(configPath)).rejects.toMatchObject({
      name: "ConfigLoadError",
      configPath,
      message: expect.stringContaining("Could not load config file"),
    });
  });
});
