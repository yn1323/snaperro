import path from "node:path";
import { consola } from "consola";
import open from "open";
import { loadConfig } from "../../server/core/config.js";
import { startServer } from "../../server/handlers/index.js";

interface StartOptions {
  port?: string;
  verbose?: boolean;
  config?: string;
}

/**
 * start コマンド
 * サーバーを起動
 */
export async function startCommand(options: StartOptions): Promise<void> {
  const configPath = path.resolve(process.cwd(), options.config ?? "snaperro.config.ts");

  consola.start("設定ファイルを読み込んでいます...");

  try {
    const config = await loadConfig(configPath);

    // コマンドラインオプションで上書き
    if (options.port) {
      config.port = Number.parseInt(options.port, 10);
    }

    const serverInfo = await startServer({
      config,
      verbose: options.verbose ?? false,
    });

    // ブラウザを自動で開く
    await open(serverInfo.guiUrl);
  } catch (error) {
    if (error instanceof Error) {
      consola.error(error.message);
    } else {
      consola.error("サーバーの起動に失敗しました");
    }
    process.exit(1);
  }
}
