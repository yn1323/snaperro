import { describe, expect, it } from "vitest";
import type { ApiConfig } from "../types/config.js";
import { findMatchingApi } from "./matcher.js";

// テスト用のAPI設定
const testApis: Record<string, ApiConfig> = {
  userRead: {
    name: "ユーザー取得",
    target: "https://user-api.example.com",
    match: ["GET /api/users/**"],
  },
  userWrite: {
    name: "ユーザー作成・更新",
    target: "https://user-write-api.example.com",
    match: ["POST /api/users/**", "PUT /api/users/**", "DELETE /api/users/**"],
  },
  orderService: {
    name: "注文サービス",
    target: "https://order-api.example.com",
    match: ["/api/orders/**"],
  },
  itemsService: {
    name: "アイテムサービス",
    target: "https://items-api.example.com",
    match: ["/api/*/items"],
  },
  exactPath: {
    name: "完全一致パス",
    target: "https://exact-api.example.com",
    match: ["POST /api/users"],
  },
};

describe("findMatchingApi", () => {
  describe("設計書のマッチング例", () => {
    it('"/api/users/**" は GET /api/users にマッチ', () => {
      const result = findMatchingApi("GET", "/api/users", testApis);
      expect(result).not.toBeNull();
      expect(result?.apiKey).toBe("userRead");
    });

    it('"/api/users/**" は POST /api/users にマッチ', () => {
      const result = findMatchingApi("POST", "/api/users", testApis);
      expect(result).not.toBeNull();
      expect(result?.apiKey).toBe("userWrite");
    });

    it('"/api/users/**" は GET /api/users/123 にマッチ', () => {
      const result = findMatchingApi("GET", "/api/users/123", testApis);
      expect(result).not.toBeNull();
      expect(result?.apiKey).toBe("userRead");
    });

    it('"GET /api/users/**" は GET /api/users にマッチ', () => {
      const result = findMatchingApi("GET", "/api/users", testApis);
      expect(result).not.toBeNull();
      expect(result?.apiKey).toBe("userRead");
    });

    it('"GET /api/users/**" は POST /api/users にマッチしない（userWriteにマッチ）', () => {
      const result = findMatchingApi("POST", "/api/users", testApis);
      expect(result).not.toBeNull();
      expect(result?.apiKey).toBe("userWrite");
    });

    it('"POST /api/users" は POST /api/users にマッチ', () => {
      const result = findMatchingApi("POST", "/api/users", testApis);
      expect(result).not.toBeNull();
      // userWriteが先にマッチするので、exactPathではない
      expect(result?.apiKey).toBe("userWrite");
    });

    it('"/api/*/items" は GET /api/products/items にマッチ', () => {
      // orderServiceより先にitemsServiceがマッチするパスを使用
      const result = findMatchingApi("GET", "/api/products/items", testApis);
      expect(result).not.toBeNull();
      expect(result?.apiKey).toBe("itemsService");
    });

    it('"/api/*/items" は GET /api/orders/123/items にマッチしない', () => {
      const result = findMatchingApi("GET", "/api/orders/123/items", testApis);
      // itemsServiceにはマッチしないが、orderServiceにマッチする
      expect(result).not.toBeNull();
      expect(result?.apiKey).toBe("orderService");
    });
  });

  describe("メソッド指定なしパターン", () => {
    it('"/api/orders/**" は全メソッドにマッチ', () => {
      expect(findMatchingApi("GET", "/api/orders/123", testApis)?.apiKey).toBe("orderService");
      expect(findMatchingApi("POST", "/api/orders", testApis)?.apiKey).toBe("orderService");
      expect(findMatchingApi("PUT", "/api/orders/123", testApis)?.apiKey).toBe("orderService");
      expect(findMatchingApi("DELETE", "/api/orders/123", testApis)?.apiKey).toBe("orderService");
    });
  });

  describe("マッチしないケース", () => {
    it("定義されていないパスはnullを返す", () => {
      const result = findMatchingApi("GET", "/api/unknown", testApis);
      expect(result).toBeNull();
    });

    it("空のapis設定ではnullを返す", () => {
      const result = findMatchingApi("GET", "/api/users", {});
      expect(result).toBeNull();
    });
  });

  describe("メソッドの大文字小文字", () => {
    it("小文字のメソッドでもマッチする", () => {
      const result = findMatchingApi("get", "/api/users", testApis);
      expect(result).not.toBeNull();
      expect(result?.apiKey).toBe("userRead");
    });
  });
});
