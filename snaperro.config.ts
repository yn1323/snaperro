import { defineConfig } from 'snaperro'

export default defineConfig({
  port: 3333,

  apis: {
    // 例: ユーザーサービス
    // userService: {
    //   name: "ユーザーサービス",
    //   target: "https://user-api.example.com",
    //   headers: {
    //     "X-Api-Key": process.env.USER_API_KEY!,
    //   },
    //   match: ["/api/users/**"],
    // },
  },
})
