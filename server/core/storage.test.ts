import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FileData } from "../types/file.js";
import { buildFilePath, endpointToFileName, storage } from "./storage.js";

const TEST_BASE_DIR = ".snaperro/files";
const TEST_PATTERN = "__test_pattern__";

// テスト用の記録データ
const testFileData: FileData = {
  endpoint: "/api/users",
  method: "GET",
  request: {
    pathParams: {},
    queryParams: {},
    headers: {
      "Content-Type": "application/json",
    },
    body: null,
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
};

describe("endpointToFileName", () => {
  it("先頭スラッシュを除去する", () => {
    expect(endpointToFileName("/api/users")).toBe("api_users");
  });

  it("パスパラメータを{param}形式に変換する", () => {
    expect(endpointToFileName("/api/users/:id")).toBe("api_users_{id}");
  });

  it("複数のパスパラメータを変換する", () => {
    expect(endpointToFileName("/api/users/:userId/orders/:orderId")).toBe("api_users_{userId}_orders_{orderId}");
  });

  it("スラッシュをアンダースコアに変換する", () => {
    expect(endpointToFileName("/api/v1/users")).toBe("api_v1_users");
  });
});

describe("buildFilePath", () => {
  it("正しいファイルパスを構築する", () => {
    const result = buildFilePath("正常系", "/api/users", 1);
    expect(result).toBe(path.join("正常系", "api_users_001.json"));
  });

  it("パスパラメータを含むパスを変換する", () => {
    const result = buildFilePath("パターン", "/api/users/:id", 1);
    expect(result).toBe(path.join("パターン", "api_users_{id}_001.json"));
  });

  it("連番を3桁0埋めする", () => {
    expect(buildFilePath("test", "/api/users", 1)).toContain("_001.json");
    expect(buildFilePath("test", "/api/users", 10)).toContain("_010.json");
    expect(buildFilePath("test", "/api/users", 100)).toContain("_100.json");
  });

  it("複数のパスパラメータを変換する", () => {
    const result = buildFilePath("test", "/api/users/:userId/orders/:orderId", 5);
    expect(result).toBe(path.join("test", "api_users_{userId}_orders_{orderId}_005.json"));
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
      const filePath = buildFilePath(TEST_PATTERN, "/api/users", 1);

      await storage.write(filePath, testFileData);
      const result = await storage.read(filePath);

      expect(result).toEqual(testFileData);
    });

    it("パスパラメータを含むエンドポイントでもファイルを作成できる", async () => {
      const data: FileData = {
        ...testFileData,
        endpoint: "/api/users/:id",
        request: {
          ...testFileData.request,
          pathParams: { id: "123" },
        },
      };
      const filePath = buildFilePath(TEST_PATTERN, "/api/users/:id", 1);

      await storage.write(filePath, data);
      const result = await storage.read(filePath);

      expect(result.endpoint).toBe("/api/users/:id");
      expect(result.request.pathParams).toEqual({ id: "123" });
    });
  });

  describe("exists", () => {
    it("存在するファイルはtrueを返す", async () => {
      const filePath = buildFilePath(TEST_PATTERN, "/api/users", 1);
      await storage.write(filePath, testFileData);

      const result = await storage.exists(filePath);
      expect(result).toBe(true);
    });

    it("存在しないファイルはfalseを返す", async () => {
      const result = await storage.exists(buildFilePath(TEST_PATTERN, "/api/unknown", 999));
      expect(result).toBe(false);
    });
  });

  describe("findNextSequence", () => {
    it("ファイルがない場合は1を返す", async () => {
      await storage.createPattern(TEST_PATTERN);
      const seq = await storage.findNextSequence(TEST_PATTERN, "/api/unknown");
      expect(seq).toBe(1);
    });

    it("既存ファイルの次の連番を返す", async () => {
      await storage.write(buildFilePath(TEST_PATTERN, "/api/users", 1), testFileData);
      await storage.write(buildFilePath(TEST_PATTERN, "/api/users", 2), testFileData);

      const seq = await storage.findNextSequence(TEST_PATTERN, "/api/users");
      expect(seq).toBe(3);
    });

    it("異なるエンドポイントは別々にカウントする", async () => {
      await storage.write(buildFilePath(TEST_PATTERN, "/api/users", 1), testFileData);
      await storage.write(buildFilePath(TEST_PATTERN, "/api/orders", 1), testFileData);
      await storage.write(buildFilePath(TEST_PATTERN, "/api/orders", 2), testFileData);

      expect(await storage.findNextSequence(TEST_PATTERN, "/api/users")).toBe(2);
      expect(await storage.findNextSequence(TEST_PATTERN, "/api/orders")).toBe(3);
    });

    it("ディレクトリが存在しない場合は1を返す", async () => {
      const seq = await storage.findNextSequence("nonexistent_pattern", "/api/users");
      expect(seq).toBe(1);
    });
  });

  describe("findMatchingFile", () => {
    it("パラメータが一致するファイルを見つける", async () => {
      const data: FileData = {
        ...testFileData,
        endpoint: "/api/users/:id",
        method: "GET",
        request: {
          ...testFileData.request,
          pathParams: { id: "123" },
          queryParams: { include: "profile" },
        },
      };
      await storage.write(buildFilePath(TEST_PATTERN, "/api/users/:id", 1), data);

      const result = await storage.findMatchingFile(
        TEST_PATTERN,
        "GET",
        "/api/users/:id",
        { id: "123" },
        { include: "profile" },
      );

      expect(result).not.toBeNull();
      expect(result?.fileData.request.pathParams.id).toBe("123");
    });

    it("パスパラメータが異なるとマッチしない", async () => {
      const data: FileData = {
        ...testFileData,
        endpoint: "/api/users/:id",
        request: {
          ...testFileData.request,
          pathParams: { id: "123" },
          queryParams: {},
        },
      };
      await storage.write(buildFilePath(TEST_PATTERN, "/api/users/:id", 1), data);

      const result = await storage.findMatchingFile(
        TEST_PATTERN,
        "GET",
        "/api/users/:id",
        { id: "456" }, // 異なるID
        {},
      );

      expect(result).toBeNull();
    });

    it("メソッドが異なるとマッチしない", async () => {
      const data: FileData = {
        ...testFileData,
        endpoint: "/api/users",
        method: "GET",
      };
      await storage.write(buildFilePath(TEST_PATTERN, "/api/users", 1), data);

      const result = await storage.findMatchingFile(TEST_PATTERN, "POST", "/api/users", {}, {});

      expect(result).toBeNull();
    });

    it("クエリパラメータが異なるとマッチしない", async () => {
      const data: FileData = {
        ...testFileData,
        endpoint: "/api/users",
        request: {
          ...testFileData.request,
          queryParams: { status: "active" },
        },
      };
      await storage.write(buildFilePath(TEST_PATTERN, "/api/users", 1), data);

      const result = await storage.findMatchingFile(TEST_PATTERN, "GET", "/api/users", {}, { status: "inactive" });

      expect(result).toBeNull();
    });

    it("ファイルがない場合はnullを返す", async () => {
      await storage.createPattern(TEST_PATTERN);
      const result = await storage.findMatchingFile(TEST_PATTERN, "GET", "/api/unknown", {}, {});
      expect(result).toBeNull();
    });

    it("リクエストボディが一致するファイルを見つける", async () => {
      const data: FileData = {
        ...testFileData,
        endpoint: "/api/users",
        method: "POST",
        request: {
          ...testFileData.request,
          body: { name: "test", email: "test@example.com" },
        },
      };
      await storage.write(buildFilePath(TEST_PATTERN, "/api/users", 1), data);

      const result = await storage.findMatchingFile(
        TEST_PATTERN,
        "POST",
        "/api/users",
        {},
        {},
        { name: "test", email: "test@example.com" },
      );

      expect(result).not.toBeNull();
    });

    it("リクエストボディが異なるとマッチしない", async () => {
      const data: FileData = {
        ...testFileData,
        endpoint: "/api/users",
        method: "POST",
        request: {
          ...testFileData.request,
          body: { name: "user1" },
        },
      };
      await storage.write(buildFilePath(TEST_PATTERN, "/api/users", 1), data);

      const result = await storage.findMatchingFile(TEST_PATTERN, "POST", "/api/users", {}, {}, { name: "user2" });

      expect(result).toBeNull();
    });

    it("bodyがnullの場合も正しくマッチする", async () => {
      const data: FileData = {
        ...testFileData,
        endpoint: "/api/users",
        method: "GET",
        request: {
          ...testFileData.request,
          body: null,
        },
      };
      await storage.write(buildFilePath(TEST_PATTERN, "/api/users", 1), data);

      const result = await storage.findMatchingFile(TEST_PATTERN, "GET", "/api/users", {}, {}, null);

      expect(result).not.toBeNull();
    });

    it("requestBodyが未指定の場合はボディチェックをスキップする", async () => {
      const data: FileData = {
        ...testFileData,
        endpoint: "/api/users",
        method: "POST",
        request: {
          ...testFileData.request,
          body: { name: "test" },
        },
      };
      await storage.write(buildFilePath(TEST_PATTERN, "/api/users", 1), data);

      // requestBodyを渡さない場合はマッチする（Mockモード互換）
      const result = await storage.findMatchingFile(TEST_PATTERN, "POST", "/api/users", {}, {});

      expect(result).not.toBeNull();
    });
  });

  describe("findOrCreateFile", () => {
    it("既存ファイルがあれば isNew: false を返す", async () => {
      const data: FileData = {
        ...testFileData,
        endpoint: "/api/users/:id",
        method: "GET",
        request: {
          ...testFileData.request,
          pathParams: { id: "123" },
          queryParams: {},
        },
      };
      await storage.write(buildFilePath(TEST_PATTERN, "/api/users/:id", 1), data);

      const result = await storage.findOrCreateFile(TEST_PATTERN, "GET", "/api/users/:id", { id: "123" }, {});

      expect(result.isNew).toBe(false);
      expect(result.filePath).toContain("_001.json");
    });

    it("既存ファイルがなければ isNew: true を返す", async () => {
      await storage.createPattern(TEST_PATTERN);

      const result = await storage.findOrCreateFile(TEST_PATTERN, "GET", "/api/users/:id", { id: "999" }, {});

      expect(result.isNew).toBe(true);
      expect(result.filePath).toContain("_001.json");
    });

    it("新規ファイルは次の連番になる", async () => {
      const data1: FileData = {
        ...testFileData,
        endpoint: "/api/users/:id",
        request: {
          ...testFileData.request,
          pathParams: { id: "1" },
          queryParams: {},
        },
      };
      await storage.write(buildFilePath(TEST_PATTERN, "/api/users/:id", 1), data1);

      const result = await storage.findOrCreateFile(
        TEST_PATTERN,
        "GET",
        "/api/users/:id",
        { id: "2" }, // 異なるID
        {},
      );

      expect(result.isNew).toBe(true);
      expect(result.filePath).toContain("_002.json");
    });

    it("ボディが異なる場合は新規ファイルを作成する", async () => {
      const data1: FileData = {
        ...testFileData,
        endpoint: "/api/users",
        method: "POST",
        request: {
          ...testFileData.request,
          body: { name: "user1" },
        },
      };
      await storage.write(buildFilePath(TEST_PATTERN, "/api/users", 1), data1);

      const result = await storage.findOrCreateFile(
        TEST_PATTERN,
        "POST",
        "/api/users",
        {},
        {},
        { name: "user2" }, // 異なるボディ
      );

      expect(result.isNew).toBe(true);
      expect(result.filePath).toContain("_002.json");
    });

    it("ボディが同じ場合は既存ファイルを上書きする", async () => {
      const data1: FileData = {
        ...testFileData,
        endpoint: "/api/users",
        method: "POST",
        request: {
          ...testFileData.request,
          body: { name: "user1" },
        },
      };
      await storage.write(buildFilePath(TEST_PATTERN, "/api/users", 1), data1);

      const result = await storage.findOrCreateFile(
        TEST_PATTERN,
        "POST",
        "/api/users",
        {},
        {},
        { name: "user1" }, // 同じボディ
      );

      expect(result.isNew).toBe(false);
      expect(result.filePath).toContain("_001.json");
    });
  });

  describe("listPatterns と createPattern", () => {
    it("フォルダ内のパターンを一覧に表示される", async () => {
      const testFolder = "__test_folder__";
      const testPatternInFolder = `${testFolder}/${TEST_PATTERN}`;

      // Create folder and pattern
      await storage.createFolder(testFolder);
      await storage.createPattern(testPatternInFolder);

      // Write a file to make it a recognized pattern
      const filePath = buildFilePath(testPatternInFolder, "/api/users", 1);
      await storage.write(filePath, testFileData);

      const patterns = await storage.listPatterns();
      expect(patterns).toContain(testPatternInFolder);

      // Cleanup
      await fs.rm(path.join(TEST_BASE_DIR, testFolder), { recursive: true, force: true });
    });
  });

  describe("getPatternFiles", () => {
    it("パターン内のファイル一覧を取得できる", async () => {
      await storage.write(buildFilePath(TEST_PATTERN, "/api/users", 1), testFileData);
      await storage.write(buildFilePath(TEST_PATTERN, "/api/orders", 1), {
        ...testFileData,
        endpoint: "/api/orders",
        method: "POST",
        response: { ...testFileData.response, status: 201 },
      });

      const files = await storage.getPatternFiles(TEST_PATTERN);

      expect(files).toHaveLength(2);
      expect(files.map((f) => f.method)).toContain("GET");
      expect(files.map((f) => f.method)).toContain("POST");
      expect(files.map((f) => f.endpoint)).toContain("/api/users");
      expect(files.map((f) => f.endpoint)).toContain("/api/orders");
    });

    it("空のパターンは空配列を返す", async () => {
      await storage.createPattern(TEST_PATTERN);
      const files = await storage.getPatternFiles(TEST_PATTERN);
      expect(files).toEqual([]);
    });
  });

  describe("deleteFile", () => {
    it("ファイルを削除できる", async () => {
      const filePath = buildFilePath(TEST_PATTERN, "/api/users", 1);
      await storage.write(filePath, testFileData);
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
