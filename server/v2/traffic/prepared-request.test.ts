import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { compileConfigV2 } from "../config/config.js";
import { PayloadLimitExceededError } from "../domain/errors.js";
import { maskRecordedHeaders, prepareTrafficRequest } from "./prepared-request.js";

const directories: string[] = [];

async function tempDirectory(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(process.cwd(), ".prepared-request-"));
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

function config(root: string, maxRequestBodyBytes = 1024) {
  return compileConfigV2(
    {
      configVersion: 2,
      storage: { root: ".snaperro/v2" },
      recording: { maxRequestBodyBytes },
      apis: {
        jsonPlaceholder: { name: "Users", target: "https://api.example.com", routes: ["POST /users/:id"] },
      },
    },
    path.join(root, "snaperro.config.ts"),
  );
}

describe("prepareTrafficRequest", () => {
  it("spools the body and canonicalizes JSON and repeated query fields", async () => {
    const root = await tempDirectory();
    const first = await prepareTrafficRequest(config(root), {
      method: "POST",
      url: "http://localhost/users/42?tag=b&tag=a",
      headers: new Headers({ "content-type": "application/json" }),
      body: new Blob(['{"name":"Ada","active":true}']).stream(),
      signal: new AbortController().signal,
    });
    const second = await prepareTrafficRequest(config(root), {
      method: "POST",
      url: "http://localhost/users/42?tag=a&tag=b",
      headers: new Headers({ "content-type": "application/problem+json" }),
      body: new Blob(['{"active":true,"name":"Ada"}']).stream(),
      signal: new AbortController().signal,
    });

    expect(first.fingerprint).toBe(second.fingerprint);
    expect(new TextDecoder().decode(await first.body.bytes())).toBe('{"name":"Ada","active":true}');
    await first.dispose();
    await second.dispose();
  });

  it("maps the streaming byte limit to a domain error and cleans partial files", async () => {
    const root = await tempDirectory();
    await expect(
      prepareTrafficRequest(config(root, 3), {
        method: "POST",
        url: "http://localhost/users/42",
        headers: new Headers(),
        body: new Blob(["four"]).stream(),
        signal: new AbortController().signal,
      }),
    ).rejects.toBeInstanceOf(PayloadLimitExceededError);
    const temporaryFiles = await fs.readdir(path.join(root, ".snaperro", "v2", "tmp"));
    expect(temporaryFiles).toEqual([]);
  });

  it("masks configured headers case-insensitively without changing other values", () => {
    expect(
      maskRecordedHeaders(
        [
          ["authorization", "secret"],
          ["x-request-id", "visible"],
        ],
        ["Authorization"],
      ),
    ).toEqual([
      ["authorization", "***"],
      ["x-request-id", "visible"],
    ]);
  });
});
