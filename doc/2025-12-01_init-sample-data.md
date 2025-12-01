# initコマンドでのサンプルデータ配置

## 概要

`npx snaperro init` コマンド実行時に、サンプルのモックデータを自動配置する機能。
GUIを開いたときにユーザーがすぐに操作を体験できるようにする。

## 配置されるサンプルパターン

| パターン | 説明 |
|---------|------|
| `demo` | 正常系レスポンス（200 OK） |
| `demo-empty` | 空データレスポンス（空配列） |
| `demo-error` | エラーレスポンス（500, 404） |

## ディレクトリ構造

```
.snaperro/recordings/
├── demo/
│   ├── users/GET_1.json        # ユーザー一覧（3件）
│   ├── users/1/GET_1.json      # ユーザー詳細
│   └── posts/GET_1.json        # 投稿一覧（3件）
├── demo-empty/
│   ├── users/GET_1.json        # 空配列
│   ├── users/1/GET_1.json      # 404エラー
│   └── posts/GET_1.json        # 空配列
└── demo-error/
    ├── users/GET_1.json        # 500エラー
    ├── users/1/GET_1.json      # 404エラー
    └── posts/GET_1.json        # 500エラー
```

## 使用方法

```bash
# 初期化（サンプルデータも配置される）
npx snaperro init

# サーバー起動
npx snaperro start

# GUIでパターンを切り替えて動作確認
# http://localhost:3333/__snaperro__/gui/
```

## 設定テンプレート

initコマンドで生成される `snaperro.config.ts` には、JSON Placeholder APIの設定が含まれている：

```typescript
import { defineConfig } from 'snaperro'

export default defineConfig({
  port: 3333,

  apis: {
    jsonPlaceholder: {
      name: "JSON Placeholder",
      target: "https://jsonplaceholder.typicode.com",
      match: ["/users/**", "/posts/**", "/comments/**"],
    },
  },
})
```

## 対応エンドポイント

サンプルデータは以下のエンドポイントに対応：

| エンドポイント | 説明 |
|---------------|------|
| GET /users | ユーザー一覧 |
| GET /users/:id | ユーザー詳細 |
| GET /posts | 投稿一覧 |
