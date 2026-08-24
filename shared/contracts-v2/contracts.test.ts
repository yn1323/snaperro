import { describe, expect, expectTypeOf, it } from "vitest";
import {
  CatalogSnapshotSchema,
  COMMAND_TYPES,
  CommandResultSchemas,
  CommandSchema,
  DownloadTicketSchema,
  type EventPayload,
  EventSchema,
  FolderIdSchema,
  FolderImportUploadMetadataSchema,
  HeaderFieldsSchema,
  MAX_CATALOG_FOLDERS,
  MAX_CATALOG_SCENARIOS,
  MAX_CATALOG_SERIALIZED_BYTES,
  MAX_CONTROL_JSON_BYTES,
  MAX_METADATA_COLLECTION_BYTES,
  MAX_METADATA_COLLECTION_ENTRIES,
  nextRevision,
  PathParamsSchema,
  ProblemSchema,
  QUERY_TYPES,
  QueryFieldsSchema,
  QueryResultSchemas,
  QuerySchema,
  RecordingDraftSchema,
  RecordingIdSchema,
  RecordingImportUploadMetadataSchema,
  RevisionSchema,
  RuntimeIdSchema,
  ScenarioIdSchema,
  ScenarioManifestSchema,
  ServerSnapshotSchema,
  StagedFolderImportSchema,
  StagedRecordingImportSchema,
  V2_ROUTE_PATHS,
} from "./index.js";

const IDS = {
  folder: "fld_0123456789abcdef",
  otherFolder: "fld_fedcba9876543210",
  scenario: "scn_0123456789abcdef",
  otherScenario: "scn_fedcba9876543210",
  recording: "rec_0123456789abcdef",
  otherRecording: "rec_fedcba9876543210",
  runtime: "run_0123456789abcdef",
  otherRuntime: "run_fedcba9876543210",
  command: "cmd_0123456789abcdef",
  event: "evt_0123456789abcdef",
  request: "req_0123456789abcdef",
} as const;

const NOW = "2026-08-24T00:00:00.000Z";
const SHA = "a".repeat(64);
const OTHER_SHA = "b".repeat(64);

function bodyRef(sha256 = SHA) {
  return { sha256, size: 12, mediaType: "application/json", contentEncoding: null };
}

function folder() {
  return { id: IDS.folder, name: "Demo", revision: 0, createdAt: NOW, updatedAt: NOW };
}

function scenario() {
  return {
    id: IDS.scenario,
    folderId: IDS.folder,
    name: "Success",
    revision: 0,
    recordingsCount: 1,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function recording(overrides: Record<string, unknown> = {}) {
  return {
    id: IDS.recording,
    scenarioId: IDS.scenario,
    filename: "api_users_001.json",
    revision: 0,
    route: "/api/users/:id",
    method: "GET",
    requestFingerprint: SHA,
    matchable: true,
    request: {
      pathParams: { id: "1" },
      query: [["expand", "profile"]],
      headers: [["accept", "application/json"]],
      body: null,
    },
    response: {
      status: 200,
      statusText: "OK",
      headers: [["content-type", "application/json"]],
      body: bodyRef(),
    },
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function catalog() {
  return {
    schemaVersion: 2,
    revision: 0,
    mode: "smart",
    currentScenarioId: IDS.scenario,
    folders: [folder()],
    scenarios: [scenario()],
  };
}

function serverSnapshot() {
  return {
    protocolVersion: 2,
    runtimeId: IDS.runtime,
    revision: 0,
    version: "2.0.0",
    mode: "smart",
    currentScenarioId: IDS.scenario,
    folders: { [IDS.folder]: { id: IDS.folder, name: "Demo" } },
    scenarios: {
      [IDS.scenario]: { id: IDS.scenario, folderId: IDS.folder, name: "Success" },
    },
  };
}

function eventEnvelope() {
  return {
    protocolVersion: 2,
    runtimeId: IDS.runtime,
    id: IDS.event,
    sequence: 1,
    revision: 1,
    occurredAt: NOW,
  };
}

describe("v2 primitive contracts", () => {
  it("keeps entity ID types distinct at runtime", () => {
    expect(FolderIdSchema.parse(IDS.folder)).toBe(IDS.folder);
    expect(ScenarioIdSchema.parse(IDS.scenario)).toBe(IDS.scenario);
    expect(RecordingIdSchema.parse(IDS.recording)).toBe(IDS.recording);
    expect(RuntimeIdSchema.parse(IDS.runtime)).toBe(IDS.runtime);
    expect(ScenarioIdSchema.safeParse(IDS.folder).success).toBe(false);
    expect(FolderIdSchema.safeParse("fld_short").success).toBe(false);
  });

  it("increments only valid safe revisions", () => {
    const revision = RevisionSchema.parse(4);
    expect(nextRevision(revision)).toBe(5);
    expect(() => nextRevision(RevisionSchema.parse(Number.MAX_SAFE_INTEGER))).toThrow();
  });
});

describe("v2 entity invariants", () => {
  it("rejects HTTP fields that Fetch cannot safely reconstruct", () => {
    expect(HeaderFieldsSchema.safeParse([["x-safe", "value"]]).success).toBe(true);
    expect(HeaderFieldsSchema.safeParse([["bad header", "value"]]).success).toBe(false);
    expect(HeaderFieldsSchema.safeParse([["x-safe", "value\r\nx-injected: yes"]]).success).toBe(false);
    expect(HeaderFieldsSchema.safeParse([["x-safe", "value\0tail"]]).success).toBe(false);

    const draft = recording();
    expect(RecordingDraftSchema.safeParse({ ...draft, response: { ...draft.response, status: 199 } }).success).toBe(
      false,
    );
    for (const statusText of ["OK\r\nInjected", "OK\0tail"]) {
      expect(RecordingDraftSchema.safeParse({ ...draft, response: { ...draft.response, statusText } }).success).toBe(
        false,
      );
    }
  });

  it("accepts a consistent catalog", () => {
    expect(CatalogSnapshotSchema.parse(catalog())).toEqual(catalog());
  });

  it("rejects dangling scenario and current-scenario references", () => {
    const missingFolder = catalog();
    missingFolder.folders = [];
    expect(CatalogSnapshotSchema.safeParse(missingFolder).success).toBe(false);

    const missingCurrent = { ...catalog(), currentScenarioId: IDS.otherScenario };
    expect(CatalogSnapshotSchema.safeParse(missingCurrent).success).toBe(false);
  });

  it("enforces canonical folder and per-folder scenario name uniqueness", () => {
    const duplicateFolder = {
      ...catalog(),
      folders: [folder(), { ...folder(), id: IDS.otherFolder, name: "DEMO" }],
    };
    expect(CatalogSnapshotSchema.safeParse(duplicateFolder).success).toBe(false);

    const duplicateScenario = {
      ...catalog(),
      scenarios: [scenario(), { ...scenario(), id: IDS.otherScenario, name: "SUCCESS" }],
    };
    expect(CatalogSnapshotSchema.safeParse(duplicateScenario).success).toBe(false);
  });

  it("bounds metadata collections by entry count and aggregate UTF-8 bytes", () => {
    const oversizedFields = Array.from({ length: 33 }, (_, index) => [`field-${index}`, "x".repeat(8_000)]);
    expect(new TextEncoder().encode(JSON.stringify(oversizedFields)).byteLength).toBeGreaterThan(
      MAX_METADATA_COLLECTION_BYTES,
    );
    expect(QueryFieldsSchema.safeParse(oversizedFields).success).toBe(false);
    expect(HeaderFieldsSchema.safeParse(oversizedFields.map(([name, value]) => [`x-${name}`, value])).success).toBe(
      false,
    );
    expect(
      PathParamsSchema.safeParse(
        Object.fromEntries(
          Array.from({ length: MAX_METADATA_COLLECTION_ENTRIES + 1 }, (_, index) => [`p${index}`, "v"]),
        ),
      ).success,
    ).toBe(false);
    expect(QueryFieldsSchema.safeParse([["key", "世".repeat(3_000)]]).success).toBe(false);
  });

  it("keeps the maximum legal catalog snapshot and recording response below client JSON/SSE limits", () => {
    const maximumId = (prefix: "fld" | "scn", index: number) =>
      `${prefix}_${`${index.toString(16).padStart(16, "0")}${"x".repeat(128)}`.slice(0, 128)}`;
    const maximumName = (prefix: string, index: number) => `${prefix}${index}-${"n".repeat(200)}`.slice(0, 200);
    const folderEntries = Array.from({ length: MAX_CATALOG_FOLDERS }, (_, index) => {
      const id = maximumId("fld", index);
      return [id, { id, name: maximumName("F", index) }] as const;
    });
    const folders = Object.fromEntries(folderEntries);
    const firstFolderId = folderEntries[0][0];
    const scenarioEntries = Array.from({ length: MAX_CATALOG_SCENARIOS }, (_, index) => {
      const id = maximumId("scn", index);
      return [id, { id, folderId: firstFolderId, name: maximumName("S", index) }] as const;
    });
    const scenarios = Object.fromEntries(scenarioEntries);
    const maximumCatalog = CatalogSnapshotSchema.parse({
      schemaVersion: 2,
      revision: 0,
      mode: "smart",
      currentScenarioId: null,
      folders: folderEntries.map(([, folder]) => ({
        ...folder,
        revision: 0,
        createdAt: NOW,
        updatedAt: NOW,
      })),
      scenarios: scenarioEntries.map(([, scenario]) => ({
        ...scenario,
        revision: 0,
        recordingsCount: 0,
        createdAt: NOW,
        updatedAt: NOW,
      })),
    });
    expect(new TextEncoder().encode(JSON.stringify(maximumCatalog)).byteLength).toBeLessThan(
      MAX_CATALOG_SERIALIZED_BYTES,
    );
    const maximumSnapshot = ServerSnapshotSchema.parse({
      protocolVersion: 2,
      runtimeId: IDS.runtime,
      revision: 0,
      version: "2.0.0",
      mode: "smart",
      currentScenarioId: null,
      folders,
      scenarios,
    });
    expect(new TextEncoder().encode(JSON.stringify(maximumSnapshot)).byteLength).toBeLessThan(
      MAX_CATALOG_SERIALIZED_BYTES,
    );
    const connected = EventSchema.parse({
      ...eventEnvelope(),
      revision: maximumSnapshot.revision,
      type: "runtime.connected",
      payload: maximumSnapshot,
    });
    expect(new TextEncoder().encode(JSON.stringify(connected)).byteLength).toBeLessThan(4 * 1024 * 1024);

    const denseFields = Array.from({ length: 32 }, (_, index) => [`x-${index}`, "a".repeat(8_000)]);
    const denseRecording = recording({
      request: { pathParams: Object.fromEntries(denseFields), query: denseFields, headers: denseFields, body: null },
      response: { status: 200, statusText: "OK", headers: denseFields, body: null },
    });
    const recordingResult = QueryResultSchemas["recording.get"].parse({
      revision: 0,
      scenarioRevision: 0,
      recording: denseRecording,
    });
    expect(new TextEncoder().encode(JSON.stringify(recordingResult)).byteLength).toBeLessThan(MAX_CONTROL_JSON_BYTES);
    const maximumRecordingCommand = CommandSchema.parse({
      protocolVersion: 2,
      commandId: IDS.command,
      type: "recording.create",
      scenarioId: IDS.scenario,
      expectedScenarioRevision: 0,
      filename: "dense.json",
      recording: RecordingDraftSchema.parse({
        route: denseRecording.route,
        method: denseRecording.method,
        request: denseRecording.request,
        response: denseRecording.response,
      }),
    });
    expect(new TextEncoder().encode(JSON.stringify(maximumRecordingCommand)).byteLength).toBeLessThan(
      MAX_CONTROL_JSON_BYTES,
    );
  });

  it("rejects duplicate recording IDs and request fingerprints", () => {
    const duplicateId = {
      schemaVersion: 2,
      scenarioId: IDS.scenario,
      revision: 0,
      recordings: [recording(), recording({ requestFingerprint: OTHER_SHA })],
    };
    expect(ScenarioManifestSchema.safeParse(duplicateId).success).toBe(false);

    const duplicateFingerprint = {
      ...duplicateId,
      recordings: [recording(), recording({ id: IDS.otherRecording })],
    };
    expect(ScenarioManifestSchema.safeParse(duplicateFingerprint).success).toBe(false);

    const preservedShadow = {
      ...duplicateId,
      recordings: [recording(), recording({ id: IDS.otherRecording, filename: "shadow.json", matchable: false })],
    };
    expect(ScenarioManifestSchema.safeParse(preservedShadow).success).toBe(true);

    const orphanedShadow = {
      ...duplicateId,
      recordings: [recording({ matchable: false })],
    };
    expect(ScenarioManifestSchema.safeParse(orphanedShadow).success).toBe(false);

    const duplicateFilename = {
      ...duplicateId,
      recordings: [
        recording(),
        recording({
          id: IDS.otherRecording,
          requestFingerprint: OTHER_SHA,
          filename: "API_USERS_001.JSON",
        }),
      ],
    };
    expect(ScenarioManifestSchema.safeParse(duplicateFilename).success).toBe(false);
  });

  it("validates ID-keyed server snapshots", () => {
    expect(ServerSnapshotSchema.safeParse(serverSnapshot()).success).toBe(true);

    const snapshot = serverSnapshot();
    const invalid = {
      ...snapshot,
      scenarios: {
        ...snapshot.scenarios,
        [IDS.scenario]: { ...snapshot.scenarios[IDS.scenario], folderId: IDS.otherFolder },
      },
    };
    expect(ServerSnapshotSchema.safeParse(invalid).success).toBe(false);
  });
});

describe("v2 command and query contracts", () => {
  it("parses discriminated commands and rejects unversioned input", () => {
    const command = {
      protocolVersion: 2,
      commandId: IDS.command,
      expectedRevision: 3,
      type: "scenario.select",
      scenarioId: IDS.scenario,
    };
    expect(CommandSchema.parse(command)).toEqual(command);
    expect(CommandSchema.safeParse({ ...command, protocolVersion: 1 }).success).toBe(false);
  });

  it("keeps requestFingerprint server-derived instead of accepting it in recording commands", () => {
    const persistent = recording();
    const {
      id: _id,
      scenarioId: _scenarioId,
      filename: _filename,
      revision: _revision,
      createdAt: _createdAt,
      updatedAt: _updatedAt,
      requestFingerprint: _requestFingerprint,
      matchable: _matchable,
      ...draft
    } = persistent;
    const command = {
      protocolVersion: 2,
      commandId: IDS.command,
      type: "recording.create",
      scenarioId: IDS.scenario,
      expectedScenarioRevision: 0,
      filename: persistent.filename,
      recording: draft,
    };

    expect(CommandSchema.safeParse(command).success).toBe(true);
    expect(
      CommandSchema.safeParse({
        ...command,
        recording: { ...draft, requestFingerprint: persistent.requestFingerprint },
      }).success,
    ).toBe(false);
    expect(CommandSchema.safeParse({ ...command, recording: { ...draft, matchable: false } }).success).toBe(false);
  });

  it("has a runtime result schema for every command", () => {
    expect(Object.keys(CommandResultSchemas).sort()).toEqual([...COMMAND_TYPES].sort());
  });

  it("applies bounded pagination defaults", () => {
    const query = QuerySchema.parse({
      protocolVersion: 2,
      type: "recording.list",
      scenarioId: IDS.scenario,
    });
    expect(query).toMatchObject({ limit: 50 });
    expect(QuerySchema.safeParse({ ...query, limit: 201 }).success).toBe(false);
  });

  it("has a runtime result schema for every query", () => {
    expect(Object.keys(QueryResultSchemas).sort()).toEqual([...QUERY_TYPES].sort());
  });
});

describe("v2 event contracts", () => {
  it("correlates event names and payloads through EventMap", () => {
    expectTypeOf<EventPayload<"mode.changed">>().toEqualTypeOf<{ mode: "proxy" | "record" | "mock" | "smart" }>();

    const event = { ...eventEnvelope(), type: "mode.changed", payload: { mode: "record" } };
    expect(EventSchema.parse(event)).toEqual(event);
    expect(EventSchema.safeParse({ ...event, payload: { scenarioId: null } }).success).toBe(false);
  });

  it("requires scenario identity and revision on recording deletion", () => {
    const event = {
      ...eventEnvelope(),
      type: "recording.deleted",
      payload: { recordingId: IDS.recording, scenarioId: IDS.scenario, scenarioRevision: RevisionSchema.parse(1) },
    };
    expect(EventSchema.safeParse(event).success).toBe(true);
    expect(EventSchema.safeParse({ ...event, payload: { recordingId: IDS.recording } }).success).toBe(false);
    expect(
      EventSchema.safeParse({
        ...event,
        payload: { recordingId: IDS.recording, scenarioId: IDS.scenario },
      }).success,
    ).toBe(false);
  });

  it("represents a folder import as a bounded snapshot invalidation", () => {
    const event = {
      ...eventEnvelope(),
      type: "folder.upserted",
      payload: {
        folder: { id: IDS.folder, name: "Imported" },
        recordingsInvalidated: true,
      },
    };
    expect(EventSchema.safeParse(event).success).toBe(true);
    expect(
      EventSchema.safeParse({
        ...event,
        payload: { ...event.payload, scenarios: [] },
      }).success,
    ).toBe(false);
    expect(
      EventSchema.safeParse({
        ...event,
        payload: { ...event.payload, files: [] },
      }).success,
    ).toBe(false);
    expect(
      CommandResultSchemas["folder.import"].safeParse({
        revision: 1,
        folder: folder(),
        recordingsInvalidated: true,
      }).success,
    ).toBe(true);
    expect(
      CommandResultSchemas["folder.import"].safeParse({
        revision: 1,
        folder: folder(),
        recordingsInvalidated: true,
        scenarios: [],
      }).success,
    ).toBe(false);
  });

  it("represents duplicated scenario recording changes as a bounded invalidation", () => {
    const event = {
      ...eventEnvelope(),
      type: "scenario.upserted",
      payload: {
        scenario: { id: IDS.scenario, folderId: IDS.folder, name: "Copy" },
        recordingsInvalidated: true,
      },
    };
    expect(EventSchema.safeParse(event).success).toBe(true);
    expect(
      EventSchema.safeParse({
        ...event,
        payload: {
          ...event.payload,
          files: [],
        },
      }).success,
    ).toBe(false);
  });

  it("separates mock identity from the recording capture lifecycle", () => {
    const completed = {
      ...eventEnvelope(),
      type: "request.completed",
      payload: {
        id: IDS.request,
        timestamp: NOW,
        method: "GET",
        path: "/users",
        action: "mock",
        status: 200,
        matchedRecordingId: IDS.recording,
        recordingOutcome: { state: "not-attempted" },
        durationMs: 2,
      },
    };
    expect(EventSchema.safeParse(completed).success).toBe(true);
    expect(
      EventSchema.safeParse({
        ...completed,
        payload: { ...completed.payload, recordingId: IDS.recording },
      }).success,
    ).toBe(false);

    const settled = {
      ...eventEnvelope(),
      type: "recording.outcome",
      payload: {
        requestId: IDS.request,
        scenarioId: IDS.scenario,
        recordingOutcome: { state: "saved", recordingId: IDS.recording },
      },
    };
    expect(EventSchema.safeParse(settled).success).toBe(true);
    expect(
      EventSchema.safeParse({
        ...settled,
        payload: { ...settled.payload, recordingOutcome: { state: "pending" } },
      }).success,
    ).toBe(false);
  });

  it("rejects connected envelopes whose runtime or revision differs from the snapshot", () => {
    const connected = {
      ...eventEnvelope(),
      revision: 0,
      type: "runtime.connected",
      payload: serverSnapshot(),
    };
    expect(EventSchema.safeParse(connected).success).toBe(true);
    expect(
      EventSchema.safeParse({
        ...connected,
        runtimeId: IDS.otherRuntime,
      }).success,
    ).toBe(false);
  });
});

describe("v2 problem contract", () => {
  it("rejects transport-specific and unknown error fields", () => {
    const problem = {
      code: "REVISION_CONFLICT",
      message: "Changed concurrently",
      retryable: true,
      details: { expected: 1, actual: 2 },
    };
    expect(ProblemSchema.parse(problem)).toEqual(problem);
    expect(ProblemSchema.safeParse({ ...problem, status: 409 }).success).toBe(false);
  });
});

describe("v2 streaming transfer contracts", () => {
  it("validates staged folder import metadata without embedding archive bytes", () => {
    const staged = {
      transferId: "xfer_0123456789abcdef",
      suggestedName: "Imported",
      scenariosCount: 3,
      size: 1_024,
      sha256: SHA,
    };

    expect(StagedFolderImportSchema.parse(staged)).toEqual(staged);
    expect(StagedFolderImportSchema.safeParse({ ...staged, archive: "base64" }).success).toBe(false);
    expect(
      FolderImportUploadMetadataSchema.safeParse({ filename: "../catalog.json", mediaType: "application/zip" }).success,
    ).toBe(false);
  });

  it("keeps public v2 routes and validated dynamic paths in one contract", () => {
    expect(V2_ROUTE_PATHS.commands).toBe("/__snaperro__/v2/commands");
    expect(V2_ROUTE_PATHS.folderImports).toBe("/__snaperro__/v2/transfers/imports");
    expect(V2_ROUTE_PATHS.recordingImports).toBe("/__snaperro__/v2/transfers/recording-imports");
    expect(V2_ROUTE_PATHS.downloads).toBe("/__snaperro__/downloads");
  });

  it("accepts only same-origin relative download tickets and bounded recording import metadata", () => {
    const ticket = {
      downloadPath: `/__snaperro__/downloads/${"A".repeat(43)}`,
      expiresAt: NOW,
      filename: "users.snaperro.zip",
      mediaType: "application/zip",
      size: 65 * 1024 * 1024,
    };
    expect(DownloadTicketSchema.parse(ticket)).toEqual(ticket);
    expect(
      DownloadTicketSchema.safeParse({ ...ticket, downloadPath: `https://evil.example/${"A".repeat(43)}` }).success,
    ).toBe(false);

    const metadata = { filename: "users.snaperro.zip", mediaType: "application/zip" } as const;
    expect(RecordingImportUploadMetadataSchema.parse(metadata)).toEqual(metadata);
    expect(
      StagedRecordingImportSchema.parse({
        transferId: "xfer_0123456789abcdef",
        filename: "nested/users.json",
        size: 1,
        sha256: SHA,
      }),
    ).toMatchObject({ filename: "nested/users.json" });
  });
});
