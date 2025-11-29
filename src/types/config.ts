import { z } from "zod/v4";

/**
 * API設定スキーマ
 */
export const ApiConfigSchema = z.object({
  /** 表示名（GUI・ログ用） */
  name: z.string().min(1),
  /** プロキシ先のベースURL */
  target: z.url(),
  /** 付与するヘッダー（機密情報含む） */
  headers: z.record(z.string(), z.string()).optional(),
  /**
   * マッチするパスパターン（glob形式）
   * - "GET /api/users/**" → GETメソッドのみマッチ
   * - "/api/orders/**" → 全メソッドにマッチ
   */
  match: z.array(z.string().min(1)).min(1),
});

export type ApiConfig = z.infer<typeof ApiConfigSchema>;

/**
 * snaperro設定ファイルスキーマ
 */
export const SnaperroConfigSchema = z.object({
  /** サーバーポート（デフォルト: 3333） */
  port: z.number().int().min(1).max(65535).optional().default(3333),
  /** API設定 */
  apis: z.record(z.string(), ApiConfigSchema),
});

export type SnaperroConfig = z.infer<typeof SnaperroConfigSchema>;

/**
 * 設定ファイルを定義するヘルパー関数
 * 型推論とバリデーションを提供
 */
export function defineConfig(config: SnaperroConfig): SnaperroConfig {
  return SnaperroConfigSchema.parse(config);
}
