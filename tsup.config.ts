import { defineConfig } from "tsup";

export default defineConfig([
  // ライブラリ用（shebangなし）
  {
    entry: ["server/index.ts"],
    format: ["esm"],
    dts: true,
    clean: true,
    splitting: false,
    sourcemap: true,
    target: "node18",
    outDir: "dist",
    external: ["undici"],
  },
  // CLI用（shebangあり）
  {
    entry: ["cli/index.ts"],
    format: ["esm"],
    dts: true,
    clean: false,
    splitting: false,
    sourcemap: true,
    target: "node18",
    outDir: "dist/cli",
    banner: {
      js: "#!/usr/bin/env node",
    },
    external: ["undici"],
  },
]);
