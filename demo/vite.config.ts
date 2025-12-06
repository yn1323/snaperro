import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig(({ command }) => ({
  plugins: [react()],
  root: path.resolve(__dirname),
  base: command === "build" ? "/__snaperro__/demo/" : "/",
  build: {
    outDir: path.resolve(__dirname, "../dist/demo"),
    emptyOutDir: true,
  },
  server: {
    port: 5174,
    proxy: {
      "/__snaperro__": {
        target: "http://localhost:3333",
        changeOrigin: true,
      },
      "/users": {
        target: "http://localhost:3333",
        changeOrigin: true,
      },
      "/posts": {
        target: "http://localhost:3333",
        changeOrigin: true,
      },
      "/comments": {
        target: "http://localhost:3333",
        changeOrigin: true,
      },
    },
  },
}));
