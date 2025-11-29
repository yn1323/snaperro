import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // JSON Placeholder API へのプロキシ（snaperro経由）
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
      "/albums": {
        target: "http://localhost:3333",
        changeOrigin: true,
      },
      "/photos": {
        target: "http://localhost:3333",
        changeOrigin: true,
      },
      "/todos": {
        target: "http://localhost:3333",
        changeOrigin: true,
      },
      // snaperro 制御API
      "/__snaperro__": {
        target: "http://localhost:3333",
        changeOrigin: true,
      },
    },
  },
});
