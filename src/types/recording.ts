import { z } from "zod/v4";

/**
 * 録画されたリクエスト情報
 */
export const RecordedRequestSchema = z.object({
  method: z.string(),
  url: z.string(),
  headers: z.record(z.string(), z.string()),
  body: z.unknown().optional(),
});

export type RecordedRequest = z.infer<typeof RecordedRequestSchema>;

/**
 * 録画されたレスポンス情報
 */
export const RecordedResponseSchema = z.object({
  status: z.number().int().min(100).max(599),
  headers: z.record(z.string(), z.string()),
  body: z.unknown(),
});

export type RecordedResponse = z.infer<typeof RecordedResponseSchema>;

/**
 * 録画データ全体
 */
export const RecordedDataSchema = z.object({
  request: RecordedRequestSchema,
  response: RecordedResponseSchema,
  /** 録画日時（ISO 8601） */
  recordedAt: z.iso.datetime(),
});

export type RecordedData = z.infer<typeof RecordedDataSchema>;
