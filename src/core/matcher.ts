import picomatch from "picomatch";
import type { ApiConfig } from "../types/config.js";

/**
 * マッチ結果
 */
export interface MatchResult {
  apiKey: string;
  apiConfig: ApiConfig;
}

/**
 * パターンをパースしてメソッドとパスに分離
 */
function parsePattern(pattern: string): {
  patternMethod: string | null;
  patternPath: string;
} {
  const methods = ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"];
  const parts = pattern.split(" ");

  if (parts.length === 2 && methods.includes(parts[0].toUpperCase())) {
    return { patternMethod: parts[0].toUpperCase(), patternPath: parts[1] };
  }

  return { patternMethod: null, patternPath: pattern };
}

/**
 * リクエストにマッチするAPI設定を検索
 *
 * @param method HTTPメソッド
 * @param path リクエストパス
 * @param apis API設定のレコード
 * @returns マッチしたAPI設定、なければnull
 */
export function findMatchingApi(method: string, path: string, apis: Record<string, ApiConfig>): MatchResult | null {
  for (const [apiKey, apiConfig] of Object.entries(apis)) {
    for (const pattern of apiConfig.match) {
      const { patternMethod, patternPath } = parsePattern(pattern);

      // メソッドチェック（指定がある場合のみ）
      if (patternMethod && patternMethod !== method.toUpperCase()) {
        continue;
      }

      // パスチェック
      if (picomatch.isMatch(path, patternPath)) {
        return { apiKey, apiConfig };
      }
    }
  }
  return null;
}
