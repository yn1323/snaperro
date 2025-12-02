import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { state } from "./state.js";

const STATE_FILE = ".snaperro/state.json";

describe("StateManager", () => {
  beforeEach(async () => {
    // テスト前に状態ファイルを削除
    try {
      await fs.unlink(STATE_FILE);
    } catch {
      // 無視
    }
    // 状態をリセット
    state.reset();
  });

  afterEach(async () => {
    // テスト後に状態ファイルを削除
    try {
      await fs.unlink(STATE_FILE);
    } catch {
      // 無視
    }
  });

  describe("mode", () => {
    it("初期モードはproxy", () => {
      expect(state.getMode()).toBe("proxy");
    });

    it("モードを変更できる", async () => {
      await state.setMode("record");
      expect(state.getMode()).toBe("record");

      await state.setMode("mock");
      expect(state.getMode()).toBe("mock");
    });
  });

  describe("pattern", () => {
    it("初期パターンはnull", () => {
      expect(state.getPattern()).toBeNull();
    });

    it("パターンを変更できる", async () => {
      await state.setPattern("正常系フル");
      expect(state.getPattern()).toBe("正常系フル");
    });

    it("パターンをnullに戻せる", async () => {
      await state.setPattern("テスト");
      await state.setPattern(null);
      expect(state.getPattern()).toBeNull();
    });
  });

  describe("永続化", () => {
    it("save()で状態がファイルに保存される", async () => {
      await state.setMode("mock");
      await state.setPattern("テストパターン");

      const content = await fs.readFile(STATE_FILE, "utf-8");
      const saved = JSON.parse(content);

      expect(saved.mode).toBe("mock");
      expect(saved.currentPattern).toBe("テストパターン");
    });

    it("load()でファイルから状態が復元される", async () => {
      // ファイルを直接作成
      await fs.mkdir(path.dirname(STATE_FILE), { recursive: true });
      await fs.writeFile(
        STATE_FILE,
        JSON.stringify({
          mode: "record",
          currentPattern: "復元テスト",
        }),
        "utf-8",
      );

      await state.load();

      expect(state.getMode()).toBe("record");
      expect(state.getPattern()).toBe("復元テスト");
    });

    it("ファイルが存在しない場合はデフォルト値を使用", async () => {
      // ファイルがない状態でload
      await state.load();

      expect(state.getMode()).toBe("proxy");
      expect(state.getPattern()).toBeNull();
    });

    it("setMode()で自動的にファイルが更新される", async () => {
      // ファイルが存在しないことを確認
      try {
        await fs.unlink(STATE_FILE);
      } catch {
        // 無視
      }

      await state.setMode("record");

      const content = await fs.readFile(STATE_FILE, "utf-8");
      const saved = JSON.parse(content);

      expect(saved.mode).toBe("record");
    });

    it("setPattern()で自動的にファイルが更新される", async () => {
      await state.setPattern("自動保存テスト");

      const content = await fs.readFile(STATE_FILE, "utf-8");
      const saved = JSON.parse(content);

      expect(saved.currentPattern).toBe("自動保存テスト");
    });
  });

  describe("getStatus", () => {
    it("現在の状態を取得できる", async () => {
      await state.setMode("mock");
      await state.setPattern("正常系フル");

      const status = state.getStatus();
      expect(status).toEqual({
        mode: "mock",
        pattern: "正常系フル",
      });
    });
  });

  describe("reset", () => {
    it("状態をデフォルト値にリセットできる", async () => {
      await state.setMode("mock");
      await state.setPattern("テスト");

      state.reset();

      expect(state.getMode()).toBe("proxy");
      expect(state.getPattern()).toBeNull();
    });
  });
});
