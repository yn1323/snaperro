import path from "node:path";
import { createJiti } from "jiti";
import type { SnaperroConfig } from "../types/config.js";
import { SnaperroConfigSchema } from "../types/config.js";

/**
 * 設定ファイルを読み込み
 * jiti を使って TypeScript ファイルを動的にインポート
 */
export async function loadConfig(configPath?: string): Promise<SnaperroConfig> {
  const resolvedPath = configPath ?? path.resolve(process.cwd(), "snaperro.config.ts");

  try {
    const jiti = createJiti(import.meta.url);
    const configModule = await jiti.import(resolvedPath);
    const config = (configModule as { default: SnaperroConfig }).default;

    return validateConfig(config);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ERR_MODULE_NOT_FOUND") {
      throw new Error(`設定ファイルが見つかりません: ${resolvedPath}`);
    }
    throw error;
  }
}

/**
 * 設定をバリデート
 */
function validateConfig(config: SnaperroConfig): SnaperroConfig {
  const result = SnaperroConfigSchema.safeParse(config);

  if (!result.success) {
    const errors = result.error.issues.map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`).join("\n");
    throw new Error(`設定ファイルのバリデーションエラー:\n${errors}`);
  }

  // 警告: apisが空の場合
  if (Object.keys(result.data.apis).length === 0) {
    console.warn("警告: apis が空です。プロキシ先が設定されていません。");
  }

  return result.data;
}
