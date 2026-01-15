# snaperro ドキュメントインデックス

## 概要

snaperro（スナペーロ）は、GUI付きモックプロキシサーバーです。
複数のAPIからのレスポンスを記録・再生し、開発・テストを効率化します。

---

## クイックスタート

```bash
# インストール
npm install --save-dev snaperro

# 初期化
npx snaperro init

# サーバー起動
npx snaperro start
```

ブラウザで `http://localhost:3333/__snaperro__/client` が自動で開きます。

---

## ドキュメント構成

| ドキュメント | 説明 |
|-------------|------|
| [ARCHITECTURE.md](ARCHITECTURE.md) | アーキテクチャ概要、ディレクトリ構造、データフロー |
| [features/](features/) | 各機能の詳細仕様 |
| [impl/](impl/) | 実装計画・仕様書（履歴） |

---

## 機能一覧

| 機能 | ドキュメント | 概要 |
|------|-------------|------|
| モード | [modes.md](features/modes.md) | Proxy/Record/Mock/Smartの4モード |
| シナリオ管理 | [scenario.md](features/scenario.md) | モックデータのグループ管理 |
| Web GUI | [gui.md](features/gui.md) | ブラウザベースの管理画面 |
| CLIコマンド | [cli.md](features/cli.md) | init, start, demo, postman |
| 内部制御API | [control-api.md](features/control-api.md) | `/__snaperro__/*` エンドポイント |
| 設定ファイル | [configuration.md](features/configuration.md) | `snaperro.config.ts` の詳細 |
| ファイル管理 | [file-storage.md](features/file-storage.md) | 保存形式、マッチングロジック |
| SSE | [sse.md](features/sse.md) | リアルタイム更新 |

---

## 主要概念

### 4つのモード

| モード | 動作 |
|--------|------|
| **Proxy** | 実APIへ転送 |
| **Record** | 実APIへ転送 + JSON保存 |
| **Mock** | 保存済みJSONを返却 |
| **Smart** | モックあり→Mock、なし→Record（推奨） |

### シナリオ

モックデータをフォルダ単位でグループ化。
テストケースや状況に応じて切り替え可能。

```
.snaperro/files/
├── 正常系フル/     ← シナリオ1
├── 空データ/       ← シナリオ2
└── エラー系/       ← シナリオ3
```

---

## 技術スタック

| カテゴリ | 技術 |
|---------|------|
| サーバー | Hono, Node.js |
| クライアント | React 19, Chakra UI v3 |
| CLI | Commander.js |
| バリデーション | Zod v4 |
| ビルド | tsup, Vite |
| パッケージマネージャー | pnpm |

詳細は [ARCHITECTURE.md](ARCHITECTURE.md) を参照。

---

## 関連リンク

- [GitHub リポジトリ](https://github.com/your-org/snaperro)
- [README](../README.md)
- [CLAUDE.md](../CLAUDE.md) - AI向けプロジェクト情報
