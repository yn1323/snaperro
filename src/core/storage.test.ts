import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RecordedData } from "../types/recording.js";
import { buildFilePath, storage } from "./storage.js";

const TEST_BASE_DIR = ".snaperro/recordings";
const TEST_PATTERN = "__test_pattern__";

// テスト用の録画データ
const testRecordedData: RecordedData = {
  request: {
    method: "GET",
    url: "/api/users",
    headers: {
      "Content-Type": "application/json",
    },
  },
  response: {
    status: 200,
    headers: {
      "Content-Type": "application/json",
    },
    body: {
      users: [
        { id: 1, name: "田中" },
        { id: 2, name: "佐藤" },
      ],
    },
  },
  recordedAt: "2024-01-15T10:30:00.000Z",
};

describe("buildFilePath", () => {
  it("正しいファイルパスを構築する", () => {
    const result = buildFilePath("正常系", "/api/users", "GET", 1);
    expect(result).toBe(path.join("正常系", "api", "users", "GET_1.json"));
  });

  it("先頭スラッシュを除去する", () => {
    const result = buildFilePath("パターン", "/api/orders/123", "POST", 2);
    expect(result).toBe(path.join("パターン", "api", "orders", "123", "POST_2.json"));
  });

  it("メソッドを大文字に変換する", () => {
    const result = buildFilePath("test", "/api/users", "get", 1);
    expect(result).toBe(path.join("test", "api", "users", "GET_1.json"));
  });
});

describe("storage", () => {
  beforeEach(async () => {
    // テスト用ディレクトリを作成
    await storage.ensureBaseDir();
  });

  afterEach(async () => {
    // テスト用パターンを削除
    try {
      await fs.rm(path.join(TEST_BASE_DIR, TEST_PATTERN), {
        recursive: true,
        force: true,
      });
    } catch {
      // 無視
    }
  });

  describe("write と read", () => {
    it("データを書き込んで読み込める", async () => {
      const filePath = buildFilePath(TEST_PATTERN, "/api/users", "GET", 1);

      await storage.write(filePath, testRecordedData);
      const result = await storage.read(filePath);

      expect(result).toEqual(testRecordedData);
    });

    it("ネストしたパスでもディレクトリを作成する", async () => {
      const filePath = buildFilePath(TEST_PATTERN, "/api/users/123/orders", "POST", 1);

      await storage.write(filePath, testRecordedData);
      const result = await storage.read(filePath);

      expect(result.request.method).toBe("GET"); // testRecordedDataの値
    });
  });

  describe("exists", () => {
    it("存在するファイルはtrueを返す", async () => {
      const filePath = buildFilePath(TEST_PATTERN, "/api/users", "GET", 1);
      await storage.write(filePath, testRecordedData);

      const result = await storage.exists(filePath);
      expect(result).toBe(true);
    });

    it("存在しないファイルはfalseを返す", async () => {
      const result = await storage.exists(buildFilePath(TEST_PATTERN, "/api/unknown", "GET", 999));
      expect(result).toBe(false);
    });
  });

  describe("findLastFile", () => {
    it("最後のファイルを見つける", async () => {
      // 3つのファイルを作成
      await storage.write(buildFilePath(TEST_PATTERN, "/api/users", "GET", 1), testRecordedData);
      await storage.write(buildFilePath(TEST_PATTERN, "/api/users", "GET", 2), testRecordedData);
      await storage.write(buildFilePath(TEST_PATTERN, "/api/users", "GET", 3), testRecordedData);

      const result = await storage.findLastFile(TEST_PATTERN, "/api/users", "GET");
      expect(result).toContain("GET_3.json");
    });

    it("ファイルがない場合はnullを返す", async () => {
      const result = await storage.findLastFile(TEST_PATTERN, "/api/unknown", "GET");
      expect(result).toBeNull();
    });

    it("異なるメソッドのファイルは無視する", async () => {
      await storage.write(buildFilePath(TEST_PATTERN, "/api/users", "GET", 1), testRecordedData);
      await storage.write(buildFilePath(TEST_PATTERN, "/api/users", "POST", 1), testRecordedData);

      const result = await storage.findLastFile(TEST_PATTERN, "/api/users", "GET");
      expect(result).toContain("GET_1.json");
    });
  });

  describe("listPatterns と createPattern", () => {
    it("パターンを作成して一覧に表示される", async () => {
      await storage.createPattern(TEST_PATTERN);

      const patterns = await storage.listPatterns();
      expect(patterns).toContain(TEST_PATTERN);
    });
  });

  describe("getPatternFiles", () => {
    it("パターン内のファイル一覧を取得できる", async () => {
      await storage.write(buildFilePath(TEST_PATTERN, "/api/users", "GET", 1), testRecordedData);
      await storage.write(buildFilePath(TEST_PATTERN, "/api/orders", "POST", 1), {
        ...testRecordedData,
        response: { ...testRecordedData.response, status: 201 },
      });

      const files = await storage.getPatternFiles(TEST_PATTERN);

      expect(files).toHaveLength(2);
      expect(files.map((f) => f.method)).toContain("GET");
      expect(files.map((f) => f.method)).toContain("POST");
    });
  });

  describe("deleteFile", () => {
    it("ファイルを削除できる", async () => {
      const filePath = buildFilePath(TEST_PATTERN, "/api/users", "GET", 1);
      await storage.write(filePath, testRecordedData);
      expect(await storage.exists(filePath)).toBe(true);

      await storage.deleteFile(filePath);
      expect(await storage.exists(filePath)).toBe(false);
    });
  });

  describe("formatSize", () => {
    it("バイト単位をフォーマットする", () => {
      expect(storage.formatSize(500)).toBe("500B");
      expect(storage.formatSize(1024)).toBe("1.0KB");
      expect(storage.formatSize(1536)).toBe("1.5KB");
      expect(storage.formatSize(1048576)).toBe("1.0MB");
    });
  });
});
