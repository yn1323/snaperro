import { createPostmanCollection } from "../postman-collection.js";

/**
 * postman command
 * Output Postman collection as JSON to stdout
 */
export async function postmanCommand(): Promise<void> {
  console.log(JSON.stringify(createPostmanCollection(), null, 2));
}
