import { describe, expect, it } from "vitest";
import type { ApiConfig } from "../types/config.js";
import { extractPathParams, findMatchingApi, parseRoute } from "./matcher.js";

describe("parseRoute", () => {
  it("パスパラメータなしのパターンをパースする", () => {
    const result = parseRoute("/api/users");
    expect(result.method).toBeNull();
    expect(result.path).toBe("/api/users");
    expect(result.paramNames).toEqual([]);
    expect("/api/users".match(result.regex)).not.toBeNull();
    expect("/api/users/123".match(result.regex)).toBeNull();
  });

  it("単一のパスパラメータをパースする", () => {
    const result = parseRoute("/api/users/:id");
    expect(result.method).toBeNull();
    expect(result.path).toBe("/api/users/:id");
    expect(result.paramNames).toEqual(["id"]);
    expect("/api/users/123".match(result.regex)).not.toBeNull();
    expect("/api/users".match(result.regex)).toBeNull();
  });

  it("複数のパスパラメータをパースする", () => {
    const result = parseRoute("/api/users/:userId/orders/:orderId");
    expect(result.paramNames).toEqual(["userId", "orderId"]);
    expect("/api/users/123/orders/456".match(result.regex)).not.toBeNull();
    expect("/api/users/123/orders".match(result.regex)).toBeNull();
  });

  it("メソッド指定付きパターンをパースする", () => {
    const result = parseRoute("GET /api/users/:id");
    expect(result.method).toBe("GET");
    expect(result.path).toBe("/api/users/:id");
    expect(result.paramNames).toEqual(["id"]);
  });

  it("小文字のメソッドも大文字に正規化する", () => {
    const result = parseRoute("get /api/users");
    expect(result.method).toBe("GET");
  });

  it("全HTTPメソッドを認識する", () => {
    const methods = ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"];
    for (const method of methods) {
      const result = parseRoute(`${method} /api/test`);
      expect(result.method).toBe(method);
    }
  });
});

describe("extractPathParams", () => {
  it("単一のパスパラメータを抽出する", () => {
    const parsed = parseRoute("/api/users/:id");
    const params = extractPathParams("/api/users/123", parsed);
    expect(params).toEqual({ id: "123" });
  });

  it("複数のパスパラメータを抽出する", () => {
    const parsed = parseRoute("/api/users/:userId/orders/:orderId");
    const params = extractPathParams("/api/users/123/orders/456", parsed);
    expect(params).toEqual({ userId: "123", orderId: "456" });
  });

  it("マッチしない場合はnullを返す", () => {
    const parsed = parseRoute("/api/users/:id");
    const params = extractPathParams("/api/orders/123", parsed);
    expect(params).toBeNull();
  });

  it("パスパラメータなしの場合は空オブジェクトを返す", () => {
    const parsed = parseRoute("/api/users");
    const params = extractPathParams("/api/users", parsed);
    expect(params).toEqual({});
  });

  it("特殊文字を含むパラメータ値を抽出する", () => {
    const parsed = parseRoute("/api/users/:id");
    const params = extractPathParams("/api/users/user-123_abc", parsed);
    expect(params).toEqual({ id: "user-123_abc" });
  });
});

// テスト用のAPI設定（新しいルートパターン形式）
const testApis: Record<string, ApiConfig> = {
  userApi: {
    name: "ユーザーAPI",
    target: "https://user-api.example.com",
    routes: ["/api/users/:id", "/api/users"],
  },
  orderApi: {
    name: "注文API",
    target: "https://order-api.example.com",
    routes: ["GET /api/orders/:id", "POST /api/orders"],
  },
  nestedApi: {
    name: "ネストAPI",
    target: "https://nested-api.example.com",
    routes: ["/api/users/:userId/orders/:orderId"],
  },
};

describe("findMatchingApi", () => {
  describe("パスパラメータのマッチング", () => {
    it("パスパラメータを含む結果を返す", () => {
      const result = findMatchingApi("GET", "/api/users/123", testApis);
      expect(result).not.toBeNull();
      expect(result?.apiKey).toBe("userApi");
      expect(result?.pathParams).toEqual({ id: "123" });
      expect(result?.matchedRoute).toBe("/api/users/:id");
    });

    it("パスパラメータなしのルートにマッチする", () => {
      const result = findMatchingApi("GET", "/api/users", testApis);
      expect(result).not.toBeNull();
      expect(result?.apiKey).toBe("userApi");
      expect(result?.pathParams).toEqual({});
      expect(result?.matchedRoute).toBe("/api/users");
    });

    it("複数のパスパラメータを抽出する", () => {
      const result = findMatchingApi("GET", "/api/users/123/orders/456", testApis);
      expect(result).not.toBeNull();
      expect(result?.apiKey).toBe("nestedApi");
      expect(result?.pathParams).toEqual({ userId: "123", orderId: "456" });
    });
  });

  describe("メソッド指定のマッチング", () => {
    it("GETメソッド指定のルートにGETでマッチする", () => {
      const result = findMatchingApi("GET", "/api/orders/123", testApis);
      expect(result).not.toBeNull();
      expect(result?.apiKey).toBe("orderApi");
    });

    it("POSTメソッド指定のルートにGETでマッチしない", () => {
      // POST /api/ordersは定義されているが、GET /api/ordersは定義されていない
      const result = findMatchingApi("GET", "/api/orders", testApis);
      expect(result).toBeNull();
    });

    it("POSTメソッド指定のルートにPOSTでマッチする", () => {
      const result = findMatchingApi("POST", "/api/orders", testApis);
      expect(result).not.toBeNull();
      expect(result?.apiKey).toBe("orderApi");
    });

    it("メソッド指定なしのルートは全メソッドにマッチする", () => {
      expect(findMatchingApi("GET", "/api/users/123", testApis)?.apiKey).toBe("userApi");
      expect(findMatchingApi("POST", "/api/users/123", testApis)?.apiKey).toBe("userApi");
      expect(findMatchingApi("PUT", "/api/users/123", testApis)?.apiKey).toBe("userApi");
      expect(findMatchingApi("DELETE", "/api/users/123", testApis)?.apiKey).toBe("userApi");
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

    it("パターン形状が一致しない場合はnullを返す", () => {
      // /api/users/:id は /api/users にマッチしない（別ルートとして定義がある場合のみ）
      // ここでは /api/users/123/extra という形状がどのパターンにもマッチしないことを確認
      const result = findMatchingApi("GET", "/api/unknown/path/extra", testApis);
      expect(result).toBeNull();
    });
  });

  describe("メソッドの大文字小文字", () => {
    it("小文字のメソッドでもマッチする", () => {
      const result = findMatchingApi("get", "/api/users/123", testApis);
      expect(result).not.toBeNull();
      expect(result?.apiKey).toBe("userApi");
    });
  });

  describe("マッチ順序", () => {
    it("先に定義されたルートが優先される", () => {
      // userApiの "/api/users/:id" が "/api/users" より先に定義されている
      // /api/users/123 は両方にマッチしうるが、:idパターンが先にマッチ
      const result = findMatchingApi("GET", "/api/users/123", testApis);
      expect(result?.matchedRoute).toBe("/api/users/:id");
    });
  });
});
