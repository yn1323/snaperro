import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { BodyRefSchema, type Recording, RecordingDraftSchema } from "../../../shared/contracts-v2/entities.js";
import { RecordingIdSchema, RevisionSchema } from "../../../shared/contracts-v2/primitives.js";
import { EntityAlreadyExistsError, InvalidArgumentError, RevisionConflictError } from "../domain/errors.js";
import { requestFingerprint } from "../domain/request-fingerprint.js";
import { MockService } from "../traffic/mock-service.js";
import type { BlobStorePort } from "./ports.js";
import { RecordingService } from "./recording-service.js";
import {
  applicationTestIds,
  CapturingLogger,
  catalogFixture,
  FakeEventHub,
  FakeGarbageCollection,
  FixedClock,
  MemoryCatalogRepository,
  MemoryManifestRepository,
  MemoryRecordingCommit,
  MutexWriteCoordinator,
  manifestFixture,
  recordingFixture,
  SequentialIds,
} from "./test-doubles.js";

function draft(identity = "1") {
  return RecordingDraftSchema.parse({
    route: "/created/:id",
    method: "POST",
    request: { pathParams: { id: identity }, query: [], headers: [], body: null },
    response: { status: 201, statusText: "Created", headers: [], body: null },
  });
}

function legacyDuplicates() {
  const base = recordingFixture();
  const fingerprint = requestFingerprint({
    method: base.method,
    route: base.route,
    pathParams: base.request.pathParams,
    query: base.request.query,
    body: { kind: "empty" },
  });
  const winner = recordingFixture({
    requestFingerprint: fingerprint,
    response: { ...base.response, body: null },
  });
  const shadow = recordingFixture({
    id: applicationTestIds.otherRecording,
    filename: "users-shadow.json",
    requestFingerprint: fingerprint,
    matchable: false,
    response: { ...base.response, body: null },
  });
  return { fingerprint, winner, shadow };
}

function service(recordings: Recording[] = []) {
  const catalogs = new MemoryCatalogRepository(catalogFixture({ recordingsCount: recordings.length }));
  const manifests = new MemoryManifestRepository([manifestFixture(recordings)]);
  const events = new FakeEventHub();
  const garbageCollection = new FakeGarbageCollection();
  const logger = new CapturingLogger();
  const commits = new MemoryRecordingCommit(catalogs, manifests);
  let bodyAvailability: (size: number) => boolean = () => true;
  const bodyContents = new Map<string, Uint8Array>();
  const blobs = {
    exists: async (body: { size: number }) => bodyAvailability(body.size),
    open: async (body: { sha256: string; size: number }) => {
      const bytes = bodyContents.get(`${body.sha256}:${body.size}`);
      if (!bytes) throw new Error(`Missing test body: ${body.sha256}`);
      return new Blob([bytes]).stream();
    },
  } as unknown as BlobStorePort;
  return {
    catalogs,
    manifests,
    events,
    garbageCollection,
    logger,
    commits,
    blobs,
    stageBody: (value: string, mediaType = "text/plain") => {
      const bytes = new TextEncoder().encode(value);
      const ref = BodyRefSchema.parse({
        sha256: createHash("sha256").update(bytes).digest("hex"),
        size: bytes.byteLength,
        mediaType,
        contentEncoding: null,
      });
      bodyContents.set(`${ref.sha256}:${ref.size}`, bytes);
      return ref;
    },
    removeStagedBodies: () => {
      bodyAvailability = () => false;
    },
    keepOnlyBodySize: (size: number) => {
      bodyAvailability = (candidate) => candidate === size;
    },
    subject: new RecordingService({
      blobs,
      catalogs,
      manifests,
      events,
      garbageCollection,
      logger,
      commits,
      writes: new MutexWriteCoordinator(),
      ids: new SequentialIds(),
      clock: new FixedClock(),
    }),
  };
}

describe("RecordingService", () => {
  it("atomically updates an existing capture with the same fingerprint and keeps its filename", async () => {
    const existing = recordingFixture({
      filename: "custom-name.json",
      revision: RevisionSchema.parse(3),
      requestFingerprint: requestFingerprint({
        method: "GET",
        route: "/users/:id",
        pathParams: { id: "1" },
        query: [],
        body: { kind: "empty" },
      }),
    });
    const harness = service([existing]);

    const result = await harness.subject.capture({
      scenarioId: applicationTestIds.scenario,
      recording: RecordingDraftSchema.parse({
        route: existing.route,
        method: existing.method,
        request: existing.request,
        response: existing.response,
      }),
    });

    expect(result).toMatchObject({ id: existing.id, filename: "custom-name.json", revision: 4 });
    expect((await harness.manifests.read(applicationTestIds.scenario)).recordings).toEqual([result]);
  });

  it("serializes more than five simultaneous captures without dropping any recording", async () => {
    const harness = service();
    const identities = ["a", "b", "c", "d", "e", "f"];

    const results = await Promise.all(
      identities.map((identity) =>
        harness.subject.capture({
          scenarioId: applicationTestIds.scenario,
          recording: draft(identity),
        }),
      ),
    );

    expect(results).toHaveLength(6);
    expect(new Set(results.map((recording) => recording.id))).toHaveProperty("size", 6);
    expect(results.map((recording) => recording.filename)).toEqual([
      "post_created_id_001.json",
      "post_created_id_002.json",
      "post_created_id_003.json",
      "post_created_id_004.json",
      "post_created_id_005.json",
      "post_created_id_006.json",
    ]);
    expect((await harness.manifests.read(applicationTestIds.scenario)).recordings).toHaveLength(6);
  });

  it("publishes catalog and manifest through one CAS commit boundary", async () => {
    const harness = service();

    const result = await harness.subject.create({
      protocolVersion: 2,
      commandId: applicationTestIds.command,
      type: "recording.create",
      scenarioId: applicationTestIds.scenario,
      expectedScenarioRevision: RevisionSchema.parse(0),
      filename: "created.json",
      recording: draft(),
    });

    expect(result).toMatchObject({ revision: 1, scenarioRevision: 1 });
    expect(harness.commits.calls).toHaveLength(1);
    expect(harness.catalogs.snapshot.scenarios[0]).toMatchObject({ recordingsCount: 1, revision: 1 });
    expect((await harness.manifests.read(applicationTestIds.scenario)).recordings).toEqual([result.recording]);
    expect(harness.events.published).toEqual([
      expect.objectContaining({
        type: "recording.upserted",
        revision: 1,
        payload: {
          recording: expect.objectContaining({ id: result.recording.id, contentRevision: 0 }),
          scenarioRevision: 1,
        },
      }),
    ]);
    expect(harness.garbageCollection.scheduled).toBe(1);
  });

  it("rejects stale concurrent writers without partially updating catalog or manifest", async () => {
    const harness = service();
    const base = {
      protocolVersion: 2 as const,
      commandId: applicationTestIds.command,
      type: "recording.create" as const,
      scenarioId: applicationTestIds.scenario,
      expectedScenarioRevision: RevisionSchema.parse(0),
    };

    const results = await Promise.allSettled([
      harness.subject.create({ ...base, filename: "one.json", recording: draft("one") }),
      harness.subject.create({ ...base, filename: "two.json", recording: draft("two") }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected).toMatchObject({ status: "rejected", reason: expect.any(RevisionConflictError) });
    expect(harness.catalogs.snapshot).toMatchObject({
      revision: 1,
      scenarios: [expect.objectContaining({ recordingsCount: 1 })],
    });
    expect((await harness.manifests.read(applicationTestIds.scenario)).recordings).toHaveLength(1);
    expect(harness.commits.calls).toHaveLength(1);
  });

  it("does not commit a manifest after a staged body has been garbage-collected", async () => {
    const harness = service();
    const body = BodyRefSchema.parse({
      sha256: "a".repeat(64),
      size: 7,
      mediaType: "text/plain",
      contentEncoding: null,
    });
    const base = draft();
    const recording = RecordingDraftSchema.parse({
      ...base,
      response: { ...base.response, body },
    });
    harness.removeStagedBodies();

    await expect(
      harness.subject.create({
        protocolVersion: 2,
        commandId: applicationTestIds.command,
        type: "recording.create",
        scenarioId: applicationTestIds.scenario,
        expectedScenarioRevision: RevisionSchema.parse(0),
        filename: "missing-body.json",
        recording,
      }),
    ).rejects.toBeInstanceOf(InvalidArgumentError);

    expect(harness.commits.calls).toHaveLength(0);
    expect((await harness.manifests.read(applicationTestIds.scenario)).recordings).toHaveLength(0);
  });

  it("validates conflicting sizes independently when body references share a digest", async () => {
    const harness = service();
    const requestBody = BodyRefSchema.parse({
      sha256: "a".repeat(64),
      size: 7,
      mediaType: "text/plain",
      contentEncoding: null,
    });
    const responseBody = BodyRefSchema.parse({ ...requestBody, size: 8 });
    const base = draft();
    harness.keepOnlyBodySize(7);

    await expect(
      harness.subject.create({
        protocolVersion: 2,
        commandId: applicationTestIds.command,
        type: "recording.create",
        scenarioId: applicationTestIds.scenario,
        expectedScenarioRevision: RevisionSchema.parse(0),
        filename: "conflicting-body-size.json",
        recording: RecordingDraftSchema.parse({
          ...base,
          request: { ...base.request, body: requestBody },
          response: { ...base.response, body: responseBody },
        }),
      }),
    ).rejects.toBeInstanceOf(InvalidArgumentError);

    expect(harness.commits.calls).toHaveLength(0);
  });

  it("enforces content revision and canonical filename/fingerprint uniqueness before committing", async () => {
    const first = recordingFixture();
    const second = recordingFixture(
      {
        id: RecordingIdSchema.parse("rec_bbbbbbbbbbbbbbbb"),
        filename: "other.json",
        requestFingerprint: "c".repeat(64) as never,
      },
      "c",
    );
    const stale = service([first]);
    await expect(
      stale.subject.update({
        protocolVersion: 2,
        commandId: applicationTestIds.command,
        type: "recording.update",
        scenarioId: applicationTestIds.scenario,
        recordingId: first.id,
        expectedScenarioRevision: RevisionSchema.parse(0),
        expectedContentRevision: RevisionSchema.parse(99),
        filename: first.filename,
        recording: draft("a"),
      }),
    ).rejects.toBeInstanceOf(RevisionConflictError);
    expect(stale.commits.calls).toHaveLength(0);

    const duplicate = service([first, second]);
    await expect(
      duplicate.subject.update({
        protocolVersion: 2,
        commandId: applicationTestIds.command,
        type: "recording.update",
        scenarioId: applicationTestIds.scenario,
        recordingId: first.id,
        expectedScenarioRevision: RevisionSchema.parse(0),
        expectedContentRevision: RevisionSchema.parse(0),
        filename: "OTHER.JSON",
        recording: draft("e"),
      }),
    ).rejects.toBeInstanceOf(EntityAlreadyExistsError);
    expect(duplicate.commits.calls).toHaveLength(0);
  });

  it("keeps a migrated shadow non-matchable while allowing response-only edits", async () => {
    const { fingerprint, winner, shadow } = legacyDuplicates();
    const harness = service([winner, shadow]);

    const updated = await harness.subject.update({
      protocolVersion: 2,
      commandId: applicationTestIds.command,
      type: "recording.update",
      scenarioId: applicationTestIds.scenario,
      recordingId: shadow.id,
      expectedScenarioRevision: RevisionSchema.parse(0),
      expectedContentRevision: shadow.revision,
      filename: shadow.filename,
      recording: RecordingDraftSchema.parse({
        route: shadow.route,
        method: shadow.method,
        request: shadow.request,
        response: { ...shadow.response, status: 202, statusText: "Accepted" },
      }),
    });

    expect(updated.recording).toMatchObject({
      id: shadow.id,
      requestFingerprint: fingerprint,
      matchable: false,
      response: { status: 202 },
    });
    const mock = new MockService(harness.manifests, harness.blobs);
    await expect(
      mock.find({ fingerprint, method: "HEAD" } as never, applicationTestIds.scenario),
    ).resolves.toMatchObject({
      recording: { id: winner.id, matchable: true },
    });
  });

  it("promotes the first migrated shadow when its active winner is deleted", async () => {
    const { fingerprint, winner, shadow } = legacyDuplicates();
    const firstShadow = recordingFixture({ ...shadow, filename: "users-a-shadow.json" });
    const laterShadow = recordingFixture({
      ...shadow,
      id: RecordingIdSchema.parse("rec_cccccccccccccccc"),
      filename: "users-z-shadow.json",
    });
    const harness = service([winner, laterShadow, firstShadow]);

    await harness.subject.delete({
      protocolVersion: 2,
      commandId: applicationTestIds.command,
      type: "recording.delete",
      scenarioId: applicationTestIds.scenario,
      recordingId: winner.id,
      expectedScenarioRevision: RevisionSchema.parse(0),
      expectedContentRevision: winner.revision,
    });

    expect((await harness.manifests.read(applicationTestIds.scenario)).recordings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: firstShadow.id, matchable: true }),
        expect.objectContaining({ id: laterShadow.id, matchable: false }),
      ]),
    );
    const mock = new MockService(harness.manifests, harness.blobs);
    await expect(
      mock.find({ fingerprint, method: "HEAD" } as never, applicationTestIds.scenario),
    ).resolves.toMatchObject({
      recording: { id: firstShadow.id, matchable: true },
    });
  });

  it("promotes a migrated shadow when its winner changes request identity", async () => {
    const { fingerprint, winner, shadow } = legacyDuplicates();
    const harness = service([winner, shadow]);

    const updated = await harness.subject.update({
      protocolVersion: 2,
      commandId: applicationTestIds.command,
      type: "recording.update",
      scenarioId: applicationTestIds.scenario,
      recordingId: winner.id,
      expectedScenarioRevision: RevisionSchema.parse(0),
      expectedContentRevision: winner.revision,
      filename: winner.filename,
      recording: draft("winner-new-request"),
    });

    const manifest = await harness.manifests.read(applicationTestIds.scenario);
    expect(manifest.recordings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: winner.id,
          requestFingerprint: updated.recording.requestFingerprint,
          matchable: true,
        }),
        expect.objectContaining({ id: shadow.id, requestFingerprint: fingerprint, matchable: true }),
      ]),
    );
    const mock = new MockService(harness.manifests, harness.blobs);
    await expect(
      mock.find({ fingerprint, method: "HEAD" } as never, applicationTestIds.scenario),
    ).resolves.toMatchObject({
      recording: { id: shadow.id },
    });
    await expect(
      mock.find(
        { fingerprint: updated.recording.requestFingerprint, method: "HEAD" } as never,
        applicationTestIds.scenario,
      ),
    ).resolves.toMatchObject({ recording: { id: winner.id } });
  });

  it("makes a migrated shadow matchable after it is edited to a unique request identity", async () => {
    const { fingerprint, winner, shadow } = legacyDuplicates();
    const harness = service([winner, shadow]);

    const updated = await harness.subject.update({
      protocolVersion: 2,
      commandId: applicationTestIds.command,
      type: "recording.update",
      scenarioId: applicationTestIds.scenario,
      recordingId: shadow.id,
      expectedScenarioRevision: RevisionSchema.parse(0),
      expectedContentRevision: shadow.revision,
      filename: shadow.filename,
      recording: draft("shadow-new-request"),
    });

    expect(updated.recording).toMatchObject({ id: shadow.id, matchable: true });
    const mock = new MockService(harness.manifests, harness.blobs);
    await expect(
      mock.find({ fingerprint, method: "HEAD" } as never, applicationTestIds.scenario),
    ).resolves.toMatchObject({
      recording: { id: winner.id },
    });
    await expect(
      mock.find(
        { fingerprint: updated.recording.requestFingerprint, method: "HEAD" } as never,
        applicationTestIds.scenario,
      ),
    ).resolves.toMatchObject({ recording: { id: shadow.id, matchable: true } });
  });

  it("derives request identity after route, query, and request body replacement so only the new request matches", async () => {
    const harness = service();
    const oldBody = harness.stageBody("old body");
    const newBody = harness.stageBody("replacement");
    const original = RecordingDraftSchema.parse({
      route: "/users/:id",
      method: "POST",
      request: { pathParams: { id: "1" }, query: [["view", "old"]], headers: [], body: oldBody },
      response: { status: 200, statusText: "OK", headers: [], body: null },
    });
    const created = await harness.subject.create({
      protocolVersion: 2,
      commandId: applicationTestIds.command,
      type: "recording.create",
      scenarioId: applicationTestIds.scenario,
      expectedScenarioRevision: RevisionSchema.parse(0),
      filename: "editable.json",
      recording: original,
    });
    const oldFingerprint = requestFingerprint({
      method: original.method,
      route: original.route,
      pathParams: original.request.pathParams,
      query: original.request.query,
      body: { kind: "raw", sha256: oldBody.sha256 },
    });
    expect(created.recording.requestFingerprint).toBe(oldFingerprint);

    const edited = RecordingDraftSchema.parse({
      ...original,
      route: "/accounts/:id",
      request: {
        ...original.request,
        pathParams: { id: "2" },
        query: [["view", "new"]],
        body: newBody,
      },
    });
    const updated = await harness.subject.update({
      protocolVersion: 2,
      commandId: applicationTestIds.command,
      type: "recording.update",
      scenarioId: applicationTestIds.scenario,
      recordingId: created.recording.id,
      expectedScenarioRevision: created.scenarioRevision,
      expectedContentRevision: created.recording.revision,
      filename: created.recording.filename,
      recording: edited,
    });
    const newFingerprint = requestFingerprint({
      method: edited.method,
      route: edited.route,
      pathParams: edited.request.pathParams,
      query: edited.request.query,
      body: { kind: "raw", sha256: newBody.sha256 },
    });
    expect(updated.recording.requestFingerprint).toBe(newFingerprint);
    expect(updated.recording.requestFingerprint).not.toBe(oldFingerprint);

    const mock = new MockService(harness.manifests, harness.blobs);
    const prepared = (fingerprint: typeof oldFingerprint) => ({ fingerprint, method: "HEAD" }) as never;
    await expect(mock.find(prepared(oldFingerprint), applicationTestIds.scenario)).resolves.toBeNull();
    await expect(mock.find(prepared(newFingerprint), applicationTestIds.scenario)).resolves.toMatchObject({
      recording: { id: created.recording.id },
    });
  });

  it("keeps a committed deletion successful when event delivery and GC scheduling fail", async () => {
    const recording = recordingFixture();
    const harness = service([recording]);
    harness.events.fail = true;
    harness.garbageCollection.failure = new Error("gc queue unavailable");

    const result = await harness.subject.delete({
      protocolVersion: 2,
      commandId: applicationTestIds.command,
      type: "recording.delete",
      scenarioId: applicationTestIds.scenario,
      recordingId: recording.id,
      expectedScenarioRevision: RevisionSchema.parse(0),
      expectedContentRevision: RevisionSchema.parse(0),
    });

    expect(result).toMatchObject({ revision: 1, scenarioRevision: 1, recordingId: recording.id });
    expect(harness.catalogs.snapshot.scenarios[0]?.recordingsCount).toBe(0);
    expect((await harness.manifests.read(applicationTestIds.scenario)).recordings).toEqual([]);
    expect(harness.logger.errors).toHaveLength(2);
  });
});
