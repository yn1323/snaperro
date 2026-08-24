import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { BodyRef } from "../../../shared/contracts-v2/entities.js";
import { type Sha256, Sha256Schema } from "../../../shared/contracts-v2/primitives.js";
import type { BlobPinHandlePort, OperationContext } from "../application/ports.js";
import { atomicWriteFileWithCommitFence } from "./atomic.js";
import { FileReadLimitError, MAX_PIN_DIGESTS, MAX_PIN_RECORD_BYTES, readFileBounded } from "./bounded-file.js";
import { StoreLayout, throwIfAborted } from "./layout.js";
import type { LeaseOptions } from "./lease.js";
import { FilesystemStoreLease } from "./store-lease.js";

type PinKind = "active" | "pending";

interface PinRecord {
  digests: readonly Sha256[];
  kind: PinKind;
  expiresAt: string;
}

function isPinRecord(value: unknown): value is PinRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    Array.isArray(record.digests) &&
    record.digests.length > 0 &&
    record.digests.length <= MAX_PIN_DIGESTS &&
    record.digests.every((digest) => typeof digest === "string" && /^[a-f0-9]{64}$/u.test(digest)) &&
    (record.kind === "active" || record.kind === "pending") &&
    typeof record.expiresAt === "string" &&
    Number.isFinite(Date.parse(record.expiresAt))
  );
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error ? String(error.code) : undefined;
}

export interface BlobPinRegistryOptions {
  lease?: LeaseOptions;
  /** @internal Shared with application writes so nested body reads reuse their store lease. */
  storeLease?: FilesystemStoreLease;
  pendingTtlMs?: number;
  activeTtlMs?: number;
  now?: () => number;
}

export class BlobPinRegistry {
  readonly #layout: StoreLayout;
  readonly #root: string;
  readonly #lease: FilesystemStoreLease;
  readonly #pendingTtlMs: number;
  readonly #activeTtlMs: number;
  readonly #now: () => number;

  constructor(root: string | StoreLayout, options: BlobPinRegistryOptions = {}) {
    this.#layout = typeof root === "string" ? new StoreLayout(root) : root;
    this.#root = path.join(this.#layout.root, "gc", "blob-pins");
    this.#lease = options.storeLease ?? new FilesystemStoreLease(this.#layout, { lease: options.lease });
    this.#pendingTtlMs = options.pendingTtlMs ?? 24 * 60 * 60 * 1_000;
    this.#activeTtlMs = options.activeTtlMs ?? 24 * 60 * 60 * 1_000;
    this.#now = options.now ?? Date.now;
    for (const [name, value] of [
      ["pendingTtlMs", this.#pendingTtlMs],
      ["activeTtlMs", this.#activeTtlMs],
    ] as const) {
      if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${name} must be a positive safe integer`);
    }
  }

  async pinPending(body: BodyRef, context: OperationContext = {}): Promise<void> {
    const digest = Sha256Schema.parse(body.sha256);
    await this.#write([digest], "pending", this.#pendingTtlMs, randomUUID(), context);
  }

  async pinActive(body: BodyRef, context: OperationContext = {}): Promise<BlobPinHandlePort> {
    return this.pinDigest(body.sha256, context);
  }

  async pinActiveMany(bodies: readonly BodyRef[], context: OperationContext = {}): Promise<BlobPinHandlePort> {
    const digests = [...new Set(bodies.map((body) => Sha256Schema.parse(body.sha256)))];
    if (digests.length > MAX_PIN_DIGESTS) {
      throw new RangeError(`A pin set cannot exceed ${MAX_PIN_DIGESTS} digests`);
    }
    return this.#pinDigests(digests, context);
  }

  async pinDigest(sha256: Sha256, context: OperationContext = {}): Promise<BlobPinHandlePort> {
    const digest = Sha256Schema.parse(sha256);
    return this.#pinDigests([digest], context);
  }

  async #pinDigests(digests: readonly Sha256[], context: OperationContext): Promise<BlobPinHandlePort> {
    if (digests.length === 0) return { release: async () => undefined };
    const token = randomUUID();
    const pinPath = this.#pinPath("active", token);
    await this.#write(digests, "active", this.#activeTtlMs, token, context);
    let released = false;
    let renewal = Promise.resolve();
    const heartbeat = setInterval(
      () => {
        renewal = renewal.then(() =>
          released ? undefined : this.#write(digests, "active", this.#activeTtlMs, token, {}).catch(() => undefined),
        );
      },
      Math.max(10, Math.floor(this.#activeTtlMs / 3)),
    );
    heartbeat.unref?.();
    return {
      release: async () => {
        if (released) return;
        released = true;
        clearInterval(heartbeat);
        await renewal;
        await this.#withLease({}, () => fs.unlink(pinPath).catch(() => undefined));
      },
    };
  }

  /** Called by GC while it already owns the global store lease. */
  async pinnedDigests(assertOwned: () => Promise<void> = async () => undefined): Promise<ReadonlySet<string>> {
    const pinned = new Set<string>();
    const now = this.#now();
    const entries = await fs.readdir(this.#root, { withFileTypes: true }).catch((error) => {
      if (errorCode(error) === "ENOENT") return [];
      throw error;
    });
    for (const entry of entries) {
      const fullPath = path.join(this.#root, entry.name);
      if (!entry.isFile() || !/^(active|pending)\.[0-9a-f-]+\.json$/u.test(entry.name)) {
        if (!entry.isDirectory()) {
          const stat = await fs.lstat(fullPath).catch(() => null);
          const isAtomicTemporary = /^\.(active|pending)\..+\.tmp$/u.test(entry.name);
          const crashTtlMs = Math.max(this.#activeTtlMs, this.#pendingTtlMs);
          if (!isAtomicTemporary || (stat?.isFile() && stat.mtimeMs + crashTtlMs <= now)) {
            await assertOwned();
            await fs.unlink(fullPath).catch(() => undefined);
          }
        }
        continue;
      }
      let record: unknown;
      try {
        record = JSON.parse((await readFileBounded(fullPath, MAX_PIN_RECORD_BYTES)).toString("utf8"));
      } catch (error) {
        if (errorCode(error) === "ENOENT") continue;
        if (error instanceof SyntaxError || error instanceof FileReadLimitError) {
          await assertOwned();
          await fs.unlink(fullPath).catch(() => undefined);
          continue;
        }
        throw error;
      }
      if (!isPinRecord(record) || !entry.name.startsWith(`${record.kind}.`) || Date.parse(record.expiresAt) <= now) {
        await assertOwned();
        await fs.unlink(fullPath).catch(() => undefined);
        continue;
      }
      for (const digest of record.digests) pinned.add(digest);
    }
    return pinned;
  }

  async #write(
    digests: readonly Sha256[],
    kind: PinKind,
    ttlMs: number,
    token: string,
    context: OperationContext,
  ): Promise<void> {
    const record = {
      digests,
      kind,
      expiresAt: new Date(this.#now() + ttlMs).toISOString(),
    } satisfies PinRecord;
    const serialized = `${JSON.stringify(record)}\n`;
    if (Buffer.byteLength(serialized, "utf8") > MAX_PIN_RECORD_BYTES) {
      throw new RangeError(`A pin record cannot exceed ${MAX_PIN_RECORD_BYTES} bytes`);
    }
    await atomicWriteFileWithCommitFence(this.#pinPath(kind, token), serialized, (commit) =>
      this.#withLease(context, commit),
    );
  }

  #pinPath(kind: PinKind, token: string): string {
    return path.join(this.#root, `${kind}.${token}.json`);
  }

  async #withLease<Result>(context: OperationContext, operation: () => Promise<Result>): Promise<Result> {
    throwIfAborted(context);
    return this.#lease.withVisibilityFence(operation, context);
  }
}
