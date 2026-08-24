import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import archiver from "archiver";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BodyRefSchema, RecordingDraftSchema } from "../../../shared/contracts-v2/entities.js";
import type { BlobStorePort } from "../application/ports.js";
import {
  ArchiveCodec,
  MAX_ARCHIVE_ENTRIES,
  MAX_CENTRAL_DIRECTORY_BYTES,
  RECORDING_MANIFEST_ENTRY,
} from "./archive-codec.js";
import { RecordingArchiveSchema } from "./archive-format.js";

const directories: string[] = [];
const timestamp = "2026-08-24T00:00:00.000Z";

async function temporaryDirectory() {
  const directory = await fs.mkdtemp(path.join(process.cwd(), ".archive-codec-"));
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

function recordingArchive(bodySize: number) {
  const body = BodyRefSchema.parse({
    sha256: "a".repeat(64),
    size: bodySize,
    mediaType: "application/octet-stream",
    contentEncoding: null,
  });
  return RecordingArchiveSchema.parse({
    format: "snaperro-recording",
    formatVersion: 2,
    exportedAt: timestamp,
    filename: "binary.json",
    recording: RecordingDraftSchema.parse({
      route: "/binary",
      method: "GET",
      request: { pathParams: {}, query: [], headers: [], body: null },
      response: { status: 200, statusText: "OK", headers: [], body },
    }),
  });
}

async function writeZip(filePath: string, manifest: unknown, extraDirectory: boolean) {
  const zip = archiver("zip");
  const completed = pipeline(zip, createWriteStream(filePath));
  zip.append(JSON.stringify(manifest), { name: RECORDING_MANIFEST_ENTRY });
  if (extraDirectory) zip.append(Buffer.alloc(0), { name: "unexpected/" });
  await zip.finalize();
  await completed;
}

async function writeBlobZip(filePath: string, manifest: unknown, digest: string, body: Uint8Array) {
  const zip = archiver("zip");
  const completed = pipeline(zip, createWriteStream(filePath));
  zip.append(JSON.stringify(manifest), { name: RECORDING_MANIFEST_ENTRY });
  zip.append(Buffer.from(body), { name: `blobs/${digest}`, store: true });
  await zip.finalize();
  await completed;
}

describe("ArchiveCodec", () => {
  it("refuses to export an archive beyond the aggregate expanded limit before opening blobs", async () => {
    const directory = await temporaryDirectory();
    const archive = recordingArchive(1024);
    const manifestSize = Buffer.byteLength(`${JSON.stringify(archive)}\n`);
    const open = vi.fn();
    const codec = new ArchiveCodec({ open } as unknown as BlobStorePort, manifestSize + 1023);
    await expect(
      codec.write(
        path.join(directory, "export.partial"),
        path.join(directory, "export.zip"),
        RECORDING_MANIFEST_ENTRY,
        archive,
        {},
      ),
    ).rejects.toMatchObject({ code: "PAYLOAD_LIMIT_EXCEEDED" });
    expect(open).not.toHaveBeenCalled();
  });

  it("rejects unknown directory entries instead of silently ignoring them", async () => {
    const directory = await temporaryDirectory();
    const archive = recordingArchive(0);
    const filePath = path.join(directory, "import.zip");
    await writeZip(filePath, archive, true);
    const codec = new ArchiveCodec({} as BlobStorePort, 1024 * 1024);
    await expect(codec.inspect(filePath, "recording")).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
  });

  it("refuses to publish a ZIP whose actual bytes exceed the matching upload limit", async () => {
    const directory = await temporaryDirectory();
    const archive = recordingArchive(0);
    const partialPath = path.join(directory, "export.partial");
    const filePath = path.join(directory, "export.zip");
    const codec = new ArchiveCodec(
      { open: vi.fn(async () => new Blob([]).stream()) } as unknown as BlobStorePort,
      1024 * 1024,
      100,
    );

    await expect(codec.write(partialPath, filePath, RECORDING_MANIFEST_ENTRY, archive, {})).rejects.toMatchObject({
      code: "PAYLOAD_LIMIT_EXCEEDED",
    });
    await expect(fs.access(partialPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.access(filePath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects a ZIP64 entry-count bomb before opening its directory", async () => {
    const directory = await temporaryDirectory();
    const filePath = path.join(directory, "entry-bomb.zip");
    const totalEntries = BigInt(MAX_ARCHIVE_ENTRIES + 1);
    const zip64End = Buffer.alloc(56);
    zip64End.writeUInt32LE(0x0606_4b50, 0);
    zip64End.writeBigUInt64LE(44n, 4);
    zip64End.writeUInt16LE(45, 12);
    zip64End.writeUInt16LE(45, 14);
    zip64End.writeBigUInt64LE(totalEntries, 24);
    zip64End.writeBigUInt64LE(totalEntries, 32);
    const locator = Buffer.alloc(20);
    locator.writeUInt32LE(0x0706_4b50, 0);
    locator.writeBigUInt64LE(0n, 8);
    locator.writeUInt32LE(1, 16);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x0605_4b50, 0);
    end.writeUInt16LE(0xffff, 8);
    end.writeUInt16LE(0xffff, 10);
    end.writeUInt32LE(0xffff_ffff, 12);
    end.writeUInt32LE(0xffff_ffff, 16);
    await fs.writeFile(filePath, Buffer.concat([zip64End, locator, end]));

    const codec = new ArchiveCodec({} as BlobStorePort, 1024 * 1024);
    await expect(codec.inspect(filePath, "recording")).rejects.toMatchObject({
      code: "PAYLOAD_LIMIT_EXCEEDED",
      details: { limitBytes: MAX_ARCHIVE_ENTRIES, actualBytes: MAX_ARCHIVE_ENTRIES + 1 },
    });
  });

  it("rejects oversized central-directory metadata before unzipper retains it", async () => {
    const directory = await temporaryDirectory();
    const filePath = path.join(directory, "directory-metadata-bomb.zip");
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x0605_4b50, 0);
    end.writeUInt16LE(1, 8);
    end.writeUInt16LE(1, 10);
    end.writeUInt32LE(MAX_CENTRAL_DIRECTORY_BYTES + 1, 12);
    await fs.writeFile(filePath, end);

    const codec = new ArchiveCodec({} as BlobStorePort, 1024 * 1024);
    await expect(codec.inspect(filePath, "recording")).rejects.toMatchObject({
      code: "PAYLOAD_LIMIT_EXCEEDED",
      details: {
        limitBytes: MAX_CENTRAL_DIRECTORY_BYTES,
        actualBytes: MAX_CENTRAL_DIRECTORY_BYTES + 1,
      },
    });
  });

  it("rejects archive inspection when its operation is already aborted", async () => {
    const directory = await temporaryDirectory();
    const archive = recordingArchive(0);
    const filePath = path.join(directory, "aborted-inspection.zip");
    await writeZip(filePath, archive, false);
    const controller = new AbortController();
    controller.abort(new Error("server stopping"));

    await expect(
      new ArchiveCodec({} as BlobStorePort, 1024 * 1024).inspect(filePath, "recording", {
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: "ABORTED" });
  });

  it("does not wait for blob cleanup after a materialization limit failure", async () => {
    const directory = await temporaryDirectory();
    const archive = recordingArchive(1);
    const filePath = path.join(directory, "oversized-blob.zip");
    const digest = archive.recording.response.body?.sha256;
    if (!digest) throw new Error("Expected the fixture to contain a response body");
    await writeBlobZip(filePath, archive, digest, Uint8Array.of(1, 2));
    const abortWritable = vi.fn(() => new Promise<void>(() => undefined));
    const abortSession = vi.fn(() => new Promise<void>(() => undefined));
    const codec = new ArchiveCodec(
      {
        beginWrite: vi.fn(async () => ({
          writable: new WritableStream<Uint8Array>({ abort: abortWritable }),
          commit: vi.fn(),
          abort: abortSession,
        })),
      } as unknown as BlobStorePort,
      1024 * 1024,
    );

    const outcome = await Promise.race([
      codec.materialize(filePath, archive, {}).then(
        () => "fulfilled" as const,
        (error: unknown) => error,
      ),
      new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 100)),
    ]);

    expect(outcome).toMatchObject({ code: "PAYLOAD_LIMIT_EXCEEDED" });
    expect(abortWritable).toHaveBeenCalledOnce();
    expect(abortSession).toHaveBeenCalledOnce();
  });

  it("aborts an export without awaiting a pending source or filesystem cleanup", async () => {
    const directory = await temporaryDirectory();
    const archive = recordingArchive(1);
    const partialPath = path.join(directory, "pending.partial");
    const filePath = path.join(directory, "pending.zip");
    const controller = new AbortController();
    let markPullStarted: (() => void) | undefined;
    const pullStarted = new Promise<void>((resolve) => {
      markPullStarted = resolve;
    });
    const cancel = vi.fn(() => new Promise<void>(() => undefined));
    const unlink = vi.spyOn(fs, "unlink").mockImplementation(() => new Promise<void>(() => undefined));
    const codec = new ArchiveCodec(
      {
        open: vi.fn(
          async () =>
            new ReadableStream<Uint8Array>({
              pull() {
                markPullStarted?.();
                return new Promise<void>(() => undefined);
              },
              cancel,
            }),
        ),
      } as unknown as BlobStorePort,
      1024 * 1024,
      1024 * 1024,
      25,
    );

    try {
      const writing = codec.write(partialPath, filePath, RECORDING_MANIFEST_ENTRY, archive, {
        signal: controller.signal,
      });
      await pullStarted;
      controller.abort(new Error("server stopping"));

      const outcome = await Promise.race([
        writing.then(
          () => "fulfilled" as const,
          (error: unknown) => error,
        ),
        new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 200)),
      ]);
      expect(outcome).toMatchObject({ code: "ABORTED" });
      await vi.waitFor(() => expect(cancel).toHaveBeenCalled());
    } finally {
      unlink.mockRestore();
    }
  });

  it("aborts materialization without awaiting a pending blob write", async () => {
    const directory = await temporaryDirectory();
    const archive = recordingArchive(1);
    const filePath = path.join(directory, "pending-write.zip");
    const digest = archive.recording.response.body?.sha256;
    if (!digest) throw new Error("Expected the fixture to contain a response body");
    await writeBlobZip(filePath, archive, digest, Uint8Array.of(1));
    const controller = new AbortController();
    let markWriteStarted: (() => void) | undefined;
    const writeStarted = new Promise<void>((resolve) => {
      markWriteStarted = resolve;
    });
    const abortSession = vi.fn(() => new Promise<void>(() => undefined));
    const codec = new ArchiveCodec(
      {
        beginWrite: vi.fn(async () => ({
          writable: new WritableStream<Uint8Array>({
            write() {
              markWriteStarted?.();
              return new Promise<void>(() => undefined);
            },
          }),
          commit: vi.fn(),
          abort: abortSession,
        })),
      } as unknown as BlobStorePort,
      1024 * 1024,
    );

    const materializing = codec.materialize(filePath, archive, { signal: controller.signal });
    await writeStarted;
    controller.abort(new Error("server stopping"));

    const outcome = await Promise.race([
      materializing.then(
        () => "fulfilled" as const,
        (error: unknown) => error,
      ),
      new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 200)),
    ]);
    expect(outcome).toMatchObject({ code: "ABORTED" });
    expect(abortSession).toHaveBeenCalledOnce();
  });

  it("removes an archive published by a rename that completes after abort", async () => {
    const directory = await temporaryDirectory();
    const archive = recordingArchive(0);
    const partialPath = path.join(directory, "late-rename.partial");
    const filePath = path.join(directory, "late-rename.zip");
    const controller = new AbortController();
    let finishRename: (() => void) | undefined;
    const renameGate = new Promise<void>((resolve) => {
      finishRename = resolve;
    });
    const rename = vi.spyOn(fs, "rename").mockImplementation(async () => {
      await renameGate;
      await fs.writeFile(filePath, "late archive");
    });
    const codec = new ArchiveCodec(
      { open: vi.fn(async () => new Blob([]).stream()) } as unknown as BlobStorePort,
      1024 * 1024,
      1024 * 1024,
      25,
    );

    try {
      const writing = codec.write(partialPath, filePath, RECORDING_MANIFEST_ENTRY, archive, {
        signal: controller.signal,
      });
      await vi.waitFor(() => expect(rename).toHaveBeenCalledOnce());
      controller.abort(new Error("server stopping"));
      await expect(writing).rejects.toMatchObject({ code: "ABORTED" });

      finishRename?.();
      await vi.waitFor(() => expect(fs.access(filePath)).rejects.toMatchObject({ code: "ENOENT" }));
    } finally {
      rename.mockRestore();
    }
  });
});
