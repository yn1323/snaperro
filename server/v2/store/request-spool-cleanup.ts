import fs from "node:fs/promises";
import path from "node:path";

const REQUEST_SPOOL_FILE =
  /^body-([1-9][0-9]*)-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.tmp$/iu;
const BLOB_STAGING_FILE =
  /^([1-9][0-9]*)\.[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.tmp$/iu;

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error ? String(error.code) : undefined;
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but cannot be signalled. Only ESRCH is a
    // safe proof that no live writer owns the spool.
    return errorCode(error) !== "ESRCH";
  }
}

async function cleanupDeadWriterFiles(
  directory: string,
  filename: RegExp,
  processAlive: (pid: number) => boolean = isProcessAlive,
): Promise<number> {
  let directoryHandle: Awaited<ReturnType<typeof fs.opendir>>;
  try {
    directoryHandle = await fs.opendir(directory);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return 0;
    throw error;
  }

  let removed = 0;
  for await (const entry of directoryHandle) {
    if (!entry.isFile()) continue;
    const match = filename.exec(entry.name);
    if (!match) continue;
    const pid = Number(match[1]);
    if (!Number.isSafeInteger(pid) || processAlive(pid)) continue;
    try {
      await fs.unlink(path.join(directory, entry.name));
      removed += 1;
    } catch (error) {
      if (errorCode(error) !== "ENOENT") throw error;
    }
  }
  return removed;
}

export function cleanupOrphanedRequestSpools(
  directory: string,
  processAlive?: (pid: number) => boolean,
): Promise<number> {
  return cleanupDeadWriterFiles(directory, REQUEST_SPOOL_FILE, processAlive);
}

export function cleanupOrphanedBlobStaging(
  directory: string,
  processAlive?: (pid: number) => boolean,
): Promise<number> {
  return cleanupDeadWriterFiles(directory, BLOB_STAGING_FILE, processAlive);
}
