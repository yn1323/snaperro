import fs from "node:fs/promises";
import path from "node:path";
import type { Mode } from "../../shared/types/mode.js";
import { eventBus } from "./event-bus.js";
import { storage } from "./storage.js";

export type { Mode };

const STATE_FILE = ".snaperro/state.json";

/**
 * 永続化される状態の型
 */
interface PersistedState {
  mode: Mode;
  currentScenario: string | null;
}

/**
 * 状態管理クラス
 * モードとシナリオを管理し、ファイルに永続化
 */
class StateManager {
  private mode: Mode = "smart";
  private scenario: string | null = null;

  /**
   * 現在のモードを取得
   */
  getMode(): Mode {
    return this.mode;
  }

  /**
   * モードを設定（自動保存）
   */
  async setMode(mode: Mode): Promise<void> {
    this.mode = mode;
    await this.save();
    eventBus.emitSSE("mode_changed", { mode });
  }

  /**
   * 現在のシナリオを取得
   */
  getScenario(): string | null {
    return this.scenario;
  }

  /**
   * シナリオを設定（自動保存）
   */
  async setScenario(scenario: string | null): Promise<void> {
    this.scenario = scenario;
    await this.save();

    // ファイルリストも一緒に送信
    const files = scenario ? await storage.getScenarioFiles(scenario) : [];
    eventBus.emitSSE("scenario_changed", {
      scenario,
      files: files.map((f) => ({
        filename: f.path,
        endpoint: f.endpoint,
        method: f.method,
      })),
    });
  }

  /**
   * 状態をファイルに保存
   */
  async save(): Promise<void> {
    const state: PersistedState = {
      mode: this.mode,
      currentScenario: this.scenario,
    };

    const dir = path.dirname(STATE_FILE);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
  }

  /**
   * 状態をファイルから復元
   */
  async load(): Promise<void> {
    try {
      const content = await fs.readFile(STATE_FILE, "utf-8");
      const state = JSON.parse(content) as PersistedState;
      this.mode = state.mode;
      this.scenario = state.currentScenario;
    } catch {
      // ファイルが存在しない場合はデフォルト値を使用
      this.mode = "smart";
      this.scenario = null;
    }
  }

  /**
   * 状態をリセット（テスト用）
   */
  reset(): void {
    this.mode = "smart";
    this.scenario = null;
  }

  /**
   * 現在の状態を取得
   */
  getStatus() {
    return {
      mode: this.mode,
      scenario: this.scenario,
    };
  }
}

// シングルトンインスタンス
export const state = new StateManager();
