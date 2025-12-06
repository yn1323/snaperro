import fs from "node:fs/promises";
import path from "node:path";
import archiver from "archiver";
import unzipper from "unzipper";
import type { FileData } from "../types/file.js";
import { eventBus } from "./event-bus.js";

let BASE_DIR = ".snaperro/files";

/**
 * ベースディレクトリを設定
 * サーバー起動時にconfigから呼び出す
 */
export function setFilesDir(dir: string): void {
  BASE_DIR = dir;
}

/**
 * 現在のベースディレクトリを取得
 */
export function getFilesDir(): string {
  return BASE_DIR;
}

/**
 * ファイルサイズをフォーマット
 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * エンドポイントパターンをファイル名に変換
 * - 先頭スラッシュを除去
 * - "/" を "_" に置換
 * - ":param" を "{param}" に変換
 *
 * @param endpoint エンドポイントパターン（例: "/api/users/:id"）
 * @returns ファイル名ベース（例: "api_users_{id}"）
 */
export function endpointToFileName(endpoint: string): string {
  // 先頭スラッシュを除去
  let fileName = endpoint.startsWith("/") ? endpoint.slice(1) : endpoint;

  // :param を {param} に変換
  fileName = fileName.replace(/:(\w+)/g, "{$1}");

  // / を _ に変換
  fileName = fileName.replace(/\//g, "_");

  return fileName;
}

/**
 * ファイルパスを構築（新命名規則）
 *
 * @param pattern パターン名
 * @param endpoint エンドポイントパターン（例: "/api/users/:id"）
 * @param sequence 連番（3桁0埋め）
 * @returns ファイルパス（例: "正常系/api_users_{id}_001.json"）
 */
export function buildFilePath(pattern: string, endpoint: string, sequence: number): string {
  const fileName = endpointToFileName(endpoint);
  const paddedSequence = String(sequence).padStart(3, "0");
  return path.join(pattern, `${fileName}_${paddedSequence}.json`);
}

/**
 * ファイル情報
 */
export interface FileInfo {
  path: string;
  method: string;
  endpoint: string;
  status: number;
  size: number;
  updatedAt: string;
}

/**
 * パターンメタデータ
 */
export interface PatternMetadata {
  name: string;
  filesCount: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * マッチしたファイルの結果
 */
export interface MatchingFileResult {
  filePath: string;
  fileData: FileData;
}

/**
 * オブジェクトの深い比較
 */
function isDeepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * ストレージ操作
 */
export const storage = {
  /**
   * 記録データをファイルに書き込み
   */
  async write(filePath: string, data: FileData): Promise<void> {
    const fullPath = path.join(BASE_DIR, filePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, JSON.stringify(data, null, 2), "utf-8");
  },

  /**
   * 記録データをファイルから読み込み
   */
  async read(filePath: string): Promise<FileData> {
    const fullPath = path.join(BASE_DIR, filePath);
    const content = await fs.readFile(fullPath, "utf-8");
    return JSON.parse(content) as FileData;
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
   * 次の連番を取得
   *
   * @param pattern パターン名
   * @param endpoint エンドポイントパターン（例: "/api/users/:id"）
   * @returns 次の連番（1始まり）
   */
  async findNextSequence(pattern: string, endpoint: string): Promise<number> {
    const fileName = endpointToFileName(endpoint);
    const patternDir = path.join(BASE_DIR, pattern);

    try {
      const files = await fs.readdir(patternDir);
      const matchingFiles = files.filter((f) => f.startsWith(`${fileName}_`) && f.endsWith(".json"));

      if (matchingFiles.length === 0) {
        return 1;
      }

      // 最大連番を取得
      const maxSequence = Math.max(
        ...matchingFiles.map((f) => {
          const match = f.match(/_(\d{3})\.json$/);
          return match ? Number.parseInt(match[1], 10) : 0;
        }),
      );

      return maxSequence + 1;
    } catch {
      return 1; // ディレクトリが存在しない場合
    }
  },

  /**
   * パラメータマッチングでファイルを検索（Mockモード用）
   *
   * @param pattern パターン名
   * @param method HTTPメソッド
   * @param endpoint エンドポイントパターン
   * @param pathParams パスパラメータ
   * @param queryParams クエリパラメータ
   * @returns マッチしたファイル情報、なければnull
   */
  async findMatchingFile(
    pattern: string,
    method: string,
    endpoint: string,
    pathParams: Record<string, string>,
    queryParams: Record<string, string | string[]>,
    requestBody?: unknown,
  ): Promise<MatchingFileResult | null> {
    const fileName = endpointToFileName(endpoint);
    const patternDir = path.join(BASE_DIR, pattern);

    try {
      const files = await fs.readdir(patternDir);
      const matchingFiles = files.filter((f) => f.startsWith(`${fileName}_`) && f.endsWith(".json")).sort();

      for (const file of matchingFiles) {
        const filePath = path.join(pattern, file);
        const data = await storage.read(filePath);

        // メソッドチェック
        if (data.method !== method.toUpperCase()) {
          continue;
        }

        // パスパラメータの完全一致チェック
        if (!isDeepEqual(data.request.pathParams, pathParams)) {
          continue;
        }

        // クエリパラメータの完全一致チェック
        if (!isDeepEqual(data.request.queryParams, queryParams)) {
          continue;
        }

        // リクエストボディの完全一致チェック（指定された場合のみ）
        if (requestBody !== undefined) {
          if (!isDeepEqual(data.request.body, requestBody)) {
            continue;
          }
        }

        return { filePath, fileData: data };
      }

      return null;
    } catch {
      return null;
    }
  },

  /**
   * 既存ファイルを検索、なければ新規ファイルパスを返す（Recordモード用）
   * 同一パラメータなら上書き、新規パラメータなら新ファイル
   */
  async findOrCreateFile(
    pattern: string,
    method: string,
    endpoint: string,
    pathParams: Record<string, string>,
    queryParams: Record<string, string | string[]>,
    requestBody?: unknown,
  ): Promise<{ filePath: string; isNew: boolean }> {
    // 既存ファイルを検索
    const existing = await storage.findMatchingFile(pattern, method, endpoint, pathParams, queryParams, requestBody);

    if (existing) {
      return { filePath: existing.filePath, isNew: false };
    }

    // 新規ファイル
    const sequence = await storage.findNextSequence(pattern, endpoint);
    const filePath = buildFilePath(pattern, endpoint, sequence);
    return { filePath, isNew: true };
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
    eventBus.emitSSE("pattern_created", { name });
  },

  /**
   * パターン内のファイル一覧を取得
   */
  async getPatternFiles(pattern: string): Promise<FileInfo[]> {
    const files: FileInfo[] = [];
    const patternDir = path.join(BASE_DIR, pattern);

    try {
      const entries = await fs.readdir(patternDir);
      for (const entry of entries) {
        if (!entry.endsWith(".json")) continue;

        const filePath = path.join(patternDir, entry);
        try {
          const content = await fs.readFile(filePath, "utf-8");
          const data = JSON.parse(content) as FileData;
          const stat = await fs.stat(filePath);

          files.push({
            path: entry,
            method: data.method,
            endpoint: data.endpoint,
            status: data.response.status,
            size: stat.size,
            updatedAt: stat.mtime.toISOString(),
          });
        } catch {
          // パース失敗は無視
        }
      }
    } catch {
      // ディレクトリ読み取り失敗
    }

    return files;
  },

  /**
   * ファイルを削除
   */
  async deleteFile(filePath: string): Promise<void> {
    const fullPath = path.join(BASE_DIR, filePath);
    await fs.unlink(fullPath);
    // filePath形式: "pattern/filename.json"
    const parts = filePath.split("/");
    if (parts.length >= 2) {
      eventBus.emitSSE("file_deleted", {
        pattern: parts[0],
        filename: parts[parts.length - 1],
      });
    }
  },

  /**
   * ベースディレクトリを作成
   */
  async ensureBaseDir(): Promise<void> {
    await fs.mkdir(BASE_DIR, { recursive: true });
  },

  /**
   * パターンが存在するかチェック
   */
  async patternExists(name: string): Promise<boolean> {
    const dir = path.join(BASE_DIR, name);
    try {
      const stat = await fs.stat(dir);
      return stat.isDirectory();
    } catch {
      return false;
    }
  },

  /**
   * パターンのメタデータを取得
   */
  async getPatternMetadata(name: string): Promise<PatternMetadata | null> {
    const dir = path.join(BASE_DIR, name);
    try {
      const stat = await fs.stat(dir);
      if (!stat.isDirectory()) {
        return null;
      }

      const files = await storage.getPatternFiles(name);
      const latestUpdated =
        files.length > 0
          ? files.reduce((latest, f) => (f.updatedAt > latest ? f.updatedAt : latest), files[0].updatedAt)
          : stat.mtime.toISOString();

      return {
        name,
        filesCount: files.length,
        createdAt: stat.birthtime.toISOString(),
        updatedAt: latestUpdated,
      };
    } catch {
      return null;
    }
  },

  /**
   * パターンを複製
   */
  async duplicatePattern(source: string, destination: string): Promise<void> {
    const sourceDir = path.join(BASE_DIR, source);
    const destDir = path.join(BASE_DIR, destination);

    // 宛先が既に存在する場合はエラー
    if (await storage.patternExists(destination)) {
      throw new Error(`Pattern already exists: ${destination}`);
    }

    // 宛先ディレクトリを作成
    await fs.mkdir(destDir, { recursive: true });

    // ファイルをコピー
    const entries = await fs.readdir(sourceDir);
    for (const entry of entries) {
      const srcPath = path.join(sourceDir, entry);
      const destPath = path.join(destDir, entry);
      await fs.copyFile(srcPath, destPath);
    }

    eventBus.emitSSE("pattern_created", { name: destination });
  },

  /**
   * パターン名を変更
   */
  async renamePattern(oldName: string, newName: string): Promise<void> {
    const oldDir = path.join(BASE_DIR, oldName);
    const newDir = path.join(BASE_DIR, newName);

    // 新名が既に存在する場合はエラー
    if (await storage.patternExists(newName)) {
      throw new Error(`Pattern already exists: ${newName}`);
    }

    await fs.rename(oldDir, newDir);
    eventBus.emitSSE("pattern_renamed", { oldName, newName });
  },

  /**
   * パターンを削除
   */
  async deletePattern(name: string): Promise<void> {
    const dir = path.join(BASE_DIR, name);
    await fs.rm(dir, { recursive: true, force: true });
    eventBus.emitSSE("pattern_deleted", { name });
  },

  /**
   * フォーマットされたファイルサイズを取得
   */
  formatSize,

  /**
   * パターンディレクトリをzipにする
   *
   * @param pattern パターン名
   * @returns zipファイルのBuffer
   */
  async zipPatternDir(pattern: string): Promise<Buffer> {
    const patternDir = path.join(BASE_DIR, pattern);

    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      const archive = archiver("zip", { zlib: { level: 9 } });

      archive.on("data", (chunk: Buffer) => chunks.push(chunk));
      archive.on("end", () => resolve(Buffer.concat(chunks)));
      archive.on("error", reject);

      // パターンディレクトリ内のファイルを追加
      archive.directory(patternDir, false);
      archive.finalize();
    });
  },

  /**
   * zipを解凍してパターンディレクトリに展開
   *
   * @param zipBuffer zipファイルのBuffer
   * @param patternName パターン名
   * @returns 展開したファイル数
   */
  async extractZipToPattern(zipBuffer: Buffer, patternName: string): Promise<number> {
    const patternDir = path.join(BASE_DIR, patternName);

    // パターンディレクトリを作成
    await fs.mkdir(patternDir, { recursive: true });

    // 一時ファイルに書き出してから解凍
    const tempZipPath = path.join(BASE_DIR, `_temp_${Date.now()}.zip`);
    await fs.writeFile(tempZipPath, zipBuffer);

    let fileCount = 0;

    try {
      const directory = await unzipper.Open.file(tempZipPath);

      for (const file of directory.files) {
        // ディレクトリはスキップ
        if (file.type === "Directory") continue;

        // JSONファイルのみ展開
        const fileName = path.basename(file.path);
        if (!fileName.endsWith(".json")) continue;

        const destPath = path.join(patternDir, fileName);
        const content = await file.buffer();
        await fs.writeFile(destPath, content);
        fileCount++;
      }

      eventBus.emitSSE("pattern_created", { name: patternName });
      return fileCount;
    } finally {
      // 一時ファイルを削除
      await fs.unlink(tempZipPath).catch(() => {});
    }
  },
};
