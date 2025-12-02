import net from "node:net";

/**
 * 指定ポートが使用可能かチェック
 */
export function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.once("error", () => {
      resolve(false);
    });

    server.once("listening", () => {
      server.close(() => {
        resolve(true);
      });
    });

    server.listen(port);
  });
}

/**
 * 空きポートを探す（最大maxAttempts回試行）
 * @param startPort 開始ポート番号
 * @param maxAttempts 最大試行回数（デフォルト: 10）
 * @returns 空きポート番号
 * @throws 全てのポートが使用中の場合
 */
export async function findAvailablePort(startPort: number, maxAttempts = 10): Promise<number> {
  for (let i = 0; i < maxAttempts; i++) {
    const port = startPort + i;
    if (await isPortAvailable(port)) {
      return port;
    }
  }

  throw new Error(`ポート ${startPort}〜${startPort + maxAttempts - 1} は全て使用中です`);
}
