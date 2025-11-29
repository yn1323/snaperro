# snaperro

<p align="center">
  <img src="https://raw.githubusercontent.com/yn1323/snaperro/main/logo.png" alt="snaperro Logo" width="200" />
</p>

GUI付きモックプロキシサーバー。複数のAPIからのレスポンスを記録・再生し、開発・テストを効率化します。

## 名前の由来

- **snap**: スナップショット、素早くキャプチャする
- **perro**: スペイン語で「犬」
- 「忠実にデータを取ってくる犬」というイメージ

## 特徴

- **3つのモード**: Proxy（透過）/ Record（録画）/ Mock（再生）
- **Web GUI**: ブラウザからモード切替・パターン管理
- **連番対応**: 同一エンドポイントへの複数リクエストを連番で管理
- **メソッド別振り分け**: GET/POST等で異なるAPIに振り分け可能
- **TypeScript設定**: 型安全な設定ファイル

---

## ユーザー向け

### クイックスタート

```bash
# インストール
npm install -D snaperro

# 初期化（.snaperro/, snaperro.config.ts, .env.example を生成）
npx snaperro init

# サーバー起動
npx snaperro start
```

サーバーが起動すると `http://localhost:3333` でGUIにアクセスできます。

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
      match: ["/api/users/**"],
    },

    // メソッド別に振り分け
    userWrite: {
      name: "ユーザー作成",
      target: "https://write-api.example.com",
      match: ["POST /api/users/**", "PUT /api/users/**"],
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
| `npx snaperro start --verbose` | 詳細ログを出力 |
| `npx snaperro demo` | デモページを起動 |

### 3つのモード

| モード | 本物のAPI | JSON保存 | 返すもの |
|-------|----------|---------|---------|
| **Proxy** | アクセスする | しない | 本物のレスポンス |
| **Record** | アクセスする | する | 本物のレスポンス |
| **Mock** | アクセスしない | しない | 保存済みJSON |

### パターンとは

「パターン」はモックデータのセットを管理するフォルダです。

```
.snaperro/recordings/
├── 正常系/           ← パターン「正常系」
│   └── api/users/GET_1.json
├── 空データ/         ← パターン「空データ」
│   └── api/users/GET_1.json
└── エラー系/         ← パターン「エラー系」
    └── api/users/GET_1.json
```

GUIでパターンを切り替えると、異なるモックデータを使い分けられます。

### 連番の動作

同じAPIに複数回リクエストがある場合、連番で管理されます。

**Record時:**
```
1回目 GET /api/users → api/users/GET_1.json に保存
2回目 GET /api/users → api/users/GET_2.json に保存
3回目 GET /api/users → api/users/GET_3.json に保存
```

**Mock時:**
```
1回目 GET /api/users → api/users/GET_1.json を返す
2回目 GET /api/users → api/users/GET_2.json を返す
3回目 GET /api/users → api/users/GET_3.json を返す（なければGET_2.jsonを返す）
```

### matchパターンの書き方

glob形式でパスを指定します。メソッド指定も可能です。

| パターン | 説明 |
|---------|------|
| `/api/users/**` | `/api/users` 以下すべて（全メソッド） |
| `/api/users/*` | `/api/users/xxx` のみ（1階層） |
| `GET /api/users/**` | GETメソッドのみマッチ |
| `POST /api/users/**` | POSTメソッドのみマッチ |

**例: 同じパスでメソッド別に振り分け**

```typescript
apis: {
  userRead: {
    name: "ユーザー取得",
    target: "https://read-api.example.com",
    match: ["GET /api/users/**"],
  },
  userWrite: {
    name: "ユーザー作成",
    target: "https://write-api.example.com",
    match: ["POST /api/users/**", "PUT /api/users/**"],
  },
}
```

### デモ

JSON Placeholder API を使ったデモ環境を起動できます：

```bash
npx snaperro demo
```

詳細は [doc/demo.md](doc/demo.md) を参照してください。

### ファイル構成

```
your-project/
├── snaperro.config.ts     # 設定ファイル（Git管理する）
├── .env                   # 機密情報（Git管理しない）
├── .env.example           # 環境変数テンプレ（Git管理する）
└── .snaperro/             # 録画データ（Git管理しない）
    └── recordings/
        ├── 正常系/
        │   └── api/users/GET_1.json
        └── エラー系/
            └── api/users/GET_1.json
```

---

## 開発者向け

### ローカル開発（npm publish せずに使う方法）

このリポジトリをローカルで開発し、別プロジェクトで使用する方法：

```bash
# 1. リポジトリをクローン
git clone https://github.com/your-org/snaperro.git
cd snaperro

# 2. 依存関係をインストール
pnpm install

# 3. ビルド
pnpm build
pnpm build:gui

# 4. グローバルにリンク
pnpm link --global

# 5. 別プロジェクトでリンク
cd /path/to/your-project
npm link snaperro

# 6. 使用
npx snaperro init
npx snaperro start
```

#### リンク解除

```bash
# 別プロジェクトでリンク解除
npm unlink snaperro

# グローバルリンク解除
cd /path/to/snaperro
pnpm unlink --global
```

### 開発コマンド

**○○したいとき:**

| やりたいこと | コマンド |
|-------------|---------|
| 開発中にコード変更を監視したい | `pnpm dev` |
| 本番用にビルドしたい | `pnpm build && pnpm build:gui` |
| テストを実行したい | `pnpm test` |
| テストを監視モードで実行したい | `pnpm test:watch` |
| コードを整形したい | `pnpm format` |
| 型エラーを確認したい | `pnpm type-check && pnpm type-check:gui` |
| 本体だけビルドしたい | `pnpm build` |
| GUIだけビルドしたい | `pnpm build:gui` |
| GUIを開発モードで起動したい | `pnpm dev:gui` |

### プロジェクト構成

```
snaperro/
├── src/
│   ├── index.ts              # エクスポート（defineConfig等）
│   ├── cli/                  # CLIコマンド
│   │   ├── index.ts
│   │   ├── commands/
│   │   │   ├── init.ts
│   │   │   ├── start.ts
│   │   │   └── demo.ts
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
├── gui/                      # React GUI
│   ├── src/
│   │   ├── App.tsx
│   │   ├── components/
│   │   └── hooks/
│   └── dist/                 # ビルド済み
├── demo/                     # デモページ
├── templates/                # initで生成するテンプレート
└── doc/                      # ドキュメント
```

---

## 技術スタック

| 項目 | 選定 |
|------|------|
| サーバー | Hono |
| GUI | React |
| GUIビルド | Vite |
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
