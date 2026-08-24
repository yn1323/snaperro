import { randomUUID } from "node:crypto";
import type { Stats } from "node:fs";
import fs, { type FileHandle } from "node:fs/promises";
import path from "node:path";
import { OperationAbortedError } from "../domain/errors.js";
import { FileReadLimitError, MAX_LEASE_RECORD_BYTES, readFileBounded, readHandleBounded } from "./bounded-file.js";

export interface LeaseOptions {
  ttlMs?: number;
  waitMs?: number;
  pollMs?: number;
  now?: () => number;
  signal?: AbortSignal;
}

interface LeaseRecord {
  token: string;
  pid: number;
  acquiredAt: string;
  expiresAt: string;
}

function isLeaseRecord(value: unknown): value is LeaseRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.token === "string" &&
    typeof record.pid === "number" &&
    typeof record.acquiredAt === "string" &&
    Number.isFinite(Date.parse(record.acquiredAt)) &&
    typeof record.expiresAt === "string" &&
    Number.isFinite(Date.parse(record.expiresAt))
  );
}

function parseLeaseRecord(content: string): LeaseRecord | null {
  try {
    const parsed = JSON.parse(content) as unknown;
    return isLeaseRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error ? String(error.code) : undefined;
}

async function statIfExists(filePath: string): Promise<Stats | null> {
  try {
    return await fs.stat(filePath);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return null;
    throw error;
  }
}

async function unlinkIfExists(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error;
  }
}

async function wait(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

export class LeaseBusyError extends Error {
  constructor(readonly leasePath: string) {
    super(`Store lease is held: ${leasePath}`);
    this.name = "LeaseBusyError";
  }
}

export class FileLease {
  private released = false;

  private constructor(
    readonly leasePath: string,
    readonly token: string,
    private readonly ttlMs: number,
    private readonly now: () => number,
  ) {}

  static async acquire(root: string, options: LeaseOptions = {}): Promise<FileLease> {
    const ttlMs = options.ttlMs ?? 30_000;
    const waitMs = options.waitMs ?? 5_000;
    const pollMs = options.pollMs ?? 50;
    const now = options.now ?? Date.now;
    const signal = options.signal;
    const leasePath = path.join(root, ".store.lease");
    const token = randomUUID();
    const deadline = now() + waitMs;

    if (ttlMs <= 0 || waitMs < 0 || pollMs <= 0) {
      throw new Error("Invalid lease timing options");
    }

    await fs.mkdir(root, { recursive: true });

    while (true) {
      if (signal?.aborted) throw new OperationAbortedError("Store lease acquisition was aborted", signal.reason);
      const acquiredAt = now();
      const record: LeaseRecord = {
        token,
        pid: process.pid,
        acquiredAt: new Date(acquiredAt).toISOString(),
        expiresAt: new Date(acquiredAt + ttlMs).toISOString(),
      };

      let handle: FileHandle | undefined;
      try {
        handle = await fs.open(leasePath, "wx", 0o600);
        await handle.writeFile(`${JSON.stringify(record)}\n`);
        await handle.sync();
        await handle.close();
        return new FileLease(leasePath, token, ttlMs, now);
      } catch (error) {
        await handle?.close().catch(() => undefined);
        if (errorCode(error) !== "EEXIST") throw error;

        const existing = await FileLease.readRecord(leasePath);
        const expired = existing ? Date.parse(existing.expiresAt) <= now() : false;
        if (expired && existing) {
          // Re-read immediately before unlinking to avoid removing a renewed lease.
          const confirmed = await FileLease.readRecord(leasePath);
          if (confirmed && confirmed.token === existing.token && confirmed.expiresAt === existing.expiresAt) {
            await unlinkIfExists(leasePath);
            continue;
          }
        } else if (!existing) {
          // A writer may be between exclusive create and write. Only reclaim a
          // malformed lease after a full TTL and an unchanged stat re-check.
          const initialStat = await statIfExists(leasePath);
          if (initialStat && initialStat.mtimeMs + ttlMs <= now()) {
            const confirmedStat = await statIfExists(leasePath);
            if (
              confirmedStat &&
              confirmedStat.mtimeMs === initialStat.mtimeMs &&
              confirmedStat.size === initialStat.size
            ) {
              await unlinkIfExists(leasePath);
              continue;
            }
          }
        }

        if (now() >= deadline) throw new LeaseBusyError(leasePath);
        await wait(Math.min(pollMs, Math.max(1, deadline - now())));
      }
    }
  }

  private static async readRecord(leasePath: string): Promise<LeaseRecord | null> {
    try {
      return parseLeaseRecord((await readFileBounded(leasePath, MAX_LEASE_RECORD_BYTES)).toString("utf8"));
    } catch (error) {
      if (errorCode(error) === "ENOENT" || error instanceof FileReadLimitError) return null;
      throw error;
    }
  }

  async assertOwned(): Promise<void> {
    if (this.released) throw new LeaseBusyError(this.leasePath);
    const existing = await FileLease.readRecord(this.leasePath);
    if (existing?.token !== this.token || Date.parse(existing.expiresAt) <= this.now()) {
      throw new LeaseBusyError(this.leasePath);
    }
  }

  async renew(): Promise<void> {
    if (this.released) throw new Error("Cannot renew a released lease");
    const handle = await fs.open(this.leasePath, "r+");
    try {
      // Verify and update through one descriptor. If the path is replaced
      // concurrently, this can only mutate our now-unlinked inode rather than
      // truncating the new owner's lease file.
      let existing: LeaseRecord | null;
      try {
        existing = parseLeaseRecord(
          (await readHandleBounded(handle, this.leasePath, MAX_LEASE_RECORD_BYTES)).toString("utf8"),
        );
      } catch (error) {
        if (error instanceof FileReadLimitError) throw new LeaseBusyError(this.leasePath);
        throw error;
      }
      const renewedAt = this.now();
      if (existing?.token !== this.token || Date.parse(existing.expiresAt) <= renewedAt) {
        throw new LeaseBusyError(this.leasePath);
      }
      const record: LeaseRecord = {
        token: this.token,
        pid: process.pid,
        acquiredAt: existing.acquiredAt,
        expiresAt: new Date(renewedAt + this.ttlMs).toISOString(),
      };
      const bytes = Buffer.from(`${JSON.stringify(record)}\n`, "utf8");
      let offset = 0;
      while (offset < bytes.byteLength) {
        const result = await handle.write(bytes, offset, bytes.byteLength - offset, offset);
        if (result.bytesWritten <= 0) throw new Error("Lease renewal write made no progress");
        offset += result.bytesWritten;
      }
      await handle.truncate(bytes.byteLength);
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  async release(): Promise<void> {
    if (this.released) return;
    // Refresh ownership immediately before the read/unlink pair. A contender
    // cannot legitimately reclaim this path during the renewed TTL window, so
    // release cannot unlink a replacement owner's file based on a stale read.
    try {
      await this.renew();
    } catch (error) {
      this.released = true;
      throw error;
    }
    this.released = true;
    const existing = await FileLease.readRecord(this.leasePath);
    if (existing?.token === this.token) {
      await unlinkIfExists(this.leasePath);
    }
  }
}
