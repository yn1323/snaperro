/**
 * クライアント側の型定義
 * サーバーの型定義と対応するが、独立して定義する
 */

/**
 * モード
 */
export type Mode = "proxy" | "record" | "mock";

/**
 * HTTPメソッド
 */
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS" | "HEAD";

/**
 * ファイル情報（一覧表示用）
 */
export interface FileInfo {
  filename: string;
  endpoint: string;
  method: string;
}

/**
 * パターン情報
 */
export interface PatternInfo {
  name: string;
  filesCount: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * アプリケーション状態（SSEで管理）
 */
export interface SnaperroState {
  version: string;
  mode: Mode;
  currentPattern: string | null;
  patterns: string[];
  files: FileInfo[];
}

/**
 * リクエスト情報
 */
export interface FileRequest {
  pathParams: Record<string, string>;
  queryParams: Record<string, string | string[]>;
  headers: Record<string, string>;
  body: unknown | null;
}

/**
 * レスポンス情報
 */
export interface FileResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

/**
 * ファイルデータ（エディタ用）
 */
export interface FileData {
  endpoint: string;
  method: HttpMethod;
  request: FileRequest;
  response: FileResponse;
}

// ============================================================
// SSEイベント型
// ============================================================

/**
 * SSEイベント種別
 */
export type SSEEventType =
  | "connected"
  | "mode_changed"
  | "pattern_changed"
  | "pattern_created"
  | "pattern_deleted"
  | "pattern_renamed"
  | "file_created"
  | "file_updated"
  | "file_deleted";

/**
 * 接続完了イベントデータ
 */
export interface ConnectedEventData {
  version: string;
  mode: Mode;
  currentPattern: string | null;
  patterns: string[];
  files: FileInfo[];
}

/**
 * モード変更イベントデータ
 */
export interface ModeChangedEventData {
  mode: Mode;
}

/**
 * パターン変更イベントデータ
 */
export interface PatternChangedEventData {
  pattern: string | null;
  files: FileInfo[];
}

/**
 * パターン作成イベントデータ
 */
export interface PatternCreatedEventData {
  name: string;
}

/**
 * パターン削除イベントデータ
 */
export interface PatternDeletedEventData {
  name: string;
}

/**
 * パターン名変更イベントデータ
 */
export interface PatternRenamedEventData {
  oldName: string;
  newName: string;
}

/**
 * ファイル作成/更新イベントデータ
 */
export interface FileChangedEventData {
  pattern: string;
  filename: string;
  endpoint: string;
  method: string;
}

/**
 * ファイル削除イベントデータ
 */
export interface FileDeletedEventData {
  pattern: string;
  filename: string;
}
