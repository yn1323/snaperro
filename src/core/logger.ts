import { consola } from "consola";

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
    if (verbose) {
      consola.level = 4; // debug
    }
  },

  /**
   * 情報ログ
   */
  info(message: string) {
    const time = new Date().toLocaleTimeString("ja-JP");
    consola.info(`[${time}] ${message}`);
  },

  /**
   * デバッグログ（--verbose時のみ）
   */
  debug(message: string) {
    if (isVerbose) {
      const time = new Date().toLocaleTimeString("ja-JP");
      consola.debug(`[${time}] ${message}`);
    }
  },

  /**
   * 警告ログ
   */
  warn(message: string) {
    const time = new Date().toLocaleTimeString("ja-JP");
    consola.warn(`[${time}] ${message}`);
  },

  /**
   * エラーログ
   */
  error(message: string, error?: Error) {
    const time = new Date().toLocaleTimeString("ja-JP");
    consola.error(`[${time}] ${message}`);
    if (error && isVerbose) {
      consola.error(error.stack);
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

    consola.debug("Headers:");
    for (const line of masked) {
      consola.debug(line);
    }
  },

  /**
   * 起動時のボックス表示
   */
  startup(port: number, mode: string, pattern: string) {
    consola.box({
      title: "snaperro",
      message: [`Server running at http://localhost:${port}`, `Mode: ${mode} | Pattern: ${pattern || "(none)"}`].join(
        "\n",
      ),
    });
  },
};
