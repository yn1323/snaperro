import { createHash, randomUUID } from "node:crypto";
import {
  DisplayNameSchema,
  type FolderId,
  FolderIdSchema,
  type RecordingId,
  RecordingIdSchema,
  type ScenarioId,
  ScenarioIdSchema,
  type Sha256,
  Sha256Schema,
} from "../../../shared/contracts-v2/primitives.js";

export function sha256(data: string | Uint8Array): Sha256 {
  return Sha256Schema.parse(createHash("sha256").update(data).digest("hex"));
}

function framed(parts: readonly string[]): string {
  return parts.map((part) => `${Buffer.byteLength(part, "utf8")}:${part}`).join("|");
}

function migratedMaterial(kind: string, sourceIdentity: string): string {
  return sha256(framed(["snaperro-v1", kind, sourceIdentity]));
}

function randomMaterial(): string {
  return randomUUID().replaceAll("-", "");
}

export function normalizeDisplayName(name: string): string {
  return DisplayNameSchema.parse(name.normalize("NFC"));
}

export function newFolderId(): FolderId {
  return FolderIdSchema.parse(`fld_${randomMaterial()}`);
}

export function newScenarioId(): ScenarioId {
  return ScenarioIdSchema.parse(`scn_${randomMaterial()}`);
}

export function newRecordingId(): RecordingId {
  return RecordingIdSchema.parse(`rec_${randomMaterial()}`);
}

export function migratedFolderId(sourceIdentity: string): FolderId {
  return FolderIdSchema.parse(`fld_${migratedMaterial("folder", sourceIdentity).slice(0, 32)}`);
}

export function migratedScenarioId(sourceIdentity: string): ScenarioId {
  return ScenarioIdSchema.parse(`scn_${migratedMaterial("scenario", sourceIdentity).slice(0, 32)}`);
}

export function migratedRecordingId(sourceIdentity: string): RecordingId {
  return RecordingIdSchema.parse(`rec_${migratedMaterial("recording", sourceIdentity).slice(0, 32)}`);
}

export function scenarioEtag(id: ScenarioId, revision: number): string {
  if (!Number.isSafeInteger(revision) || revision < 0) throw new Error(`Invalid scenario revision: ${revision}`);
  return `"${id}-${revision}"`;
}
