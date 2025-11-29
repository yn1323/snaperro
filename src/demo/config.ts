import type { SnaperroConfig } from "../types/config.js";

/**
 * デモ用設定
 * JSON Placeholder API を使用したサンプル設定
 */
export const demoConfig: SnaperroConfig = {
  port: 3333,

  apis: {
    jsonPlaceholder: {
      name: "JSON Placeholder",
      target: "https://jsonplaceholder.typicode.com",
      match: ["/users/**", "/posts/**", "/comments/**", "/albums/**", "/photos/**", "/todos/**"],
    },
  },
};
