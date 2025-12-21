import fs from "node:fs/promises";
import path from "node:path";
import archiver from "archiver";
import { Mutex } from "async-mutex";
import unzipper from "unzipper";
import type { FileData } from "../types/file.js";
import { eventBus } from "./event-bus.js";

/**
 * Mutex for atomic file operations
 * Prevents race conditions when multiple requests try to create files simultaneously
 */
const writeMutex = new Mutex();

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
 * @param scenario シナリオ名
 * @param endpoint エンドポイントパターン（例: "/api/users/:id"）
 * @param sequence 連番（3桁0埋め）
 * @returns ファイルパス（例: "正常系/api_users_{id}_001.json"）
 */
export function buildFilePath(scenario: string, endpoint: string, sequence: number): string {
  const fileName = endpointToFileName(endpoint);
  const paddedSequence = String(sequence).padStart(3, "0");
  return path.join(scenario, `${fileName}_${paddedSequence}.json`);
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
 * シナリオメタデータ
 */
export interface ScenarioMetadata {
  name: string;
  filesCount: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * フォルダ情報
 */
export interface FolderInfo {
  name: string;
  scenariosCount: number;
}

/**
 * マッチしたファイルの結果
 */
export interface MatchingFileResult {
  filePath: string;
  fileData: FileData;
}

/**
 * Search result for scenario file search
 */
export interface SearchResult {
  filename: string;
  endpoint: string;
  method: string;
}

/**
 * オブジェクトの深い比較
 */
function isDeepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * ディレクトリがフォルダかどうかを判定
 * フォルダ = 直下に.jsonファイルがない（空ディレクトリも含む）
 */
async function isFolder(dirPath: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const hasJsonFiles = entries.some((e) => e.isFile() && e.name.endsWith(".json"));
    return !hasJsonFiles;
  } catch {
    return false;
  }
}

/**
 * ディレクトリがシナリオかどうかを判定
 * シナリオ = 直下に.jsonファイルがある
 */
async function isScenario(dirPath: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries.some((e) => e.isFile() && e.name.endsWith(".json"));
  } catch {
    return false;
  }
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
   * @param scenario シナリオ名
   * @param endpoint エンドポイントパターン（例: "/api/users/:id"）
   * @returns 次の連番（1始まり）
   */
  async findNextSequence(scenario: string, endpoint: string): Promise<number> {
    const fileName = endpointToFileName(endpoint);
    const scenarioDir = path.join(BASE_DIR, scenario);

    try {
      const files = await fs.readdir(scenarioDir);
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
   * @param scenario シナリオ名
   * @param method HTTPメソッド
   * @param endpoint エンドポイントパターン
   * @param pathParams パスパラメータ
   * @param queryParams クエリパラメータ
   * @returns マッチしたファイル情報、なければnull
   */
  async findMatchingFile(
    scenario: string,
    method: string,
    endpoint: string,
    pathParams: Record<string, string>,
    queryParams: Record<string, string | string[]>,
    requestBody?: unknown,
  ): Promise<MatchingFileResult | null> {
    const fileName = endpointToFileName(endpoint);
    const scenarioDir = path.join(BASE_DIR, scenario);

    try {
      const files = await fs.readdir(scenarioDir);
      const matchingFiles = files.filter((f) => f.startsWith(`${fileName}_`) && f.endsWith(".json")).sort();

      for (const file of matchingFiles) {
        const filePath = path.join(scenario, file);
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
    scenario: string,
    method: string,
    endpoint: string,
    pathParams: Record<string, string>,
    queryParams: Record<string, string | string[]>,
    requestBody?: unknown,
  ): Promise<{ filePath: string; isNew: boolean }> {
    // 既存ファイルを検索
    const existing = await storage.findMatchingFile(scenario, method, endpoint, pathParams, queryParams, requestBody);

    if (existing) {
      return { filePath: existing.filePath, isNew: false };
    }

    // 新規ファイル
    const sequence = await storage.findNextSequence(scenario, endpoint);
    const filePath = buildFilePath(scenario, endpoint, sequence);
    return { filePath, isNew: true };
  },

  /**
   * シナリオ一覧を取得（folder/scenario形式）
   * 全フォルダ内の全シナリオを "folder/scenario" 形式で返す
   */
  async listScenarios(): Promise<string[]> {
    try {
      const entries = await fs.readdir(BASE_DIR, { withFileTypes: true });
      const scenarios: string[] = [];

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const dirPath = path.join(BASE_DIR, entry.name);

        // フォルダの場合、中のシナリオを取得
        if (await isFolder(dirPath)) {
          const subScenarios = await storage.listScenariosInFolder(entry.name);
          for (const subScenario of subScenarios) {
            scenarios.push(`${entry.name}/${subScenario}`);
          }
        }
      }

      return scenarios;
    } catch {
      return [];
    }
  },

  /**
   * 新規シナリオを作成
   * @param name シナリオ名（"folder/scenario" 形式）
   */
  async createScenario(name: string): Promise<void> {
    // folder/scenario形式を処理
    const dir = path.join(BASE_DIR, name);
    await fs.mkdir(dir, { recursive: true });
    eventBus.emitSSE("scenario_created", { name });
  },

  /**
   * シナリオ内のファイル一覧を取得
   */
  async getScenarioFiles(scenario: string): Promise<FileInfo[]> {
    const files: FileInfo[] = [];
    const scenarioDir = path.join(BASE_DIR, scenario);

    try {
      const entries = await fs.readdir(scenarioDir);
      for (const entry of entries) {
        if (!entry.endsWith(".json")) continue;

        const filePath = path.join(scenarioDir, entry);
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
   * Search files in a scenario by text content
   * @param scenario Scenario name
   * @param query Search query (case-insensitive)
   * @returns Matching files
   */
  async searchScenarioFiles(scenario: string, query: string): Promise<SearchResult[]> {
    const results: SearchResult[] = [];
    const scenarioDir = path.join(BASE_DIR, scenario);
    const lowerQuery = query.toLowerCase();

    try {
      const entries = await fs.readdir(scenarioDir);
      for (const entry of entries) {
        if (!entry.endsWith(".json")) continue;

        const filePath = path.join(scenarioDir, entry);
        try {
          const content = await fs.readFile(filePath, "utf-8");

          // Text search (case-insensitive)
          if (content.toLowerCase().includes(lowerQuery)) {
            const data = JSON.parse(content) as FileData;
            results.push({
              filename: entry,
              endpoint: data.endpoint,
              method: data.method,
            });
          }
        } catch {
          // Skip files that can't be read or parsed
        }
      }
    } catch {
      // Directory read failure
    }

    return results;
  },

  /**
   * ファイルを削除
   */
  async deleteFile(filePath: string): Promise<void> {
    const fullPath = path.join(BASE_DIR, filePath);
    await fs.unlink(fullPath);
    // filePath形式: "folder/pattern/filename.json"
    const parts = filePath.split("/");
    if (parts.length >= 3) {
      // folder/pattern/filename.json
      eventBus.emitSSE("file_deleted", {
        pattern: `${parts[0]}/${parts[1]}`,
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
   * シナリオが存在するかチェック
   */
  async scenarioExists(name: string): Promise<boolean> {
    const dir = path.join(BASE_DIR, name);
    try {
      const stat = await fs.stat(dir);
      return stat.isDirectory();
    } catch {
      return false;
    }
  },

  /**
   * シナリオのメタデータを取得
   */
  async getScenarioMetadata(name: string): Promise<ScenarioMetadata | null> {
    const dir = path.join(BASE_DIR, name);
    try {
      const stat = await fs.stat(dir);
      if (!stat.isDirectory()) {
        return null;
      }

      const files = await storage.getScenarioFiles(name);
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
   * シナリオを複製
   */
  async duplicateScenario(source: string, destination: string): Promise<void> {
    const sourceDir = path.join(BASE_DIR, source);
    const destDir = path.join(BASE_DIR, destination);

    // 宛先が既に存在する場合はエラー
    if (await storage.scenarioExists(destination)) {
      throw new Error(`Scenario already exists: ${destination}`);
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

    eventBus.emitSSE("scenario_created", { name: destination });
  },

  /**
   * シナリオ名を変更
   */
  async renameScenario(oldName: string, newName: string): Promise<void> {
    const oldDir = path.join(BASE_DIR, oldName);
    const newDir = path.join(BASE_DIR, newName);

    // 新名が既に存在する場合はエラー
    if (await storage.scenarioExists(newName)) {
      throw new Error(`Scenario already exists: ${newName}`);
    }

    await fs.rename(oldDir, newDir);
    eventBus.emitSSE("scenario_renamed", { oldName, newName });
  },

  /**
   * シナリオを削除
   */
  async deleteScenario(name: string): Promise<void> {
    const dir = path.join(BASE_DIR, name);
    await fs.rm(dir, { recursive: true, force: true });
    eventBus.emitSSE("scenario_deleted", { name });
  },

  // ============================================================
  // フォルダ操作
  // ============================================================

  /**
   * フォルダ一覧を取得
   */
  async listFolders(): Promise<FolderInfo[]> {
    try {
      const entries = await fs.readdir(BASE_DIR, { withFileTypes: true });
      const folders: FolderInfo[] = [];

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const dirPath = path.join(BASE_DIR, entry.name);
        if (await isFolder(dirPath)) {
          const scenarios = await storage.listScenariosInFolder(entry.name);
          folders.push({
            name: entry.name,
            scenariosCount: scenarios.length,
          });
        }
      }

      return folders;
    } catch {
      return [];
    }
  },

  /**
   * フォルダ内のシナリオ一覧を取得
   */
  async listScenariosInFolder(folder: string): Promise<string[]> {
    const folderDir = path.join(BASE_DIR, folder);
    try {
      const entries = await fs.readdir(folderDir, { withFileTypes: true });
      const scenarios: string[] = [];

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const dirPath = path.join(folderDir, entry.name);
        if (await isScenario(dirPath)) {
          scenarios.push(entry.name);
        }
      }

      return scenarios;
    } catch {
      return [];
    }
  },

  /**
   * フォルダが存在するかチェック
   */
  async folderExists(name: string): Promise<boolean> {
    const dir = path.join(BASE_DIR, name);
    try {
      const stat = await fs.stat(dir);
      if (!stat.isDirectory()) return false;
      return await isFolder(dir);
    } catch {
      return false;
    }
  },

  /**
   * フォルダを作成
   */
  async createFolder(name: string): Promise<void> {
    const dir = path.join(BASE_DIR, name);
    await fs.mkdir(dir, { recursive: true });
    eventBus.emitSSE("folder_created", { name });
  },

  /**
   * フォルダを削除（中のパターンも全て削除）
   */
  async deleteFolder(name: string): Promise<void> {
    const dir = path.join(BASE_DIR, name);
    await fs.rm(dir, { recursive: true, force: true });
    eventBus.emitSSE("folder_deleted", { name });
  },

  /**
   * フォルダ名を変更
   */
  async renameFolder(oldName: string, newName: string): Promise<void> {
    const oldDir = path.join(BASE_DIR, oldName);
    const newDir = path.join(BASE_DIR, newName);

    // 新名が既に存在する場合はエラー
    if (await storage.folderExists(newName)) {
      throw new Error(`Folder already exists: ${newName}`);
    }

    await fs.rename(oldDir, newDir);
    eventBus.emitSSE("folder_renamed", { oldName, newName });
  },

  /**
   * ルート直下の旧シナリオをフォルダ構成に移行
   * 例: demo -> _demo/demo
   * 冪等性あり（再実行しても安全）
   */
  async migrateRootScenarios(): Promise<void> {
    try {
      const entries = await fs.readdir(BASE_DIR, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const dirPath = path.join(BASE_DIR, entry.name);

        // 直下に.jsonファイルがある = 旧シナリオ（移行対象）
        if (await isScenario(dirPath)) {
          const oldName = entry.name;
          const newFolderName = `_${oldName}`;
          const newScenarioPath = path.join(BASE_DIR, newFolderName, oldName);

          // 移行先が既に存在する場合はスキップ（冪等性）
          try {
            await fs.access(newScenarioPath);
            continue; // 既に移行済み
          } catch {
            // 存在しない = 移行が必要
          }

          // 新フォルダを作成
          await fs.mkdir(path.join(BASE_DIR, newFolderName), { recursive: true });

          // シナリオを移動
          await fs.rename(dirPath, newScenarioPath);
        }
      }
    } catch {
      // BASE_DIRが存在しない場合など
    }
  },

  /**
   * フォーマットされたファイルサイズを取得
   */
  formatSize,

  /**
   * フォルダをZIP化する（パターンのサブディレクトリ構造を保持）
   *
   * @param folderName フォルダ名
   * @returns zipファイルのBuffer
   */
  async zipFolderDir(folderName: string): Promise<Buffer> {
    const folderDir = path.join(BASE_DIR, folderName);

    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      const archive = archiver("zip", { zlib: { level: 9 } });

      archive.on("data", (chunk: Buffer) => chunks.push(chunk));
      archive.on("end", () => resolve(Buffer.concat(chunks)));
      archive.on("error", reject);

      // フォルダ内のパターンディレクトリ構造を保持してZIP化
      archive.directory(folderDir, false);
      archive.finalize();
    });
  },

  /**
   * ZIPを解凍してフォルダとして展開
   * 同名フォルダが存在する場合はサフィックスを付与
   *
   * @param zipBuffer zipファイルのBuffer
   * @param folderName フォルダ名
   * @returns 作成されたフォルダ名と展開したシナリオ数
   */
  async extractZipToFolder(
    zipBuffer: Buffer,
    folderName: string,
  ): Promise<{ actualFolderName: string; scenariosCount: number }> {
    // ユニークなフォルダ名を生成
    let actualFolderName = folderName;
    let suffix = 1;
    while (await storage.folderExists(actualFolderName)) {
      actualFolderName = `${folderName}_${suffix}`;
      suffix++;
    }

    const folderDir = path.join(BASE_DIR, actualFolderName);

    // フォルダを作成
    await fs.mkdir(folderDir, { recursive: true });

    // 一時ファイルに書き出してから解凍
    const tempZipPath = path.join(BASE_DIR, `_temp_${Date.now()}.zip`);
    await fs.writeFile(tempZipPath, zipBuffer);

    const scenarioNames = new Set<string>();

    try {
      const directory = await unzipper.Open.file(tempZipPath);

      for (const file of directory.files) {
        // ディレクトリエントリはスキップ
        if (file.type === "Directory") continue;

        // JSONファイルのみ展開
        if (!file.path.endsWith(".json")) continue;

        // パス構造を保持（scenario/file.json）
        const destPath = path.join(folderDir, file.path);
        await fs.mkdir(path.dirname(destPath), { recursive: true });

        const content = await file.buffer();
        await fs.writeFile(destPath, content);

        // シナリオ名を収集（最初のディレクトリ部分）
        const scenarioName = file.path.split("/")[0];
        if (scenarioName) {
          scenarioNames.add(scenarioName);
        }
      }

      const scenarioFullNames = Array.from(scenarioNames).map((p) => `${actualFolderName}/${p}`);
      eventBus.emitSSE("folder_created", {
        name: actualFolderName,
        scenariosCount: scenarioNames.size,
        scenarios: scenarioFullNames,
      });
      return { actualFolderName, scenariosCount: scenarioNames.size };
    } finally {
      // 一時ファイルを削除
      await fs.unlink(tempZipPath).catch(() => {});
    }
  },

  /**
   * Atomic find-and-write operation for Record mode
   * Prevents race conditions by holding a mutex during sequence number lookup and file write
   */
  async findAndWriteAtomic(
    scenario: string,
    method: string,
    endpoint: string,
    pathParams: Record<string, string>,
    queryParams: Record<string, string | string[]>,
    requestBody: unknown,
    fileData: FileData,
  ): Promise<{ filePath: string; isNew: boolean }> {
    const release = await writeMutex.acquire();
    try {
      const { filePath, isNew } = await storage.findOrCreateFile(
        scenario,
        method,
        endpoint,
        pathParams,
        queryParams,
        requestBody,
      );
      await storage.write(filePath, fileData);
      return { filePath, isNew };
    } finally {
      release();
    }
  },
};
