import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { BodyRef } from "../../../shared/contracts-v2/entities.js";
import { ScenarioIdSchema } from "../../../shared/contracts-v2/primitives.js";
import type { GarbageCollectionPort, OperationContext } from "../application/ports.js";
import { OperationAbortedError } from "../domain/errors.js";
import { BlobPinRegistry } from "./blob-pin-registry.js";
import { FilesystemBlobStore } from "./blob-store.js";
import { StoreCorruptionError } from "./errors.js";
import { readManifestGeneration, readPersistedCatalog, StoreLayout, throwIfAborted } from "./layout.js";
import type { LeaseOptions } from "./lease.js";
import { readMigrationReceipt } from "./migration-receipt.js";
import { FilesystemStoreLease } from "./store-lease.js";

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error ? String(error.code) : undefined;
}

async function receiptReferences(root: string): Promise<string[]> {
  const receipt = await readMigrationReceipt(root);
  return receipt?.entries.map((entry) => entry.originalBlob.sha256) ?? [];
}

export interface FilesystemGarbageCollectorOptions {
  lease?: LeaseOptions;
  /** Protects staged-but-not-yet-visible generations from a concurrent GC. */
  minimumAgeMs?: number;
  now?: () => number;
  pendingPinTtlMs?: number;
  activePinTtlMs?: number;
  /** @internal Shared with the blob store so all pin clocks and roots agree. */
  pins?: BlobPinRegistry;
}

export class FilesystemGarbageCollector implements GarbageCollectionPort {
  private readonly layout: StoreLayout;
  private readonly blobs: FilesystemBlobStore;
  private readonly leaseOptions: LeaseOptions;
  private readonly minimumAgeMs: number;
  private readonly now: () => number;
  private readonly pins: BlobPinRegistry;
  private readonly lease: FilesystemStoreLease;
  readonly #lifetime = new AbortController();
  #running: Promise<void> | undefined;
  #deferredTimer: ReturnType<typeof setTimeout> | undefined;
  #deferredSweepActive = false;
  #scheduleGeneration = 0;
  #closed = false;
  #closePromise: Promise<void> | undefined;

  constructor(
    root: string | StoreLayout,
    blobs?: FilesystemBlobStore,
    options: FilesystemGarbageCollectorOptions = {},
  ) {
    this.layout = typeof root === "string" ? new StoreLayout(root) : root;
    this.leaseOptions = options.lease ?? {};
    this.minimumAgeMs = options.minimumAgeMs ?? 60 * 60 * 1_000;
    if (!Number.isSafeInteger(this.minimumAgeMs) || this.minimumAgeMs < 0) {
      throw new RangeError("Garbage-collection minimum age must be a non-negative safe integer");
    }
    this.now = options.now ?? Date.now;
    this.blobs = blobs ?? new FilesystemBlobStore(this.layout, { lease: this.leaseOptions });
    this.pins =
      options.pins ??
      new BlobPinRegistry(this.layout, {
        lease: this.leaseOptions,
        pendingTtlMs: options.pendingPinTtlMs,
        activeTtlMs: options.activePinTtlMs,
        now: this.now,
      });
    this.lease = new FilesystemStoreLease(this.layout, { lease: this.leaseOptions });
  }

  pinPending(body: BodyRef, context: OperationContext = {}): Promise<void> {
    return this.pins.pinPending(body, context);
  }

  async schedule(context: OperationContext = {}): Promise<void> {
    throwIfAborted(context);
    if (this.#closed) throw new OperationAbortedError("Garbage collection is closed");
    this.#scheduleGeneration += 1;
    if (this.#deferredTimer || this.#deferredSweepActive) return;
    const generation = this.#scheduleGeneration;
    this.#armDeferredSweep(generation);
    await this.#enqueueSweep();
  }

  async close(): Promise<void> {
    if (this.#closePromise) return this.#closePromise;
    this.#closed = true;
    if (this.#deferredTimer) clearTimeout(this.#deferredTimer);
    this.#deferredTimer = undefined;
    this.#lifetime.abort(new OperationAbortedError("Garbage collection is closing"));
    this.#closePromise =
      this.#running?.then(
        () => undefined,
        () => undefined,
      ) ?? Promise.resolve();
    return this.#closePromise;
  }

  #armDeferredSweep(generation: number): void {
    if (this.minimumAgeMs === 0 || this.#deferredTimer || this.#closed) return;
    this.#deferredTimer = setTimeout(() => {
      this.#deferredTimer = undefined;
      const absorbedRunningSweep = this.#running !== undefined;
      this.#deferredSweepActive = true;
      let failed = false;
      void this.#enqueueSweep()
        .catch(() => {
          failed = true;
        })
        .finally(() => {
          this.#deferredSweepActive = false;
          if (!this.#closed && (failed || absorbedRunningSweep || this.#scheduleGeneration !== generation)) {
            this.#armDeferredSweep(this.#scheduleGeneration);
          }
        });
    }, this.minimumAgeMs + 1);
    this.#deferredTimer.unref?.();
  }

  #enqueueSweep(): Promise<void> {
    if (this.#running) return this.#running;
    if (this.#closed) return Promise.reject(new OperationAbortedError("Garbage collection is closed"));
    const running = this.#collect({ signal: this.#lifetime.signal }).finally(() => {
      if (this.#running === running) this.#running = undefined;
    });
    this.#running = running;
    return running;
  }

  async #collect(context: OperationContext): Promise<void> {
    const lease = await this.lease.acquire(context);
    try {
      await this.lease.runWithHandle(lease, async () => {
        const catalog = await readPersistedCatalog(this.layout);
        const referenced = new Set<string>(await receiptReferences(this.layout.root));
        for (const digest of await this.pins.pinnedDigests(() => lease.assertOwned())) referenced.add(digest);
        const visibleManifestPaths = new Set<string>();

        for (const scenario of catalog.scenarios) {
          throwIfAborted(context);
          const revision = catalog.manifestRevisions[scenario.id];
          if (revision === undefined) throw new StoreCorruptionError(`Missing manifest pointer: ${scenario.id}`);
          visibleManifestPaths.add(this.layout.manifestPath(scenario.id, revision));
          const manifest = await readManifestGeneration(this.layout, scenario.id, revision);
          for (const recording of manifest.recordings) {
            if (recording.request.body) referenced.add(recording.request.body.sha256);
            if (recording.response.body) referenced.add(recording.response.body.sha256);
          }
        }

        await this.blobs.collectGarbage(referenced, context, {
          minimumAgeMs: this.minimumAgeMs,
          now: this.now,
          onProgress: () => lease.assertOwned(),
          beforeDelete: () => lease.assertOwned(),
        });
        await this.collectManifestGenerations(visibleManifestPaths, context, () => lease.assertOwned());
        await this.clearGarbageMarkers(context, () => lease.assertOwned());
      });
    } finally {
      await lease.release();
    }
  }

  private async collectManifestGenerations(
    visibleManifestPaths: ReadonlySet<string>,
    context: OperationContext,
    renew: () => Promise<void>,
  ): Promise<void> {
    let directories: Dirent[];
    try {
      directories = await fs.readdir(this.layout.manifestRoot, { withFileTypes: true });
    } catch (error) {
      if (errorCode(error) === "ENOENT") return;
      throw error;
    }

    for (const directory of directories) {
      throwIfAborted(context);
      await renew();
      if (!directory.isDirectory() || !ScenarioIdSchema.safeParse(directory.name).success) continue;
      const fullDirectory = path.join(this.layout.manifestRoot, directory.name);
      for (const [index, entry] of (await fs.readdir(fullDirectory, { withFileTypes: true })).entries()) {
        if (index % 100 === 0) await renew();
        if (!entry.isFile() || !/^\d{16}\.json$/u.test(entry.name)) continue;
        const fullPath = path.join(fullDirectory, entry.name);
        if (visibleManifestPaths.has(fullPath)) continue;
        const stat = await fs.lstat(fullPath).catch(() => null);
        if (!stat?.isFile() || (this.minimumAgeMs > 0 && this.now() - stat.mtimeMs < this.minimumAgeMs)) continue;
        await renew();
        await fs.unlink(fullPath);
      }
      await renew();
      await fs.rmdir(fullDirectory).catch((error) => {
        if (errorCode(error) !== "ENOTEMPTY" && errorCode(error) !== "ENOENT") throw error;
      });
    }
  }

  private async clearGarbageMarkers(context: OperationContext, assertOwned: () => Promise<void>): Promise<void> {
    const markerRoot = path.join(this.layout.root, "gc", "manifests");
    let entries: Dirent[];
    try {
      entries = await fs.readdir(markerRoot, { withFileTypes: true });
    } catch (error) {
      if (errorCode(error) === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      throwIfAborted(context);
      if (entry.isFile() && entry.name.endsWith(".json")) {
        await assertOwned();
        await fs.unlink(path.join(markerRoot, entry.name));
      }
    }
  }
}
