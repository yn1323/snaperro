import {
  MAX_CATALOG_SERIALIZED_BYTES,
  MAX_SCENARIO_MANIFEST_BYTES,
  serializedJsonUtf8Bytes,
} from "../../../shared/contracts-v2/entities.js";
import { AggregateLimitExceededError } from "./errors.js";

export function assertSerializedAggregateLimit(resource: string, limit: number, value: unknown, pretty = false): void {
  const actual = serializedJsonUtf8Bytes(value, pretty);
  if (actual > limit) throw new AggregateLimitExceededError(resource, limit, actual);
}

export function assertCatalogSerializedLimit(value: unknown): void {
  assertSerializedAggregateLimit("catalog serialized bytes", MAX_CATALOG_SERIALIZED_BYTES, value);
}

export function assertPersistedCatalogSerializedLimit(value: unknown): void {
  const actual = new TextEncoder().encode(`${JSON.stringify(value)}\n`).byteLength;
  if (actual > MAX_CATALOG_SERIALIZED_BYTES) {
    throw new AggregateLimitExceededError("persisted catalog serialized bytes", MAX_CATALOG_SERIALIZED_BYTES, actual);
  }
}

export function assertScenarioManifestSerializedLimit(value: unknown): void {
  assertSerializedAggregateLimit("scenario manifest serialized bytes", MAX_SCENARIO_MANIFEST_BYTES, value, true);
}
