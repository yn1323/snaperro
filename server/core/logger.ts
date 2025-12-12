import { consola } from "consola/basic";
import pc from "picocolors";

let isVerbose = false;

/**
 * ログ出力ユーティリティ
 */
export const logger = {
  /**
   * 詳細ログモードを設定
   */
  setVerbose(verbose: boolean) {
    isVerbose = verbose;
  },

  /**
   * 情報ログ
   */
  info(message: string) {
    const time = new Date().toLocaleTimeString("ja-JP");
    console.log(`${pc.cyan("INFO")}  [${time}] ${message}`);
  },

  /**
   * デバッグログ（--verbose時のみ）
   */
  debug(message: string) {
    if (isVerbose) {
      const time = new Date().toLocaleTimeString("ja-JP");
      console.log(`${pc.gray("DEBUG")} [${time}] ${message}`);
    }
  },

  /**
   * 警告ログ
   */
  warn(message: string) {
    const time = new Date().toLocaleTimeString("ja-JP");
    console.log(`${pc.yellow("WARN")}  [${time}] ${message}`);
  },

  /**
   * エラーログ
   */
  error(message: string, error?: Error) {
    const time = new Date().toLocaleTimeString("ja-JP");
    console.log(`${pc.red("ERROR")} [${time}] ${message}`);
    if (error && isVerbose) {
      console.log(pc.red(error.stack || ""));
    }
  },

  /**
   * 機密情報をマスクしてログ出力（--verbose時のヘッダー表示用）
   */
  debugHeaders(headers: Record<string, string>) {
    if (!isVerbose) return;

    const masked = Object.entries(headers).map(([key, value]) => {
      const lowerKey = key.toLowerCase();
      if (
        lowerKey.includes("key") ||
        lowerKey.includes("secret") ||
        lowerKey.includes("token") ||
        lowerKey.includes("authorization")
      ) {
        // 最初の4文字だけ表示
        const visible = value.slice(0, 4);
        return `  ${key}: ${visible}${"*".repeat(Math.min(value.length - 4, 10))}`;
      }
      return `  ${key}: ${value}`;
    });

    console.log(pc.gray("Headers:"));
    for (const line of masked) {
      console.log(pc.gray(line));
    }
  },

  /**
   * 起動時のボックス表示
   */
  startup(port: number, guiUrl?: string, demoUrl?: string) {
    const lines = [`Server running at http://localhost:${port}`];
    if (guiUrl) {
      lines.push(`GUI: ${guiUrl}`);
    }
    if (demoUrl) {
      lines.push(`Demo: ${demoUrl}`);
    }
    consola.box({
      title: "snaperro",
      message: lines.join("\n"),
    });
  },
};
