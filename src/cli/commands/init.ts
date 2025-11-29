import fs from "node:fs/promises";
import path from "node:path";
import { consola } from "consola";

const CONFIG_TEMPLATE = `import { defineConfig } from 'snaperro'

export default defineConfig({
  port: 3333,

  apis: {
    // 例: ユーザーサービス
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

  // 2. snaperro.config.ts を作成（存在しない場合）
  const configPath = path.join(cwd, "snaperro.config.ts");
  try {
    await fs.access(configPath);
    consola.info("snaperro.config.ts は既に存在します");
  } catch {
    await fs.writeFile(configPath, CONFIG_TEMPLATE, "utf-8");
    consola.success("snaperro.config.ts を作成しました");
  }

  // 3. .gitignore に追加
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
      "次のステップ:",
      "1. snaperro.config.ts を編集してAPIを設定",
      "2. npx snaperro start でサーバーを起動",
    ].join("\n"),
  });
}
