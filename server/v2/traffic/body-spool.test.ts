import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BodyLimitExceededError, spoolBody } from "./body-spool.js";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "snaperro-body-spool-"));
  temporaryDirectories.push(directory);
  return directory;
}

function stream(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe("spoolBody", () => {
  it("streams chunks to a private temporary file and hashes the bytes", async () => {
    const directory = await temporaryDirectory();
    const spool = await spoolBody(stream("hello", " ", "world"), { directory, maxBytes: 1024 });

    expect(spool.size).toBe(11);
    expect(spool.sha256).toBe(createHash("sha256").update("hello world").digest("hex"));
    expect(new TextDecoder().decode(await spool.bytes())).toBe("hello world");

    await spool.dispose();
    await expect(fs.access(spool.filePath as string)).rejects.toThrow();
  });

  it("does not create a file for an empty body", async () => {
    const directory = await temporaryDirectory();
    const spool = await spoolBody(null, { directory, maxBytes: 1024 });

    expect(spool.filePath).toBeNull();
    expect(spool.size).toBe(0);
    expect(await spool.bytes()).toEqual(new Uint8Array());
  });

  it("removes the partial file when the size limit is exceeded", async () => {
    const directory = await temporaryDirectory();

    await expect(spoolBody(stream("1234", "5678"), { directory, maxBytes: 6 })).rejects.toBeInstanceOf(
      BodyLimitExceededError,
    );
    expect(await fs.readdir(directory)).toEqual([]);
  });

  it("rejects an oversized body without awaiting an uncooperative stream cancellation", async () => {
    const directory = await temporaryDirectory();
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(7));
      },
      cancel() {
        cancelled = true;
        return new Promise<void>(() => undefined);
      },
    });

    let failure: unknown;
    void spoolBody(body, { directory, maxBytes: 6 }).catch((error: unknown) => {
      failure = error;
    });

    await vi.waitFor(() => expect(failure).toBeInstanceOf(BodyLimitExceededError));
    expect(cancelled).toBe(true);
    expect(await fs.readdir(directory)).toEqual([]);
  });

  it("honors an already aborted signal", async () => {
    const directory = await temporaryDirectory();
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));

    await expect(spoolBody(stream("body"), { directory, maxBytes: 1024, signal: controller.signal })).rejects.toThrow(
      "cancelled",
    );
    expect(await fs.readdir(directory)).toEqual([]);
  });

  it("observes a rejected stream cancellation triggered by abort", async () => {
    const directory = await temporaryDirectory();
    const controller = new AbortController();
    let markPullStarted: (() => void) | undefined;
    const pullStarted = new Promise<void>((resolve) => {
      markPullStarted = resolve;
    });
    const cancel = vi.fn(async () => Promise.reject(new Error("cancel cleanup failed")));
    const body = new ReadableStream<Uint8Array>({
      pull() {
        markPullStarted?.();
        return new Promise<void>(() => undefined);
      },
      cancel,
    });

    const spooling = spoolBody(body, { directory, maxBytes: 1024, signal: controller.signal });
    await pullStarted;
    controller.abort(new Error("cancelled"));

    await expect(spooling).rejects.toThrow("cancelled");
    expect(cancel).toHaveBeenCalled();
    expect(await fs.readdir(directory)).toEqual([]);
  });

  it("rejects an aborted pending read without awaiting source cancellation", async () => {
    const directory = await temporaryDirectory();
    const controller = new AbortController();
    let markPullStarted: (() => void) | undefined;
    const pullStarted = new Promise<void>((resolve) => {
      markPullStarted = resolve;
    });
    const cancel = vi.fn(() => new Promise<void>(() => undefined));
    const body = new ReadableStream<Uint8Array>({
      pull() {
        markPullStarted?.();
        return new Promise<void>(() => undefined);
      },
      cancel,
    });

    const spooling = spoolBody(body, {
      directory,
      maxBytes: 1024,
      cleanupTimeoutMs: 25,
      signal: controller.signal,
    });
    const result = spooling.then(
      () => ({ status: "fulfilled" as const, error: undefined }),
      (error: unknown) => ({ status: "rejected" as const, error }),
    );
    await pullStarted;
    controller.abort(new Error("cancelled"));

    await vi.waitFor(() =>
      expect(result).resolves.toMatchObject({ status: "rejected", error: { message: "cancelled" } }),
    );
    expect(cancel).toHaveBeenCalled();
    expect(await fs.readdir(directory)).toEqual([]);
  });

  it("closes a file handle that opens after the request was aborted", async () => {
    const directory = await temporaryDirectory();
    const controller = new AbortController();
    let resolveOpen: ((handle: Awaited<ReturnType<typeof fs.open>>) => void) | undefined;
    const lateHandle = {
      close: vi.fn(async () => undefined),
    } as unknown as Awaited<ReturnType<typeof fs.open>>;
    const open = vi.spyOn(fs, "open").mockImplementation(
      () =>
        new Promise<Awaited<ReturnType<typeof fs.open>>>((resolve) => {
          resolveOpen = resolve;
        }),
    );

    try {
      const spooling = spoolBody(stream("body"), {
        directory,
        maxBytes: 1024,
        cleanupTimeoutMs: 25,
        signal: controller.signal,
      });
      await vi.waitFor(() => expect(open).toHaveBeenCalled());
      controller.abort(new Error("cancelled"));
      await expect(spooling).rejects.toThrow("cancelled");

      resolveOpen?.(lateHandle);
      await vi.waitFor(() => expect(lateHandle.close).toHaveBeenCalledOnce());
    } finally {
      open.mockRestore();
    }
  });
});
