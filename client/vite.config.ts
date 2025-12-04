import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig(({ command }) => ({
  plugins: [react()],
  root: path.resolve(__dirname),
  base: command === "build" ? "/__snaperro__/client/" : "/",
  build: {
    outDir: path.resolve(__dirname, "../dist/client"),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/__snaperro__": {
        target: "http://localhost:3333",
        changeOrigin: true,
      },
    },
  },
}));
