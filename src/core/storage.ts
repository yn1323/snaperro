import fs from "node:fs/promises";
import path from "node:path";
import type { RecordedData } from "../types/recording.js";

const BASE_DIR = ".snaperro/recordings";

/**
 * ファイルサイズをフォーマット
 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * ファイルパスを構築
 */
export function buildFilePath(pattern: string, urlPath: string, method: string, count: number): string {
  // /api/users → api/users
  const normalizedPath = urlPath.startsWith("/") ? urlPath.slice(1) : urlPath;
  return path.join(pattern, normalizedPath, `${method.toUpperCase()}_${count}.json`);
}

/**
 * ファイル情報
 */
export interface FileInfo {
  path: string;
  method: string;
  status: number;
  size: number;
}

/**
 * ストレージ操作
 */
export const storage = {
  /**
   * 録画データをファイルに書き込み
   */
  async write(filePath: string, data: RecordedData): Promise<void> {
    const fullPath = path.join(BASE_DIR, filePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, JSON.stringify(data, null, 2), "utf-8");
  },

  /**
   * 録画データをファイルから読み込み
   */
  async read(filePath: string): Promise<RecordedData> {
    const fullPath = path.join(BASE_DIR, filePath);
    const content = await fs.readFile(fullPath, "utf-8");
    return JSON.parse(content) as RecordedData;
  },

  /**
   * ファイルが存在するかチェック
   */
  async exists(filePath: string): Promise<boolean> {
    const fullPath = path.join(BASE_DIR, filePath);
    try {
      await fs.access(fullPath);
      return true;
    } catch {
      return false;
    }
  },

  /**
   * 最後のファイルを検索（連番の最大値）
   */
  async findLastFile(pattern: string, urlPath: string, method: string): Promise<string | null> {
    const normalizedPath = urlPath.startsWith("/") ? urlPath.slice(1) : urlPath;
    const dir = path.join(BASE_DIR, pattern, normalizedPath);
    try {
      const files = await fs.readdir(dir);
      const methodFiles = files
        .filter((f) => f.startsWith(`${method.toUpperCase()}_`) && f.endsWith(".json"))
        .sort((a, b) => {
          const numA = Number.parseInt(a.match(/_(\d+)\.json$/)?.[1] ?? "0", 10);
          const numB = Number.parseInt(b.match(/_(\d+)\.json$/)?.[1] ?? "0", 10);
          return numB - numA; // 降順
        });

      if (methodFiles.length > 0) {
        return path.join(pattern, normalizedPath, methodFiles[0]);
      }
    } catch {
      // ディレクトリが存在しない
    }
    return null;
  },

  /**
   * パターン一覧を取得
   */
  async listPatterns(): Promise<string[]> {
    try {
      const entries = await fs.readdir(BASE_DIR, { withFileTypes: true });
      return entries.filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
      return [];
    }
  },

  /**
   * 新規パターンを作成
   */
  async createPattern(name: string): Promise<void> {
    const dir = path.join(BASE_DIR, name);
    await fs.mkdir(dir, { recursive: true });
  },

  /**
   * パターン内のファイル一覧を取得
   */
  async getPatternFiles(pattern: string): Promise<FileInfo[]> {
    const files: FileInfo[] = [];
    const patternDir = path.join(BASE_DIR, pattern);

    async function walkDir(dir: string, relativePath: string): Promise<void> {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const entryPath = path.join(dir, entry.name);
          const entryRelative = path.join(relativePath, entry.name);

          if (entry.isDirectory()) {
            await walkDir(entryPath, entryRelative);
          } else if (entry.name.endsWith(".json")) {
            try {
              const content = await fs.readFile(entryPath, "utf-8");
              const data = JSON.parse(content) as RecordedData;
              const stat = await fs.stat(entryPath);

              // ファイル名からメソッドを抽出
              const methodMatch = entry.name.match(/^([A-Z]+)_\d+\.json$/);
              const method = methodMatch ? methodMatch[1] : "UNKNOWN";

              files.push({
                path: entryRelative,
                method,
                status: data.response.status,
                size: stat.size,
              });
            } catch {
              // パース失敗は無視
            }
          }
        }
      } catch {
        // ディレクトリ読み取り失敗
      }
    }

    await walkDir(patternDir, "");
    return files;
  },

  /**
   * ファイルを削除
   */
  async deleteFile(filePath: string): Promise<void> {
    const fullPath = path.join(BASE_DIR, filePath);
    await fs.unlink(fullPath);
  },

  /**
   * ベースディレクトリを作成
   */
  async ensureBaseDir(): Promise<void> {
    await fs.mkdir(BASE_DIR, { recursive: true });
  },

  /**
   * フォーマットされたファイルサイズを取得
   */
  formatSize,
};
