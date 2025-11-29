import { beforeEach, describe, expect, it } from "vitest";
import { state } from "./state.js";

describe("StateManager", () => {
  beforeEach(() => {
    // 各テスト前に状態をリセット
    state.setMode("proxy");
    state.setPattern("");
  });

  describe("mode", () => {
    it("初期モードはproxy", () => {
      expect(state.getMode()).toBe("proxy");
    });

    it("モードを変更できる", () => {
      state.setMode("record");
      expect(state.getMode()).toBe("record");

      state.setMode("mock");
      expect(state.getMode()).toBe("mock");
    });
  });

  describe("pattern", () => {
    it("初期パターンは空文字", () => {
      expect(state.getPattern()).toBe("");
    });

    it("パターンを変更できる", () => {
      state.setPattern("正常系フル");
      expect(state.getPattern()).toBe("正常系フル");
    });
  });

  describe("counter", () => {
    it("カウンターは1から始まる", () => {
      const count = state.incrementCounter("GET", "/api/users");
      expect(count).toBe(1);
    });

    it("同じパスでカウンターがインクリメントされる", () => {
      expect(state.incrementCounter("GET", "/api/users")).toBe(1);
      expect(state.incrementCounter("GET", "/api/users")).toBe(2);
      expect(state.incrementCounter("GET", "/api/users")).toBe(3);
    });

    it("異なるパスは別々にカウントされる", () => {
      expect(state.incrementCounter("GET", "/api/users")).toBe(1);
      expect(state.incrementCounter("GET", "/api/orders")).toBe(1);
      expect(state.incrementCounter("GET", "/api/users")).toBe(2);
    });

    it("異なるメソッドは別々にカウントされる", () => {
      expect(state.incrementCounter("GET", "/api/users")).toBe(1);
      expect(state.incrementCounter("POST", "/api/users")).toBe(1);
      expect(state.incrementCounter("GET", "/api/users")).toBe(2);
    });

    it("メソッドは大文字に正規化される", () => {
      expect(state.incrementCounter("get", "/api/users")).toBe(1);
      expect(state.incrementCounter("GET", "/api/users")).toBe(2);
    });

    it("getCounterで現在のカウント値を取得できる", () => {
      state.incrementCounter("GET", "/api/users");
      state.incrementCounter("GET", "/api/users");
      expect(state.getCounter("GET", "/api/users")).toBe(2);
    });

    it("存在しないキーのgetCounterは0を返す", () => {
      expect(state.getCounter("GET", "/api/unknown")).toBe(0);
    });
  });

  describe("カウンターリセット", () => {
    it("モード変更時にカウンターがリセットされる", () => {
      state.incrementCounter("GET", "/api/users");
      state.incrementCounter("GET", "/api/users");
      expect(state.getCounter("GET", "/api/users")).toBe(2);

      state.setMode("record");
      expect(state.getCounter("GET", "/api/users")).toBe(0);
    });

    it("パターン変更時にカウンターがリセットされる", () => {
      state.incrementCounter("GET", "/api/users");
      state.incrementCounter("GET", "/api/users");
      expect(state.getCounter("GET", "/api/users")).toBe(2);

      state.setPattern("エラー系");
      expect(state.getCounter("GET", "/api/users")).toBe(0);
    });

    it("resetCounterでカウンターをリセットできる", () => {
      state.incrementCounter("GET", "/api/users");
      state.incrementCounter("POST", "/api/orders");

      state.resetCounter();

      expect(state.getCounter("GET", "/api/users")).toBe(0);
      expect(state.getCounter("POST", "/api/orders")).toBe(0);
    });
  });

  describe("getStatus", () => {
    it("現在の状態を取得できる", () => {
      state.setMode("mock");
      state.setPattern("正常系フル");

      const status = state.getStatus();
      expect(status).toEqual({
        mode: "mock",
        pattern: "正常系フル",
      });
    });
  });
});
