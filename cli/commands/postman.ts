/**
 * Postman collection output command
 * Output snaperro's internal control API in Postman format
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const POSTMAN_COLLECTION_PATH = "debug/postman-collection.json";

/**
 * postman command
 * Output Postman collection as JSON to stdout
 */
export async function postmanCommand(): Promise<void> {
  const jsonPath = resolve(process.cwd(), POSTMAN_COLLECTION_PATH);

  if (!existsSync(jsonPath)) {
    console.error(`Error: ${POSTMAN_COLLECTION_PATH} not found`);
    process.exit(1);
  }

  const content = readFileSync(jsonPath, "utf-8");
  const collection = JSON.parse(content);
  console.log(JSON.stringify(collection, null, 2));
}
