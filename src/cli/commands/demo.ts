import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { consola } from "consola";
import { demoConfig } from "../../demo/config.js";
import { startServer } from "../../server/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface DemoOptions {
  port?: string;
}

/**
 * demo コマンド
 * デモページを起動してsnaperroの動作を確認
 */
export async function demoCommand(options: DemoOptions): Promise<void> {
  const demoPort = options.port ? Number.parseInt(options.port, 10) : 5173;
  const demoDir = path.resolve(__dirname, "../../../demo");

  consola.box({
    title: "snaperro demo",
    message: `
デモを起動しています...

  snaperro server: http://localhost:${demoConfig.port}
  demo page:       http://localhost:${demoPort}
  snaperro GUI:    http://localhost:${demoConfig.port}/__snaperro__/gui/
    `.trim(),
  });

  try {
    // 1. snaperroサーバーを起動（バックグラウンド）
    consola.start("snaperro サーバーを起動中...");
    await startServer({
      config: demoConfig,
      verbose: false,
    });

    // 2. デモページのViteサーバーを起動
    consola.start("デモページを起動中...");
    const viteProcess = spawn("npx", ["vite", "--port", String(demoPort), "--open"], {
      cwd: demoDir,
      shell: true,
      stdio: "inherit",
    });

    viteProcess.on("error", (error) => {
      consola.error("デモページの起動に失敗しました:", error.message);
    });

    // Ctrl+C でクリーンアップ
    process.on("SIGINT", () => {
      consola.info("\nデモを終了しています...");
      viteProcess.kill();
      process.exit(0);
    });
  } catch (error) {
    if (error instanceof Error) {
      consola.error(error.message);
    } else {
      consola.error("デモの起動に失敗しました");
    }
    process.exit(1);
  }
}
