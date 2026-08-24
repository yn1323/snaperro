import { createHash } from "node:crypto";
import type { BodyRef, CatalogSnapshot, Recording, ScenarioManifest } from "../../../shared/contracts-v2/entities.js";
import { ServerSnapshotSchema } from "../../../shared/contracts-v2/entities.js";
import {
  type Cursor,
  CursorSchema,
  type FolderId,
  type RecordingId,
  type Revision,
  type RuntimeId,
  type ScenarioId,
  V2_SCHEMA_VERSION,
} from "../../../shared/contracts-v2/primitives.js";
import type { QueryOf, QueryResult } from "../../../shared/contracts-v2/queries.js";
import { EntityNotFoundError, InvalidArgumentError, RevisionConflictError } from "../domain/errors.js";
import type { QueryHandlerMap } from "./bus.js";
import type {
  BlobPinHandlePort,
  BlobStorePort,
  CatalogRepositoryPort,
  OperationContext,
  ScenarioManifestRepositoryPort,
} from "./ports.js";
import { toRecordingSummary } from "./service-support.js";
import { bodyContainsText } from "./stream-text-search.js";

interface CursorPayload {
  kind: "recording.list" | "recording.search";
  scenarioId: ScenarioId;
  revision: Revision;
  offset: number;
  searchHash?: string;
}

const DEFAULT_PIN_CLEANUP_TIMEOUT_MS = 5_000;

export interface FolderExportQueryPort {
  prepare(
    folderId: FolderId,
    catalog: CatalogSnapshot,
    context?: OperationContext,
  ): Promise<QueryResult<"folder.export">>;
}

export interface RecordingExportQueryPort {
  prepareRecording(
    recording: Recording,
    revision: Revision,
    scenarioRevision: Revision,
    context?: OperationContext,
  ): Promise<QueryResult<"recording.export">>;
}

export interface BodyDownloadQueryPort {
  prepareBody(
    body: BodyRef,
    filename: string,
    revision: Revision,
    context?: OperationContext,
  ): Promise<QueryResult<"body.download">>;
}

export interface QueryServiceDependencies {
  blobs: BlobStorePort;
  catalogs: CatalogRepositoryPort;
  manifests: ScenarioManifestRepositoryPort;
  folderExports: FolderExportQueryPort;
  recordingExports: RecordingExportQueryPort;
  bodyDownloads: BodyDownloadQueryPort;
  runtimeId: RuntimeId;
  version: string;
  pinCleanupTimeoutMs?: number;
}

function findScenario(catalog: CatalogSnapshot, scenarioId: ScenarioId) {
  const scenario = catalog.scenarios.find((candidate) => candidate.id === scenarioId);
  if (!scenario) throw new EntityNotFoundError("scenario", scenarioId);
  return scenario;
}

function findRecording(manifest: ScenarioManifest, recordingId: RecordingId): Recording {
  const recording = manifest.recordings.find((candidate) => candidate.id === recordingId);
  if (!recording) throw new EntityNotFoundError("recording", recordingId);
  return recording;
}

function encodeCursor(payload: CursorPayload): Cursor {
  return CursorSchema.parse(Buffer.from(JSON.stringify(payload), "utf8").toString("base64url"));
}

function decodeCursor(cursor: Cursor, expected: Omit<CursorPayload, "offset" | "revision">): CursorPayload {
  try {
    const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Partial<CursorPayload>;
    if (
      decoded.kind !== expected.kind ||
      decoded.scenarioId !== expected.scenarioId ||
      !Number.isSafeInteger(decoded.revision) ||
      Number(decoded.revision) < 0 ||
      !Number.isSafeInteger(decoded.offset) ||
      Number(decoded.offset) < 0 ||
      decoded.searchHash !== expected.searchHash
    ) {
      throw new Error("cursor does not belong to this query");
    }
    return decoded as CursorPayload;
  } catch (error) {
    throw new InvalidArgumentError("Invalid pagination cursor", {
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

function compareRecordings(left: Recording, right: Recording): number {
  return right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id);
}

function searchHash(text: string): string {
  return createHash("sha256").update(text.normalize("NFC").toLocaleLowerCase("en-US")).digest("hex");
}

async function releasePinWithin(pin: BlobPinHandlePort, timeoutMs: number): Promise<void> {
  let cleanup: Promise<void>;
  try {
    cleanup = pin.release().then(
      () => undefined,
      () => undefined,
    );
  } catch {
    // Search has completed and the pin record expires automatically. Cleanup
    // failure may over-retain a blob but must not retain the query result.
    return;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      cleanup,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function matchesSearch(
  blobs: BlobStorePort,
  recording: Recording,
  text: string,
  context: OperationContext,
): Promise<boolean> {
  const needle = text.normalize("NFC").toLocaleLowerCase("en-US");
  const metadata = JSON.stringify({
    filename: recording.filename,
    route: recording.route,
    method: recording.method,
    request: { ...recording.request, body: undefined },
    response: { ...recording.response, body: undefined },
  })
    .normalize("NFC")
    .toLocaleLowerCase("en-US");
  if (metadata.includes(needle)) return true;

  const checked = new Set<string>();
  for (const body of [recording.request.body, recording.response.body]) {
    if (!body || body.size === 0) continue;
    const key = `${body.sha256}:${body.size}`;
    if (checked.has(key)) continue;
    checked.add(key);
    if (await bodyContainsText(blobs, body, text, context)) return true;
  }
  return false;
}

export class ApplicationQueryService {
  readonly #pinCleanupTimeoutMs: number;

  constructor(private readonly dependencies: QueryServiceDependencies) {
    this.#pinCleanupTimeoutMs = dependencies.pinCleanupTimeoutMs ?? DEFAULT_PIN_CLEANUP_TIMEOUT_MS;
    if (!Number.isSafeInteger(this.#pinCleanupTimeoutMs) || this.#pinCleanupTimeoutMs < 1) {
      throw new TypeError("pinCleanupTimeoutMs must be a positive safe integer");
    }
  }

  handlers(): QueryHandlerMap {
    return {
      "runtime.snapshot": (query, context) => this.runtimeSnapshot(query, context),
      "folder.list": (query, context) => this.listFolders(query, context),
      "folder.export": (query, context) => this.exportFolder(query, context),
      "scenario.list": (query, context) => this.listScenarios(query, context),
      "scenario.get": (query, context) => this.getScenario(query, context),
      "recording.list": (query, context) => this.listRecordings(query, context),
      "recording.search": (query, context) => this.searchRecordings(query, context),
      "recording.get": (query, context) => this.getRecording(query, context),
      "recording.body": (query, context) => this.getRecordingBody(query, context),
      "recording.export": (query, context) => this.exportRecording(query, context),
      "body.download": (query, context) => this.downloadBody(query, context),
    };
  }

  async runtimeSnapshot(
    _query: QueryOf<"runtime.snapshot">,
    context: OperationContext = {},
  ): Promise<QueryResult<"runtime.snapshot">> {
    const catalog = await this.dependencies.catalogs.read(context);
    return ServerSnapshotSchema.parse({
      protocolVersion: V2_SCHEMA_VERSION,
      runtimeId: this.dependencies.runtimeId,
      revision: catalog.revision,
      version: this.dependencies.version,
      mode: catalog.mode,
      currentScenarioId: catalog.currentScenarioId,
      folders: Object.fromEntries(catalog.folders.map((folder) => [folder.id, { id: folder.id, name: folder.name }])),
      scenarios: Object.fromEntries(
        catalog.scenarios.map((scenario) => [
          scenario.id,
          { id: scenario.id, folderId: scenario.folderId, name: scenario.name },
        ]),
      ),
      // Recording metadata is intentionally paged through recording.list. This
      // keeps startup bounded even for stores containing hundreds of thousands
      // of captures.
    });
  }

  async listFolders(
    _query: QueryOf<"folder.list">,
    context: OperationContext = {},
  ): Promise<QueryResult<"folder.list">> {
    const catalog = await this.dependencies.catalogs.read(context);
    return { revision: catalog.revision, folders: [...catalog.folders] };
  }

  async exportFolder(
    query: QueryOf<"folder.export">,
    context: OperationContext = {},
  ): Promise<QueryResult<"folder.export">> {
    const catalog = await this.dependencies.catalogs.read(context);
    if (!catalog.folders.some((folder) => folder.id === query.folderId)) {
      throw new EntityNotFoundError("folder", query.folderId);
    }
    return this.dependencies.folderExports.prepare(query.folderId, catalog, context);
  }

  async listScenarios(
    query: QueryOf<"scenario.list">,
    context: OperationContext = {},
  ): Promise<QueryResult<"scenario.list">> {
    const catalog = await this.dependencies.catalogs.read(context);
    if (query.folderId && !catalog.folders.some((folder) => folder.id === query.folderId)) {
      throw new EntityNotFoundError("folder", query.folderId);
    }
    return {
      revision: catalog.revision,
      scenarios: query.folderId
        ? catalog.scenarios.filter((scenario) => scenario.folderId === query.folderId)
        : [...catalog.scenarios],
    };
  }

  async getScenario(
    query: QueryOf<"scenario.get">,
    context: OperationContext = {},
  ): Promise<QueryResult<"scenario.get">> {
    const catalog = await this.dependencies.catalogs.read(context);
    return { revision: catalog.revision, scenario: findScenario(catalog, query.scenarioId) };
  }

  async listRecordings(
    query: QueryOf<"recording.list">,
    context: OperationContext = {},
  ): Promise<QueryResult<"recording.list">> {
    return this.#recordingPage(query, context);
  }

  async searchRecordings(
    query: QueryOf<"recording.search">,
    context: OperationContext = {},
  ): Promise<QueryResult<"recording.search">> {
    return this.#recordingPage(query, context);
  }

  async getRecording(
    query: QueryOf<"recording.get">,
    context: OperationContext = {},
  ): Promise<QueryResult<"recording.get">> {
    const { catalog, manifest } = await this.#recordingView(query.scenarioId, context);
    return {
      revision: catalog.revision,
      scenarioRevision: manifest.revision,
      recording: findRecording(manifest, query.recordingId),
    };
  }

  async getRecordingBody(
    query: QueryOf<"recording.body">,
    context: OperationContext = {},
  ): Promise<QueryResult<"recording.body">> {
    const { catalog, manifest } = await this.#recordingView(query.scenarioId, context);
    const recording = findRecording(manifest, query.recordingId);
    return {
      revision: catalog.revision,
      recordingId: recording.id,
      target: query.target,
      body: recording[query.target].body,
    };
  }

  async exportRecording(
    query: QueryOf<"recording.export">,
    context: OperationContext = {},
  ): Promise<QueryResult<"recording.export">> {
    const { catalog, manifest } = await this.#recordingView(query.scenarioId, context);
    return this.dependencies.recordingExports.prepareRecording(
      findRecording(manifest, query.recordingId),
      catalog.revision,
      manifest.revision,
      context,
    );
  }

  async downloadBody(
    query: QueryOf<"body.download">,
    context: OperationContext = {},
  ): Promise<QueryResult<"body.download">> {
    const catalog = await this.dependencies.catalogs.read(context);
    return this.dependencies.bodyDownloads.prepareBody(query.body, query.filename, catalog.revision, context);
  }

  async #recordingPage(
    query: QueryOf<"recording.list"> | QueryOf<"recording.search">,
    context: OperationContext,
  ): Promise<QueryResult<"recording.list">> {
    const { catalog, manifest } = await this.#recordingView(query.scenarioId, context);
    const hash = query.type === "recording.search" ? searchHash(query.text) : undefined;
    const expectedCursor = { kind: query.type, scenarioId: query.scenarioId, searchHash: hash } as const;
    const decoded = query.cursor ? decodeCursor(query.cursor, expectedCursor) : undefined;
    if (decoded && decoded.revision !== manifest.revision) {
      throw new RevisionConflictError(decoded.revision, manifest.revision);
    }

    const recordings = [...manifest.recordings].sort(compareRecordings);
    const offset = decoded?.offset ?? 0;
    if (query.type === "recording.search") {
      const bodies = recordings.flatMap((recording) =>
        [recording.request.body, recording.response.body].filter((body): body is BodyRef => body !== null),
      );
      const pin = await this.dependencies.blobs.pinMany(bodies, context);
      try {
        // pinMany only holds the global store lease while installing the pins.
        // Revalidate the pointer after that short fence; the long body scan is
        // protected by active pins and never owns the global write lease.
        await this.dependencies.manifests.readAtRevision(
          query.scenarioId,
          catalog.revision,
          manifest.revision,
          context,
        );
        const matches: Array<{ index: number; recording: Recording }> = [];
        for (let index = offset; index < recordings.length; index += 1) {
          const recording = recordings[index];
          if (recording && (await matchesSearch(this.dependencies.blobs, recording, query.text, context))) {
            matches.push({ index, recording });
            if (matches.length > query.limit) break;
          }
        }
        const page = matches.slice(0, query.limit);
        const next = matches[query.limit];
        return {
          revision: catalog.revision,
          scenarioRevision: manifest.revision,
          items: page.map(({ recording }) => toRecordingSummary(recording)),
          nextCursor: next
            ? encodeCursor({
                ...expectedCursor,
                revision: manifest.revision,
                offset: next.index,
              })
            : null,
        };
      } finally {
        // Normal completion removes the pin before exposing the result, while
        // a wedged metadata cleanup remains bounded by the server deadline.
        await releasePinWithin(pin, this.#pinCleanupTimeoutMs);
      }
    }

    const page = recordings.slice(offset, offset + query.limit);
    const nextOffset = offset + page.length;
    return {
      revision: catalog.revision,
      scenarioRevision: manifest.revision,
      items: page.map(toRecordingSummary),
      nextCursor:
        nextOffset < recordings.length
          ? encodeCursor({
              ...expectedCursor,
              revision: manifest.revision,
              offset: nextOffset,
            })
          : null,
    };
  }

  async #recordingView(scenarioId: ScenarioId, context: OperationContext) {
    const catalog = await this.dependencies.catalogs.read(context);
    const scenario = findScenario(catalog, scenarioId);
    const manifest = await this.dependencies.manifests.readAtRevision(
      scenarioId,
      catalog.revision,
      scenario.revision,
      context,
    );
    return { catalog, manifest };
  }
}
