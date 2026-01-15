# CLIコマンド

## 概要

snaperroはコマンドラインから操作可能です。
プロジェクトの初期化、サーバー起動、デモ実行などをCLIで行います。

## 関連ファイル

- **CLI**: `cli/index.ts`, `cli/commands/*.ts`

---

## インストール

```bash
# グローバルインストール
npm install -g snaperro

# ローカルインストール（推奨）
npm install --save-dev snaperro
```

---

## コマンド一覧

| コマンド | 説明 |
|---------|------|
| `snaperro init` | プロジェクト初期化 |
| `snaperro start` | サーバー起動 |
| `snaperro demo` | デモページ起動 |
| `snaperro postman` | Postmanコレクション出力 |

---

## snaperro init

プロジェクトにsnaperroを初期化します。

### 実行
```bash
npx snaperro init
```

### 作成されるファイル
```
.snaperro/
├── files/           # モックデータ保存先
└── state.json       # 状態ファイル

snaperro.config.ts   # 設定ファイル
```

### 処理内容
1. `.snaperro/` ディレクトリ作成
2. `.snaperro/files/` ディレクトリ作成
3. `.snaperro/state.json` 初期ファイル作成
4. `snaperro.config.ts` テンプレート作成
5. `.gitignore` に `.snaperro/files/` 追加

---

## snaperro start

サーバーを起動します。

### 実行
```bash
npx snaperro start
npx snaperro start -p 4000
npx snaperro start --verbose
```

### オプション

| オプション | 短縮形 | 説明 | デフォルト |
|-----------|--------|------|----------|
| `--port <port>` | `-p` | ポート番号 | `3333` |
| `--config <path>` | `-c` | 設定ファイルパス | `snaperro.config.ts` |
| `--env <path>` | `-e` | 環境変数ファイルパス | - |
| `--verbose` | `-v` | 詳細ログ表示 | `false` |
| `--no-watch` | - | 設定ファイル監視を無効化 | `false` |

### 処理内容
1. 設定ファイル読み込み（`snaperro.config.ts`）
2. 設定検証（Zodスキーマ）
3. 前回の状態復元（`.snaperro/state.json`）
4. サーバー起動
5. ブラウザ自動起動（GUI）
6. 設定ファイル監視（変更時に自動リロード）

### 設定ファイル監視
`--no-watch` を指定しない限り、設定ファイルの変更を監視し自動リロードします。

---

## snaperro demo

デモページをブラウザで開きます。

### 実行
```bash
npx snaperro demo
npx snaperro demo -p 4000
```

### オプション

| オプション | 短縮形 | 説明 | デフォルト |
|-----------|--------|------|----------|
| `--port <port>` | `-p` | ポート番号 | `3333` |

### アクセス先
```
http://localhost:3333/__snaperro__/demo
```

---

## snaperro postman

Postmanコレクションを出力します。

### 実行
```bash
npx snaperro postman
```

### 出力
設定ファイルで定義されたAPIエンドポイントをPostmanコレクション形式で出力します。

---

## 開発時の実行方法

### ビルド後に実行
```bash
pnpm build && npx . start
```

### ビルドなしで直接実行
```bash
npx tsx cli/index.ts start
```

---

## 関連ドキュメント

- [configuration.md](configuration.md) - 設定ファイルの詳細
