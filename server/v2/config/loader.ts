import fs from "node:fs/promises";
import path from "node:path";
import { createJiti } from "jiti";
import type { CompiledSnaperroConfigV2 } from "./config.js";
import { compileConfigV2 } from "./config.js";

export class ConfigLoadError extends Error {
  constructor(
    readonly configPath: string,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ConfigLoadError";
  }
}

export interface LoadConfigV2Options {
  disableCache?: boolean;
}

export async function loadConfigV2(
  configPath = path.resolve(process.cwd(), "snaperro.config.ts"),
  options: LoadConfigV2Options = {},
): Promise<CompiledSnaperroConfigV2> {
  const resolvedPath = path.resolve(configPath);
  try {
    await fs.access(resolvedPath);
  } catch (error) {
    const code = error instanceof Error && "code" in error ? String(error.code) : undefined;
    if (code === "ENOENT") {
      throw new ConfigLoadError(resolvedPath, `Config file was not found: ${resolvedPath}`, error);
    }
    throw new ConfigLoadError(resolvedPath, `Config file cannot be accessed: ${resolvedPath}`, error);
  }

  try {
    const jiti = createJiti(import.meta.url, {
      moduleCache: !(options.disableCache ?? false),
      fsCache: !(options.disableCache ?? false),
    });
    const imported = (await jiti.import(resolvedPath)) as { default?: unknown };
    if (!("default" in imported)) {
      throw new ConfigLoadError(resolvedPath, "The config file must have a default export");
    }
    return compileConfigV2(imported.default as never, resolvedPath);
  } catch (error) {
    if (error instanceof ConfigLoadError) throw error;
    throw new ConfigLoadError(
      resolvedPath,
      `Could not load config file: ${error instanceof Error ? error.message : String(error)}`,
      error,
    );
  }
}
