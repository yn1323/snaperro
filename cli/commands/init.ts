import fs from "node:fs/promises";
import path from "node:path";
import { consola } from "consola";

const CONFIG_TEMPLATE = `import { defineConfig } from 'snaperro'

export default defineConfig({
  port: 3333,
  filesDir: '.snaperro/files',

  apis: {
    // JSON Placeholder API（サンプル）
    jsonPlaceholder: {
      name: "JSON Placeholder",
      target: "https://jsonplaceholder.typicode.com",
      routes: [
        "/users",
        "/users/:id",
        "/posts",
        "/posts/:id",
        "/posts/:id/comments",
        "/comments",
      ],
    },

    // 例: カスタムAPI
    // userService: {
    //   name: "ユーザーサービス",
    //   target: "https://user-api.example.com",
    //   headers: {
    //     "X-Api-Key": process.env.USER_API_KEY!,
    //   },
    //   routes: ["/api/users", "/api/users/:id"],
    // },
  },
})
`;

const GITIGNORE_ENTRY = "\n# snaperro\n.snaperro/\n";

// ============================================
// ヘルパー関数
// ============================================

type FileData = {
  endpoint: string;
  method: string;
  request: {
    pathParams: Record<string, string>;
    queryParams: Record<string, string>;
    headers: Record<string, string>;
    body: unknown;
  };
  response: {
    status: number;
    headers: Record<string, string>;
    body: unknown;
  };
};

function createFileData(
  endpoint: string,
  method: string,
  pathParams: Record<string, string>,
  queryParams: Record<string, string>,
  status: number,
  body: unknown,
): FileData {
  return {
    endpoint,
    method,
    request: {
      pathParams,
      queryParams,
      headers: {},
      body: null,
    },
    response: {
      status,
      headers: { "content-type": "application/json" },
      body,
    },
  };
}

// ============================================
// 基礎データ（JSONPlaceholder準拠）
// ============================================

const USERS_DATA: Record<number, object> = {
  1: {
    id: 1,
    name: "Leanne Graham",
    username: "Bret",
    email: "Sincere@april.biz",
    phone: "1-770-736-8031 x56442",
    website: "hildegard.org",
  },
  2: {
    id: 2,
    name: "Ervin Howell",
    username: "Antonette",
    email: "Shanna@melissa.tv",
    phone: "010-692-6593 x09125",
    website: "anastasia.net",
  },
  3: {
    id: 3,
    name: "Clementine Bauch",
    username: "Samantha",
    email: "Nathan@yesenia.net",
    phone: "1-463-123-4447",
    website: "ramiro.info",
  },
  5: {
    id: 5,
    name: "Chelsey Dietrich",
    username: "Kamren",
    email: "Lucio_Hettinger@annie.ca",
    phone: "(254)954-1289",
    website: "demarco.info",
  },
  10: {
    id: 10,
    name: "Clementina DuBuque",
    username: "Moriah.Stanton",
    email: "Rey.Padberg@karina.biz",
    phone: "024-648-3804",
    website: "ambrose.net",
  },
};

const POSTS_DATA: Record<number, object> = {
  1: {
    userId: 1,
    id: 1,
    title: "sunt aut facere repellat provident occaecati excepturi optio reprehenderit",
    body: "quia et suscipit\nsuscipit recusandae consequuntur expedita et cum\nreprehenderit molestiae ut ut quas totam\nnostrum rerum est autem sunt rem eveniet architecto",
  },
  2: {
    userId: 1,
    id: 2,
    title: "qui est esse",
    body: "est rerum tempore vitae\nsequi sint nihil reprehenderit dolor beatae ea dolores neque\nfugiat blanditiis voluptate porro vel nihil molestiae ut reiciendis\nqui aperiam non debitis possimus qui neque nisi nulla",
  },
  3: {
    userId: 1,
    id: 3,
    title: "ea molestias quasi exercitationem repellat qui ipsa sit aut",
    body: "et iusto sed quo iure\nvoluptatem occaecati omnis eligendi aut ad\nvoluptatem doloribus vel accusantium quis pariatur\nmolestiae porro eius odio et labore et velit aut",
  },
};

// User別の投稿
const POSTS_BY_USER: Record<number, object[]> = {
  1: [
    { userId: 1, id: 1, title: "sunt aut facere repellat provident", body: "quia et suscipit..." },
    { userId: 1, id: 2, title: "qui est esse", body: "est rerum tempore vitae..." },
  ],
  2: [
    { userId: 2, id: 11, title: "et ea vero quia laudantium autem", body: "delectus reiciendis..." },
    { userId: 2, id: 12, title: "in quibusdam tempore odit est dolorem", body: "itaque id aut..." },
  ],
  3: [
    { userId: 3, id: 21, title: "asperiores ea ipsam voluptatibus modi", body: "voluptatem ut..." },
    { userId: 3, id: 22, title: "dolor sint quo a velit explicabo", body: "eos qui et ipsum..." },
  ],
};

const COMMENTS_DATA: Record<number, object[]> = {
  1: [
    {
      postId: 1,
      id: 1,
      name: "id labore ex et quam laborum",
      email: "Eliseo@gardner.biz",
      body: "laudantium enim quasi est quidem magnam voluptate ipsam eos\ntempora quo necessitatibus",
    },
    {
      postId: 1,
      id: 2,
      name: "quo vero reiciendis velit similique earum",
      email: "Jayne_Kuhic@sydney.com",
      body: "est natus enim nihil est dolore omnis voluptatem numquam\net omnis occaecati quod ullam at",
    },
    {
      postId: 1,
      id: 3,
      name: "odio adipisci rerum aut animi",
      email: "Nikita@garfield.biz",
      body: "quia molestiae reprehenderit quasi aspernatur\naut expedita occaecati aliquam eveniet laudantium",
    },
  ],
  2: [
    {
      postId: 2,
      id: 6,
      name: "et fugit eligendi deleniti quidem qui sint nihil autem",
      email: "Presley.Mueller@myrl.com",
      body: "doloribus at sed quis culpa deserunt consectetur qui praesentium",
    },
    {
      postId: 2,
      id: 7,
      name: "repellat consequatur praesentium vel minus molestias voluptatum",
      email: "Dallas@ole.me",
      body: "maiores sed dolores similique labore et inventore et\nquasi temporibus esse sunt id et",
    },
  ],
  3: [
    {
      postId: 3,
      id: 11,
      name: "fugit labore quia mollitia quas deserunt nostrum sunt",
      email: "Veronica_Goodwin@timmothy.net",
      body: "ut dolorum nostrum id quia aut est\nfuga est inventore vel eligendi explicabo quis consectetur",
    },
    {
      postId: 3,
      id: 12,
      name: "modi ut eos dolores illum nam dolor",
      email: "Oswald.Vandervort@leanne.org",
      body: "expedita maiores dignissimos facilis\nipsum est rem est fugit velit sequi",
    },
  ],
};

// ============================================
// サンプルデータ: demo（正常系）
// ============================================

const SAMPLE_DEMO: Record<string, FileData> = {
  // === Basic ===
  "users_001.json": createFileData("/users", "GET", {}, {}, 200, Object.values(USERS_DATA)),
  "posts_001.json": createFileData("/posts", "GET", {}, {}, 200, Object.values(POSTS_DATA)),
  "comments_001.json": createFileData("/comments", "GET", {}, {}, 200, [
    ...COMMENTS_DATA[1],
    ...COMMENTS_DATA[2],
    ...COMMENTS_DATA[3],
  ]),

  // === Path Parameter: /users/:id ===
  "users_{id}_001.json": createFileData("/users/:id", "GET", { id: "1" }, {}, 200, USERS_DATA[1]),
  "users_{id}_002.json": createFileData("/users/:id", "GET", { id: "2" }, {}, 200, USERS_DATA[2]),
  "users_{id}_003.json": createFileData("/users/:id", "GET", { id: "3" }, {}, 200, USERS_DATA[3]),
  "users_{id}_004.json": createFileData("/users/:id", "GET", { id: "5" }, {}, 200, USERS_DATA[5]),
  "users_{id}_005.json": createFileData("/users/:id", "GET", { id: "10" }, {}, 200, USERS_DATA[10]),

  // === Path Parameter: /posts/:id ===
  "posts_{id}_001.json": createFileData("/posts/:id", "GET", { id: "1" }, {}, 200, POSTS_DATA[1]),
  "posts_{id}_002.json": createFileData("/posts/:id", "GET", { id: "2" }, {}, 200, POSTS_DATA[2]),
  "posts_{id}_003.json": createFileData("/posts/:id", "GET", { id: "3" }, {}, 200, POSTS_DATA[3]),

  // === Query String: /posts?userId= ===
  "posts_002.json": createFileData("/posts", "GET", {}, { userId: "1" }, 200, POSTS_BY_USER[1]),
  "posts_003.json": createFileData("/posts", "GET", {}, { userId: "2" }, 200, POSTS_BY_USER[2]),
  "posts_004.json": createFileData("/posts", "GET", {}, { userId: "3" }, 200, POSTS_BY_USER[3]),

  // === Query String: /comments?postId= ===
  "comments_002.json": createFileData("/comments", "GET", {}, { postId: "1" }, 200, COMMENTS_DATA[1]),
  "comments_003.json": createFileData("/comments", "GET", {}, { postId: "2" }, 200, COMMENTS_DATA[2]),
  "comments_004.json": createFileData("/comments", "GET", {}, { postId: "3" }, 200, COMMENTS_DATA[3]),

  // === Nested Resource: /posts/:id/comments ===
  "posts_{id}_comments_001.json": createFileData("/posts/:id/comments", "GET", { id: "1" }, {}, 200, COMMENTS_DATA[1]),
  "posts_{id}_comments_002.json": createFileData("/posts/:id/comments", "GET", { id: "2" }, {}, 200, COMMENTS_DATA[2]),
  "posts_{id}_comments_003.json": createFileData("/posts/:id/comments", "GET", { id: "3" }, {}, 200, COMMENTS_DATA[3]),
};

// ============================================
// サンプルデータ: demo-empty（空データ）
// ============================================

const SAMPLE_DEMO_EMPTY: Record<string, FileData> = {
  // === Basic（空配列） ===
  "users_001.json": createFileData("/users", "GET", {}, {}, 200, []),
  "posts_001.json": createFileData("/posts", "GET", {}, {}, 200, []),
  "comments_001.json": createFileData("/comments", "GET", {}, {}, 200, []),

  // === Path Parameter: /users/:id（404） ===
  "users_{id}_001.json": createFileData("/users/:id", "GET", { id: "1" }, {}, 404, { error: "Not Found" }),

  // === Path Parameter: /posts/:id（404） ===
  "posts_{id}_001.json": createFileData("/posts/:id", "GET", { id: "1" }, {}, 404, { error: "Not Found" }),

  // === Query String（空配列） ===
  "posts_002.json": createFileData("/posts", "GET", {}, { userId: "1" }, 200, []),
  "comments_002.json": createFileData("/comments", "GET", {}, { postId: "1" }, 200, []),

  // === Nested Resource（空配列） ===
  "posts_{id}_comments_001.json": createFileData("/posts/:id/comments", "GET", { id: "1" }, {}, 200, []),
};

// ============================================
// サンプルデータ: demo-error（エラー系）
// ============================================

const SAMPLE_DEMO_ERROR: Record<string, FileData> = {
  // === Basic（500エラー） ===
  "users_001.json": createFileData("/users", "GET", {}, {}, 500, { error: "Internal Server Error" }),
  "posts_001.json": createFileData("/posts", "GET", {}, {}, 500, { error: "Internal Server Error" }),
  "comments_001.json": createFileData("/comments", "GET", {}, {}, 500, { error: "Internal Server Error" }),

  // === Path Parameter（404） ===
  "users_{id}_001.json": createFileData("/users/:id", "GET", { id: "1" }, {}, 404, { error: "User not found" }),
  "posts_{id}_001.json": createFileData("/posts/:id", "GET", { id: "1" }, {}, 404, { error: "Post not found" }),

  // === Query String（500エラー） ===
  "posts_002.json": createFileData("/posts", "GET", {}, { userId: "1" }, 500, { error: "Internal Server Error" }),
  "comments_002.json": createFileData("/comments", "GET", {}, { postId: "1" }, 500, { error: "Internal Server Error" }),

  // === Nested Resource（500エラー） ===
  "posts_{id}_comments_001.json": createFileData("/posts/:id/comments", "GET", { id: "1" }, {}, 500, {
    error: "Internal Server Error",
  }),
};

// ============================================
// サンプルデータ集約
// ============================================

const SAMPLE_DATA: Record<string, Record<string, FileData>> = {
  demo: SAMPLE_DEMO,
  "demo-empty": SAMPLE_DEMO_EMPTY,
  "demo-error": SAMPLE_DEMO_ERROR,
};

/**
 * サンプルファイルを書き込む
 */
async function writeSampleFiles(filesDir: string): Promise<void> {
  for (const [pattern, files] of Object.entries(SAMPLE_DATA)) {
    for (const [filePath, data] of Object.entries(files)) {
      const fullPath = path.join(filesDir, pattern, filePath);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, JSON.stringify(data, null, 2), "utf-8");
    }
  }
}

/**
 * init コマンド
 * - .snaperro/files ディレクトリを作成
 * - snaperro.config.ts を作成（存在しない場合）
 * - .gitignore に .snaperro/ を追加
 */
export async function initCommand(): Promise<void> {
  const cwd = process.cwd();

  consola.start("snaperro を初期化しています...");

  // 1. .snaperro/files ディレクトリを作成
  const filesDir = path.join(cwd, ".snaperro", "files");
  await fs.mkdir(filesDir, { recursive: true });
  consola.success(".snaperro/files ディレクトリを作成しました");

  // 2. サンプルデータを配置
  await writeSampleFiles(filesDir);
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
