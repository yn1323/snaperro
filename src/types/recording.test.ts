import { describe, expect, it } from "vitest";
import { RecordedDataSchema, RecordedRequestSchema, RecordedResponseSchema } from "./recording.js";

describe("RecordedRequestSchema", () => {
  it("有効なGETリクエストを受け入れる", () => {
    const validRequest = {
      method: "GET",
      url: "/api/users",
      headers: {
        "Content-Type": "application/json",
      },
    };

    const result = RecordedRequestSchema.safeParse(validRequest);
    expect(result.success).toBe(true);
  });

  it("ボディ付きのPOSTリクエストを受け入れる", () => {
    const validRequest = {
      method: "POST",
      url: "/api/users",
      headers: {
        "Content-Type": "application/json",
      },
      body: {
        name: "田中太郎",
        email: "tanaka@example.com",
      },
    };

    const result = RecordedRequestSchema.safeParse(validRequest);
    expect(result.success).toBe(true);
  });

  it("headersが空でも受け入れる", () => {
    const validRequest = {
      method: "GET",
      url: "/api/health",
      headers: {},
    };

    const result = RecordedRequestSchema.safeParse(validRequest);
    expect(result.success).toBe(true);
  });
});

describe("RecordedResponseSchema", () => {
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

    const result = RecordedResponseSchema.safeParse(validResponse);
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

    const result = RecordedResponseSchema.safeParse(validResponse);
    expect(result.success).toBe(true);
  });

  it("無効なステータスコードを拒否する（範囲外）", () => {
    const invalidResponse = {
      status: 999,
      headers: {},
      body: null,
    };

    const result = RecordedResponseSchema.safeParse(invalidResponse);
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

    const result = RecordedResponseSchema.safeParse(validResponse);
    expect(result.success).toBe(true);
  });
});

describe("RecordedDataSchema", () => {
  it("有効な録画データを受け入れる", () => {
    const validData = {
      request: {
        method: "POST",
        url: "/api/users",
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
      recordedAt: "2024-01-15T10:30:00.000Z",
    };

    const result = RecordedDataSchema.safeParse(validData);
    expect(result.success).toBe(true);
  });

  it("無効な日時フォーマットを拒否する", () => {
    const invalidData = {
      request: {
        method: "GET",
        url: "/api/users",
        headers: {},
      },
      response: {
        status: 200,
        headers: {},
        body: [],
      },
      recordedAt: "invalid-date",
    };

    const result = RecordedDataSchema.safeParse(invalidData);
    expect(result.success).toBe(false);
  });

  it("recordedAtが欠けていると拒否する", () => {
    const invalidData = {
      request: {
        method: "GET",
        url: "/api/users",
        headers: {},
      },
      response: {
        status: 200,
        headers: {},
        body: [],
      },
    };

    const result = RecordedDataSchema.safeParse(invalidData);
    expect(result.success).toBe(false);
  });
});
