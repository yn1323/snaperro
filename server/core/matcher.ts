import type { ApiConfig } from "../types/config.js";

/**
 * マッチ結果
 */
export interface MatchResult {
  /** マッチしたAPI設定のキー */
  apiKey: string;
  /** マッチしたAPI設定 */
  apiConfig: ApiConfig;
  /** マッチしたルートパターン（例: "/api/users/:id"） */
  matchedRoute: string;
  /** 抽出されたパスパラメータ */
  pathParams: Record<string, string>;
}

/**
 * パース済みルートパターン
 */
interface ParsedPattern {
  /** HTTPメソッド（指定がない場合はnull） */
  method: string | null;
  /** パスパターン（メソッド部分を除く） */
  path: string;
  /** パラメータ名の配列 */
  paramNames: string[];
  /** マッチング用正規表現 */
  regex: RegExp;
}

/**
 * ルートパターンをパースしてメソッド、パス、パラメータ名、正規表現を取得
 * @param pattern 例: "GET /api/users/:id" または "/api/users/:id"
 */
export function parseRoutePattern(pattern: string): ParsedPattern {
  const methods = ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"];
  const parts = pattern.split(" ");

  let method: string | null = null;
  let path: string;

  if (parts.length === 2 && methods.includes(parts[0].toUpperCase())) {
    method = parts[0].toUpperCase();
    path = parts[1];
  } else {
    path = pattern;
  }

  // パスから :param を抽出してパラメータ名を収集
  const paramNames: string[] = [];
  const regexPattern = path
    .split("/")
    .map((segment) => {
      if (segment.startsWith(":")) {
        const paramName = segment.slice(1);
        paramNames.push(paramName);
        return "([^/]+)";
      }
      // 正規表現の特殊文字をエスケープ
      return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("\\/");

  const regex = new RegExp(`^${regexPattern}$`);

  return { method, path, paramNames, regex };
}

/**
 * リクエストパスからパスパラメータを抽出
 * @param path リクエストパス（例: "/api/users/123"）
 * @param parsedPattern パース済みパターン
 * @returns パスパラメータ、マッチしない場合はnull
 */
export function extractPathParams(path: string, parsedPattern: ParsedPattern): Record<string, string> | null {
  const match = path.match(parsedPattern.regex);
  if (!match) return null;

  const params: Record<string, string> = {};
  for (let i = 0; i < parsedPattern.paramNames.length; i++) {
    params[parsedPattern.paramNames[i]] = match[i + 1]; // match[0]は全体マッチ
  }
  return params;
}

/**
 * リクエストにマッチするAPI設定を検索
 *
 * @param method HTTPメソッド
 * @param path リクエストパス
 * @param apis API設定のレコード
 * @returns マッチ結果（パスパラメータを含む）、なければnull
 */
export function findMatchingApi(method: string, path: string, apis: Record<string, ApiConfig>): MatchResult | null {
  for (const [apiKey, apiConfig] of Object.entries(apis)) {
    for (const route of apiConfig.routes) {
      const parsed = parseRoutePattern(route);

      // メソッドチェック（指定がある場合のみ）
      if (parsed.method && parsed.method !== method.toUpperCase()) {
        continue;
      }

      // パスマッチングとパラメータ抽出
      const pathParams = extractPathParams(path, parsed);
      if (pathParams !== null) {
        return {
          apiKey,
          apiConfig,
          matchedRoute: parsed.path,
          pathParams,
        };
      }
    }
  }
  return null;
}
