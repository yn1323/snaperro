/**
 * Postman コレクション出力コマンド
 * snaperro の内部制御APIをPostman形式で出力する
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const POSTMAN_COLLECTION_PATH = "debug/postman-collection.json";

/**
 * postman コマンド
 * Postmanコレクションを標準出力にJSON形式で出力
 */
export async function postmanCommand(): Promise<void> {
  const jsonPath = resolve(process.cwd(), POSTMAN_COLLECTION_PATH);

  if (!existsSync(jsonPath)) {
    console.error(`Error: ${POSTMAN_COLLECTION_PATH} が見つかりません`);
    process.exit(1);
  }

  const content = readFileSync(jsonPath, "utf-8");
  const collection = JSON.parse(content);
  console.log(JSON.stringify(collection, null, 2));
}
