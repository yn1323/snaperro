import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BodyRef } from "../../../shared/contracts-v2/entities.js";
import { Sha256Schema } from "../../../shared/contracts-v2/primitives.js";
import { BlobPinRegistry } from "./blob-pin-registry.js";
import { MAX_PIN_DIGESTS, MAX_PIN_RECORD_BYTES } from "./bounded-file.js";

const roots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "snaperro-pin-set-"));
  roots.push(root);
  return root;
}

function body(index: number): BodyRef {
  return {
    sha256: Sha256Schema.parse(index.toString(16).padStart(64, "0")),
    size: 1,
    mediaType: null,
    contentEncoding: null,
  };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("BlobPinRegistry set records", () => {
  it("persists a 2,000-body pin set with one atomic metadata file", async () => {
    const root = await temporaryRoot();
    const registry = new BlobPinRegistry(root);
    const bodies = Array.from({ length: 2_000 }, (_, index) => body(index + 1));
    const handle = await registry.pinActiveMany(bodies);
    try {
      const pinRoot = path.join(root, "gc", "blob-pins");
      const entries = await fs.readdir(pinRoot);
      expect(entries).toHaveLength(1);
      const record = JSON.parse(await fs.readFile(path.join(pinRoot, entries[0] as string), "utf8")) as {
        digests: string[];
      };
      expect(record.digests).toHaveLength(2_000);
      expect(await registry.pinnedDigests()).toEqual(new Set(bodies.map((item) => item.sha256)));
    } finally {
      await handle.release();
    }
    expect(await fs.readdir(path.join(root, "gc", "blob-pins"))).toEqual([]);
  });

  it("renews active sets, expires pending/crashed sets, and cleans bounded crash debris", async () => {
    const root = await temporaryRoot();
    let now = Date.parse("2026-08-24T00:00:00.000Z");
    const registry = new BlobPinRegistry(root, { activeTtlMs: 30, pendingTtlMs: 30, now: () => now });
    const handle = await registry.pinActive(body(1));
    const pinRoot = path.join(root, "gc", "blob-pins");
    const activePath = path.join(
      pinRoot,
      (await fs.readdir(pinRoot)).find((entry) => entry.startsWith("active.")) as string,
    );
    const initial = JSON.parse(await fs.readFile(activePath, "utf8")) as { expiresAt: string };
    now += 20;
    await vi.waitFor(async () => {
      const renewed = JSON.parse(await fs.readFile(activePath, "utf8")) as { expiresAt: string };
      expect(Date.parse(renewed.expiresAt)).toBeGreaterThan(Date.parse(initial.expiresAt));
    });
    await handle.release();

    await registry.pinPending(body(2));
    now += 31;
    expect(await registry.pinnedDigests()).toEqual(new Set());

    const crashed = path.join(pinRoot, "active.00000000-0000-0000-0000-000000000000.json");
    const temporary = path.join(pinRoot, ".active.crash.tmp");
    const freshTemporary = path.join(pinRoot, ".active.in-progress.tmp");
    await fs.writeFile(crashed, "");
    await fs.truncate(crashed, MAX_PIN_RECORD_BYTES + 1);
    await fs.writeFile(temporary, "partial");
    const abandonedAt = new Date(now - 31);
    await fs.utimes(temporary, abandonedAt, abandonedAt);
    await fs.writeFile(freshTemporary, "in progress");
    const freshAt = new Date(now);
    await fs.utimes(freshTemporary, freshAt, freshAt);
    expect(await registry.pinnedDigests()).toEqual(new Set());
    await expect(fs.access(crashed)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.access(temporary)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.access(freshTemporary)).resolves.toBeUndefined();
    now += 31;
    expect(await registry.pinnedDigests()).toEqual(new Set());
    await expect(fs.access(freshTemporary)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("persists the maximum pin set once and rejects one digest above it without a partial set", async () => {
    const root = await temporaryRoot();
    const registry = new BlobPinRegistry(root);
    const maximum = Array.from({ length: MAX_PIN_DIGESTS }, (_, index) => body(index + 1));

    const handle = await registry.pinActiveMany(maximum);
    const pinRoot = path.join(root, "gc", "blob-pins");
    const entries = await fs.readdir(pinRoot);
    expect(entries).toHaveLength(1);
    expect((await fs.stat(path.join(pinRoot, entries[0] as string))).size).toBeLessThanOrEqual(MAX_PIN_RECORD_BYTES);
    await handle.release();

    await expect(registry.pinActiveMany([...maximum, body(MAX_PIN_DIGESTS + 1)])).rejects.toThrow(
      `cannot exceed ${MAX_PIN_DIGESTS}`,
    );
    expect(await fs.readdir(pinRoot)).toEqual([]);
  });

  it("fails closed without deleting a valid pin when its record cannot be read", async () => {
    const root = await temporaryRoot();
    const registry = new BlobPinRegistry(root);
    const handle = await registry.pinActive(body(1));
    const pinRoot = path.join(root, "gc", "blob-pins");
    const pinPath = path.join(pinRoot, (await fs.readdir(pinRoot))[0] as string);
    const readError = Object.assign(new Error("pin read failed"), { code: "EIO" });
    const open = vi.spyOn(fs, "open").mockRejectedValueOnce(readError);

    await expect(registry.pinnedDigests()).rejects.toBe(readError);
    open.mockRestore();
    await expect(fs.access(pinPath)).resolves.toBeUndefined();
    await handle.release();
  });
});
