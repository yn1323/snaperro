import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";
import { mountStaticAssets } from "./static-assets.js";

const directories: string[] = [];

async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "snaperro-static-"));
  directories.push(directory);
  const root = path.join(directory, "client");
  await fs.mkdir(path.join(root, "assets"), { recursive: true });
  await fs.writeFile(path.join(root, "index.html"), "<!doctype html><title>Snaperro</title>");
  await fs.writeFile(path.join(root, "assets", "app.js"), "export const ready = true;");
  await fs.writeFile(path.join(directory, "secret.txt"), "not public");
  await fs.symlink(path.join(directory, "secret.txt"), path.join(root, "assets", "escape.txt"));
  return { directory, root };
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe("mountStaticAssets", () => {
  it("streams index and nested assets with explicit cache and content metadata", async () => {
    const { root } = await fixture();
    const app = new Hono();
    mountStaticAssets(app, { mountPath: "/ui", root, missingIndexMessage: "not built" });

    const index = await app.request("/ui/");
    expect(index.status).toBe(200);
    expect(index.headers.get("cache-control")).toBe("no-cache");
    expect(index.headers.get("content-type")).toContain("text/html");
    expect(index.headers.get("content-security-policy")).toContain("worker-src 'none'");
    expect(index.headers.get("cross-origin-opener-policy")).toBe("same-origin");
    expect(index.headers.get("x-frame-options")).toBe("DENY");
    expect(await index.text()).toContain("Snaperro");

    const asset = await app.request("/ui/assets/app.js", { method: "HEAD" });
    expect(asset.status).toBe(200);
    expect(asset.headers.get("cache-control")).toContain("immutable");
    expect(asset.headers.get("content-type")).toContain("text/javascript");
    expect(Number(asset.headers.get("content-length"))).toBeGreaterThan(0);
  });

  it("rejects encoded traversal and symlinks that escape the distribution root", async () => {
    const { root } = await fixture();
    const app = new Hono();
    mountStaticAssets(app, { mountPath: "/ui", root, missingIndexMessage: "not built" });

    expect((await app.request("/ui/assets/%2e%2e%2fsecret.txt")).status).toBe(404);
    expect((await app.request("/ui/assets/%5c..%5csecret.txt")).status).toBe(404);
    expect((await app.request("/ui/assets/escape.txt")).status).toBe(404);
  });

  it("returns the actionable build message only when the index is absent", async () => {
    const { directory } = await fixture();
    const app = new Hono();
    mountStaticAssets(app, {
      mountPath: "/ui",
      root: path.join(directory, "missing"),
      missingIndexMessage: "build the UI",
    });

    const response = await app.request("/ui");
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("build the UI");
  });
});
