import fs from "node:fs/promises";
import path from "node:path";
import { consola } from "consola";

const CONFIG_TEMPLATE = `import { defineConfig } from 'snaperro'

export default defineConfig({
  port: 3333,

  apis: {
    // JSON Placeholder API（サンプル）
    jsonPlaceholder: {
      name: "JSON Placeholder",
      target: "https://jsonplaceholder.typicode.com",
      match: ["/users/**", "/posts/**", "/comments/**"],
    },

    // 例: カスタムAPI
    // userService: {
    //   name: "ユーザーサービス",
    //   target: "https://user-api.example.com",
    //   headers: {
    //     "X-Api-Key": process.env.USER_API_KEY!,
    //   },
    //   match: ["/api/users/**"],
    // },
  },
})
`;

const GITIGNORE_ENTRY = "\n# snaperro\n.snaperro/\n";

/**
 * サンプルデータ: demo（正常系）
 */
const SAMPLE_DEMO = {
  "users/GET_1.json": {
    request: {
      method: "GET",
      url: "https://jsonplaceholder.typicode.com/users",
      headers: {},
    },
    response: {
      status: 200,
      headers: { "content-type": "application/json" },
      body: [
        { id: 1, name: "Leanne Graham", email: "leanne@example.com" },
        { id: 2, name: "Ervin Howell", email: "ervin@example.com" },
        { id: 3, name: "Clementine Bauch", email: "clementine@example.com" },
      ],
    },
    recordedAt: "2025-01-01T00:00:00.000Z",
  },
  "users/1/GET_1.json": {
    request: {
      method: "GET",
      url: "https://jsonplaceholder.typicode.com/users/1",
      headers: {},
    },
    response: {
      status: 200,
      headers: { "content-type": "application/json" },
      body: {
        id: 1,
        name: "Leanne Graham",
        username: "Bret",
        email: "leanne@example.com",
        phone: "1-770-736-8031",
        website: "hildegard.org",
      },
    },
    recordedAt: "2025-01-01T00:00:00.000Z",
  },
  "posts/GET_1.json": {
    request: {
      method: "GET",
      url: "https://jsonplaceholder.typicode.com/posts",
      headers: {},
    },
    response: {
      status: 200,
      headers: { "content-type": "application/json" },
      body: [
        { id: 1, userId: 1, title: "Sample Post 1", body: "This is the first post." },
        { id: 2, userId: 1, title: "Sample Post 2", body: "This is the second post." },
        { id: 3, userId: 2, title: "Sample Post 3", body: "This is the third post." },
      ],
    },
    recordedAt: "2025-01-01T00:00:00.000Z",
  },
};

/**
 * サンプルデータ: demo-empty（空データ）
 */
const SAMPLE_DEMO_EMPTY = {
  "users/GET_1.json": {
    request: {
      method: "GET",
      url: "https://jsonplaceholder.typicode.com/users",
      headers: {},
    },
    response: {
      status: 200,
      headers: { "content-type": "application/json" },
      body: [],
    },
    recordedAt: "2025-01-01T00:00:00.000Z",
  },
  "users/1/GET_1.json": {
    request: {
      method: "GET",
      url: "https://jsonplaceholder.typicode.com/users/1",
      headers: {},
    },
    response: {
      status: 404,
      headers: { "content-type": "application/json" },
      body: { error: "Not Found" },
    },
    recordedAt: "2025-01-01T00:00:00.000Z",
  },
  "posts/GET_1.json": {
    request: {
      method: "GET",
      url: "https://jsonplaceholder.typicode.com/posts",
      headers: {},
    },
    response: {
      status: 200,
      headers: { "content-type": "application/json" },
      body: [],
    },
    recordedAt: "2025-01-01T00:00:00.000Z",
  },
};

/**
 * サンプルデータ: demo-error（エラー系）
 */
const SAMPLE_DEMO_ERROR = {
  "users/GET_1.json": {
    request: {
      method: "GET",
      url: "https://jsonplaceholder.typicode.com/users",
      headers: {},
    },
    response: {
      status: 500,
      headers: { "content-type": "application/json" },
      body: { error: "Internal Server Error" },
    },
    recordedAt: "2025-01-01T00:00:00.000Z",
  },
  "users/1/GET_1.json": {
    request: {
      method: "GET",
      url: "https://jsonplaceholder.typicode.com/users/1",
      headers: {},
    },
    response: {
      status: 404,
      headers: { "content-type": "application/json" },
      body: { error: "User not found" },
    },
    recordedAt: "2025-01-01T00:00:00.000Z",
  },
  "posts/GET_1.json": {
    request: {
      method: "GET",
      url: "https://jsonplaceholder.typicode.com/posts",
      headers: {},
    },
    response: {
      status: 500,
      headers: { "content-type": "application/json" },
      body: { error: "Internal Server Error" },
    },
    recordedAt: "2025-01-01T00:00:00.000Z",
  },
};

const SAMPLE_DATA: Record<string, Record<string, unknown>> = {
  demo: SAMPLE_DEMO,
  "demo-empty": SAMPLE_DEMO_EMPTY,
  "demo-error": SAMPLE_DEMO_ERROR,
};

/**
 * サンプルファイルを書き込む
 */
async function writeSampleFiles(recordingsDir: string): Promise<void> {
  for (const [pattern, files] of Object.entries(SAMPLE_DATA)) {
    for (const [filePath, data] of Object.entries(files)) {
      const fullPath = path.join(recordingsDir, pattern, filePath);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, JSON.stringify(data, null, 2), "utf-8");
    }
  }
}

/**
 * init コマンド
 * - .snaperro/recordings ディレクトリを作成
 * - snaperro.config.ts を作成（存在しない場合）
 * - .gitignore に .snaperro/ を追加
 */
export async function initCommand(): Promise<void> {
  const cwd = process.cwd();

  consola.start("snaperro を初期化しています...");

  // 1. .snaperro/recordings ディレクトリを作成
  const recordingsDir = path.join(cwd, ".snaperro", "recordings");
  await fs.mkdir(recordingsDir, { recursive: true });
  consola.success(".snaperro/recordings ディレクトリを作成しました");

  // 2. サンプルデータを配置
  await writeSampleFiles(recordingsDir);
  consola.success("サンプルパターン（demo, demo-empty, demo-error）を配置しました");

  // 3. snaperro.config.ts を作成（存在しない場合）
  const configPath = path.join(cwd, "snaperro.config.ts");
  try {
    await fs.access(configPath);
    consola.info("snaperro.config.ts は既に存在します");
  } catch {
    await fs.writeFile(configPath, CONFIG_TEMPLATE, "utf-8");
    consola.success("snaperro.config.ts を作成しました");
  }

  // 4. .gitignore に追加
  const gitignorePath = path.join(cwd, ".gitignore");
  try {
    const content = await fs.readFile(gitignorePath, "utf-8");
    if (!content.includes(".snaperro/")) {
      await fs.appendFile(gitignorePath, GITIGNORE_ENTRY);
      consola.success(".gitignore に .snaperro/ を追加しました");
    } else {
      consola.info(".gitignore には既に .snaperro/ が含まれています");
    }
  } catch {
    // .gitignore が存在しない場合は作成
    await fs.writeFile(gitignorePath, `${GITIGNORE_ENTRY.trim()}\n`, "utf-8");
    consola.success(".gitignore を作成しました");
  }

  consola.box({
    title: "snaperro 初期化完了 🐕",
    message: [
      "サンプルパターン:",
      "  - demo（正常系）",
      "  - demo-empty（空データ）",
      "  - demo-error（エラー系）",
      "",
      "次のステップ:",
      "1. npx snaperro start でサーバーを起動",
      "2. GUIでパターンを切り替えて動作を確認",
    ].join("\n"),
  });
}
