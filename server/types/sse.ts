/**
 * SSEイベント種別
 */
export type SSEEventType =
  | "connected" // 接続完了（初期状態送信）
  | "mode_changed" // モード変更
  | "pattern_changed" // 現在のパターン変更
  | "pattern_created" // パターン作成
  | "pattern_deleted" // パターン削除
  | "pattern_renamed" // パターン名変更
  | "file_created" // ファイル作成（記録時）
  | "file_updated" // ファイル更新
  | "file_deleted"; // ファイル削除

/**
 * SSEイベント
 */
export interface SSEEvent {
  type: SSEEventType;
  data: unknown;
  timestamp: string;
}

/**
 * 接続完了イベントデータ
 */
export interface ConnectedEventData {
  mode: string;
  currentPattern: string | null;
  patterns: string[];
  files: Array<{
    filename: string;
    endpoint: string;
    method: string;
  }>;
}

/**
 * モード変更イベントデータ
 */
export interface ModeChangedEventData {
  mode: string;
}

/**
 * パターン変更イベントデータ
 */
export interface PatternChangedEventData {
  pattern: string | null;
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
