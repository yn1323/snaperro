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
  /** 記録時にマスクするリクエストヘッダー名（大文字小文字区別なし） */
  maskRequestHeaders: z.array(z.string()).optional(),
  /**
   * マッチするルートパターン
   * - "/api/users/:id" → パスパラメータ :id を抽出
   * - "GET /api/users" → GETメソッドのみマッチ
   */
  routes: z.array(z.string().min(1)).min(1),
});

export type ApiConfig = z.infer<typeof ApiConfigSchema>;

/**
 * Upstream proxy configuration schema
 */
export const UpstreamProxySchema = z.object({
  /** Proxy URL (e.g., http://proxy.company.com:8080 or http://user:pass@proxy:8080) */
  url: z.url(),
});

export type UpstreamProxyConfig = z.infer<typeof UpstreamProxySchema>;

/**
 * Mock fallback behavior schema
 * - "404": Return 404 error (default)
 * - "proxy": Forward request to real server
 * - "proxy&record": Forward to real server and record the response
 */
export const MockFallbackSchema = z.enum(["404", "proxy", "proxy&record"]);

export type MockFallback = z.infer<typeof MockFallbackSchema>;

/**
 * snaperro設定ファイルスキーマ
 */
export const SnaperroConfigSchema = z.object({
  /** サーバーポート（デフォルト: 3333） */
  port: z.number().int().min(1).max(65535).optional().default(3333),
  /** 記録データの保存先ディレクトリ（デフォルト: .snaperro/files） */
  filesDir: z.string().optional().default(".snaperro/files"),
  /** Upstream proxy configuration */
  upstreamProxy: UpstreamProxySchema.optional(),
  /** Fallback behavior when mock file is not found (default: "404") */
  mockFallback: MockFallbackSchema.optional().default("404"),
  /** API設定 */
  apis: z.record(z.string(), ApiConfigSchema),
});

export type SnaperroConfig = z.infer<typeof SnaperroConfigSchema>;

/**
 * 設定ファイルを定義するヘルパー関数
 * 型推論とバリデーションを提供
 */
export function defineConfig(config: z.input<typeof SnaperroConfigSchema>): SnaperroConfig {
  return SnaperroConfigSchema.parse(config);
}
