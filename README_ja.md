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

- **4つのモード**: Proxy（透過）/ Record（録画）/ Mock（再生）/ Smart（自動）
- **パラメータマッチング**: パスパラメータ・クエリパラメータで正確にマッチング
- **状態の永続化**: モード・シナリオをサーバー再起動後も保持
- **TypeScript設定**: 型安全な設定ファイル

## なぜ snaperro？

開発中、こんな問題に直面していませんか？

- 複数のAPIに依存していて、環境構築が大変
- 外部APIの障害でローカル開発が止まる
- テストデータを用意するのが面倒
- 「この状態を再現したい」けど、毎回手動で操作するのが手間

snaperroは、APIレスポンスを「スナップショット」として保存し、いつでも再生できるモックプロキシサーバーです。

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

### デモ

snaperroの動作を実際に体験できるデモ環境を提供しています。

```bash
npx snaperro demo
```

ブラウザで `http://localhost:3333/__snaperro__/demo` が開きます。

#### 体験できる機能

| 機能 | 説明 |
|-----|------|
| モード切替 | Proxy/Record/Mockの切替と動作の違いを体験 |
| Path Parameter | `/users/:id` でIDごとに異なるレスポンスを保存・返却 |
| Query String | `/posts?userId=1` でクエリごとに異なるレスポンスを保存・返却 |
| Nested Resource | `/posts/:id/comments` でネストしたリソースの取得 |

詳細な管理（シナリオ/ファイル/JSON編集）は GUI (`/__snaperro__/client`) で行います。

### 組み込みAPI

以下のAPIは設定なしで利用可能です：

| API | ターゲット | ルート |
|-----|--------|--------|
| jsonPlaceholder | https://jsonplaceholder.typicode.com | /users, /posts, /comments 等 |

これらはデモページで使用されており、必要に応じて設定で上書きできます。

### Web GUI

ブラウザから直感的にsnaperroを操作できます。

<p align="center">
  <img src="https://raw.githubusercontent.com/yn1323/snaperro/main/gui-screenshot.png" alt="snaperro GUI" width="800" />
</p>

#### アクセス

```
http://localhost:3333/__snaperro__/client
```

サーバー起動時に自動でブラウザが開きます。

#### 機能

| 機能 | 説明 |
|-----|------|
| モード切替 | Proxy/Record/Mockをワンクリックで切替 |
| シナリオ管理 | シナリオの作成・削除・複製・リネーム |
| ファイル管理 | 記録されたJSONファイルの一覧・削除 |
| JSONエディタ | レスポンスの確認・編集 |
| リアルタイム更新 | SSEで状態変更を即座に反映 |

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

#### 設定項目

| 項目 | 型 | 説明 |
|-----|-----|------|
| `port` | number | サーバーポート（デフォルト: 3333） |
| `filesDir` | string | ファイル保存ディレクトリ（デフォルト: `.snaperro/files`） |
| `mockFallback` | string | モックファイルが見つからない場合の動作（デフォルト: `"404"`） |
| `maskRequestHeaders` | string[] | 記録時にマスクするヘッダー（全API共通） |
| `apis` | object | API定義のオブジェクト |

#### API定義

| 項目 | 型 | 必須 | 説明 |
|-----|-----|-----|------|
| `name` | string | ○ | API表示名 |
| `target` | string | ○ | プロキシ先URL |
| `routes` | string[] | ○ | マッチするルートパターン |
| `headers` | object | - | 付与するヘッダー |
| `maskRequestHeaders` | string[] | - | 記録時にマスクするヘッダー |

#### 上流プロキシ

企業プロキシ環境下で使用する場合、上流プロキシを設定できます。

**設定ファイルで指定:**

```typescript
export default defineConfig({
  upstreamProxy: {
    url: "http://proxy.company.com:8080",
  },
  // ...
})
```

**環境変数で指定:**

```bash
export HTTPS_PROXY=http://proxy.company.com:8080
# 認証付きの場合
export HTTPS_PROXY=http://username:password@proxy.company.com:8080
```

設定ファイルが環境変数より優先されます。

**重要:** 上流プロキシを使用する場合、ローカルリクエストがプロキシをバイパスするように `localhost` を `NO_PROXY` に追加してください:

```bash
export NO_PROXY=localhost,127.0.0.1
```

### CLI コマンド

| コマンド | 説明 |
|---------|------|
| `npx snaperro init` | プロジェクトを初期化 |
| `npx snaperro start` | サーバーを起動 |
| `npx snaperro start -p 4000` | ポート指定で起動 |
| `npx snaperro demo` | デモ環境を起動 |
| `npx snaperro postman` | Postmanコレクションを出力 |

#### init の処理内容

1. `.snaperro/` ディレクトリを作成
2. `.snaperro/files/` ディレクトリを作成
3. `snaperro.config.ts` のテンプレートを作成（存在しない場合）
4. `.gitignore` に `.snaperro/` を追加

#### start のオプション

| オプション | 説明 |
|-----------|------|
| `-p, --port <port>` | ポート番号を指定 |
| `-c, --config <path>` | 設定ファイルのパスを指定 |
| `-e, --env <path>` | 環境変数ファイルのパスを指定（デフォルト: 設定ファイルと同じディレクトリの`.env`） |
| `-v, --verbose` | 詳細ログを表示 |

### 4つのモード

| モード | 本物のAPI | JSON保存 | 返すもの |
|-------|----------|---------|---------|
| **Proxy** | アクセスする | しない | 本物のレスポンス |
| **Record** | アクセスする | する | 本物のレスポンス |
| **Mock** | アクセスしない | しない | 保存済みJSON |
| **Smart** | 条件付き | 条件付き | mockまたは本物 |

#### Proxyモード

設定ファイルで定義されたヘッダー（API Key等）を付与して、実際のAPIにそのまま接続します。

```
リクエスト → snaperro → 実際のAPI → レスポンス
```

#### Recordモード

実際のAPIに接続しつつ、レスポンスをJSONファイルに記録します。

```
リクエスト → snaperro → 実際のAPI → レスポンス
                ↓
           JSONファイルに保存
```

- 同じエンドポイント、同じパラメータ → 上書き
- 同じエンドポイント、異なるパラメータ → 別ファイルを生成

#### Mockモード

保存済みのJSONファイルからレスポンスを返却します。実際のAPIにはアクセスしません。

```
リクエスト → snaperro → JSONファイルを検索 → レスポンス
```

#### Smartモード

既存のmockデータがあれば自動的にそれを返し、なければ実サーバーにプロキシしてレスポンスを記録します。

```
リクエスト → snaperro → mockファイルを検索
                ↓
         見つかった？ → Yes → mockを返す（API接続なし）
                ↓ No
         実際のAPIにプロキシ & 記録
                ↓
         レスポンスを返す
```

日常の開発ではこのモードを推奨します：
- mockデータが既にある場合は無駄なAPI接続を防ぐ
- 新しいエンドポイントは自動的に記録される
- APIレート制限の心配を軽減

#### Mockフォールバック動作

モックファイルが見つからない場合の動作を `mockFallback` で設定できます:

| 値 | 説明 |
|-----|------|
| `"404"` | 404エラーを返す（デフォルト） |
| `"proxy"` | 実サーバーにプロキシ |
| `"proxy&record"` | 実サーバーにプロキシ + レスポンスを記録 |

```typescript
export default defineConfig({
  mockFallback: "proxy&record",  // プロキシ + 記録にフォールバック
  // ...
})
```

### シナリオとは

「シナリオ」はモックデータのセットを管理するフォルダです。

```
.snaperro/
├── state.json              ← サーバー状態（モード、シナリオ）
└── files/
    ├── 正常系フル/           ← シナリオ「正常系フル」
    │   ├── api_users_001.json
    │   ├── api_users_{id}_001.json
    │   └── api_orders_001.json
    ├── 空データ/             ← シナリオ「空データ」
    │   └── api_users_001.json
    └── エラー系/             ← シナリオ「エラー系」
        └── api_users_001.json
```

シナリオを切り替えると、異なるモックデータを使い分けられます。
サーバーを再起動しても、前回のモードとシナリオが復元されます。

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
    └── files/
        ├── 正常系フル/
        │   ├── api_users_001.json
        │   └── api_users_{id}_001.json
        └── エラー系/
            └── api_users_001.json
```

### SSE (Server-Sent Events)

GUIやクライアントがリアルタイムで状態変更を検知するためのSSEエンドポイントを提供しています。

#### エンドポイント

```
GET /__snaperro__/events
```

#### 確認方法

```bash
# curl
curl -N http://localhost:3333/__snaperro__/events

# ブラウザコンソール
const es = new EventSource('http://localhost:3333/__snaperro__/events');
es.addEventListener('connected', (e) => console.log(JSON.parse(e.data)));
es.addEventListener('file_created', (e) => console.log(JSON.parse(e.data)));
```

#### イベント種別

| イベント | 説明 |
|---------|------|
| `connected` | 接続完了（初期状態を含む） |
| `mode_changed` | モード変更 |
| `scenario_changed` | シナリオ切替 |
| `file_created` | ファイル作成（記録時） |
| `file_updated` | ファイル更新 |
| `file_deleted` | ファイル削除 |
| `scenario_created` | シナリオ作成 |
| `scenario_deleted` | シナリオ削除 |
| `scenario_renamed` | シナリオ名変更 |

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
| GUIを開発したい | `pnpm dev:client` |
| GUIをビルドしたい | `pnpm build:client` |
| デモを開発したい | `pnpm dev:demo` |
| デモをビルドしたい | `pnpm build:demo` |

### プロジェクト構成

```
snaperro/
├── cli/                      # CLIコマンド
│   ├── index.ts
│   └── commands/
│       ├── init.ts
│       ├── postman.ts
│       └── start.ts
├── server/                   # Honoサーバー
│   ├── handlers/
│   │   ├── handler.ts
│   │   ├── proxy.ts
│   │   ├── recorder.ts
│   │   ├── mocker.ts
│   │   └── control-api.ts
│   ├── core/
│   │   ├── config.ts
│   │   ├── state.ts
│   │   ├── storage.ts
│   │   └── matcher.ts
│   └── types/
├── client/                   # React GUI
│   └── src/
├── demo/                     # デモアプリケーション
│   └── src/
└── doc/                      # ドキュメント
```

---

## 技術スタック

| 項目 | 選定 |
|------|------|
| サーバー | Hono |
| CLI | Commander |
| GUI | React + Tailwind CSS |
| スキーマ | Zod |
| ログ | Consola |
| パスマッチング | Picomatch |
| ビルド | tsup, Vite |
| Linter/Formatter | Biome |
| テスト | Vitest |

## 動作要件

- Node.js 18以上
- tsx がインストールされていること（peerDependencies）

## ライセンス

MIT
