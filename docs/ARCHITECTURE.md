# snaperro アーキテクチャ

## ディレクトリ構造

```
snaperro/
├── cli/                          # CLIコマンド（Commander）
│   ├── index.ts                  # CLIエントリーポイント
│   └── commands/
│       ├── init.ts               # 初期化コマンド
│       ├── start.ts              # サーバー起動コマンド
│       ├── demo.ts               # デモ起動コマンド
│       └── postman.ts            # Postmanコレクション出力
│
├── server/                       # Honoサーバー（バックエンド）
│   ├── index.ts                  # サーバーエクスポート
│   ├── handlers/
│   │   ├── index.ts              # サーバー起動・停止
│   │   ├── handler.ts            # メインリクエストハンドラー（モード振り分け）
│   │   ├── proxy.ts              # Proxyモードハンドラー
│   │   ├── recorder.ts           # Recordモードハンドラー
│   │   ├── mocker.ts             # Mockモードハンドラー
│   │   ├── smart.ts              # Smartモードハンドラー
│   │   ├── control-api.ts        # 制御API（/__snaperro__/*）
│   │   └── cors.ts               # CORSミドルウェア
│   ├── core/
│   │   ├── config.ts             # 設定ファイル読み込み（jiti使用）
│   │   ├── state.ts              # 状態管理（Mode、Scenario）
│   │   ├── storage.ts            # ファイルストレージ操作
│   │   ├── matcher.ts            # ルートマッチング・パラメータ抽出
│   │   ├── event-bus.ts          # SSEイベントバス
│   │   ├── logger.ts             # ロギング（consola）
│   │   ├── mask.ts               # ヘッダーマスキング
│   │   ├── request-utils.ts      # リクエスト処理ユーティリティ
│   │   ├── proxy-agent.ts        # アップストリームプロキシ設定
│   │   ├── port.ts               # ポート検索
│   │   ├── watcher.ts            # 設定ファイル監視
│   │   ├── api-response.ts       # APIレスポンスヘルパー
│   │   ├── builtin-apis.ts       # ビルトインAPI（jsonPlaceholder）
│   │   └── version.ts            # バージョン管理
│   └── types/
│       ├── config.ts             # 設定型定義（Zod）
│       ├── file.ts               # ファイルデータ型（shared再エクスポート）
│       └── sse.ts                # SSEイベント型
│
├── client/                       # React GUIアプリケーション
│   └── src/
│       ├── App.tsx               # アプリケーションルート
│       ├── main.tsx              # エントリーポイント
│       ├── components/           # UIコンポーネント
│       │   ├── Layout.tsx        # レイアウト（ResizablePane）
│       │   ├── TopBar.tsx        # トップバー（モード切替）
│       │   ├── ScenarioPane.tsx  # シナリオペイン
│       │   ├── FilePane.tsx      # ファイル一覧ペイン
│       │   ├── EditorPane.tsx    # JSONエディタペイン
│       │   ├── LogPanel.tsx      # リクエストログパネル
│       │   └── dialogs/          # ダイアログ類
│       ├── hooks/                # カスタムフック
│       │   ├── useSnaperroSSE.ts # SSE接続管理
│       │   ├── useSnaperroAPI.ts # API呼び出し
│       │   ├── useFileEditor.ts  # ファイル編集
│       │   └── useFavicon.ts     # ファビコン動的変更
│       └── types/                # 型定義
│
├── demo/                         # デモアプリケーション（Vite + React）
│   └── src/                      # デモページコンポーネント
│
├── shared/                       # 共有型定義（server/clientで共通）
│   └── types/
│       ├── index.ts
│       ├── file.ts               # FileData, FileRequest, FileResponse
│       ├── mode.ts               # Mode型
│       └── sse.ts                # SSEイベント型
│
├── templates/                    # 設定ファイルテンプレート
└── dist/                         # ビルド出力（tsup + vite）
```

---

## 機能→ファイルマッピング

| 機能 | Server | Client | CLI |
|------|--------|--------|-----|
| Proxyモード | `handlers/proxy.ts` | - | - |
| Recordモード | `handlers/recorder.ts` | - | - |
| Mockモード | `handlers/mocker.ts` | - | - |
| Smartモード | `handlers/smart.ts` | - | - |
| シナリオ管理 | `core/storage.ts`, `handlers/control-api.ts` | `components/ScenarioPane.tsx` | - |
| ファイル管理 | `core/storage.ts`, `handlers/control-api.ts` | `components/FilePane.tsx`, `EditorPane.tsx` | - |
| GUI | `handlers/index.ts`（静的配信） | `src/` 全体 | - |
| CLI | - | - | `commands/*.ts` |
| 設定 | `core/config.ts`, `types/config.ts` | - | `commands/start.ts` |
| SSE | `core/event-bus.ts`, `handlers/control-api.ts` | `hooks/useSnaperroSSE.ts` | - |
| 検索 | `core/storage.ts` | `components/FilePane.tsx` | - |

---

## ファイル→機能マッピング（逆引き）

### モード処理
| ファイルパス | 責務 |
|-------------|------|
| `server/handlers/handler.ts` | リクエスト受信、モード判定、振り分け |
| `server/handlers/proxy.ts` | 実APIへの転送 |
| `server/handlers/recorder.ts` | 実API転送 + JSON保存 |
| `server/handlers/mocker.ts` | JSON検索 + レスポンス返却 |
| `server/handlers/smart.ts` | モック有無で自動判定 |

### データ管理
| ファイルパス | 責務 |
|-------------|------|
| `server/core/storage.ts` | ファイルCRUD、検索、ZIP操作 |
| `server/core/state.ts` | モード・シナリオ状態管理、永続化 |
| `server/core/matcher.ts` | ルートマッチング、パスパラメータ抽出 |

### GUI
| ファイルパス | 責務 |
|-------------|------|
| `client/src/App.tsx` | 状態管理、イベントハンドラー統合 |
| `client/src/components/TopBar.tsx` | モード切替UI |
| `client/src/components/ScenarioPane.tsx` | シナリオ一覧・操作UI |
| `client/src/components/FilePane.tsx` | ファイル一覧・検索UI |
| `client/src/components/EditorPane.tsx` | JSONエディターUI |
| `client/src/components/LogPanel.tsx` | リクエストログ表示 |

---

## データフロー

### Proxyモード
```
Client → Snaperro → 実API → Snaperro → Client
                    (転送)           (そのまま返却)
```

### Recordモード
```
Client → Snaperro → 実API → Snaperro → Client
                    (転送)      ↓
                          JSON保存
                          SSE通知
```

### Mockモード
```
Client → Snaperro → JSON検索 → Snaperro → Client
                   (パラメータマッチング)  (モックレスポンス)
```

### Smartモード
```
Client → Snaperro → JSON検索
                       ↓
                    見つかった？
                   /        \
                 Yes         No
                  ↓           ↓
              Mock返却    Record実行
```

---

## 技術スタック

### サーバー
| 技術 | 用途 |
|-----|------|
| Hono | Webフレームワーク |
| @hono/node-server | Node.jsアダプター |
| undici | fetch実装、ProxyAgent |
| chokidar | ファイル監視 |
| jiti | TypeScript直接実行 |

### クライアント
| 技術 | 用途 |
|-----|------|
| React 19 | UIフレームワーク |
| Chakra UI v3 | コンポーネントライブラリ |
| Emotion | CSS-in-JS |
| next-themes | ダークモード |
| Vite | ビルドツール |

### CLI
| 技術 | 用途 |
|-----|------|
| Commander | CLIフレームワーク |
| consola | ロギング |
| open | ブラウザ起動 |

### 共通
| 技術 | 用途 |
|-----|------|
| TypeScript | 型安全性 |
| Zod v4 | スキーマ検証 |
| tsup | サーバービルド |
| Biome | Linter/Formatter |
| Vitest | テスト |
| pnpm | パッケージマネージャー |

---

## 状態管理

### サーバー状態（`server/core/state.ts`）
```typescript
{
  mode: "proxy" | "record" | "mock" | "smart",
  currentScenario: string | null
}
```
- `.snaperro/state.json` に永続化
- 変更時にSSEイベント発火

### クライアント状態（React）
- SSE経由でサーバーと同期
- `useSnaperroSSE` フックで管理

---

## 関連ドキュメント

- [INDEX.md](INDEX.md) - 機能一覧
- [features/](features/) - 各機能の詳細
- [impl/](impl/) - 実装計画・仕様書
