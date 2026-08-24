import { defineConfig } from "tsup";
import packageJson from "./package.json" with { type: "json" };

const define = {
  __SNAPERRO_VERSION__: JSON.stringify(packageJson.version),
};

export default defineConfig([
  // Library bundle without a shebang.
  {
    entry: ["server/index.ts"],
    format: ["esm"],
    dts: true,
    clean: true,
    splitting: false,
    sourcemap: true,
    target: "node22",
    outDir: "dist",
    external: ["undici"],
    define,
  },
  // Executable CLI bundle with a shebang.
  {
    entry: ["cli/index.ts"],
    format: ["esm"],
    dts: true,
    clean: false,
    splitting: false,
    sourcemap: true,
    target: "node22",
    outDir: "dist/cli",
    banner: {
      js: "#!/usr/bin/env node",
    },
    external: ["undici"],
    define,
  },
]);
