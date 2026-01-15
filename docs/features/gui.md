# Web GUI

## 概要

snaperroはブラウザベースの管理画面を提供します。
モード切替、シナリオ管理、ファイル編集、リクエストログの確認が可能です。

## 関連ファイル

- **Client**: `client/src/` 配下全般
- **Server**: `server/handlers/index.ts`（静的ファイル配信）

---

## アクセス方法

```
http://localhost:3333/__snaperro__/client
```

`npx snaperro start` 実行時にブラウザが自動で開きます。

---

## 画面構成（3ペインレイアウト）

```
┌─────────────────────────────────────────────────────┐
│  [Proxy] [Record] [Mock] [Smart]      接続状態      │
├────────────┬────────────────┬───────────────────────┤
│ Scenarios  │ Files          │  Editor               │
│ (左ペイン)  │ (中央ペイン)    │  (右ペイン)            │
│            │                │                       │
│ ・正常系   │ 検索 [______]  │  ファイル名            │
│ ・空データ  │               │                       │
│ ・エラー系  │ /api/users    │  {                    │
│            │  └ _001.json  │    "endpoint": "...", │
│            │  └ _002.json  │    ...                │
│            │               │  }                    │
│            │ /api/orders   │                       │
│            │  └ _001.json  │  [整形] [保存] [削除]  │
├────────────┴────────────────┴───────────────────────┤
│ Request Logs (折りたたみ可能)                         │
└─────────────────────────────────────────────────────┘
```

---

## 主要コンポーネント

### TopBar（トップバー）
**ファイル**: `client/src/components/TopBar.tsx`

- 4つのモードボタン
- 現在モードのハイライト表示
- Recordモード時は録画インジケーター（●）
- 接続状態表示

### ScenarioPane（左ペイン）
**ファイル**: `client/src/components/ScenarioPane.tsx`

- シナリオ一覧表示
- フォルダ構造対応
- 新規作成、ZIPアップロード
- コンテキストメニュー（リネーム、複製、ダウンロード、削除）

### FilePane（中央ペイン）
**ファイル**: `client/src/components/FilePane.tsx`

- ファイル一覧表示
- エンドポイント別グルーピング
- 検索機能（ファイル名・エンドポイント・内容）
- ファイルアップロード

### EditorPane（右ペイン）
**ファイル**: `client/src/components/EditorPane.tsx`

- JSONエディター（textarea）
- 整形ボタン（Pretty Print）
- 保存・削除ボタン
- 検索文字列のハイライト表示

### LogPanel（ログパネル）
**ファイル**: `client/src/components/LogPanel.tsx`

- リクエストログのリアルタイム表示
- メソッド、パス、ステータス、所要時間
- 折りたたみ可能

---

## カスタムフック

| フック | 役割 | ファイル |
|-------|------|---------|
| `useSnaperroSSE` | SSE接続、状態同期 | `hooks/useSnaperroSSE.ts` |
| `useSnaperroAPI` | REST API呼び出し | `hooks/useSnaperroAPI.ts` |
| `useFileEditor` | ファイル編集状態 | `hooks/useFileEditor.ts` |
| `useFavicon` | ファビコン動的変更 | `hooks/useFavicon.ts` |
| `useScenarioNavigation` | シナリオナビゲーション | `hooks/useScenarioNavigation.ts` |

---

## 技術スタック

| 技術 | 用途 |
|-----|------|
| React 19 | UIフレームワーク |
| Chakra UI v3 | コンポーネントライブラリ |
| Emotion | CSS-in-JS |
| next-themes | ダークモード切替 |

---

## リアルタイム更新

SSE（Server-Sent Events）により、以下が自動更新されます：

- モード変更
- シナリオ切り替え
- ファイル作成・更新・削除
- リクエストログ

詳細は [sse.md](sse.md) を参照。

---

## ファビコン

モードに応じてファビコンが動的に変化：

| モード | ファビコン |
|--------|----------|
| Proxy | 通常アイコン |
| Record | 赤いドット付き |
| Mock | 青いアイコン |
| Smart | 緑のアイコン |

---

## ダークモード

`next-themes` によりシステム設定に連動したダークモードをサポート。

---

## 関連ドキュメント

- [scenario.md](scenario.md) - シナリオ管理の詳細
- [sse.md](sse.md) - リアルタイム更新
- [control-api.md](control-api.md) - 内部API
