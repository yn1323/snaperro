# シナリオ管理

## 概要

シナリオは、モックデータをグループ化するフォルダ単位の管理機能です。
テストケースや状況に応じて異なるモックデータセットを切り替えて使用できます。

## 関連ファイル

- **Server**: `server/core/storage.ts`, `server/handlers/control-api.ts`
- **Client**: `client/src/components/ScenarioPane.tsx`, `dialogs/CreateScenarioModal.tsx`
- **Types**: `shared/types/sse.ts`

---

## 主な機能

- シナリオの作成・削除・リネーム・複製
- シナリオの切り替え
- ZIPエクスポート / インポート
- フォルダによるシナリオのグルーピング

---

## ディレクトリ構造

```
.snaperro/
└── files/
    ├── 正常系フル/              ← シナリオ1
    │   ├── api_users_001.json
    │   └── api_orders_001.json
    ├── 空データ/                ← シナリオ2
    │   └── api_users_001.json
    ├── エラー系/                ← シナリオ3
    │   └── api_users_001.json
    └── テスト/                  ← フォルダ
        ├── ケースA/             ← シナリオ4
        └── ケースB/             ← シナリオ5
```

---

## API

### 内部API（Control API）

#### シナリオ一覧取得
```
GET /__snaperro__/scenarios
```
**レスポンス**:
```json
{
  "scenarios": ["正常系フル", "空データ", "エラー系"],
  "folders": [
    { "name": "テスト", "scenariosCount": 2 }
  ],
  "currentScenario": "正常系フル"
}
```

#### シナリオ作成
```
POST /__snaperro__/scenarios
Content-Type: application/json

{ "name": "新規シナリオ" }
```

#### シナリオ切り替え
```
PUT /__snaperro__/scenarios/current
Content-Type: application/json

{ "name": "エラー系" }
```

#### シナリオ削除
```
DELETE /__snaperro__/scenarios/:name
```

#### シナリオリネーム
```
PUT /__snaperro__/scenarios/:name/rename
Content-Type: application/json

{ "newName": "新しい名前" }
```

#### シナリオ複製
```
POST /__snaperro__/scenarios/:name/duplicate
Content-Type: application/json

{ "newName": "コピー先名" }
```

#### ZIPダウンロード
```
GET /__snaperro__/scenarios/:name/download
```

#### ZIPアップロード
```
POST /__snaperro__/scenarios/upload
Content-Type: multipart/form-data

file: (ZIPファイル)
```

---

## SSEイベント

| イベント | データ | 説明 |
|---------|--------|------|
| `scenario_changed` | `{ scenario, files }` | シナリオ切り替え時 |
| `scenario_created` | `{ name }` | シナリオ作成時 |
| `scenario_deleted` | `{ name }` | シナリオ削除時 |
| `scenario_renamed` | `{ oldName, newName }` | シナリオリネーム時 |

---

## 状態の永続化

```json
// .snaperro/state.json
{
  "mode": "smart",
  "currentScenario": "正常系フル"
}
```

サーバー再起動時も前回のシナリオが維持されます。

---

## GUI操作

### シナリオペイン（左ペイン）
- シナリオ一覧表示
- クリックで選択・切り替え
- 右クリックまたは[⋮]ボタンでコンテキストメニュー
  - リネーム
  - 複製
  - ZIPダウンロード
  - 削除

### 新規作成
- [+]ボタンで新規シナリオ作成ダイアログ
- フォルダ配下に作成可能

---

## 使用例

### シナリオの使い分け

| シナリオ名 | 用途 |
|-----------|------|
| `正常系フル` | 全APIが正常に返却するケース |
| `空データ` | 一覧が空のケース |
| `エラー系` | APIエラーが返却されるケース |
| `ログイン前` | 認証前の状態 |

### CIでの使用
```bash
# 特定シナリオに切り替えてテスト実行
curl -X PUT http://localhost:3333/__snaperro__/scenarios/current \
  -H "Content-Type: application/json" \
  -d '{"name": "テスト用シナリオ"}'

npm test
```

---

## 関連ドキュメント

- [file-storage.md](file-storage.md) - ファイル管理の詳細
- [sse.md](sse.md) - リアルタイム更新
