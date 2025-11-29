import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

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
