import fs from "node:fs/promises";
import path from "node:path";
import { consola } from "consola";

const CONFIG_TEMPLATE = `import { defineConfig } from 'snaperro'

export default defineConfig({
  port: 3333,
  filesDir: '.snaperro/files',

  // Upstream proxy (for corporate networks)
  // upstreamProxy: {
  //   url: "http://proxy.company.com:8080",
  // },

  apis: {
    // JSON Placeholder API (sample)
    jsonPlaceholder: {
      name: "JSON Placeholder",
      target: "https://jsonplaceholder.typicode.com",
      // headers: { "X-Api-Key": "your-api-key" },
      // maskRequestHeaders: ["Authorization", "Cookie"],
      routes: [
        // All methods (GET, POST, PUT, DELETE, etc.)
        "/users",
        "/users/:id",
        "/posts",
        "/posts/:id",
        "/posts/:id/comments",
        "/comments",
        // Or specify method explicitly:
        // "GET /users",
        // "POST /users",
      ],
    },

    // Example: Custom API
    // userService: {
    //   name: "User Service",
    //   target: "https://user-api.example.com",
    //   headers: {
    //     "X-Api-Key": process.env.USER_API_KEY!,
    //   },
    //   maskRequestHeaders: ["Authorization", "X-Api-Key", "Cookie"],
    //   routes: ["/api/users", "/api/users/:id"],
    // },
  },
})
`;

const GITIGNORE_ENTRY = "\n# snaperro\n.snaperro/\n";

// ============================================
// Helper functions
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
  requestBody?: unknown,
): FileData {
  return {
    endpoint,
    method,
    request: {
      pathParams,
      queryParams,
      headers: {},
      body: requestBody ?? null,
    },
    response: {
      status,
      headers: { "content-type": "application/json" },
      body,
    },
  };
}

// ============================================
// Base data (JSONPlaceholder compliant)
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

// Posts by user
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
// Sample data: demo (success cases)
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

  // === POST: Create user ===
  "users_002.json": createFileData(
    "/users",
    "POST",
    {},
    {},
    201,
    {
      id: 11,
      name: "New User",
      username: "newuser",
      email: "newuser@example.com",
      phone: "123-456-7890",
      website: "newuser.com",
    },
    {
      name: "New User",
      username: "newuser",
      email: "newuser@example.com",
      phone: "123-456-7890",
      website: "newuser.com",
    },
  ),

  // === POST: Create post ===
  "posts_005.json": createFileData(
    "/posts",
    "POST",
    {},
    {},
    201,
    { userId: 1, id: 101, title: "New Post Title", body: "This is a new post content..." },
    { userId: 1, title: "New Post Title", body: "This is a new post content..." },
  ),

  // === POST: Create comment ===
  "comments_005.json": createFileData(
    "/comments",
    "POST",
    {},
    {},
    201,
    { postId: 1, id: 501, name: "New comment", email: "commenter@example.com", body: "This is a new comment" },
    { postId: 1, name: "New comment", email: "commenter@example.com", body: "This is a new comment" },
  ),
};

// ============================================
// Sample data: demo-empty (empty data)
// ============================================

const SAMPLE_DEMO_EMPTY: Record<string, FileData> = {
  // === Basic (empty array) ===
  "users_001.json": createFileData("/users", "GET", {}, {}, 200, []),
  "posts_001.json": createFileData("/posts", "GET", {}, {}, 200, []),
  "comments_001.json": createFileData("/comments", "GET", {}, {}, 200, []),

  // === Path Parameter: /users/:id (404) ===
  "users_{id}_001.json": createFileData("/users/:id", "GET", { id: "1" }, {}, 404, { error: "Not Found" }),

  // === Path Parameter: /posts/:id (404) ===
  "posts_{id}_001.json": createFileData("/posts/:id", "GET", { id: "1" }, {}, 404, { error: "Not Found" }),

  // === Query String (empty array) ===
  "posts_002.json": createFileData("/posts", "GET", {}, { userId: "1" }, 200, []),
  "comments_002.json": createFileData("/comments", "GET", {}, { postId: "1" }, 200, []),

  // === Nested Resource (empty array) ===
  "posts_{id}_comments_001.json": createFileData("/posts/:id/comments", "GET", { id: "1" }, {}, 200, []),
};

// ============================================
// Sample data: demo-error (error cases)
// ============================================

const SAMPLE_DEMO_ERROR: Record<string, FileData> = {
  // === Basic (500 error) ===
  "users_001.json": createFileData("/users", "GET", {}, {}, 500, { error: "Internal Server Error" }),
  "posts_001.json": createFileData("/posts", "GET", {}, {}, 500, { error: "Internal Server Error" }),
  "comments_001.json": createFileData("/comments", "GET", {}, {}, 500, { error: "Internal Server Error" }),

  // === Path Parameter (404) ===
  "users_{id}_001.json": createFileData("/users/:id", "GET", { id: "1" }, {}, 404, { error: "User not found" }),
  "posts_{id}_001.json": createFileData("/posts/:id", "GET", { id: "1" }, {}, 404, { error: "Post not found" }),

  // === Query String (500 error) ===
  "posts_002.json": createFileData("/posts", "GET", {}, { userId: "1" }, 500, { error: "Internal Server Error" }),
  "comments_002.json": createFileData("/comments", "GET", {}, { postId: "1" }, 500, { error: "Internal Server Error" }),

  // === Nested Resource (500 error) ===
  "posts_{id}_comments_001.json": createFileData("/posts/:id/comments", "GET", { id: "1" }, {}, 500, {
    error: "Internal Server Error",
  }),
};

// ============================================
// Sample data aggregation
// ============================================

const SAMPLE_DATA: Record<string, Record<string, FileData>> = {
  demo: SAMPLE_DEMO,
  "demo-empty": SAMPLE_DEMO_EMPTY,
  "demo-error": SAMPLE_DEMO_ERROR,
};

/**
 * Write sample files
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
 * init command
 * - Create .snaperro/files directory
 * - Create snaperro.config.ts (if not exists)
 * - Add .snaperro/ to .gitignore
 */
export async function initCommand(): Promise<void> {
  const cwd = process.cwd();

  consola.start("Initializing snaperro...");

  // 1. Create .snaperro/files directory
  const filesDir = path.join(cwd, ".snaperro", "files");
  await fs.mkdir(filesDir, { recursive: true });
  consola.success("Created .snaperro/files directory");

  // 2. Place sample data
  await writeSampleFiles(filesDir);
  consola.success("Placed sample patterns (demo, demo-empty, demo-error)");

  // 3. Create snaperro.config.ts (if not exists)
  const configPath = path.join(cwd, "snaperro.config.ts");
  try {
    await fs.access(configPath);
    consola.info("snaperro.config.ts already exists");
  } catch {
    await fs.writeFile(configPath, CONFIG_TEMPLATE, "utf-8");
    consola.success("Created snaperro.config.ts");
  }

  // 4. Add to .gitignore
  const gitignorePath = path.join(cwd, ".gitignore");
  try {
    const content = await fs.readFile(gitignorePath, "utf-8");
    if (!content.includes(".snaperro/")) {
      await fs.appendFile(gitignorePath, GITIGNORE_ENTRY);
      consola.success("Added .snaperro/ to .gitignore");
    } else {
      consola.info(".gitignore already contains .snaperro/");
    }
  } catch {
    // Create .gitignore if it doesn't exist
    await fs.writeFile(gitignorePath, `${GITIGNORE_ENTRY.trim()}\n`, "utf-8");
    consola.success("Created .gitignore");
  }

  consola.box({
    title: "snaperro initialization complete 🐕",
    message: [
      "Sample patterns:",
      "  - demo (success cases)",
      "  - demo-empty (empty data)",
      "  - demo-error (error cases)",
      "",
      "Next steps:",
      "1. Start server with: npx snaperro start",
      "2. Switch patterns in GUI to verify operation",
      "3. Try demo page: http://localhost:3333/__snaperro__/demo",
    ].join("\n"),
  });
}
