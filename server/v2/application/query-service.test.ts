import { describe, expect, it, vi } from "vitest";
import {
  type CatalogSnapshot,
  CatalogSnapshotSchema,
  type ScenarioManifest,
  ScenarioManifestSchema,
} from "../../../shared/contracts-v2/entities.js";
import {
  FolderIdSchema,
  RecordingIdSchema,
  RequestFingerprintSchema,
  RuntimeIdSchema,
  ScenarioIdSchema,
  Sha256Schema,
  V2_SCHEMA_VERSION,
} from "../../../shared/contracts-v2/primitives.js";
import { RevisionConflictError } from "../domain/errors.js";
import type { BlobStorePort } from "./ports.js";
import type { FolderExportQueryPort } from "./query-service.js";
import { ApplicationQueryService } from "./query-service.js";

const folderId = FolderIdSchema.parse("fld_0123456789abcdef");
const scenarioId = ScenarioIdSchema.parse("scn_0123456789abcdef");
const runtimeId = RuntimeIdSchema.parse("run_0123456789abcdef");
const timestamp = "2026-08-24T00:00:00.000Z";

function catalog(): CatalogSnapshot {
  return CatalogSnapshotSchema.parse({
    schemaVersion: V2_SCHEMA_VERSION,
    revision: 4,
    mode: "mock",
    currentScenarioId: scenarioId,
    folders: [{ id: folderId, name: "Team", revision: 0, createdAt: timestamp, updatedAt: timestamp }],
    scenarios: [
      {
        id: scenarioId,
        folderId,
        name: "Success",
        revision: 2,
        recordingsCount: 3,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
  });
}

function manifest(revision = 2): ScenarioManifest {
  return ScenarioManifestSchema.parse({
    schemaVersion: V2_SCHEMA_VERSION,
    scenarioId,
    revision,
    recordings: ["alpha.json", "bravo.json", "charlie.json"].map((filename, index) => ({
      id: RecordingIdSchema.parse(`rec_0123456789abcde${index}`),
      scenarioId,
      filename,
      revision: 0,
      route: index === 1 ? "/orders/:id" : "/users/:id",
      method: index === 1 ? "POST" : "GET",
      requestFingerprint: RequestFingerprintSchema.parse(String(index).repeat(64)),
      request: { pathParams: {}, query: [], headers: [], body: null },
      response: {
        status: 200,
        statusText: "OK",
        headers: [],
        body: {
          sha256: Sha256Schema.parse(String(index).repeat(64)),
          size: index + 1,
          mediaType: "application/json",
          contentEncoding: null,
        },
      },
      createdAt: timestamp,
      updatedAt: `2026-08-24T00:00:0${index}.000Z`,
    })),
  });
}

function service(
  getManifest = () => manifest(),
  bodyText: Readonly<Record<string, string>> = {},
  readAtRevision?: (
    scenarioId: ScenarioManifest["scenarioId"],
    catalogRevision: CatalogSnapshot["revision"],
    scenarioRevision: ScenarioManifest["revision"],
  ) => Promise<ScenarioManifest>,
  blobOverrides: Partial<BlobStorePort> = {},
  pinCleanupTimeoutMs?: number,
) {
  const download = {
    downloadPath: `/__snaperro__/downloads/${"a".repeat(43)}`,
    expiresAt: timestamp,
    filename: "Team.zip",
    mediaType: "application/zip",
    size: 10,
  };
  const folderExports: FolderExportQueryPort = {
    prepare: async (_folderId, current) => ({
      revision: current.revision,
      download,
    }),
  };
  const blobs = {
    open: async (body: { sha256: string }) => new Blob([bodyText[body.sha256] ?? ""]).stream(),
    pin: async () => ({ release: async () => undefined }),
    pinMany: async () => ({ release: async () => undefined }),
    ...blobOverrides,
  } as unknown as BlobStorePort;
  return new ApplicationQueryService({
    blobs,
    catalogs: { read: async () => catalog(), compareAndSwap: async () => catalog() },
    manifests: {
      read: async () => getManifest(),
      readAtRevision:
        readAtRevision ??
        (async (_scenarioId, _catalogRevision, scenarioRevision) => {
          const current = getManifest();
          if (current.revision !== scenarioRevision) {
            throw new RevisionConflictError(scenarioRevision, current.revision);
          }
          return current;
        }),
      create: async () => undefined,
      markForGarbageCollection: async () => undefined,
    },
    folderExports,
    recordingExports: { prepareRecording: async (_recording, revision) => ({ revision, download }) },
    bodyDownloads: { prepareBody: async (_body, _filename, revision) => ({ revision, download }) },
    runtimeId,
    version: "2.0.0",
    pinCleanupTimeoutMs,
  });
}

describe("ApplicationQueryService", () => {
  it("builds a bounded startup snapshot without eagerly loading recording manifests", async () => {
    let manifestReads = 0;
    const queries = service(() => {
      manifestReads += 1;
      return manifest();
    });

    const snapshot = await queries.runtimeSnapshot({ protocolVersion: V2_SCHEMA_VERSION, type: "runtime.snapshot" });

    expect(snapshot.revision).toBe(4);
    expect(snapshot.currentScenarioId).toBe(scenarioId);
    expect(snapshot).not.toHaveProperty("files");
    expect(manifestReads).toBe(0);
  });

  it("paginates deterministically and rejects a stale cursor", async () => {
    let currentManifest = manifest();
    const queries = service(() => currentManifest);
    const first = await queries.listRecordings({
      protocolVersion: V2_SCHEMA_VERSION,
      type: "recording.list",
      scenarioId,
      limit: 2,
    });

    expect(first.items.map((item) => item.filename)).toEqual(["charlie.json", "bravo.json"]);
    expect(first.scenarioRevision).toBe(2);
    expect(first.nextCursor).not.toBeNull();

    const second = await queries.listRecordings({
      protocolVersion: V2_SCHEMA_VERSION,
      type: "recording.list",
      scenarioId,
      limit: 2,
      cursor: first.nextCursor ?? undefined,
    });
    expect(second.items.map((item) => item.filename)).toEqual(["alpha.json"]);

    currentManifest = manifest(3);
    await expect(
      queries.listRecordings({
        protocolVersion: V2_SCHEMA_VERSION,
        type: "recording.list",
        scenarioId,
        limit: 2,
        cursor: first.nextCursor ?? undefined,
      }),
    ).rejects.toBeInstanceOf(RevisionConflictError);
  });

  it("searches metadata without opening bodies", async () => {
    const result = await service().searchRecordings({
      protocolVersion: V2_SCHEMA_VERSION,
      type: "recording.search",
      scenarioId,
      text: "ORDER",
      limit: 50,
    });

    expect(result.items.map((item) => item.filename)).toEqual(["bravo.json"]);
  });

  it("searches request/response metadata and streamed body text case-insensitively", async () => {
    const bodyDigest = manifest().recordings[2]?.response.body?.sha256;
    expect(bodyDigest).toBeDefined();
    const queries = service(() => manifest(), { [bodyDigest as string]: `prefix-${"x".repeat(70_000)}-Needle-suffix` });

    const header = await queries.searchRecordings({
      protocolVersion: V2_SCHEMA_VERSION,
      type: "recording.search",
      scenarioId,
      text: "200",
      limit: 50,
    });
    const body = await queries.searchRecordings({
      protocolVersion: V2_SCHEMA_VERSION,
      type: "recording.search",
      scenarioId,
      text: "NEEDLE",
      limit: 50,
    });

    expect(header.items).toHaveLength(3);
    expect(body.items.map((item) => item.filename)).toEqual(["charlie.json"]);
  });

  it("paginates search by source position without materializing every body", async () => {
    const current = manifest();
    const bodyText = Object.fromEntries(
      current.recordings.map((recording) => [recording.response.body?.sha256 ?? "", "shared search value"]),
    );
    const queries = service(() => current, bodyText);
    const first = await queries.searchRecordings({
      protocolVersion: V2_SCHEMA_VERSION,
      type: "recording.search",
      scenarioId,
      text: "shared search value",
      limit: 2,
    });
    const second = await queries.searchRecordings({
      protocolVersion: V2_SCHEMA_VERSION,
      type: "recording.search",
      scenarioId,
      text: "shared search value",
      limit: 2,
      cursor: first.nextCursor ?? undefined,
    });

    expect(first.items.map((item) => item.filename)).toEqual(["charlie.json", "bravo.json"]);
    expect(second.items.map((item) => item.filename)).toEqual(["alpha.json"]);
    expect(second.nextCursor).toBeNull();
  });

  it("pins search bodies before revalidating the catalog view and releases them after the long scan", async () => {
    const current = manifest();
    let readCount = 0;
    let pinned = false;
    const events: string[] = [];
    const release = vi.fn(async () => {
      events.push("release");
      pinned = false;
    });
    const queries = service(
      () => current,
      {},
      async () => {
        readCount += 1;
        if (readCount === 2) {
          events.push("validate");
          expect(pinned).toBe(true);
        }
        return current;
      },
      {
        pinMany: vi.fn(async () => {
          events.push("pin");
          pinned = true;
          return { release };
        }),
        open: vi.fn(async () => {
          events.push("open");
          if (!pinned) throw new Error("blob was collected");
          return new Blob(["needle"]).stream();
        }),
      },
    );

    const result = await queries.searchRecordings({
      protocolVersion: V2_SCHEMA_VERSION,
      type: "recording.search",
      scenarioId,
      text: "needle",
      limit: 50,
    });

    expect(result.items).toHaveLength(3);
    expect(events).toEqual(["pin", "validate", "open", "open", "open", "release"]);
    expect(release).toHaveBeenCalledOnce();
  });

  it("bounds pin cleanup before returning a completed search", async () => {
    const release = vi.fn(() => new Promise<void>(() => {}));
    const queries = service(() => manifest(), {}, undefined, { pinMany: vi.fn(async () => ({ release })) }, 25);

    await expect(
      queries.searchRecordings({
        protocolVersion: V2_SCHEMA_VERSION,
        type: "recording.search",
        scenarioId,
        text: "ORDER",
        limit: 50,
      }),
    ).resolves.toMatchObject({ items: [{ filename: "bravo.json" }] });
    expect(release).toHaveBeenCalledOnce();
  });

  it("rejects every recording query instead of mixing an old catalog with a newer manifest", async () => {
    const conflict = new RevisionConflictError(4 as never, 5 as never);
    const readAtRevision = async () => Promise.reject<ScenarioManifest>(conflict);
    const queries = service(() => manifest(3), {}, readAtRevision);
    const recordingId = manifest().recordings[0]?.id;
    const body = manifest().recordings[0]?.response.body;
    if (!recordingId || !body) throw new Error("Expected recording fixtures");
    const operations = [
      () =>
        queries.listRecordings({
          protocolVersion: V2_SCHEMA_VERSION,
          type: "recording.list",
          scenarioId,
          limit: 50,
        }),
      () =>
        queries.searchRecordings({
          protocolVersion: V2_SCHEMA_VERSION,
          type: "recording.search",
          scenarioId,
          text: "users",
          limit: 50,
        }),
      () =>
        queries.getRecording({
          protocolVersion: V2_SCHEMA_VERSION,
          type: "recording.get",
          scenarioId,
          recordingId,
        }),
      () =>
        queries.getRecordingBody({
          protocolVersion: V2_SCHEMA_VERSION,
          type: "recording.body",
          scenarioId,
          recordingId,
          target: "response",
        }),
      () =>
        queries.exportRecording({
          protocolVersion: V2_SCHEMA_VERSION,
          type: "recording.export",
          scenarioId,
          recordingId,
        }),
    ];

    for (const operation of operations) {
      await expect(operation()).rejects.toBe(conflict);
    }
    await expect(
      queries.exportFolder({ protocolVersion: V2_SCHEMA_VERSION, type: "folder.export", folderId }),
    ).resolves.toMatchObject({ revision: 4 });
  });
});
