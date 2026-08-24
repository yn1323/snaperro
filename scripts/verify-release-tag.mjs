import { execFileSync, spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

export async function verifyReleaseTag({
  cwd = process.cwd(),
  tag = process.env.GITHUB_REF_NAME,
  packageVersion = process.env.PACKAGE_VERSION,
  mainRef = process.env.RELEASE_MAIN_REF ?? "origin/main",
} = {}) {
  const version = packageVersion ?? JSON.parse(await readFile(path.join(cwd, "package.json"), "utf8")).version;
  if (!tag || tag !== `v${version}`) {
    throw new Error("Release tag does not match the package version");
  }

  const tagCommit = git(cwd, ["rev-parse", `${tag}^{commit}`]);
  const checkedOutCommit = git(cwd, ["rev-parse", "HEAD"]);
  if (tagCommit !== checkedOutCommit) {
    throw new Error("The checked-out commit does not match the release tag");
  }

  const ancestry = spawnSync("git", ["merge-base", "--is-ancestor", tagCommit, mainRef], {
    cwd,
    encoding: "utf8",
  });
  if (ancestry.status !== 0) {
    throw new Error(`Release tag commit is not reachable from ${mainRef}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await verifyReleaseTag();
  console.log("Verified release tag identity and main ancestry");
}
