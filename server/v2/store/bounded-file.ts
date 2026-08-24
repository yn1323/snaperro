import fs, { type FileHandle } from "node:fs/promises";

export const MAX_STORE_METADATA_BYTES = 2 * 1024 * 1024;
export const MAX_BLOB_METADATA_BYTES = 4 * 1024;
export const MAX_PIN_DIGESTS = 100_000;
export const MAX_PIN_RECORD_BYTES = 8 * 1024 * 1024;
export const MAX_LEASE_RECORD_BYTES = 4 * 1024;
export const MAX_MIGRATION_RECEIPT_BYTES = 64 * 1024 * 1024;

export class FileReadLimitError extends Error {
  constructor(
    readonly filePath: string,
    readonly maximumBytes: number,
    readonly observedBytes: number,
  ) {
    super(`${filePath} exceeds the read limit: ${observedBytes} bytes > ${maximumBytes} bytes`);
    this.name = "FileReadLimitError";
  }
}

function assertMaximum(maximumBytes: number): void {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    throw new RangeError("maximumBytes must be a positive safe integer");
  }
}

/**
 * Reads a regular file without allowing a size change to trigger an unbounded
 * allocation. The descriptor is statted first, exactly that bounded size is
 * allocated, and one trailing byte is probed before returning.
 */
export async function readHandleBounded(handle: FileHandle, filePath: string, maximumBytes: number): Promise<Buffer> {
  assertMaximum(maximumBytes);
  const stat = await handle.stat();
  if (!stat.isFile()) throw new Error(`Not a regular file: ${filePath}`);
  if (!Number.isSafeInteger(stat.size) || stat.size < 0) throw new Error(`Invalid file size: ${filePath}`);
  if (stat.size > maximumBytes) throw new FileReadLimitError(filePath, maximumBytes, stat.size);

  const bytes = Buffer.alloc(stat.size);
  let position = 0;
  while (position < bytes.byteLength) {
    const result = await handle.read(bytes, position, bytes.byteLength - position, position);
    if (result.bytesRead === 0) throw new Error(`File changed while reading: ${filePath}`);
    position += result.bytesRead;
  }
  const probe = Buffer.allocUnsafe(1);
  if ((await handle.read(probe, 0, 1, position)).bytesRead !== 0) {
    throw new FileReadLimitError(filePath, maximumBytes, Math.max(maximumBytes + 1, position + 1));
  }
  return bytes;
}

export async function readFileBounded(filePath: string, maximumBytes: number): Promise<Buffer> {
  const handle = await fs.open(filePath, "r");
  try {
    return await readHandleBounded(handle, filePath, maximumBytes);
  } finally {
    await handle.close();
  }
}
