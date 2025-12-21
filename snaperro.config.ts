import { defineConfig } from "snaperro";

export default defineConfig({
  port: 3333,
  filesDir: ".snaperro/files",
  mockFallback: "404",
  maskRequestHeaders: ["cookie"],

  // Available modes:
  // - proxy: Always forward to real API
  // - record: Forward to real API and save response
  // - mock: Return saved mock data
  // - smart: Return mock if exists, otherwise proxy & record (recommended)
  apis: {
    // JSON Placeholder API（サンプル）
    // jsonPlaceholder: {
    //   name: "JSON Placeholder",
    //   target: "https://jsonplaceholder.typicode.com",
    //   routes: ["/users", "/users/:id", "/posts", "/posts/:id", "/posts/:id/comments", "/comments"],
    //   maskRequestHeaders: ["connection"],
    // },
    // 例: カスタムAPI
    // userService: {
    //   name: "ユーザーサービス",
    //   target: "https://user-api.example.com",
    //   headers: {
    //     "X-Api-Key": process.env.USER_API_KEY!,
    //   },
    //   routes: ["/api/users", "/api/users/:id"],
    // },
  },
});
