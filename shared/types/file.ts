import { z } from "zod/v4";

/**
 * HTTP method
 */
export const HttpMethodSchema = z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]);

export type HttpMethod = z.infer<typeof HttpMethodSchema>;

/**
 * Recorded request information
 */
export const FileRequestSchema = z.object({
  /** Path parameters */
  pathParams: z.record(z.string(), z.string()),
  /** Query parameters */
  queryParams: z.record(z.string(), z.union([z.string(), z.array(z.string())])),
  /** Request headers */
  headers: z.record(z.string(), z.string()),
  /** Request body */
  body: z.unknown().nullable(),
});

export type FileRequest = z.infer<typeof FileRequestSchema>;

/**
 * Recorded response information
 */
export const FileResponseSchema = z.object({
  /** HTTP status code */
  status: z.number().int().min(100).max(599),
  /** Response headers */
  headers: z.record(z.string(), z.string()),
  /** Response body */
  body: z.unknown(),
});

export type FileResponse = z.infer<typeof FileResponseSchema>;

/**
 * Recorded data
 */
export const FileDataSchema = z.object({
  /** Endpoint path pattern (e.g. "/api/users/:id") */
  endpoint: z.string(),
  /** HTTP method */
  method: HttpMethodSchema,
  /** Request information */
  request: FileRequestSchema,
  /** Response information */
  response: FileResponseSchema,
});

export type FileData = z.infer<typeof FileDataSchema>;
