import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { builtinModules } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "snaperro-package-"));

const fail = (message) => {
  throw new Error(`Package verification failed: ${message}`);
};

try {
  await import(pathToFileURL(path.join(root, packageJson.exports["."].import)).href);

  const externalImports = new Set();
  for (const outputFile of ["dist/index.js", "dist/index.d.ts", "dist/cli/index.js"]) {
    const output = await readFile(path.join(root, outputFile), "utf8");
    const importPatterns = [
      /^\s*(?:import|export)\s+.*?\sfrom\s+["']([^"']+)["'];?\s*$/gm,
      /^\s*import\s+["']([^"']+)["'];?\s*$/gm,
    ];
    for (const pattern of importPatterns) {
      for (const match of output.matchAll(pattern)) {
        const specifier = match[1];
        if (specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("node:")) continue;
        const dependency = specifier.startsWith("@")
          ? specifier.split("/").slice(0, 2).join("/")
          : specifier.split("/")[0];
        if (!builtinModules.includes(dependency)) externalImports.add(dependency);
      }
    }
  }
  for (const dependency of externalImports) {
    if (!packageJson.dependencies[dependency]) fail(`built output imports undeclared runtime dependency ${dependency}`);
  }

  const cli = spawnSync(process.execPath, [path.join(root, packageJson.bin.snaperro), "--help"], {
    cwd: root,
    encoding: "utf8",
  });
  if (cli.status !== 0) fail(`CLI smoke test exited with ${cli.status}: ${cli.stderr}`);
  if (!cli.stdout.includes("migrate") || !cli.stdout.includes("doctor")) {
    fail("CLI help is missing v2 maintenance commands");
  }

  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const npmEnvironment = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.toLowerCase().startsWith("npm_config_")),
  );
  const packed = execFileSync(npm, ["pack", "--json", "--pack-destination", temporaryDirectory], {
    cwd: root,
    encoding: "utf8",
    env: { ...npmEnvironment, npm_config_cache: path.join(temporaryDirectory, "npm-cache") },
  });
  const [manifest] = JSON.parse(packed);
  if (!manifest || manifest.name !== packageJson.name || manifest.version !== packageJson.version) {
    fail("npm pack returned an unexpected package identity");
  }

  const entries = new Map(manifest.files.map((entry) => [entry.path, entry]));
  const requiredFiles = [
    "LICENSE",
    "README.md",
    "package.json",
    "logo.png",
    "dist/index.js",
    "dist/index.d.ts",
    "dist/cli/index.js",
    "dist/client/index.html",
    "dist/demo/index.html",
  ];
  for (const requiredFile of requiredFiles) {
    if (!entries.has(requiredFile)) fail(`tarball is missing ${requiredFile}`);
  }
  if (![...entries].some(([file]) => /^dist\/client\/assets\/.*\.js$/.test(file))) {
    fail("tarball is missing the GUI JavaScript bundle");
  }
  if (![...entries].some(([file]) => /^dist\/demo\/assets\/.*\.js$/.test(file))) {
    fail("tarball is missing the demo JavaScript bundle");
  }

  const forbiddenPrefixes = [".github/", "client/src/", "debug/", "demo/src/", "server/", "shared/"];
  const forbiddenFile = [...entries.keys()].find((file) => forbiddenPrefixes.some((prefix) => file.startsWith(prefix)));
  if (forbiddenFile) fail(`tarball includes source-only file ${forbiddenFile}`);

  const cliEntry = entries.get("dist/cli/index.js");
  if ((cliEntry.mode & 0o111) === 0) fail("CLI entry is not executable");
  if (manifest.size > 8 * 1024 * 1024) fail(`tarball is unexpectedly large (${manifest.size} bytes)`);
  if (manifest.unpackedSize > 10 * 1024 * 1024) {
    fail(`unpacked package is unexpectedly large (${manifest.unpackedSize} bytes)`);
  }

  console.log(
    `Verified ${manifest.filename}: ${manifest.entryCount} files, ${manifest.size} packed bytes, ${manifest.unpackedSize} unpacked bytes`,
  );
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
