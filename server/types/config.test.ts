import { describe, expect, it } from "vitest";
import { ApiConfigSchema, defineConfig, SnaperroConfigSchema } from "./config.js";

describe("ApiConfigSchema", () => {
  it("有効なAPI設定を受け入れる", () => {
    const validConfig = {
      name: "ユーザーサービス",
      target: "https://api.example.com",
      routes: ["/api/users/**"],
    };

    const result = ApiConfigSchema.safeParse(validConfig);
    expect(result.success).toBe(true);
  });

  it("ヘッダー付きのAPI設定を受け入れる", () => {
    const validConfig = {
      name: "認証サービス",
      target: "https://auth.example.com",
      headers: {
        "X-Api-Key": "secret-key",
        Authorization: "Bearer token",
      },
      routes: ["GET /auth/**", "POST /auth/**"],
    };

    const result = ApiConfigSchema.safeParse(validConfig);
    expect(result.success).toBe(true);
  });

  it("空のnameを拒否する", () => {
    const invalidConfig = {
      name: "",
      target: "https://api.example.com",
      routes: ["/api/**"],
    };

    const result = ApiConfigSchema.safeParse(invalidConfig);
    expect(result.success).toBe(false);
  });

  it("無効なURLを拒否する", () => {
    const invalidConfig = {
      name: "テスト",
      target: "not-a-url",
      routes: ["/api/**"],
    };

    const result = ApiConfigSchema.safeParse(invalidConfig);
    expect(result.success).toBe(false);
  });

  it("空のmatch配列を拒否する", () => {
    const invalidConfig = {
      name: "テスト",
      target: "https://api.example.com",
      routes: [],
    };

    const result = ApiConfigSchema.safeParse(invalidConfig);
    expect(result.success).toBe(false);
  });
});

describe("SnaperroConfigSchema", () => {
  it("有効な設定を受け入れる", () => {
    const validConfig = {
      port: 3333,
      apis: {
        userService: {
          name: "ユーザーサービス",
          target: "https://api.example.com",
          routes: ["/api/users/**"],
        },
      },
    };

    const result = SnaperroConfigSchema.safeParse(validConfig);
    expect(result.success).toBe(true);
  });

  it("portを省略するとデフォルト値3333が設定される", () => {
    const config = {
      apis: {
        userService: {
          name: "ユーザーサービス",
          target: "https://api.example.com",
          routes: ["/api/users/**"],
        },
      },
    };

    const result = SnaperroConfigSchema.parse(config);
    expect(result.port).toBe(3333);
  });

  it("無効なポート番号を拒否する", () => {
    const invalidConfig = {
      port: 70000,
      apis: {},
    };

    const result = SnaperroConfigSchema.safeParse(invalidConfig);
    expect(result.success).toBe(false);
  });

  it("複数のAPI設定を受け入れる", () => {
    const validConfig = {
      apis: {
        userRead: {
          name: "ユーザー取得",
          target: "https://user-api.example.com",
          routes: ["GET /api/users/**"],
        },
        userWrite: {
          name: "ユーザー作成",
          target: "https://user-write-api.example.com",
          routes: ["POST /api/users/**", "PUT /api/users/**"],
        },
      },
    };

    const result = SnaperroConfigSchema.safeParse(validConfig);
    expect(result.success).toBe(true);
  });
});

describe("defineConfig", () => {
  it("有効な設定をそのまま返す", () => {
    const config = {
      port: 4000,
      filesDir: ".snaperro/files",
      apis: {
        testApi: {
          name: "テストAPI",
          target: "https://test.example.com",
          routes: ["/test/**"],
        },
      },
    };

    const result = defineConfig(config);
    expect(result.port).toBe(4000);
    expect(result.apis.testApi?.name).toBe("テストAPI");
  });

  it("無効な設定でエラーをスローする", () => {
    const invalidConfig = {
      port: -1,
      apis: {},
    };

    expect(() => defineConfig(invalidConfig as never)).toThrow();
  });
});
