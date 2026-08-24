import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TransferIdSchema } from "../../../shared/contracts-v2/primitives.js";
import type { IdGeneratorPort } from "../application/ports.js";
import type { ArchiveCodec } from "./archive-codec.js";
import { RecordingArchiveSchema } from "./archive-format.js";
import { StagedImportRegistry } from "./staged-import-registry.js";

const directories: string[] = [];
const firstId = TransferIdSchema.parse("xfer_0123456789abcdef");
const secondId = TransferIdSchema.parse("xfer_fedcba9876543210");
type StreamReadResult = Awaited<ReturnType<ReadableStreamDefaultReader<Uint8Array>["read"]>>;

async function temporaryDirectory() {
  const directory = await fs.mkdtemp(path.join(process.cwd(), ".staged-import-"));
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

function archive() {
  return RecordingArchiveSchema.parse({
    format: "snaperro-recording",
    formatVersion: 2,
    exportedAt: "2026-08-24T00:00:00.000Z",
    filename: "portable/name.json",
    recording: {
      route: "/users",
      method: "GET",
      request: { pathParams: {}, query: [], headers: [], body: null },
      response: { status: 200, statusText: "OK", headers: [], body: null },
    },
  });
}

function ids() {
  return {
    nextTransferId: vi.fn().mockReturnValueOnce(firstId).mockReturnValueOnce(secondId),
  } as unknown as IdGeneratorPort;
}

describe("StagedImportRegistry", () => {
  it("expires an uncommitted import and removes its staged bytes", async () => {
    const directory = await temporaryDirectory();
    const registry = new StagedImportRegistry({
      directory,
      maxUploadBytes: 1024,
      codec: { inspect: vi.fn(async () => archive()) } as unknown as ArchiveCodec,
      ids: ids(),
      ttlMs: 10,
    });
    await registry.stage("recording", new Blob(["zip"]).stream(), {});
    await vi.waitFor(() => expect(() => registry.get(firstId, "recording", {})).toThrow(), { timeout: 1000 });
    await vi.waitFor(async () => {
      await expect(fs.access(path.join(directory, `${firstId}.recording.import.zip`))).rejects.toMatchObject({
        code: "ENOENT",
      });
    });
    await registry.close();
  });

  it("enforces aggregate staged bytes and removes stale crash orphans on reopen", async () => {
    const directory = await temporaryDirectory();
    const orphans = [
      path.join(directory, `${firstId}.recording.import.zip`),
      path.join(directory, "xfer_aaaaaaaaaaaaaaaa.partial"),
      path.join(directory, "xfer_bbbbbbbbbbbbbbbb.zip"),
    ];
    await Promise.all(orphans.map((orphan) => fs.writeFile(orphan, "orphan")));
    const old = new Date(Date.now() - 120_000);
    await Promise.all(orphans.map((orphan) => fs.utimes(orphan, old, old)));
    const registry = new StagedImportRegistry({
      directory,
      maxUploadBytes: 1024,
      maxPendingBytes: 5,
      maxPendingImports: 2,
      codec: { inspect: vi.fn(async () => archive()) } as unknown as ArchiveCodec,
      ids: ids(),
      ttlMs: 60_000,
    });
    await registry.ready();
    await Promise.all(orphans.map((orphan) => expect(fs.access(orphan)).rejects.toMatchObject({ code: "ENOENT" })));
    await registry.stage("recording", new Blob(["1234"]).stream(), {});
    await expect(registry.stage("recording", new Blob(["12"]).stream(), {})).rejects.toMatchObject({
      code: "PAYLOAD_LIMIT_EXCEEDED",
    });
    await registry.close();
    await expect(fs.access(path.join(directory, `${firstId}.recording.import.zip`))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("cancels and removes an upload that is still streaming when closed", async () => {
    const directory = await temporaryDirectory();
    const registry = new StagedImportRegistry({
      directory,
      maxUploadBytes: 1024,
      codec: { inspect: vi.fn(async () => archive()) } as unknown as ArchiveCodec,
      ids: ids(),
    });
    const upload = registry.stage(
      "recording",
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3]));
        },
      }),
      {},
    );
    const settledUpload = upload.then(
      () => ({ status: "fulfilled" as const, error: undefined }),
      (error: unknown) => ({ status: "rejected" as const, error }),
    );
    await vi.waitFor(async () => {
      await expect(fs.access(path.join(directory, `${firstId}.recording.import.zip`))).resolves.toBeUndefined();
    });
    await registry.close();
    await expect(settledUpload).resolves.toMatchObject({ status: "rejected", error: { code: "ABORTED" } });
    await expect(fs.access(path.join(directory, `${firstId}.recording.import.zip`))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("aborts a pending read and bounds never-settling cancellation and file cleanup", async () => {
    const directory = await temporaryDirectory();
    const filePath = path.join(directory, `${firstId}.recording.import.zip`);
    const realOpen = fs.open.bind(fs);
    let handleObserved = false;
    let handleCloseCalled = false;
    let releaseRealHandle: (() => Promise<void>) | undefined;
    vi.spyOn(fs, "open").mockImplementation(async (...args: Parameters<typeof fs.open>) => {
      const handle = await realOpen(...args);
      const realClose = handle.close.bind(handle);
      releaseRealHandle = realClose;
      vi.spyOn(handle, "close").mockImplementation(() => {
        handleCloseCalled = true;
        return new Promise<void>(() => undefined);
      });
      handleObserved = true;
      return handle;
    });
    const read = vi.fn(() => new Promise<StreamReadResult>(() => undefined));
    const cancel = vi.fn(() => new Promise<void>(() => undefined));
    const releaseLock = vi.fn(() => {
      throw new TypeError("A read is still pending");
    });
    const registry = new StagedImportRegistry({
      directory,
      maxUploadBytes: 1024,
      shutdownTimeoutMs: 25,
      codec: { inspect: vi.fn(async () => archive()) } as unknown as ArchiveCodec,
      ids: ids(),
    });
    const upload = registry.stage(
      "recording",
      {
        getReader: () => ({ read, cancel, releaseLock }),
      } as unknown as ReadableStream<Uint8Array>,
      {},
    );
    const uploadResult = upload.then(
      () => ({ status: "fulfilled" as const, error: undefined }),
      (error: unknown) => ({ status: "rejected" as const, error }),
    );
    await vi.waitFor(() => expect(handleObserved).toBe(true));
    await vi.waitFor(() => expect(fs.access(filePath)).resolves.toBeUndefined());
    vi.useFakeTimers();

    const stopping = registry.close();
    const stopResult = stopping.then(
      () => ({ status: "fulfilled" as const, error: undefined }),
      (error: unknown) => ({ status: "rejected" as const, error }),
    );
    await vi.advanceTimersByTimeAsync(25);

    await expect(stopResult).resolves.toMatchObject({
      status: "rejected",
      error: { message: "Import staging cleanup did not settle within 25ms" },
    });
    await expect(uploadResult).resolves.toMatchObject({ status: "rejected", error: { code: "ABORTED" } });
    expect(read).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalled();
    expect(handleCloseCalled).toBe(true);
    expect(releaseLock).toHaveBeenCalled();
    await expect(fs.access(filePath)).rejects.toMatchObject({ code: "ENOENT" });
    await releaseRealHandle?.();
  });

  it("does not retain an upload when opening its staging file never settles", async () => {
    const directory = await temporaryDirectory();
    const open = vi.spyOn(fs, "open").mockImplementation(() => new Promise(() => undefined));
    const registry = new StagedImportRegistry({
      directory,
      maxUploadBytes: 1024,
      shutdownTimeoutMs: 25,
      codec: { inspect: vi.fn(async () => archive()) } as unknown as ArchiveCodec,
      ids: ids(),
    });
    await registry.ready();
    const upload = registry.stage("recording", new Blob(["zip"]).stream(), {});
    const uploadResult = upload.then(
      () => ({ status: "fulfilled" as const, error: undefined }),
      (error: unknown) => ({ status: "rejected" as const, error }),
    );
    await vi.waitFor(() => expect(open).toHaveBeenCalledOnce());

    await expect(registry.close()).resolves.toBeUndefined();
    await expect(uploadResult).resolves.toMatchObject({ status: "rejected", error: { code: "ABORTED" } });
  });

  it("can close after staging initialization fails", async () => {
    const directory = await temporaryDirectory();
    const blockedDirectory = path.join(directory, "blocked");
    await fs.writeFile(blockedDirectory, "not a directory", "utf8");
    const registry = new StagedImportRegistry({
      directory: blockedDirectory,
      maxUploadBytes: 1024,
      codec: { inspect: vi.fn(async () => archive()) } as unknown as ArchiveCodec,
      ids: ids(),
    });

    await expect(registry.ready()).rejects.toMatchObject({ code: "EEXIST" });
    const first = registry.close();
    const second = registry.close();
    expect(first).toBe(second);
    await expect(first).resolves.toBeUndefined();
  });

  it("bounds initialization inside the overall close deadline", async () => {
    const directory = await temporaryDirectory();
    vi.spyOn(fs, "mkdir").mockImplementation(() => new Promise(() => undefined));
    const registry = new StagedImportRegistry({
      directory,
      maxUploadBytes: 1024,
      shutdownTimeoutMs: 25,
      codec: { inspect: vi.fn(async () => archive()) } as unknown as ArchiveCodec,
      ids: ids(),
    });
    vi.useFakeTimers();

    const first = registry.close();
    const second = registry.close();
    expect(first).toBe(second);
    const result = first.then(
      () => ({ status: "fulfilled" as const, error: undefined }),
      (error: unknown) => ({ status: "rejected" as const, error }),
    );
    await vi.advanceTimersByTimeAsync(25);

    await expect(result).resolves.toMatchObject({
      status: "rejected",
      error: { message: "Import staging cleanup did not settle within 25ms" },
    });
  });

  it("atomically grants one import claim and releases it only for an explicit retry", async () => {
    const directory = await temporaryDirectory();
    const registry = new StagedImportRegistry({
      directory,
      maxUploadBytes: 1024,
      codec: { inspect: vi.fn(async () => archive()) } as unknown as ArchiveCodec,
      ids: ids(),
    });
    await registry.stage("recording", new Blob(["zip"]).stream(), {});

    const claims = await Promise.allSettled([
      Promise.resolve().then(() => registry.claim(firstId, "recording", "command-a", {})),
      Promise.resolve().then(() => registry.claim(firstId, "recording", "command-b", {})),
    ]);
    expect(claims.filter((claim) => claim.status === "fulfilled")).toHaveLength(1);
    expect(claims.filter((claim) => claim.status === "rejected")).toHaveLength(1);

    const owner = claims[0]?.status === "fulfilled" ? "command-a" : "command-b";
    registry.release(firstId, "recording", owner);
    expect(() => registry.claim(firstId, "recording", "command-c", {})).not.toThrow();
    await registry.complete(firstId, "recording", "command-c");
    await registry.close();
  });

  it("accounts for a fresh crash orphan and removes it when its grace expires", async () => {
    const directory = await temporaryDirectory();
    const orphan = path.join(directory, `${firstId}.recording.import.zip`);
    await fs.writeFile(orphan, "orphan");
    const almostExpired = new Date(Date.now() - 59_900);
    await fs.utimes(orphan, almostExpired, almostExpired);
    const registry = new StagedImportRegistry({
      directory,
      maxUploadBytes: 1024,
      maxPendingImports: 1,
      codec: { inspect: vi.fn(async () => archive()) } as unknown as ArchiveCodec,
      ids: ids(),
      ttlMs: 10,
    });
    await registry.ready();
    await expect(registry.stage("recording", new Blob(["zip"]).stream(), {})).rejects.toMatchObject({
      code: "PAYLOAD_LIMIT_EXCEEDED",
    });
    await vi.waitFor(() => expect(fs.access(orphan)).rejects.toMatchObject({ code: "ENOENT" }), { timeout: 1000 });
    await expect(registry.stage("recording", new Blob(["zip"]).stream(), {})).resolves.toMatchObject({
      transferId: firstId,
    });
    await registry.close();
  });
});
