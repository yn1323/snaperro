import { Hono } from "hono";
import {
  type FolderImportUploadMetadata,
  FolderImportUploadMetadataSchema,
  type RecordingImportUploadMetadata,
  RecordingImportUploadMetadataSchema,
  type StagedFolderImport,
  StagedFolderImportSchema,
  type StagedRecordingImport,
  StagedRecordingImportSchema,
} from "../../../shared/contracts-v2/transfers.js";
import { V2_RELATIVE_PATHS } from "../../../shared/contracts-v2/transport.js";
import type { OperationContext } from "../application/ports.js";
import { EntityNotFoundError, InvalidArgumentError } from "../domain/errors.js";
import { domainErrorResponse } from "./domain-error-response.js";
import { assertDeclaredContentLengthWithinLimit } from "./request-content-length.js";

export interface TransferDownload {
  filename: string;
  mediaType: string;
  contentEncoding: string | null;
  size: number;
  stream: ReadableStream<Uint8Array>;
}

export interface FolderTransferPort {
  stageImport(
    stream: ReadableStream<Uint8Array>,
    metadata: FolderImportUploadMetadata,
    context?: OperationContext,
  ): Promise<StagedFolderImport>;
  stageRecordingImport(
    stream: ReadableStream<Uint8Array>,
    metadata: RecordingImportUploadMetadata,
    context?: OperationContext,
  ): Promise<StagedRecordingImport>;
}

export interface CapabilityDownloadPort {
  openCapability(capability: string, context?: OperationContext): Promise<TransferDownload>;
}

export interface TransferApiOptions {
  maxUploadBytes?: number;
}

function contentDisposition(filename: string): string {
  const encoded = encodeURIComponent(filename).replace(
    /['()*]/gu,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="snaperro-export.zip"; filename*=UTF-8''${encoded}`;
}

export function createTransferApi(transfers: FolderTransferPort, options: TransferApiOptions = {}): Hono {
  const app = new Hono();
  const maxUploadBytes = options.maxUploadBytes ?? 512 * 1024 * 1024;
  if (!Number.isSafeInteger(maxUploadBytes) || maxUploadBytes < 1) {
    throw new TypeError("maxUploadBytes must be a positive safe integer");
  }
  app.onError(domainErrorResponse);

  app.post(V2_RELATIVE_PATHS.folderImports, async (context) => {
    assertDeclaredContentLengthWithinLimit(context, maxUploadBytes);
    if (!context.req.raw.body) throw new InvalidArgumentError("A ZIP archive body is required");
    const mediaType = (context.req.header("content-type") ?? "").split(";", 1)[0].trim().toLowerCase();
    const metadata = FolderImportUploadMetadataSchema.safeParse({
      filename: context.req.query("filename"),
      mediaType,
    });
    if (!metadata.success) {
      throw new InvalidArgumentError("Invalid folder import metadata", { issues: metadata.error.issues });
    }
    const staged = StagedFolderImportSchema.parse(
      await transfers.stageImport(context.req.raw.body, metadata.data, { signal: context.req.raw.signal }),
    );
    return context.json(staged, 201);
  });

  app.post(V2_RELATIVE_PATHS.recordingImports, async (context) => {
    assertDeclaredContentLengthWithinLimit(context, maxUploadBytes);
    if (!context.req.raw.body) throw new InvalidArgumentError("A ZIP archive body is required");
    const mediaType = (context.req.header("content-type") ?? "").split(";", 1)[0].trim().toLowerCase();
    const metadata = RecordingImportUploadMetadataSchema.safeParse({
      filename: context.req.query("filename"),
      mediaType,
    });
    if (!metadata.success) {
      throw new InvalidArgumentError("Invalid recording import metadata", { issues: metadata.error.issues });
    }
    const staged = StagedRecordingImportSchema.parse(
      await transfers.stageRecordingImport(context.req.raw.body, metadata.data, {
        signal: context.req.raw.signal,
      }),
    );
    return context.json(staged, 201);
  });

  return app;
}

export function createDownloadApi(downloads: CapabilityDownloadPort): Hono {
  const app = new Hono();
  app.onError(domainErrorResponse);

  app.use("/:capability", async (context, next) => {
    if (context.req.method !== "HEAD") return next();
    context.header("Allow", "GET");
    return context.body(null, 405);
  });

  app.get("/:capability", async (context) => {
    const capability = context.req.param("capability");
    if (!/^[A-Za-z0-9_-]{43}$/u.test(capability)) throw new EntityNotFoundError("download", "capability");
    const download = await downloads.openCapability(capability, { signal: context.req.raw.signal });
    const headers = new Headers({
      "Cache-Control": "no-store",
      "Content-Disposition": contentDisposition(download.filename),
      "Content-Length": String(download.size),
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Content-Type": download.mediaType,
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    });
    if (download.contentEncoding) headers.set("X-Snaperro-Content-Encoding", download.contentEncoding);
    return new Response(download.stream, {
      status: 200,
      headers,
    });
  });

  return app;
}
