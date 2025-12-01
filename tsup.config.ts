import { defineConfig } from "tsup";

export default defineConfig([
  // ライブラリ用（shebangなし）
  {
    entry: ["src/index.ts"],
    format: ["esm"],
    dts: true,
    clean: true,
    splitting: false,
    sourcemap: true,
    target: "node18",
    outDir: "dist",
  },
  // CLI用（shebangあり）
  {
    entry: ["src/cli/index.ts"],
    format: ["esm"],
    dts: true,
    clean: false,
    splitting: false,
    sourcemap: true,
    target: "node18",
    outDir: "dist",
    banner: {
      js: "#!/usr/bin/env node",
    },
  },
]);
