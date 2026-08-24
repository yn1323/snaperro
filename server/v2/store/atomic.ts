import { randomUUID } from "node:crypto";
import fs, { type FileHandle } from "node:fs/promises";
import path from "node:path";

function isIgnorableDirectorySyncError(error: unknown): boolean {
  if (!(error instanceof Error) || !("code" in error)) return false;
  return ["EINVAL", "ENOTSUP", "EISDIR", "EPERM", "EBADF"].includes(String(error.code));
}

/** Flush directory metadata where the platform supports it. */
export async function fsyncDirectory(directory: string): Promise<void> {
  let handle: FileHandle | undefined;
  try {
    handle = await fs.open(directory, "r");
    await handle.sync();
  } catch (error) {
    if (!isIgnorableDirectorySyncError(error)) throw error;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

/**
 * Durable single-file replacement: same-directory temp file, file fsync,
 * rename, then parent-directory fsync.
 */
export async function atomicWriteFile(targetPath: string, data: string | Uint8Array): Promise<void> {
  const directory = path.dirname(targetPath);
  await fs.mkdir(directory, { recursive: true });

  const tempPath = path.join(directory, `.${path.basename(targetPath)}.${process.pid}.${randomUUID()}.tmp`);
  let handle: FileHandle | undefined;

  try {
    handle = await fs.open(tempPath, "wx", 0o600);
    await handle.writeFile(data);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await fs.rename(tempPath, targetPath);
    await fsyncDirectory(directory);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await fs.unlink(tempPath).catch(() => undefined);
    throw error;
  }
}

/**
 * Durable single-file replacement with a fence around only the visibility
 * change. The temp file is fully written and synced before the fence runs.
 */
export async function atomicWriteFileWithCommitFence(
  targetPath: string,
  data: string | Uint8Array,
  fence: (commit: () => Promise<void>) => Promise<void>,
): Promise<void> {
  const directory = path.dirname(targetPath);
  await fs.mkdir(directory, { recursive: true });

  const tempPath = path.join(directory, `.${path.basename(targetPath)}.${process.pid}.${randomUUID()}.tmp`);
  let handle: FileHandle | undefined;
  let committed = false;

  try {
    handle = await fs.open(tempPath, "wx", 0o600);
    await handle.writeFile(data);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await fence(async () => {
      await fs.rename(tempPath, targetPath);
      committed = true;
      await fsyncDirectory(directory);
    });
  } catch (error) {
    await handle?.close().catch(() => undefined);
    if (!committed) await fs.unlink(tempPath).catch(() => undefined);
    throw error;
  }
}

export async function atomicWriteJson(targetPath: string, value: unknown): Promise<void> {
  await atomicWriteFile(targetPath, `${JSON.stringify(value, null, 2)}\n`);
}
