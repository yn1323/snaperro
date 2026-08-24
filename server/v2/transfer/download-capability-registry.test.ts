import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BodyRefSchema } from "../../../shared/contracts-v2/entities.js";
import type { BlobStorePort } from "../application/ports.js";
import { DownloadCapabilityRegistry } from "./download-capability-registry.js";

const files: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await Promise.all(files.splice(0).map((file) => fs.rm(file, { force: true })));
});

describe("DownloadCapabilityRegistry", () => {
  it("burns before open and makes unknown, used, and expired capabilities indistinguishable", async () => {
    let now = Date.parse("2026-08-24T00:00:00.000Z");
    const open = vi.fn(async () => new Blob(["body"]).stream());
    const releases: Array<ReturnType<typeof vi.fn>> = [];
    const pin = vi.fn(async () => {
      const release = vi.fn(async () => undefined);
      releases.push(release);
      return { release };
    });
    const registry = new DownloadCapabilityRegistry({
      blobs: { open, exists: vi.fn(async () => true), pin } as unknown as BlobStorePort,
      ttlMs: 60_000,
      now: () => now,
      capabilityBytes: () => new Uint8Array(32).fill(9),
    });
    const body = BodyRefSchema.parse({
      sha256: "a".repeat(64),
      size: 4,
      mediaType: "text/plain",
      contentEncoding: null,
    });
    const first = await registry.issue({
      kind: "body",
      body,
      filename: "body.txt",
      mediaType: "text/plain",
      contentEncoding: null,
      size: 4,
    });
    const capability = first.downloadPath.split("/").at(-1) as string;
    const claims = await Promise.allSettled([registry.open(capability), registry.open(capability)]);
    expect(claims.filter((claim) => claim.status === "fulfilled")).toHaveLength(1);
    const used = await registry.open(capability).catch((error) => error);

    const second = await registry.issue({
      kind: "body",
      body,
      filename: "body.txt",
      mediaType: "text/plain",
      contentEncoding: null,
      size: 4,
    });
    now += 60_001;
    const expired = await registry.open(second.downloadPath.split("/").at(-1) as string).catch((error) => error);
    const unknown = await registry.open("x".repeat(43)).catch((error) => error);
    expect([used, expired, unknown].map((error) => ({ code: error.code, message: error.message }))).toEqual([
      { code: "NOT_FOUND", message: "download was not found" },
      { code: "NOT_FOUND", message: "download was not found" },
      { code: "NOT_FOUND", message: "download was not found" },
    ]);
    expect(open).toHaveBeenCalledTimes(1);
    expect(releases).toHaveLength(2);
    expect(releases.every((release) => release.mock.calls.length === 1)).toBe(true);
    await registry.close();
  });

  it("removes a claimed temporary file when the registry closes", async () => {
    const filePath = path.join(process.cwd(), `.capability-${randomUUID()}.zip`);
    files.push(filePath);
    await fs.writeFile(filePath, Buffer.alloc(1024));
    const registry = new DownloadCapabilityRegistry({
      blobs: {} as unknown as BlobStorePort,
      capabilityBytes: () => new Uint8Array(32).fill(4),
    });
    const ticket = await registry.issue({
      kind: "file",
      filePath,
      filename: "export.zip",
      mediaType: "application/zip",
      contentEncoding: null,
      size: 1024,
    });
    await registry.open(ticket.downloadPath.split("/").at(-1) as string);
    await registry.close();
    await expect(fs.access(filePath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("closes a claimed file when its signal aborts during listener registration", async () => {
    const filePath = path.join(process.cwd(), `.capability-${randomUUID()}.zip`);
    files.push(filePath);
    await fs.writeFile(filePath, Buffer.alloc(1024));
    const registry = new DownloadCapabilityRegistry({
      blobs: {} as unknown as BlobStorePort,
      capabilityBytes: () => new Uint8Array(32).fill(10),
    });
    const ticket = await registry.issue({
      kind: "file",
      filePath,
      filename: "export.zip",
      mediaType: "application/zip",
      contentEncoding: null,
      size: 1024,
    });
    const controller = new AbortController();
    const addEventListener = controller.signal.addEventListener.bind(controller.signal);
    vi.spyOn(controller.signal, "addEventListener").mockImplementation((type, listener, options) => {
      addEventListener(type, listener, options);
      if (type === "abort") controller.abort(new Error("request ended"));
    });

    const download = await registry.open(ticket.downloadPath.split("/").at(-1) as string, {
      signal: controller.signal,
    });
    await expect(new Response(download.stream).arrayBuffer()).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(fs.access(filePath)).rejects.toMatchObject({ code: "ENOENT" }));
    await registry.close();
  });

  it("fences new tickets and cancels an active body stream after close begins", async () => {
    const cancel = vi.fn();
    const releases: Array<ReturnType<typeof vi.fn>> = [];
    const registry = new DownloadCapabilityRegistry({
      blobs: {
        exists: vi.fn(async () => true),
        pin: vi.fn(async () => {
          const release = vi.fn(async () => undefined);
          releases.push(release);
          return { release };
        }),
        open: vi.fn(
          async () =>
            new ReadableStream<Uint8Array>({
              cancel,
            }),
        ),
      } as unknown as BlobStorePort,
      capabilityBytes: () => new Uint8Array(32).fill(6),
    });
    const body = BodyRefSchema.parse({
      sha256: "b".repeat(64),
      size: 4,
      mediaType: "text/plain",
      contentEncoding: null,
    });
    const ticket = await registry.issue({
      kind: "body",
      body,
      filename: "body.txt",
      mediaType: "text/plain",
      contentEncoding: null,
      size: 4,
    });
    await registry.open(ticket.downloadPath.split("/").at(-1) as string);
    await registry.issue({
      kind: "body",
      body,
      filename: "pending.txt",
      mediaType: "text/plain",
      contentEncoding: null,
      size: 4,
    });

    await registry.close();
    expect(cancel).toHaveBeenCalledOnce();
    expect(releases).toHaveLength(2);
    expect(releases.every((release) => release.mock.calls.length === 1)).toBe(true);
    await expect(
      registry.issue({
        kind: "body",
        body,
        filename: "body.txt",
        mediaType: "text/plain",
        contentEncoding: null,
        size: 4,
      }),
    ).rejects.toThrow(/closed/u);
    await expect(registry.open("x".repeat(43))).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("releases the ticket pin when issue validation or claimed body open fails", async () => {
    const releases = [vi.fn(async () => undefined), vi.fn(async () => undefined)];
    const exists = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const registry = new DownloadCapabilityRegistry({
      blobs: {
        pin: vi.fn().mockResolvedValueOnce({ release: releases[0] }).mockResolvedValueOnce({ release: releases[1] }),
        exists,
        open: vi.fn(async () => Promise.reject(new Error("blob open failed"))),
      } as unknown as BlobStorePort,
      capabilityBytes: () => new Uint8Array(32).fill(8),
    });
    const body = BodyRefSchema.parse({
      sha256: "c".repeat(64),
      size: 4,
      mediaType: "text/plain",
      contentEncoding: null,
    });
    const download = {
      kind: "body" as const,
      body,
      filename: "body.txt",
      mediaType: "text/plain",
      contentEncoding: null,
      size: 4,
    };

    await expect(registry.issue(download)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(releases[0]).toHaveBeenCalledOnce();
    const ticket = await registry.issue(download);
    await expect(registry.open(ticket.downloadPath.split("/").at(-1) as string)).rejects.toThrow("blob open failed");
    expect(releases[1]).toHaveBeenCalledOnce();
    await registry.close();
  });

  it("bounds never-settling body cancellation and pin release while starting both cleanups", async () => {
    const activeRelease = vi.fn(async () => undefined);
    const pendingRelease = vi.fn(() => new Promise<void>(() => undefined));
    const cancel = vi.fn(() => new Promise<void>(() => undefined));
    const registry = new DownloadCapabilityRegistry({
      blobs: {
        pin: vi
          .fn()
          .mockResolvedValueOnce({ release: activeRelease })
          .mockResolvedValueOnce({ release: pendingRelease }),
        exists: vi.fn(async () => true),
        open: vi.fn(
          async () =>
            new ReadableStream<Uint8Array>({
              cancel,
            }),
        ),
      } as unknown as BlobStorePort,
      shutdownTimeoutMs: 25,
      capabilityBytes: () => new Uint8Array(32).fill(3),
    });
    const body = BodyRefSchema.parse({
      sha256: "d".repeat(64),
      size: 4,
      mediaType: "text/plain",
      contentEncoding: null,
    });
    const download = {
      kind: "body" as const,
      body,
      filename: "body.txt",
      mediaType: "text/plain",
      contentEncoding: null,
      size: 4,
    };
    const activeTicket = await registry.issue(download);
    await registry.open(activeTicket.downloadPath.split("/").at(-1) as string);
    await registry.issue({ ...download, filename: "pending.txt" });
    vi.useFakeTimers();

    const closing = registry.close();
    const closeResult = closing.then(
      () => ({ status: "fulfilled" as const, error: undefined }),
      (error: unknown) => ({ status: "rejected" as const, error }),
    );
    await vi.advanceTimersByTimeAsync(25);

    await expect(closeResult).resolves.toMatchObject({
      status: "rejected",
      error: { message: "Download capability cleanup did not settle within 25ms" },
    });
    expect(cancel).toHaveBeenCalledOnce();
    expect(activeRelease).toHaveBeenCalledOnce();
    expect(pendingRelease).toHaveBeenCalledOnce();
  });

  it("releases an active body immediately when client cancellation never settles upstream", async () => {
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const registry = new DownloadCapabilityRegistry({
      blobs: {
        pin: vi.fn(async () => ({ release: vi.fn(async () => undefined) })),
        exists: vi.fn(async () => true),
        open: vi.fn(
          async () =>
            new ReadableStream<Uint8Array>({
              cancel,
            }),
        ),
      } as unknown as BlobStorePort,
      shutdownTimeoutMs: 25,
      capabilityBytes: () => new Uint8Array(32).fill(7),
    });
    const body = BodyRefSchema.parse({
      sha256: "e".repeat(64),
      size: 4,
      mediaType: "text/plain",
      contentEncoding: null,
    });
    const ticket = await registry.issue({
      kind: "body",
      body,
      filename: "body.txt",
      mediaType: "text/plain",
      contentEncoding: null,
      size: 4,
    });
    const download = await registry.open(ticket.downloadPath.split("/").at(-1) as string);

    await download.stream.cancel("client disconnected");
    await registry.close();

    expect(cancel).toHaveBeenCalledOnce();
  });

  it("rejects an open-close race without awaiting source cancellation", async () => {
    let resolveOpen = (_stream: ReadableStream<Uint8Array>) => {};
    const openGate = new Promise<ReadableStream<Uint8Array>>((resolve) => {
      resolveOpen = resolve;
    });
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const release = vi.fn(async () => undefined);
    const registry = new DownloadCapabilityRegistry({
      blobs: {
        pin: vi.fn(async () => ({ release })),
        exists: vi.fn(async () => true),
        open: vi.fn(() => openGate),
      } as unknown as BlobStorePort,
      capabilityBytes: () => new Uint8Array(32).fill(2),
    });
    const body = BodyRefSchema.parse({
      sha256: "f".repeat(64),
      size: 4,
      mediaType: "text/plain",
      contentEncoding: null,
    });
    const ticket = await registry.issue({
      kind: "body",
      body,
      filename: "body.txt",
      mediaType: "text/plain",
      contentEncoding: null,
      size: 4,
    });
    const opening = registry.open(ticket.downloadPath.split("/").at(-1) as string);
    const openingResult = opening.then(
      () => ({ status: "fulfilled" as const, error: undefined }),
      (error: unknown) => ({ status: "rejected" as const, error }),
    );
    await registry.close();

    await expect(openingResult).resolves.toMatchObject({
      status: "rejected",
      error: { code: "NOT_FOUND" },
    });

    resolveOpen(
      new ReadableStream<Uint8Array>({
        cancel,
      }),
    );

    await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce());
    expect(release).toHaveBeenCalledTimes(2);
  });

  it("does not retain validation failure or source handoff when pin release never settles", async () => {
    const release = vi.fn(() => new Promise<void>(() => {}));
    const exists = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const registry = new DownloadCapabilityRegistry({
      blobs: {
        pin: vi.fn(async () => ({ release })),
        exists,
        open: vi.fn(async () => new Blob(["body"]).stream()),
      } as unknown as BlobStorePort,
      capabilityBytes: () => new Uint8Array(32).fill(1),
    });
    const body = BodyRefSchema.parse({
      sha256: "1".repeat(64),
      size: 4,
      mediaType: "text/plain",
      contentEncoding: null,
    });
    const download = {
      kind: "body" as const,
      body,
      filename: "body.txt",
      mediaType: "text/plain",
      contentEncoding: null,
      size: 4,
    };

    await expect(registry.issue(download)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const ticket = await registry.issue(download);
    const opened = await registry.open(ticket.downloadPath.split("/").at(-1) as string);
    await opened.stream.cancel();
    await registry.close();

    expect(release).toHaveBeenCalledTimes(2);
  });

  it("finishes client cancellation while an inner read and cancellation remain pending", async () => {
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const registry = new DownloadCapabilityRegistry({
      blobs: {
        pin: vi.fn(async () => ({ release: vi.fn(async () => undefined) })),
        exists: vi.fn(async () => true),
        open: vi.fn(
          async () =>
            new ReadableStream<Uint8Array>({
              pull: () => new Promise<void>(() => {}),
              cancel,
            }),
        ),
      } as unknown as BlobStorePort,
      capabilityBytes: () => new Uint8Array(32).fill(5),
    });
    const body = BodyRefSchema.parse({
      sha256: "2".repeat(64),
      size: 4,
      mediaType: "text/plain",
      contentEncoding: null,
    });
    const ticket = await registry.issue({
      kind: "body",
      body,
      filename: "body.txt",
      mediaType: "text/plain",
      contentEncoding: null,
      size: 4,
    });
    const opened = await registry.open(ticket.downloadPath.split("/").at(-1) as string);
    const reader = opened.stream.getReader();
    const reading = reader.read();
    await Promise.resolve();

    await reader.cancel("client disconnected");
    await expect(reading).resolves.toMatchObject({ done: true });
    await registry.close();

    expect(cancel).toHaveBeenCalledOnce();
  });
});
