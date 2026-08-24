import { createHash } from "node:crypto";
import syncFs from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BodyRef } from "../../../shared/contracts-v2/entities.js";
import { CommandIdSchema, Sha256Schema, V2_SCHEMA_VERSION } from "../../../shared/contracts-v2/primitives.js";
import { compileConfigV2 } from "../config/config.js";
import { requestFingerprint } from "../domain/request-fingerprint.js";
import { RuntimeCore } from "../runtime/runtime-core.js";
import { MockService } from "../traffic/mock-service.js";
import { prepareTrafficRequest } from "../traffic/prepared-request.js";
import { createTrafficApi } from "../transport/traffic-api.js";
import { FilesystemStore } from "./filesystem-store.js";
import { DEFAULT_V1_MIGRATION_READ_LIMITS, migrateV1Store, V1MigrationError } from "./v1-migrator.js";

function fileData(endpoint: string, body: unknown, requestBody: unknown = null) {
  return {
    endpoint,
    method: "GET",
    request: {
      pathParams: {},
      queryParams: {},
      headers: { accept: "application/json" },
      body: requestBody,
    },
    response: {
      status: 200,
      headers: { "content-type": "application/json" },
      body,
    },
  };
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeIdenticalRecordings(directory: string, first: number, last: number): Promise<void> {
  await fs.mkdir(directory, { recursive: true });
  const raw = `${JSON.stringify(fileData("/users", [{ id: "limit" }]), null, 2)}\n`;
  const indexes = Array.from({ length: last - first + 1 }, (_, offset) => first + offset);
  for (let start = 0; start < indexes.length; start += 100) {
    await Promise.all(
      indexes
        .slice(start, start + 100)
        .map((index) =>
          fs.writeFile(path.join(directory, `users_limit_${String(index).padStart(4, "0")}.json`), raw, "utf8"),
        ),
    );
  }
}

async function sourceDigest(root: string): Promise<string> {
  const entries: string[] = [];
  const walk = async (directory: string): Promise<void> => {
    const children = (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    for (const child of children) {
      const fullPath = path.join(directory, child.name);
      const relativePath = path.relative(root, fullPath).split(path.sep).join("/");
      if (child.isDirectory()) {
        entries.push(`d:${relativePath}`);
        await walk(fullPath);
      } else {
        const content = await fs.readFile(fullPath);
        entries.push(`f:${relativePath}:${createHash("sha256").update(content).digest("hex")}`);
      }
    }
  };
  await walk(root);
  return createHash("sha256").update(entries.join("\n")).digest("hex");
}

async function readSmallTestBlob(store: FilesystemStore, body: BodyRef): Promise<Uint8Array> {
  return new Uint8Array(await new Response(await store.blobs.open(body)).arrayBuffer());
}

describe("migrateV1Store", () => {
  let tempRoot: string;
  let sourceRoot: string;
  let destinationRoot: string;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "snaperro-v1-migration-"));
    sourceRoot = path.join(tempRoot, ".snaperro", "files");
    destinationRoot = path.join(tempRoot, ".snaperro", "store-v2");

    await writeJson(path.join(sourceRoot, "flat", "users_001.json"), fileData("/users", [{ id: 1 }]));
    await writeJson(path.join(sourceRoot, "folder", "nested", "posts_001.json"), fileData("/posts", [{ id: 10 }]));
    await fs.mkdir(path.join(sourceRoot, "folder", "empty"), { recursive: true });
    await fs.mkdir(path.join(sourceRoot, "ambiguous-empty-root"), { recursive: true });
    await fs.writeFile(path.join(sourceRoot, ".gitkeep"), "", "utf8");
    await writeJson(path.join(tempRoot, ".snaperro", "state.json"), {
      mode: "mock",
      currentScenario: "folder/nested",
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("uses documented finite default read limits", () => {
    expect(DEFAULT_V1_MIGRATION_READ_LIMITS).toEqual({
      maxRecordingFileBytes: 256 * 1024 * 1024,
      maxStateFileBytes: 1024 * 1024,
    });
  });

  it("dry-runs deterministically without creating the destination or changing v1", async () => {
    const before = await sourceDigest(sourceRoot);
    const report = await migrateV1Store({ sourceRoot, destinationRoot, dryRun: true });
    const repeated = await migrateV1Store({ sourceRoot, destinationRoot, dryRun: true });

    expect(report).toMatchObject({
      dryRun: true,
      sourceFiles: 2,
      sourceUnchanged: true,
      errors: [],
    });
    expect(report.scenarios.map(({ folderName, scenarioName }) => `${folderName}/${scenarioName}`)).toEqual([
      "_ambiguous-empty-root/ambiguous-empty-root",
      "_flat/flat",
      "folder/empty",
      "folder/nested",
    ]);
    expect(repeated.scenarios).toEqual(report.scenarios);
    expect(repeated.entries).toEqual(report.entries);
    expect(report.entries[0]).toMatchObject({
      folderName: "_flat",
      scenarioName: "flat",
      recordingId: expect.stringMatching(/^rec_[A-Za-z0-9_-]{16,}$/),
    });
    await expect(fs.access(destinationRoot)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await sourceDigest(sourceRoot)).toBe(before);
  });

  it("copies flat and nested stores, preserves exact source bytes, and is idempotent", async () => {
    const before = await sourceDigest(sourceRoot);
    const report = await migrateV1Store({ sourceRoot, destinationRoot });

    expect(report.sourceUnchanged).toBe(true);
    expect(report.integrity).toMatchObject({
      ok: true,
      counts: { folders: 3, scenarios: 4, manifests: 4, recordings: 2, orphanBlobs: 0, orphanManifests: 0 },
    });
    expect(await sourceDigest(sourceRoot)).toBe(before);

    const store = new FilesystemStore(destinationRoot);
    const metadata = await store.readMetadata();
    expect(metadata.importedFrom).toMatchObject({ format: "snaperro-v1", filesCount: 2 });
    expect(metadata.importedState).toEqual({ mode: "mock", currentScenario: "folder/nested" });
    const catalog = await store.catalogs.read();
    expect(catalog.folders.map((folder) => folder.name).sort()).toEqual(["_ambiguous-empty-root", "_flat", "folder"]);
    expect(catalog.scenarios.map((scenario) => scenario.name).sort()).toEqual([
      "ambiguous-empty-root",
      "empty",
      "flat",
      "nested",
    ]);
    expect(catalog.mode).toBe("mock");
    expect(catalog.scenarios.find((scenario) => scenario.id === catalog.currentScenarioId)?.name).toBe("nested");

    const recordings = (
      await Promise.all(catalog.scenarios.map((scenario) => store.manifests.read(scenario.id)))
    ).flatMap((manifest) => manifest.recordings);
    expect(recordings.map((recording) => recording.id).sort()).toEqual(
      report.entries.map((entry) => entry.recordingId).sort(),
    );
    expect(recordings.every((recording) => recording.request.body === null)).toBe(true);
    for (const entry of report.entries) {
      if (!entry.originalBlob) throw new Error("Expected migrated source provenance");
      const original = await fs.readFile(path.join(sourceRoot, entry.sourceRelativePath));
      const copied = await readSmallTestBlob(store, entry.originalBlob);
      expect(Buffer.from(copied)).toEqual(original);
    }
    await store.garbageCollection.schedule();
    for (const entry of report.entries) {
      if (!entry.originalBlob) throw new Error("Expected migrated source provenance");
      expect(await store.blobs.exists(entry.originalBlob)).toBe(true);
    }

    const repeated = await migrateV1Store({ sourceRoot, destinationRoot });
    expect(repeated.alreadyApplied).toBe(true);
    expect(repeated.integrity?.ok).toBe(true);
    expect(await sourceDigest(sourceRoot)).toBe(before);
  });

  it("preserves non-JSON text bodies as exact bytes", async () => {
    const textFixture = fileData("/text", "hello=world");
    textFixture.response.headers = { "content-type": "text/plain; charset=utf-8" };
    await writeJson(path.join(sourceRoot, "flat", "text_001.json"), textFixture);
    await migrateV1Store({ sourceRoot, destinationRoot });

    const store = new FilesystemStore(destinationRoot);
    const catalog = await store.catalogs.read();
    const flatScenario = catalog.scenarios.find((scenario) => scenario.name === "flat");
    if (!flatScenario) throw new Error("Expected migrated flat scenario");
    const manifest = await store.manifests.read(flatScenario.id);
    const textRecording = manifest.recordings.find((recording) => recording.filename === "text_001.json");
    if (!textRecording?.response.body) throw new Error("Expected migrated text body");
    expect(Buffer.from(await readSmallTestBlob(store, textRecording.response.body)).toString("utf8")).toBe(
      "hello=world",
    );
    expect(textRecording.response.body.mediaType).toBe("text/plain; charset=utf-8");
  });

  it("migrates legacy auto-decoded bodies without stale content encoding or length", async () => {
    const requestBody = { request: "already decoded" };
    const responseBody = { response: "already decoded" };
    const compressed = fileData("/compressed", responseBody, requestBody);
    compressed.method = "POST";
    Object.assign(compressed.request.headers, {
      "content-type": "application/json",
      "content-encoding": "gzip",
      "content-length": "999",
    });
    Object.assign(compressed.response.headers, {
      "content-encoding": "gzip",
      "content-length": "999",
    });
    const sourceFile = path.join(sourceRoot, "flat", "compressed_001.json");
    await writeJson(sourceFile, compressed);
    await writeJson(path.join(tempRoot, ".snaperro", "state.json"), {
      mode: "mock",
      currentScenario: "flat",
    });
    const sourceBefore = await sourceDigest(sourceRoot);
    const original = await fs.readFile(sourceFile);

    const report = await migrateV1Store({ sourceRoot, destinationRoot });
    const store = new FilesystemStore(destinationRoot);
    const catalog = await store.catalogs.read();
    const flat = catalog.scenarios.find((scenario) => scenario.name === "flat");
    if (!flat) throw new Error("Expected flat scenario");
    const recording = (await store.manifests.read(flat.id)).recordings.find(
      (candidate) => candidate.filename === "compressed_001.json",
    );
    if (!recording?.request.body || !recording.response.body) throw new Error("Expected migrated bodies");

    const requestBytes = new TextEncoder().encode(JSON.stringify(requestBody));
    const responseBytes = new TextEncoder().encode(JSON.stringify(responseBody));
    expect(recording.request.body).toMatchObject({ contentEncoding: null, size: requestBytes.byteLength });
    expect(recording.response.body).toMatchObject({ contentEncoding: null, size: responseBytes.byteLength });
    expect(recording.request.headers).toEqual(
      expect.arrayContaining([["content-length", String(requestBytes.byteLength)]]),
    );
    expect(recording.response.headers).toEqual(
      expect.arrayContaining([["content-length", String(responseBytes.byteLength)]]),
    );
    expect(recording.request.headers.map(([name]) => name.toLowerCase())).not.toContain("content-encoding");
    expect(recording.response.headers.map(([name]) => name.toLowerCase())).not.toContain("content-encoding");

    const fingerprint = requestFingerprint({
      method: "POST",
      route: "/compressed",
      pathParams: {},
      query: [],
      body: { kind: "json", value: requestBody },
    });
    const mock = new MockService(store.manifests, store.blobs);
    const resolution = await mock.find({ fingerprint, method: "POST" } as never, flat.id);
    if (!resolution) throw new Error("Expected migrated mock match");
    const response = await createTrafficApi({ execute: async () => resolution.response }).request(
      "http://localhost/compressed",
      { method: "POST" },
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(responseBody);

    const receiptEntry = report.entries.find((entry) => entry.sourceRelativePath === "flat/compressed_001.json");
    if (!receiptEntry?.originalBlob) throw new Error("Expected original-byte provenance");
    expect(Buffer.from(await readSmallTestBlob(store, receiptEntry.originalBlob))).toEqual(original);
    expect(await sourceDigest(sourceRoot)).toBe(sourceBefore);
  });

  it("decodes legacy path parameters once and matches encoded v2 traffic", async () => {
    const encodedSlug = "caf%C3%A9%20%E6%9D%B1%2F%E4%BA%AC";
    const decodedSlug = "café 東/京";
    const fixture = fileData("/places/:slug", { slug: decodedSlug });
    fixture.request.pathParams = { slug: encodedSlug };
    await writeJson(path.join(sourceRoot, "flat", "place_001.json"), fixture);
    await migrateV1Store({ sourceRoot, destinationRoot });

    const store = new FilesystemStore(destinationRoot);
    const catalog = await store.catalogs.read();
    const flat = catalog.scenarios.find((scenario) => scenario.name === "flat");
    if (!flat) throw new Error("Expected flat scenario");
    const recording = (await store.manifests.read(flat.id)).recordings.find(
      (candidate) => candidate.filename === "place_001.json",
    );
    expect(recording?.request.pathParams).toEqual({ slug: decodedSlug });

    const config = compileConfigV2(
      {
        configVersion: 2,
        storage: { root: destinationRoot },
        apis: {
          legacy: {
            name: "Legacy",
            target: "https://api.example.com",
            routes: ["GET /places/:slug"],
          },
        },
      },
      path.join(tempRoot, "snaperro.config.ts"),
    );
    const prepared = await prepareTrafficRequest(config, {
      method: "GET",
      url: `http://localhost/places/${encodedSlug}`,
      headers: new Headers(),
      body: null,
      signal: new AbortController().signal,
    });
    try {
      expect(prepared.match.pathParams).toEqual({ slug: decodedSlug });
      const resolution = await new MockService(store.manifests, store.blobs).find(prepared, flat.id);
      expect(resolution?.recording.id).toBe(recording?.id);
    } finally {
      await prepared.dispose();
    }
  });

  it("fails preflight explicitly for an invalid legacy path-parameter escape", async () => {
    const fixture = fileData("/places/:slug", { ok: true });
    fixture.request.pathParams = { slug: "broken%ZZ" };
    await writeJson(path.join(sourceRoot, "flat", "invalid-path-param.json"), fixture);

    const dryRun = await migrateV1Store({ sourceRoot, destinationRoot, dryRun: true });
    expect(dryRun.errors).toContainEqual(
      expect.objectContaining({
        path: "flat/invalid-path-param.json",
        message: expect.stringContaining("Invalid percent-encoding in request.pathParams"),
      }),
    );
    await expect(migrateV1Store({ sourceRoot, destinationRoot })).rejects.toBeInstanceOf(V1MigrationError);
    await expect(fs.access(destinationRoot)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps a legacy HTTP 205 response bodyless", async () => {
    const discardedBody = { mustNotPersist: true };
    const resetFixture = fileData("/reset", discardedBody);
    resetFixture.response.status = 205;
    await writeJson(path.join(sourceRoot, "flat", "reset_001.json"), resetFixture);
    await migrateV1Store({ sourceRoot, destinationRoot });

    const store = new FilesystemStore(destinationRoot);
    const catalog = await store.catalogs.read();
    const flat = catalog.scenarios.find((scenario) => scenario.name === "flat");
    if (!flat) throw new Error("Expected flat scenario");
    const reset = (await store.manifests.read(flat.id)).recordings.find(
      (recording) => recording.filename === "reset_001.json",
    );
    expect(reset?.response).toMatchObject({ status: 205, body: null });
    const discardedDigest = Sha256Schema.parse(
      createHash("sha256").update(JSON.stringify(discardedBody)).digest("hex"),
    );
    await expect(store.blobs.openByDigest(discardedDigest)).rejects.toThrow();
  });

  it("drops a legacy HEAD response body instead of materializing it", async () => {
    const discardedBody = { mustNotPersist: "head" };
    const headFixture = fileData("/head", discardedBody);
    headFixture.method = "HEAD";
    await writeJson(path.join(sourceRoot, "flat", "head_001.json"), headFixture);
    await migrateV1Store({ sourceRoot, destinationRoot });

    const store = new FilesystemStore(destinationRoot);
    const catalog = await store.catalogs.read();
    const flat = catalog.scenarios.find((scenario) => scenario.name === "flat");
    if (!flat) throw new Error("Expected flat scenario");
    const head = (await store.manifests.read(flat.id)).recordings.find(
      (recording) => recording.filename === "head_001.json",
    );
    expect(head).toMatchObject({ method: "HEAD", response: { body: null } });
    const discardedDigest = Sha256Schema.parse(
      createHash("sha256").update(JSON.stringify(discardedBody)).digest("hex"),
    );
    await expect(store.blobs.openByDigest(discardedDigest)).rejects.toThrow();
  });

  it("preserves shadowed v1 duplicates while keeping the old filename-order winner matchable", async () => {
    await writeJson(path.join(sourceRoot, "flat", "users_000.json"), fileData("/users", [{ id: 0 }]));

    const dryRun = await migrateV1Store({ sourceRoot, destinationRoot, dryRun: true });
    expect(dryRun.errors).toEqual([]);
    expect(dryRun.warnings).toContainEqual(
      expect.objectContaining({
        path: "flat/users_001.json",
        message: expect.stringContaining("users_000.json remains active"),
      }),
    );
    await migrateV1Store({ sourceRoot, destinationRoot });

    const store = new FilesystemStore(destinationRoot);
    const catalog = await store.catalogs.read();
    const flat = catalog.scenarios.find((scenario) => scenario.name === "flat");
    if (!flat) throw new Error("Expected flat scenario");
    const recordings = (await store.manifests.read(flat.id)).recordings.filter(
      (recording) => recording.route === "/users",
    );
    const canonical = requestFingerprint({
      method: "GET",
      route: "/users",
      pathParams: {},
      query: [],
      body: { kind: "empty" },
    });

    expect(recordings).toHaveLength(2);
    expect(recordings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ filename: "users_000.json", requestFingerprint: canonical, matchable: true }),
        expect.objectContaining({ filename: "users_001.json", requestFingerprint: canonical, matchable: false }),
      ]),
    );
  });

  it("fails closed on invalid data and leaves no final destination", async () => {
    await fs.writeFile(path.join(sourceRoot, "flat", "broken.json"), "{broken", "utf8");
    const before = await sourceDigest(sourceRoot);

    const dryRun = await migrateV1Store({ sourceRoot, destinationRoot, dryRun: true });
    expect(dryRun.errors).toContainEqual(expect.objectContaining({ path: "flat/broken.json" }));

    await expect(migrateV1Store({ sourceRoot, destinationRoot })).rejects.toBeInstanceOf(V1MigrationError);
    await expect(fs.access(destinationRoot)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await sourceDigest(sourceRoot)).toBe(before);
  });

  it("accepts a recording JSON at the read limit and blocks one byte over it", async () => {
    const maximum = 2048;
    const sourceFile = path.join(sourceRoot, "flat", "bounded.json");
    const serialized = JSON.stringify(fileData("/bounded", { ok: true }));
    const paddingBytes = maximum - Buffer.byteLength(serialized);
    expect(paddingBytes).toBeGreaterThan(0);
    await fs.writeFile(sourceFile, `${serialized}${" ".repeat(paddingBytes)}`, "utf8");
    const readLimits = { maxRecordingFileBytes: maximum };

    const boundaryDryRun = await migrateV1Store({ sourceRoot, destinationRoot, dryRun: true, readLimits });
    expect(boundaryDryRun.errors).toEqual([]);
    await expect(migrateV1Store({ sourceRoot, destinationRoot, readLimits })).resolves.toMatchObject({
      integrity: { ok: true },
    });

    await fs.appendFile(sourceFile, " ", "utf8");
    const overLimitDestination = path.join(tempRoot, ".snaperro", "recording-over-limit-v2");
    const overLimitDryRun = await migrateV1Store({
      sourceRoot,
      destinationRoot: overLimitDestination,
      dryRun: true,
      readLimits,
    });
    expect(overLimitDryRun.errors).toContainEqual({
      path: "flat/bounded.json",
      message: `Legacy recording JSON exceeds the migration read limit: ${maximum + 1} bytes > ${maximum} bytes`,
    });
    await expect(
      migrateV1Store({ sourceRoot, destinationRoot: overLimitDestination, readLimits }),
    ).rejects.toBeInstanceOf(V1MigrationError);
    await expect(fs.access(overLimitDestination)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("accepts v1 state at the read limit and blocks one byte over it", async () => {
    const maximum = 256;
    const stateFile = path.join(tempRoot, ".snaperro", "state.json");
    const serialized = JSON.stringify({ mode: "mock", currentScenario: "flat" });
    const paddingBytes = maximum - Buffer.byteLength(serialized);
    expect(paddingBytes).toBeGreaterThan(0);
    await fs.writeFile(stateFile, `${serialized}${" ".repeat(paddingBytes)}`, "utf8");
    const readLimits = { maxStateFileBytes: maximum };

    const boundaryDryRun = await migrateV1Store({ sourceRoot, destinationRoot, dryRun: true, readLimits });
    expect(boundaryDryRun.errors).toEqual([]);
    await expect(migrateV1Store({ sourceRoot, destinationRoot, readLimits })).resolves.toMatchObject({
      integrity: { ok: true },
    });

    await fs.appendFile(stateFile, " ", "utf8");
    const overLimitDestination = path.join(tempRoot, ".snaperro", "state-over-limit-v2");
    const overLimitDryRun = await migrateV1Store({
      sourceRoot,
      destinationRoot: overLimitDestination,
      stateFile,
      dryRun: true,
      readLimits,
    });
    expect(overLimitDryRun.errors).toContainEqual({
      path: stateFile,
      message: `Legacy state JSON exceeds the migration read limit: ${maximum + 1} bytes > ${maximum} bytes`,
    });
    await expect(
      migrateV1Store({ sourceRoot, destinationRoot: overLimitDestination, stateFile, readLimits }),
    ).rejects.toBeInstanceOf(V1MigrationError);
    await expect(fs.access(overLimitDestination)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("blocks migration when the v1 state cannot be hashed or reread", async () => {
    const stateFile = path.join(tempRoot, ".snaperro", "state.json");
    const realOpen = fs.open.bind(fs);
    const accessError = Object.assign(new Error("simulated state I/O failure"), { code: "EIO" });
    let stateOpens = 0;
    vi.spyOn(fs, "open").mockImplementation(async (...args: Parameters<typeof fs.open>) => {
      if (String(args[0]) === stateFile && stateOpens++ === 0) throw accessError;
      return realOpen(...args);
    });

    const hashFailure = await migrateV1Store({ sourceRoot, destinationRoot, stateFile, dryRun: true });
    expect(hashFailure.errors).toContainEqual({
      path: stateFile,
      message: "Cannot read v1 state: simulated state I/O failure",
    });
    await expect(fs.access(destinationRoot)).rejects.toMatchObject({ code: "ENOENT" });

    vi.restoreAllMocks();
    stateOpens = 0;
    vi.spyOn(fs, "open").mockImplementation(async (...args: Parameters<typeof fs.open>) => {
      if (String(args[0]) === stateFile && stateOpens++ === 1) throw accessError;
      return realOpen(...args);
    });
    const rereadFailure = await migrateV1Store({
      sourceRoot,
      destinationRoot,
      stateFile,
      dryRun: true,
    });
    expect(rereadFailure.errors).toContainEqual({
      path: stateFile,
      message: "Cannot read v1 state consistently: simulated state I/O failure",
    });
    await expect(fs.access(destinationRoot)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("blocks migration when v1 state changes between hashing and parsing", async () => {
    const stateFile = path.join(tempRoot, ".snaperro", "state.json");
    const realOpen = fs.open.bind(fs);
    let stateOpens = 0;
    vi.spyOn(fs, "open").mockImplementation(async (...args: Parameters<typeof fs.open>) => {
      if (String(args[0]) === stateFile && stateOpens++ === 1) {
        syncFs.writeFileSync(stateFile, `${JSON.stringify({ mode: "proxy", currentScenario: null })}\n`, "utf8");
      }
      return realOpen(...args);
    });

    const report = await migrateV1Store({ sourceRoot, destinationRoot, stateFile, dryRun: true });

    expect(report.errors).toContainEqual({ path: stateFile, message: "v1 state changed while it was read" });
    await expect(fs.access(destinationRoot)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("fingerprints a large skipped non-JSON source without applying the JSON read limit", async () => {
    const isolatedSource = path.join(tempRoot, "streamed-source", "files");
    const ignoredFile = path.join(isolatedSource, "empty", "legacy.bin");
    await fs.mkdir(path.dirname(ignoredFile), { recursive: true });
    await fs.writeFile(ignoredFile, Buffer.alloc(2 * 1024 * 1024, 0x61));

    const report = await migrateV1Store({
      sourceRoot: isolatedSource,
      destinationRoot: path.join(tempRoot, "streamed-destination"),
      dryRun: true,
      readLimits: { maxRecordingFileBytes: 1, maxStateFileBytes: 1 },
    });
    expect(report).toMatchObject({ sourceFiles: 0, sourceBytes: 0, sourceUnchanged: true, errors: [] });
    expect(report.warnings).toContainEqual({ path: "empty/legacy.bin", message: "Non-JSON file skipped" });
  });

  it("rejects an informational status that Fetch cannot replay as a final response", async () => {
    const informational = fileData("/informational", null);
    informational.response.status = 199;
    await writeJson(path.join(sourceRoot, "flat", "informational_001.json"), informational);

    const dryRun = await migrateV1Store({ sourceRoot, destinationRoot, dryRun: true });
    expect(dryRun.errors).toContainEqual(
      expect.objectContaining({ path: "flat/informational_001.json", message: "Invalid response.status" }),
    );
    await expect(migrateV1Store({ sourceRoot, destinationRoot })).rejects.toBeInstanceOf(V1MigrationError);
    await expect(fs.access(destinationRoot)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not trust an existing destination without its migration receipt", async () => {
    await migrateV1Store({ sourceRoot, destinationRoot });
    await fs.unlink(path.join(destinationRoot, "migration-v1.json"));

    await expect(migrateV1Store({ sourceRoot, destinationRoot })).rejects.toMatchObject({
      name: "V1MigrationError",
      report: { alreadyApplied: false },
    });
  });

  it("fails closed when a migration receipt loses an original-byte reference", async () => {
    await migrateV1Store({ sourceRoot, destinationRoot });
    const receiptPath = path.join(destinationRoot, "migration-v1.json");
    const receipt = JSON.parse(await fs.readFile(receiptPath, "utf8")) as {
      entries: Array<{ originalBlob?: unknown }>;
    };
    delete receipt.entries[0].originalBlob;
    await writeJson(receiptPath, receipt);

    const store = new FilesystemStore(destinationRoot);
    expect(await store.verifyIntegrity()).toMatchObject({ ok: false });
    await expect(store.garbageCollection.schedule()).rejects.toThrow("migration receipt");
    await expect(migrateV1Store({ sourceRoot, destinationRoot })).rejects.toBeInstanceOf(V1MigrationError);
  });

  it("keeps provenance verifiable after a migrated recording is deleted normally", async () => {
    const report = await migrateV1Store({ sourceRoot, destinationRoot });
    const config = compileConfigV2(
      {
        configVersion: 2,
        server: { openBrowser: false },
        storage: { root: destinationRoot },
        apis: {},
      },
      path.join(tempRoot, "snaperro.config.ts"),
    );
    const runtime = await RuntimeCore.create(config);
    const catalog = await runtime.store.catalogs.read();
    const scenario = catalog.scenarios.find((candidate) => candidate.name === "flat");
    if (!scenario) throw new Error("Expected migrated flat scenario");
    const manifest = await runtime.store.manifests.read(scenario.id);
    const recording = manifest.recordings[0];
    if (!recording) throw new Error("Expected migrated recording");

    try {
      await runtime.commands.execute({
        protocolVersion: V2_SCHEMA_VERSION,
        commandId: CommandIdSchema.parse("cmd_delete_migrated_recording"),
        type: "recording.delete",
        scenarioId: scenario.id,
        recordingId: recording.id,
        expectedScenarioRevision: manifest.revision,
        expectedContentRevision: recording.revision,
      });
    } finally {
      await runtime.close();
    }

    const store = new FilesystemStore(destinationRoot);
    await expect(store.verifyIntegrity()).resolves.toMatchObject({ ok: true });

    const provenance = report.entries.find((entry) => entry.recordingId === recording.id)?.originalBlob;
    if (!provenance) throw new Error("Expected original-byte provenance");
    await fs.writeFile(store.layout.blobPath(provenance.sha256), "tampered", "utf8");
    await expect(store.verifyIntegrity()).resolves.toMatchObject({
      ok: false,
      errors: expect.arrayContaining([
        expect.stringContaining(`Blob failed integrity validation: ${provenance.sha256}`),
      ]),
    });
  });

  it("applies the scenario recording limit identically in preflight and materialization", async () => {
    const flatRoot = path.join(sourceRoot, "flat");
    await writeIdenticalRecordings(flatRoot, 2, 1000);

    const boundaryDryRun = await migrateV1Store({ sourceRoot, destinationRoot, dryRun: true });
    expect(boundaryDryRun.errors).toEqual([]);
    const boundaryMigration = await migrateV1Store({ sourceRoot, destinationRoot });
    expect(boundaryMigration.integrity).toMatchObject({ ok: true });

    await writeIdenticalRecordings(flatRoot, 1001, 1001);
    const overLimitDestination = path.join(tempRoot, ".snaperro", "over-limit-v2");
    const overLimitDryRun = await migrateV1Store({
      sourceRoot,
      destinationRoot: overLimitDestination,
      dryRun: true,
    });
    expect(overLimitDryRun.errors).toContainEqual(
      expect.objectContaining({
        path: "flat",
        message: expect.stringContaining("Scenario exceeds the v2 aggregate contract"),
      }),
    );

    await expect(migrateV1Store({ sourceRoot, destinationRoot: overLimitDestination })).rejects.toMatchObject({
      name: "V1MigrationError",
      report: { errors: overLimitDryRun.errors },
    });
    await expect(fs.access(overLimitDestination)).rejects.toMatchObject({ code: "ENOENT" });
  }, 120_000);

  it("refuses to place the v2 store inside the v1 source", async () => {
    const nestedDestination = path.join(sourceRoot, "store-v2");
    await expect(migrateV1Store({ sourceRoot, destinationRoot: nestedDestination })).rejects.toThrow(
      "must not be the v1 source",
    );
    await expect(fs.access(nestedDestination)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses overlapping state and destination paths before writing", async () => {
    const before = await sourceDigest(sourceRoot);
    const stateInsideDestination = path.join(destinationRoot, "state.json");
    await expect(migrateV1Store({ sourceRoot, destinationRoot, stateFile: stateInsideDestination })).rejects.toThrow(
      "state file and v2 destination must not overlap",
    );
    await expect(fs.access(destinationRoot)).rejects.toMatchObject({ code: "ENOENT" });

    const futureStatePath = path.join(tempRoot, "future-state-path");
    const destinationInsideStatePath = path.join(futureStatePath, "v2");
    await expect(
      migrateV1Store({ sourceRoot, destinationRoot: destinationInsideStatePath, stateFile: futureStatePath }),
    ).rejects.toThrow("state file and v2 destination must not overlap");
    await expect(fs.access(futureStatePath)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await sourceDigest(sourceRoot)).toBe(before);
  });

  it("refuses a state path inside the recording source before parsing it twice", async () => {
    const before = await sourceDigest(sourceRoot);
    const overlappingState = path.join(sourceRoot, "flat", "state.json");

    await expect(migrateV1Store({ sourceRoot, destinationRoot, stateFile: overlappingState })).rejects.toThrow(
      "state file and v1 recording source must not overlap",
    );

    await expect(fs.access(destinationRoot)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await sourceDigest(sourceRoot)).toBe(before);
  });

  it("rejects symlink aliases that would place destination or state inside the recording source", async () => {
    const before = await sourceDigest(sourceRoot);
    const sourceAlias = path.join(tempRoot, "source-alias");
    await fs.symlink(sourceRoot, sourceAlias, "dir");
    const aliasedDestination = path.join(sourceAlias, "nested-v2");

    await expect(migrateV1Store({ sourceRoot, destinationRoot: aliasedDestination })).rejects.toThrow(
      "must not be the v1 source or a descendant",
    );
    await expect(fs.access(aliasedDestination)).rejects.toMatchObject({ code: "ENOENT" });

    const stateAlias = path.join(tempRoot, "state-alias.json");
    await fs.symlink(path.join(sourceRoot, "flat", "users_001.json"), stateAlias);
    await expect(migrateV1Store({ sourceRoot, destinationRoot, stateFile: stateAlias })).rejects.toThrow(
      "state file and v1 recording source must not overlap",
    );
    await expect(fs.access(destinationRoot)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await sourceDigest(sourceRoot)).toBe(before);
  });

  it("does not treat an unreadable destination as missing", async () => {
    const before = await sourceDigest(sourceRoot);
    const realAccess = fs.access.bind(fs);
    const accessError = Object.assign(new Error("simulated destination I/O failure"), { code: "EIO" });
    vi.spyOn(fs, "access").mockImplementation(async (...args: Parameters<typeof fs.access>) => {
      if (String(args[0]) === destinationRoot) throw accessError;
      return realAccess(...args);
    });

    await expect(migrateV1Store({ sourceRoot, destinationRoot })).rejects.toBe(accessError);
    expect(await sourceDigest(sourceRoot)).toBe(before);
    const siblings = await fs.readdir(path.dirname(destinationRoot));
    expect(siblings.some((entry) => entry.includes(".store-v2.migrate."))).toBe(false);
  });

  it("reports a published destination when parent-directory durability cannot be confirmed", async () => {
    const before = await sourceDigest(sourceRoot);
    const destinationParent = path.dirname(destinationRoot);
    const realOpen = fs.open.bind(fs);
    const durabilityError = Object.assign(new Error("simulated parent fsync failure"), { code: "EIO" });
    vi.spyOn(fs, "open").mockImplementation(async (...args: Parameters<typeof fs.open>) => {
      if (String(args[0]) === destinationParent && args[1] === "r") {
        return {
          sync: async () => {
            throw durabilityError;
          },
          close: async () => undefined,
        } as unknown as Awaited<ReturnType<typeof fs.open>>;
      }
      return realOpen(...args);
    });

    const failure = await migrateV1Store({ sourceRoot, destinationRoot }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(V1MigrationError);
    expect(failure).toMatchObject({
      message: "v2 migration destination was published but durability confirmation failed",
      cause: durabilityError,
      report: {
        errors: [
          {
            path: destinationRoot,
            message: expect.stringContaining("destination was published"),
          },
        ],
      },
    });
    await expect(fs.access(path.join(destinationRoot, "store.json"))).resolves.toBeUndefined();
    expect(await sourceDigest(sourceRoot)).toBe(before);

    vi.restoreAllMocks();
    await expect(migrateV1Store({ sourceRoot, destinationRoot })).resolves.toMatchObject({
      alreadyApplied: true,
      errors: [],
      integrity: { ok: true },
    });
  });

  it("keeps the migration failure primary and reports a failed staging cleanup", async () => {
    const before = await sourceDigest(sourceRoot);
    const destinationParent = path.dirname(destinationRoot);
    const realRename = fs.rename.bind(fs);
    const realRm = fs.rm.bind(fs);
    const migrationError = Object.assign(new Error("simulated destination rename failure"), { code: "EIO" });
    const cleanupError = Object.assign(new Error("simulated staging cleanup failure"), { code: "EACCES" });
    vi.spyOn(fs, "rename").mockImplementation(async (...args: Parameters<typeof fs.rename>) => {
      if (String(args[1]) === destinationRoot) throw migrationError;
      return realRename(...args);
    });
    vi.spyOn(fs, "rm").mockImplementation(async (...args: Parameters<typeof fs.rm>) => {
      const target = String(args[0]);
      if (
        path.dirname(target) === destinationParent &&
        path.basename(target).startsWith(`.${path.basename(destinationRoot)}.migrate.`)
      ) {
        throw cleanupError;
      }
      return realRm(...args);
    });

    const failure = await migrateV1Store({ sourceRoot, destinationRoot }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(V1MigrationError);
    if (!(failure instanceof V1MigrationError)) throw new Error("Expected V1MigrationError");
    expect(failure.message).toContain("v1 migration failed");
    expect(failure.message).toContain("simulated staging cleanup failure");
    expect(failure.report.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: "simulated destination rename failure" }),
        expect.objectContaining({ message: expect.stringContaining("simulated staging cleanup failure") }),
      ]),
    );
    expect(failure.cause).toBeInstanceOf(AggregateError);
    expect((failure.cause as AggregateError).errors).toEqual([migrationError, cleanupError]);
    await expect(fs.access(destinationRoot)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await sourceDigest(sourceRoot)).toBe(before);
    const siblings = await fs.readdir(destinationParent);
    expect(siblings.some((entry) => entry.startsWith(`.${path.basename(destinationRoot)}.migrate.`))).toBe(true);
  });
});
