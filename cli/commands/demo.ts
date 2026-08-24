import path from "node:path";
import { consola } from "consola";
import open from "open";
import { ApiError } from "../../client/src/v2/infrastructure/api-error.js";
import { V2HttpClient } from "../../client/src/v2/infrastructure/http-client.js";
import { loadConfigV2 } from "../../server/v2/config/loader.js";
import { V2_CONTROL_BASE_PATH } from "../../shared/contracts-v2/transport.js";

export interface DemoOptions {
  port?: string;
  config?: string;
}

export interface DemoCommandDependencies {
  fetch?: typeof globalThis.fetch;
  loadConfig?: (configPath: string) => Promise<{ server: { host: string; port: number } }>;
  open?: (url: string) => Promise<unknown>;
}

function parsePort(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!/^\d+$/u.test(value)) throw new TypeError(`Invalid port: ${value}`);
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) throw new TypeError(`Invalid port: ${value}`);
  return port;
}

function browserHost(host: string): string {
  if (host === "0.0.0.0") return "127.0.0.1";
  if (host === "::") return "[::1]";
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

async function demoOrigin(options: DemoOptions, dependencies: DemoCommandDependencies): Promise<string> {
  const portOverride = parsePort(options.port);
  if (portOverride !== undefined && options.config === undefined) {
    return `http://127.0.0.1:${portOverride}`;
  }
  const configPath = path.resolve(process.cwd(), options.config ?? "snaperro.config.ts");
  const config = await (dependencies.loadConfig ?? loadConfigV2)(configPath);
  return `http://${browserHost(config.server.host)}:${portOverride ?? config.server.port}`;
}

/**
 * demo command
 * Open demo page in browser (requires server to be running)
 */
export async function demoCommand(options: DemoOptions, dependencies: DemoCommandDependencies = {}): Promise<void> {
  const origin = await demoOrigin(options, dependencies);
  const demoUrl = `${origin}/__snaperro__/demo`;
  const request = dependencies.fetch ?? globalThis.fetch;
  const openPage = dependencies.open ?? open;
  const client = new V2HttpClient({ baseUrl: `${origin}${V2_CONTROL_BASE_PATH}`, fetch: request });

  try {
    await client.snapshot();
  } catch (cause) {
    if (!(cause instanceof ApiError && cause.code === "UNAUTHORIZED" && cause.status === 401)) {
      if (cause instanceof ApiError && cause.status !== null) {
        throw new Error(`Server rejected the demo check at ${origin}: ${cause.code}: ${cause.message}`, { cause });
      }
      throw new Error(`Server is not running at ${origin}. Start it first with: npx snaperro start`, { cause });
    }
  }

  consola.success(`Opening demo page: ${demoUrl}`);
  await openPage(demoUrl);
}
