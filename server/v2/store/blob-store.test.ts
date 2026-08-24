import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FilesystemBlobStore, writeBlobBytes } from "./blob-store.js";
import { FileLease, LeaseBusyError } from "./lease.js";

function neverSettles(): Promise<void> {
  return new Promise<void>(() => undefined);
}

const PIN_CLEANUP_TIMEOUT_MS = 25;

describe("FilesystemBlobStore", () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "snaperro-v2-blob-store-"));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(root, { recursive: true, force: true });
  });

  it("keeps the promotion lease alive while validating an existing large blob", async () => {
    const ttlMs = 120;
    let releaseHash: (() => void) | undefined;
    const hashGate = new Promise<void>((resolve) => {
      releaseHash = resolve;
    });
    let hashStarted: (() => void) | undefined;
    const atHash = new Promise<void>((resolve) => {
      hashStarted = resolve;
    });
    let blockedAt = 0;
    let blocked = false;
    const store = new FilesystemBlobStore(root, {
      lease: { ttlMs, waitMs: 0, pollMs: 1 },
      onExistingBlobHashProgress: async () => {
        if (blocked) return;
        blocked = true;
        blockedAt = Date.now();
        hashStarted?.();
        await hashGate;
      },
    });
    const bytes = Buffer.alloc(2 * 1024 * 1024, 0x5a);
    const metadata = { mediaType: "application/octet-stream", contentEncoding: null } as const;
    const original = await writeBlobBytes(store, bytes, metadata);

    const session = await store.beginWrite(metadata);
    const writer = session.writable.getWriter();
    await writer.write(bytes);
    await writer.close();

    let observedRenewal: (() => void) | undefined;
    const renewedAfterOriginalExpiry = new Promise<void>((resolve) => {
      observedRenewal = resolve;
    });
    const originalRenew = FileLease.prototype.renew;
    const renew = vi.spyOn(FileLease.prototype, "renew").mockImplementation(async function (this: FileLease) {
      await originalRenew.call(this);
      if (blockedAt > 0 && Date.now() >= blockedAt + ttlMs) observedRenewal?.();
    });

    const commit = session.commit();
    try {
      await atHash;
      await renewedAfterOriginalExpiry;

      // Garbage collection uses the same store lease. It must not reclaim and
      // unlink the EEXIST target while this commit is still validating it.
      await expect(
        FileLease.acquire(root, {
          ttlMs,
          waitMs: 0,
          pollMs: 1,
          // Freeze the contender at the original expiry boundary. The
          // heartbeat renewal must keep the lease valid at this instant, and
          // unrelated suite load cannot expire it again before this assertion.
          now: () => blockedAt + ttlMs,
        }),
      ).rejects.toBeInstanceOf(LeaseBusyError);
    } finally {
      releaseHash?.();
    }

    const committed = await commit;
    expect(committed).toEqual(original);
    await expect(
      fs.stat(path.join(root, "blobs", "sha256", committed.sha256.slice(0, 2), committed.sha256)),
    ).resolves.toMatchObject({ size: bytes.byteLength });
    expect(await store.exists(committed)).toBe(true);
    renew.mockRestore();
  });

  it("bounds active-pin cleanup before delivering EOF", async () => {
    const bytes = Buffer.from("complete response", "utf8");
    const writer = new FilesystemBlobStore(root);
    const ref = await writeBlobBytes(writer, bytes, { mediaType: "text/plain", contentEncoding: null });
    const release = vi.fn(neverSettles);
    const reader = new FilesystemBlobStore(root, {
      pinCleanupTimeoutMs: PIN_CLEANUP_TIMEOUT_MS,
      pins: {
        pinActive: vi.fn(async () => ({ release })),
      } as never,
    });

    await expect(new Response(await reader.open(ref)).arrayBuffer()).resolves.toEqual(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    );
    expect(release).toHaveBeenCalledOnce();
  });

  it("preserves validation and post-stat abort errors when active-pin cleanup never settles", async () => {
    const bytes = Buffer.from("validated response", "utf8");
    const writer = new FilesystemBlobStore(root);
    const ref = await writeBlobBytes(writer, bytes, { mediaType: "text/plain", contentEncoding: null });
    const validationRelease = vi.fn(neverSettles);
    const validationReader = new FilesystemBlobStore(root, {
      pinCleanupTimeoutMs: PIN_CLEANUP_TIMEOUT_MS,
      pins: {
        pinActive: vi.fn(async () => ({ release: validationRelease })),
      } as never,
    });

    await expect(validationReader.open({ ...ref, size: ref.size + 1 })).rejects.toThrow(
      "Blob size does not match its reference",
    );
    expect(validationRelease).toHaveBeenCalledOnce();

    const controller = new AbortController();
    const abortRelease = vi.fn(neverSettles);
    const abortReader = new FilesystemBlobStore(root, {
      pinCleanupTimeoutMs: PIN_CLEANUP_TIMEOUT_MS,
      pins: {
        pinActive: vi.fn(async () => ({ release: abortRelease })),
      } as never,
    });
    const originalStat = fs.stat.bind(fs);
    vi.spyOn(fs, "stat").mockImplementation(async (target) => {
      const stat = await originalStat(target);
      controller.abort(new Error("aborted while stat was pending"));
      return stat;
    });

    await expect(abortReader.open(ref, { signal: controller.signal })).rejects.toMatchObject({ code: "ABORTED" });
    // Let createReadStream's deferred destroy notifications run; an Error
    // passed to destroy before Readable.toWeb would surface as an unhandled event.
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(abortRelease).toHaveBeenCalledOnce();
  });

  it("aborts a pending blob stat and releases its pin without waiting for the filesystem", async () => {
    const bytes = Buffer.from("pending stat", "utf8");
    const writer = new FilesystemBlobStore(root);
    const ref = await writeBlobBytes(writer, bytes, { mediaType: "text/plain", contentEncoding: null });
    const release = vi.fn(async () => undefined);
    const stat = vi.spyOn(fs, "stat").mockImplementation(() => new Promise(() => undefined));
    const reader = new FilesystemBlobStore(root, {
      pinCleanupTimeoutMs: PIN_CLEANUP_TIMEOUT_MS,
      pins: {
        pinActive: vi.fn(async () => ({ release })),
      } as never,
    });
    const controller = new AbortController();
    const opening = reader.open(ref, { signal: controller.signal });
    await vi.waitFor(() => expect(stat).toHaveBeenCalledOnce());

    controller.abort(new Error("request ended"));

    await expect(opening).rejects.toMatchObject({ code: "ABORTED" });
    expect(release).toHaveBeenCalledOnce();
  });

  it("bounds metadata pin cleanup before handing off openByDigest", async () => {
    const bytes = Buffer.from("digest handoff", "utf8");
    const writer = new FilesystemBlobStore(root);
    const ref = await writeBlobBytes(writer, bytes, { mediaType: "text/plain", contentEncoding: null });
    const digestRelease = vi.fn(neverSettles);
    const activeRelease = vi.fn(async () => undefined);
    const reader = new FilesystemBlobStore(root, {
      pinCleanupTimeoutMs: PIN_CLEANUP_TIMEOUT_MS,
      pins: {
        pinDigest: vi.fn(async () => ({ release: digestRelease })),
        pinActive: vi.fn(async () => ({ release: activeRelease })),
      } as never,
    });

    const opened = await reader.openByDigest(ref.sha256);
    await expect(new Response(opened.stream).arrayBuffer()).resolves.toEqual(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    );
    expect(opened.ref).toMatchObject({ sha256: ref.sha256, size: ref.size });
    expect(digestRelease).toHaveBeenCalledOnce();
    expect(activeRelease).toHaveBeenCalledOnce();
  });

  it("settles client cancellation while the inner read, cancellation, and pin cleanup remain pending", async () => {
    const bytes = Buffer.from("pending source", "utf8");
    const writer = new FilesystemBlobStore(root);
    const ref = await writeBlobBytes(writer, bytes, { mediaType: "text/plain", contentEncoding: null });
    const release = vi.fn(neverSettles);
    const cancel = vi.fn(neverSettles);
    let markPullStarted: (() => void) | undefined;
    const pullStarted = new Promise<void>((resolve) => {
      markPullStarted = resolve;
    });
    const inner = new ReadableStream<Uint8Array>({
      pull: () => {
        markPullStarted?.();
        return neverSettles();
      },
      cancel,
    });
    vi.spyOn(Readable, "toWeb").mockReturnValue(inner as never);
    const store = new FilesystemBlobStore(root, {
      pinCleanupTimeoutMs: PIN_CLEANUP_TIMEOUT_MS,
      pins: {
        pinActive: vi.fn(async () => ({ release })),
      } as never,
    });

    const outerReader = (await store.open(ref)).getReader();
    const reading = outerReader.read();
    await pullStarted;
    await outerReader.cancel("client disconnected");

    await expect(reading).resolves.toMatchObject({ done: true });
    expect(cancel).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
  });

  it("preserves a source read error when active-pin cleanup never settles", async () => {
    const bytes = Buffer.from("failed source", "utf8");
    const writer = new FilesystemBlobStore(root);
    const ref = await writeBlobBytes(writer, bytes, { mediaType: "text/plain", contentEncoding: null });
    const sourceError = new Error("source read failed");
    vi.spyOn(Readable, "toWeb").mockReturnValue(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.error(sourceError);
        },
      }) as never,
    );
    const release = vi.fn(neverSettles);
    const store = new FilesystemBlobStore(root, {
      pinCleanupTimeoutMs: PIN_CLEANUP_TIMEOUT_MS,
      pins: {
        pinActive: vi.fn(async () => ({ release })),
      } as never,
    });

    const reader = (await store.open(ref)).getReader();
    await expect(reader.read()).rejects.toBe(sourceError);
    expect(release).toHaveBeenCalledOnce();
  });

  it("fails closed when garbage collection cannot inspect an unreferenced blob", async () => {
    const bytes = Buffer.from("must remain", "utf8");
    const store = new FilesystemBlobStore(root);
    const ref = await writeBlobBytes(store, bytes, { mediaType: "text/plain", contentEncoding: null });
    const inspectionError = Object.assign(new Error("blob lstat failed"), { code: "EIO" });
    const lstat = vi.spyOn(fs, "lstat").mockRejectedValueOnce(inspectionError);

    await expect(store.collectGarbage(new Set(), {}, { minimumAgeMs: 0 })).rejects.toBe(inspectionError);
    lstat.mockRestore();

    await expect(store.exists(ref)).resolves.toBe(true);
  });
});
