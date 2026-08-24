import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const directories: string[] = [];
const verifier = path.resolve("scripts/verify-release-tag.mjs");

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

async function repository(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "snaperro-release-tag-"));
  directories.push(directory);
  git(directory, "init", "--initial-branch=main");
  git(directory, "config", "user.name", "Snaperro Test");
  git(directory, "config", "user.email", "snaperro@example.invalid");
  await fs.writeFile(path.join(directory, "tracked.txt"), "main\n");
  git(directory, "add", "tracked.txt");
  git(directory, "commit", "-m", "main");
  git(directory, "tag", "v2.0.0");
  git(directory, "update-ref", "refs/remotes/origin/main", "HEAD");
  return directory;
}

function verify(cwd: string, tag = "v2.0.0") {
  return spawnSync(process.execPath, [verifier], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GITHUB_REF_NAME: tag,
      PACKAGE_VERSION: "2.0.0",
      RELEASE_MAIN_REF: "origin/main",
    },
  });
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe("verify-release-tag", () => {
  it("accepts the matching release tag on origin/main", async () => {
    const directory = await repository();
    expect(verify(directory)).toMatchObject({ status: 0 });
  });

  it("rejects a matching version tag whose commit is outside origin/main", async () => {
    const directory = await repository();
    git(directory, "checkout", "--detach");
    await fs.writeFile(path.join(directory, "tracked.txt"), "side\n");
    git(directory, "commit", "-am", "side");
    git(directory, "tag", "--force", "v2.0.0");

    const result = verify(directory);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("not reachable from origin/main");
  });

  it("rejects a release tag that does not match the package version", async () => {
    const directory = await repository();
    const result = verify(directory, "v2.0.1");

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("does not match the package version");
  });
});
