import { describe, expect, it } from "vitest";
import { FileDataSchema, FileRequestSchema, FileResponseSchema } from "./file.js";

describe("FileRequestSchema", () => {
  it("有効なGETリクエストを受け入れる", () => {
    const validRequest = {
      pathParams: {},
      queryParams: {},
      headers: {
        "Content-Type": "application/json",
      },
      body: null,
    };

    const result = FileRequestSchema.safeParse(validRequest);
    expect(result.success).toBe(true);
  });

  it("ボディ付きのPOSTリクエストを受け入れる", () => {
    const validRequest = {
      pathParams: {},
      queryParams: {},
      headers: {
        "Content-Type": "application/json",
      },
      body: {
        name: "田中太郎",
        email: "tanaka@example.com",
      },
    };

    const result = FileRequestSchema.safeParse(validRequest);
    expect(result.success).toBe(true);
  });

  it("headersが空でも受け入れる", () => {
    const validRequest = {
      pathParams: {},
      queryParams: {},
      headers: {},
      body: null,
    };

    const result = FileRequestSchema.safeParse(validRequest);
    expect(result.success).toBe(true);
  });

  it("パスパラメータとクエリパラメータを受け入れる", () => {
    const validRequest = {
      pathParams: { id: "123" },
      queryParams: { page: "1", tags: ["a", "b"] },
      headers: {},
      body: null,
    };

    const result = FileRequestSchema.safeParse(validRequest);
    expect(result.success).toBe(true);
  });
});

describe("FileResponseSchema", () => {
  it("有効なレスポンスを受け入れる", () => {
    const validResponse = {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
      body: {
        id: 1,
        name: "田中太郎",
      },
    };

    const result = FileResponseSchema.safeParse(validResponse);
    expect(result.success).toBe(true);
  });

  it("エラーレスポンスを受け入れる", () => {
    const validResponse = {
      status: 404,
      headers: {},
      body: {
        error: "Not found",
      },
    };

    const result = FileResponseSchema.safeParse(validResponse);
    expect(result.success).toBe(true);
  });

  it("無効なステータスコードを拒否する（範囲外）", () => {
    const invalidResponse = {
      status: 999,
      headers: {},
      body: null,
    };

    const result = FileResponseSchema.safeParse(invalidResponse);
    expect(result.success).toBe(false);
  });

  it("配列のボディを受け入れる", () => {
    const validResponse = {
      status: 200,
      headers: {},
      body: [
        { id: 1, name: "田中" },
        { id: 2, name: "佐藤" },
      ],
    };

    const result = FileResponseSchema.safeParse(validResponse);
    expect(result.success).toBe(true);
  });
});

describe("FileDataSchema", () => {
  it("有効な記録データを受け入れる", () => {
    const validData = {
      endpoint: "/api/users",
      method: "POST",
      request: {
        pathParams: {},
        queryParams: {},
        headers: {
          "Content-Type": "application/json",
        },
        body: {
          name: "田中太郎",
        },
      },
      response: {
        status: 201,
        headers: {
          "Content-Type": "application/json",
        },
        body: {
          id: 123,
          name: "田中太郎",
        },
      },
    };

    const result = FileDataSchema.safeParse(validData);
    expect(result.success).toBe(true);
  });

  it("パスパラメータ付きの記録データを受け入れる", () => {
    const validData = {
      endpoint: "/api/users/:id",
      method: "GET",
      request: {
        pathParams: { id: "123" },
        queryParams: {},
        headers: {},
        body: null,
      },
      response: {
        status: 200,
        headers: {},
        body: { id: 123, name: "田中太郎" },
      },
    };

    const result = FileDataSchema.safeParse(validData);
    expect(result.success).toBe(true);
  });

  it("無効なHTTPメソッドを拒否する", () => {
    const invalidData = {
      endpoint: "/api/users",
      method: "INVALID",
      request: {
        pathParams: {},
        queryParams: {},
        headers: {},
        body: null,
      },
      response: {
        status: 200,
        headers: {},
        body: [],
      },
    };

    const result = FileDataSchema.safeParse(invalidData);
    expect(result.success).toBe(false);
  });

  it("endpointが欠けていると拒否する", () => {
    const invalidData = {
      method: "GET",
      request: {
        pathParams: {},
        queryParams: {},
        headers: {},
        body: null,
      },
      response: {
        status: 200,
        headers: {},
        body: [],
      },
    };

    const result = FileDataSchema.safeParse(invalidData);
    expect(result.success).toBe(false);
  });
});
