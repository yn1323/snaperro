# snaperro

<p align="center">
  <img src="https://raw.githubusercontent.com/yn1323/snaperro/main/logo.png" alt="snaperro Logo" width="200" />
</p>

モックプロキシサーバー。複数のAPIからのレスポンスを記録・再生し、開発・テストを効率化します。

## 名前の由来

- **snap**: スナップショット、素早くキャプチャする
- **perro**: スペイン語で「犬」
- 「忠実にデータを取ってくる犬」というイメージ

## 特徴

- **3つのモード**: Proxy（透過）/ Record（録画）/ Mock（再生）
- **パラメータマッチング**: パスパラメータ・クエリパラメータで正確にマッチング
- **状態の永続化**: モード・パターンをサーバー再起動後も保持
- **TypeScript設定**: 型安全な設定ファイル

---

## ユーザー向け

### クイックスタート

```bash
# インストール
npm install -D snaperro

# 初期化（.snaperro/, snaperro.config.ts を生成）
npx snaperro init

# サーバー起動
npx snaperro start
```

### 設定ファイル

#### snaperro.config.ts

```typescript
import { defineConfig } from 'snaperro'

export default defineConfig({
  port: 3333,

  apis: {
    userService: {
      name: "ユーザーサービス",
      target: "https://api.example.com",
      headers: {
        "X-Api-Key": process.env.API_KEY!,
      },
      routes: [
        "/api/users",
        "/api/users/:id",
        "/api/users/:id/profile",
      ],
    },

    orderService: {
      name: "注文サービス",
      target: "https://order-api.example.com",
      routes: [
        "/api/orders",
        "/api/orders/:id",
        "/api/users/:userId/orders",
      ],
    },
  },
})
```

#### .env

```bash
# API キー等の機密情報
API_KEY=your-api-key-here
```

### CLI コマンド

| コマンド | 説明 |
|---------|------|
| `npx snaperro init` | プロジェクトを初期化 |
| `npx snaperro start` | サーバーを起動 |
| `npx snaperro start -p 4000` | ポート指定で起動 |
| `npx snaperro postman` | Postmanコレクションを出力 |

### 3つのモード

| モード | 本物のAPI | JSON保存 | 返すもの |
|-------|----------|---------|---------|
| **Proxy** | アクセスする | しない | 本物のレスポンス |
| **Record** | アクセスする | する | 本物のレスポンス |
| **Mock** | アクセスしない | しない | 保存済みJSON |

### パターンとは

「パターン」はモックデータのセットを管理するフォルダです。

```
.snaperro/
├── state.json              ← サーバー状態（モード、パターン）
└── recordings/
    ├── 正常系フル/           ← パターン「正常系フル」
    │   ├── api_users_001.json
    │   ├── api_users_{id}_001.json
    │   └── api_orders_001.json
    ├── 空データ/             ← パターン「空データ」
    │   └── api_users_001.json
    └── エラー系/             ← パターン「エラー系」
        └── api_users_001.json
```

パターンを切り替えると、異なるモックデータを使い分けられます。
サーバーを再起動しても、前回のモードとパターンが復元されます。

### ルート定義とマッチング

#### パスパラメータ

`:param` 形式でパスパラメータを定義します。

```typescript
routes: [
  "/api/users",           // 完全一致
  "/api/users/:id",       // :id がパラメータ
  "/api/users/:id/orders/:orderId",  // 複数パラメータ
]
```

#### マッチング例

```typescript
routes: ["/api/users/:id"]
```

| リクエスト | マッチ | pathParams |
|-----------|--------|------------|
| `/api/users/123` | Yes | `{ id: "123" }` |
| `/api/users/abc` | Yes | `{ id: "abc" }` |
| `/api/users` | No | - |
| `/api/users/123/profile` | No | - |

#### Record時の動作

- 同一パラメータのリクエスト → 既存ファイルを上書き
- 新規パラメータのリクエスト → 新規ファイルを作成

#### Mock時の動作

- パスパラメータ・クエリパラメータが完全一致するファイルを返す
- マッチするファイルがない場合は 404 エラー

### ファイル構成

```
your-project/
├── snaperro.config.ts     # 設定ファイル（Git管理する）
├── .env                   # 機密情報（Git管理しない）
├── .env.example           # 環境変数テンプレ（Git管理する）
└── .snaperro/             # 録画データ（Git管理しない）
    ├── state.json         # サーバー状態
    └── recordings/
        ├── 正常系フル/
        │   ├── api_users_001.json
        │   └── api_users_{id}_001.json
        └── エラー系/
            └── api_users_001.json
```

---

## 開発者向け

### ローカル開発（npm publish せずにCLIを試す方法）

```bash
# 1. 依存関係をインストール
pnpm install

# 2. ビルド
pnpm build

# 3. ローカルでCLIを実行
npx . init
npx . start
```

開発中（ビルドなしで直接実行）:

```bash
npx tsx src/cli/index.ts init
npx tsx src/cli/index.ts start
```

### 開発コマンド

**○○したいとき:**

| やりたいこと | コマンド |
|-------------|---------|
| 開発中にコード変更を監視したい | `pnpm dev` |
| 本番用にビルドしたい | `pnpm build` |
| テストを実行したい | `pnpm test` |
| テストを監視モードで実行したい | `pnpm test:watch` |
| コードを整形したい | `pnpm format` |
| 型エラーを確認したい | `pnpm type-check` |

### プロジェクト構成

```
snaperro/
├── src/
│   ├── index.ts              # エクスポート（defineConfig等）
│   ├── cli/                  # CLIコマンド
│   │   ├── index.ts
│   │   ├── commands/
│   │   │   ├── init.ts
│   │   │   ├── postman.ts
│   │   │   └── start.ts
│   ├── server/               # Honoサーバー
│   │   ├── index.ts
│   │   ├── proxy.ts
│   │   ├── recorder.ts
│   │   ├── mocker.ts
│   │   └── control-api.ts
│   ├── core/                 # コアロジック
│   │   ├── config.ts
│   │   ├── state.ts
│   │   ├── storage.ts
│   │   ├── matcher.ts
│   │   └── logger.ts
│   └── types/                # 型定義
│       ├── config.ts
│       └── recording.ts
├── templates/                # initで生成するテンプレート
└── doc/                      # ドキュメント
```

---

## 技術スタック

| 項目 | 選定 |
|------|------|
| サーバー | Hono |
| CLI | Commander |
| ログ | Consola |
| パスマッチング | Picomatch |
| Linter/Formatter | Biome |
| テスト | Vitest |

## 動作要件

- Node.js 18以上
- tsx がインストールされていること（peerDependencies）

## ライセンス

MIT
