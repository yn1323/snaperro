import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { consola } from "consola";
import { requestFingerprint } from "../../server/v2/domain/request-fingerprint.js";
import { RandomIdGenerator } from "../../server/v2/runtime/system-adapters.js";
import { fsyncDirectory } from "../../server/v2/store/atomic.js";
import { writeBlobBytes } from "../../server/v2/store/blob-store.js";
import { FilesystemStore } from "../../server/v2/store/filesystem-store.js";
import { assertMigrationReadiness } from "../../server/v2/store/migration-readiness.js";
import {
  CatalogSnapshotSchema,
  FolderSchema,
  type Recording,
  RecordingSchema,
  type Scenario,
  ScenarioManifestSchema,
  ScenarioSchema,
} from "../../shared/contracts-v2/entities.js";
import {
  HttpMethodSchema,
  IsoDateTimeSchema,
  RequestFingerprintSchema,
  RevisionSchema,
  V2_SCHEMA_VERSION,
} from "../../shared/contracts-v2/primitives.js";

const CONFIG_TEMPLATE = `import { defineConfig } from 'snaperro'

export default defineConfig({
  configVersion: 2,
  server: {
    host: '127.0.0.1',
    port: 3333,
  },
  storage: {
    root: '.snaperro/v2',
  },

  // Mock fallback behavior when mock file is not found
  // "404" - Return 404 error (default)
  // "proxy" - Forward to real server
  // "proxy&record" - Forward to real server and record response
  mock: { fallback: '404' },

  // Request headers to mask when recording (applied to all APIs)
  // recording: { maskRequestHeaders: ['Authorization', 'Cookie'] },

  // Upstream proxy (for corporate networks)
  // proxy: {
  //   url: "http://proxy.company.com:8080",
  // },

  apis: {
    // JSON Placeholder API (sample)
    // This is a built-in API - you can remove this section if you don't need it.
    // It will still be available for demo purposes.
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

const GITIGNORE_ENTRY = "\n# snaperro\n.snaperro/v2/\n";

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

function isNotFound(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function isAlreadyExists(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}

function errorValue(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function hasV2GitignoreEntry(content: string): boolean {
  return content.split(/\r?\n/u).some((line) => /^\/?\.snaperro\/v2\/?[\t ]*$/u.test(line));
}

async function updateExistingGitignore(gitignorePath: string): Promise<"updated" | "unchanged"> {
  const content = await fs.readFile(gitignorePath, "utf-8");
  if (hasV2GitignoreEntry(content)) return "unchanged";
  await fs.appendFile(gitignorePath, GITIGNORE_ENTRY);
  return "updated";
}

async function ensureGitignore(gitignorePath: string): Promise<"created" | "updated" | "unchanged"> {
  try {
    return await updateExistingGitignore(gitignorePath);
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }

  try {
    await fs.writeFile(gitignorePath, `${GITIGNORE_ENTRY.trim()}\n`, { encoding: "utf-8", flag: "wx" });
    return "created";
  } catch (error) {
    // Another initializer may have created the file after our missing read.
    // Re-read and append so its content is never truncated.
    if (!isAlreadyExists(error)) throw error;
    return updateExistingGitignore(gitignorePath);
  }
}

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

function headerFields(headers: Record<string, string>): Array<[string, string]> {
  return Object.entries(headers);
}

function queryFields(query: Record<string, string>): Array<[string, string]> {
  return Object.entries(query);
}

function contentType(headers: Record<string, string>): string {
  return Object.entries(headers).find(([name]) => name.toLowerCase() === "content-type")?.[1] ?? "application/json";
}

async function writeJsonBody(store: FilesystemStore, value: unknown, headers: Record<string, string>) {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error("Sample JSON body cannot be serialized");
  return writeBlobBytes(store.blobs, Buffer.from(serialized, "utf8"), {
    mediaType: contentType(headers),
    contentEncoding: null,
  });
}

async function seedSampleStore(cwd: string): Promise<boolean> {
  const storageRoot = path.join(cwd, ".snaperro", "v2");
  try {
    const stat = await fs.stat(storageRoot);
    if (!stat.isDirectory()) throw new Error(`The v2 storage path is not a directory: ${storageRoot}`);
    try {
      await fs.access(path.join(storageRoot, "store.json"));
      return false;
    } catch {
      throw new Error(`An incomplete v2 store already exists: ${storageRoot}`);
    }
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }

  const storageParent = path.dirname(storageRoot);
  const stagingRoot = path.join(storageParent, `.v2.init.${randomUUID()}`);
  const store = new FilesystemStore(stagingRoot);
  const ids = new RandomIdGenerator();
  const timestamp = IsoDateTimeSchema.parse(new Date().toISOString());
  let storagePublished = false;
  const folder = FolderSchema.parse({
    id: ids.nextFolderId(),
    name: "Samples",
    revision: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  const scenarios: Scenario[] = [];

  try {
    await store.initialize();
    for (const [scenarioName, files] of Object.entries(SAMPLE_DATA)) {
      const scenarioId = ids.nextScenarioId();
      const recordings: Recording[] = [];
      for (const [filename, file] of Object.entries(files)) {
        const requestBody =
          file.request.body === null ? null : await writeJsonBody(store, file.request.body, file.request.headers);
        const responseBody =
          file.response.body === null && [204, 205, 304].includes(file.response.status)
            ? null
            : await writeJsonBody(store, file.response.body, file.response.headers);
        const fingerprint = RequestFingerprintSchema.parse(
          requestFingerprint({
            method: file.method,
            route: file.endpoint,
            pathParams: file.request.pathParams,
            query: queryFields(file.request.queryParams),
            body: file.request.body === null ? { kind: "empty" } : { kind: "json", value: file.request.body },
          }),
        );
        recordings.push(
          RecordingSchema.parse({
            id: ids.nextRecordingId(),
            scenarioId,
            filename,
            revision: 0,
            createdAt: timestamp,
            updatedAt: timestamp,
            route: file.endpoint,
            method: HttpMethodSchema.parse(file.method.toUpperCase()),
            requestFingerprint: fingerprint,
            request: {
              pathParams: file.request.pathParams,
              query: queryFields(file.request.queryParams),
              headers: headerFields(file.request.headers),
              body: requestBody,
            },
            response: {
              status: file.response.status,
              statusText: "",
              headers: headerFields(file.response.headers),
              body: responseBody,
            },
          }),
        );
      }
      const scenario = ScenarioSchema.parse({
        id: scenarioId,
        folderId: folder.id,
        name: scenarioName,
        revision: 0,
        recordingsCount: recordings.length,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      await store.manifests.create(
        ScenarioManifestSchema.parse({
          schemaVersion: V2_SCHEMA_VERSION,
          scenarioId,
          revision: 0,
          recordings,
        }),
      );
      scenarios.push(scenario);
    }

    const initialCatalog = await store.catalogs.read();
    await store.catalogs.compareAndSwap(
      initialCatalog.revision,
      CatalogSnapshotSchema.parse({
        schemaVersion: V2_SCHEMA_VERSION,
        revision: RevisionSchema.parse(1),
        mode: "smart",
        currentScenarioId: scenarios.at(0)?.id ?? null,
        folders: [folder],
        scenarios,
      }),
    );
    const integrity = await store.verifyIntegrity();
    if (!integrity.ok) throw new Error(`Initialized v2 store failed integrity checks: ${integrity.errors.join("; ")}`);
    await fsyncDirectory(stagingRoot);
    await fs.rename(stagingRoot, storageRoot);
    storagePublished = true;
    try {
      await fsyncDirectory(storageParent);
    } catch (error) {
      throw new Error(
        `The v2 sample store was published at ${storageRoot}, but parent-directory durability could not be confirmed: ${errorValue(error).message}. Re-run snaperro init to verify the existing store.`,
        { cause: error },
      );
    }
    return true;
  } catch (error) {
    if (storagePublished) throw error;
    try {
      await fs.rm(stagingRoot, { recursive: true, force: true });
    } catch (cleanupError) {
      const primary = errorValue(error);
      const cleanup = errorValue(cleanupError);
      throw new AggregateError(
        [primary, cleanup],
        `${primary.message}; additionally, failed to remove the incomplete v2 staging directory ${stagingRoot}: ${cleanup.message}`,
        { cause: error },
      );
    }
    throw error;
  }
}

/**
 * init command
 * - Create an atomic v2 store with sample scenarios
 * - Create snaperro.config.ts (if not exists)
 * - Add .snaperro/v2/ to .gitignore
 */
export interface InitCommandOptions {
  cwd?: string;
}

export async function initCommand(options: InitCommandOptions = {}): Promise<void> {
  const cwd = path.resolve(options.cwd ?? process.cwd());

  // Refuse before creating config, ignore rules, or a sample store. Otherwise a
  // native sample destination would hide the legacy data and block migration.
  await assertMigrationReadiness(path.join(cwd, ".snaperro", "files"), path.join(cwd, ".snaperro", "v2"));

  consola.start("Initializing snaperro...");

  // 1. Create the v2 store and sample catalog.
  const snaperroDir = path.join(cwd, ".snaperro");
  await fs.mkdir(snaperroDir, { recursive: true });
  if (await seedSampleStore(cwd)) consola.success("Created v2 sample store (demo, demo-empty, demo-error)");
  else consola.info("The v2 store already exists; sample data was left unchanged");

  // 2. Create snaperro.config.ts (if not exists)
  const configPath = path.join(cwd, "snaperro.config.ts");
  try {
    await fs.writeFile(configPath, CONFIG_TEMPLATE, { encoding: "utf-8", flag: "wx" });
    consola.success("Created snaperro.config.ts");
  } catch (error) {
    if (!isAlreadyExists(error)) throw error;
    consola.info("snaperro.config.ts already exists");
  }

  // 3. Add the v2 store to .gitignore.
  const gitignorePath = path.join(cwd, ".gitignore");
  const gitignoreResult = await ensureGitignore(gitignorePath);
  if (gitignoreResult === "created") consola.success("Created .gitignore");
  else if (gitignoreResult === "updated") consola.success("Added snaperro entries to .gitignore");
  else consola.info(".gitignore already contains snaperro entries");

  consola.box({
    title: "snaperro initialization complete 🐕",
    message: [
      "Sample scenarios:",
      "  - demo (success cases)",
      "  - demo-empty (empty data)",
      "  - demo-error (error cases)",
      "",
      "Next steps:",
      "1. Start server with: npx snaperro start",
      "2. Switch scenarios in GUI to verify operation",
      "3. Try demo page: http://localhost:3333/__snaperro__/demo",
    ].join("\n"),
  });
}
