import { z } from "zod/v4";

/**
 * HTTPメソッド
 */
export const HttpMethodSchema = z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]);

export type HttpMethod = z.infer<typeof HttpMethodSchema>;

/**
 * 記録されたリクエスト情報
 */
export const FileRequestSchema = z.object({
  /** パスパラメータ */
  pathParams: z.record(z.string(), z.string()),
  /** クエリパラメータ */
  queryParams: z.record(z.string(), z.union([z.string(), z.array(z.string())])),
  /** リクエストヘッダー */
  headers: z.record(z.string(), z.string()),
  /** リクエストボディ */
  body: z.unknown().nullable(),
});

export type FileRequest = z.infer<typeof FileRequestSchema>;

/**
 * 記録されたレスポンス情報
 */
export const FileResponseSchema = z.object({
  /** HTTPステータスコード */
  status: z.number().int().min(100).max(599),
  /** レスポンスヘッダー */
  headers: z.record(z.string(), z.string()),
  /** レスポンスボディ */
  body: z.unknown(),
});

export type FileResponse = z.infer<typeof FileResponseSchema>;

/**
 * 記録データ全体
 */
export const FileDataSchema = z.object({
  /** エンドポイントのパスパターン（例: "/api/users/:id"） */
  endpoint: z.string(),
  /** HTTPメソッド */
  method: HttpMethodSchema,
  /** リクエスト情報 */
  request: FileRequestSchema,
  /** レスポンス情報 */
  response: FileResponseSchema,
});

export type FileData = z.infer<typeof FileDataSchema>;
