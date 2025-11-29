import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  root: "gui",
  base: "/__snaperro__/gui/",
  build: {
    outDir: "dist",
  },
  server: {
    proxy: {
      "/__snaperro__": {
        target: "http://localhost:3333",
        changeOrigin: true,
      },
    },
  },
});
