/**
 * 動作モード
 */
export type Mode = "proxy" | "record" | "mock";

/**
 * 状態管理クラス
 * モード、パターン、リクエストカウンターを管理
 */
class StateManager {
  private mode: Mode = "proxy";
  private pattern = "";
  private counter: Map<string, number> = new Map();

  /**
   * 現在のモードを取得
   */
  getMode(): Mode {
    return this.mode;
  }

  /**
   * モードを設定
   * カウンターもリセットされる
   */
  setMode(mode: Mode): void {
    this.mode = mode;
    this.resetCounter();
  }

  /**
   * 現在のパターンを取得
   */
  getPattern(): string {
    return this.pattern;
  }

  /**
   * パターンを設定
   * カウンターもリセットされる
   */
  setPattern(pattern: string): void {
    this.pattern = pattern;
    this.resetCounter();
  }

  /**
   * カウンターをインクリメントして現在値を返す
   * @param method HTTPメソッド
   * @param path リクエストパス
   * @returns インクリメント後のカウント値
   */
  incrementCounter(method: string, path: string): number {
    const key = `${method.toUpperCase()}:${path}`;
    const current = this.counter.get(key) ?? 0;
    const next = current + 1;
    this.counter.set(key, next);
    return next;
  }

  /**
   * 特定のキーのカウント値を取得（テスト用）
   */
  getCounter(method: string, path: string): number {
    const key = `${method.toUpperCase()}:${path}`;
    return this.counter.get(key) ?? 0;
  }

  /**
   * カウンターをリセット
   */
  resetCounter(): void {
    this.counter.clear();
  }

  /**
   * 現在の状態を取得
   */
  getStatus() {
    return {
      mode: this.mode,
      pattern: this.pattern,
    };
  }
}

// シングルトンインスタンス
export const state = new StateManager();
