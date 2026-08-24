import type { CompiledSnaperroConfigV2 } from "../config/config.js";

export interface ImmutableConfigSnapshot {
  storageRoot: string;
  maxImportBytes: number;
  host: string;
  port: number;
  openBrowser: boolean;
  allowedOrigins: readonly string[];
  controlToken: string | undefined;
  shutdownTimeoutMs: number;
}

export class ImmutableConfigChangeError extends Error {
  constructor(readonly paths: readonly string[]) {
    super(`Config reload cannot change stable runtime settings: ${paths.join(", ")}`);
    this.name = "ImmutableConfigChangeError";
  }
}

function normalizedOrigins(origins: readonly string[]): string[] {
  return [...new Set(origins)].sort();
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function captureImmutableConfig(config: CompiledSnaperroConfigV2): ImmutableConfigSnapshot {
  return {
    storageRoot: config.storage.root,
    maxImportBytes: config.storage.maxImportBytes,
    host: config.server.host,
    port: config.server.port,
    openBrowser: config.server.openBrowser,
    allowedOrigins: normalizedOrigins(config.server.allowedOrigins),
    controlToken: config.server.controlToken,
    shutdownTimeoutMs: config.server.shutdownTimeoutMs,
  };
}

export function immutableConfigChanges(
  baseline: ImmutableConfigSnapshot,
  candidate: CompiledSnaperroConfigV2,
): string[] {
  const next = captureImmutableConfig(candidate);
  const changes: string[] = [];
  if (baseline.storageRoot !== next.storageRoot) changes.push("storage.root");
  if (baseline.maxImportBytes !== next.maxImportBytes) changes.push("storage.maxImportBytes");
  if (baseline.host !== next.host) changes.push("server.host");
  if (baseline.port !== next.port) changes.push("server.port");
  if (baseline.openBrowser !== next.openBrowser) changes.push("server.openBrowser");
  if (!sameStrings(baseline.allowedOrigins, next.allowedOrigins)) changes.push("server.allowedOrigins");
  if (baseline.controlToken !== next.controlToken) changes.push("server.controlToken");
  if (baseline.shutdownTimeoutMs !== next.shutdownTimeoutMs) changes.push("server.shutdownTimeoutMs");
  return changes;
}

export function assertReloadCompatible(baseline: ImmutableConfigSnapshot, candidate: CompiledSnaperroConfigV2): void {
  const changes = immutableConfigChanges(baseline, candidate);
  if (changes.length > 0) throw new ImmutableConfigChangeError(changes);
}
