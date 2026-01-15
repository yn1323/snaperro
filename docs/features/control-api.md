# 内部制御API

## 概要

snaperroは `/__snaperro__/` プレフィックスで内部制御APIを提供します。
GUI、外部ツール、スクリプトからの操作に使用します。

## 関連ファイル

- **Server**: `server/handlers/control-api.ts`
- **Types**: `shared/types/sse.ts`

---

## エンドポイント一覧

### 状態管理

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/__snaperro__/status` | サーバー状態一括取得 |
| GET | `/__snaperro__/mode` | 現在のモード取得 |
| PUT | `/__snaperro__/mode` | モード変更 |

### シナリオ管理

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/__snaperro__/scenarios` | シナリオ一覧 |
| POST | `/__snaperro__/scenarios` | シナリオ作成 |
| PUT | `/__snaperro__/scenarios/current` | シナリオ切り替え |
| DELETE | `/__snaperro__/scenarios/:name` | シナリオ削除 |
| PUT | `/__snaperro__/scenarios/:name/rename` | シナリオリネーム |
| POST | `/__snaperro__/scenarios/:name/duplicate` | シナリオ複製 |
| GET | `/__snaperro__/scenarios/:name/download` | ZIPダウンロード |
| POST | `/__snaperro__/scenarios/upload` | ZIPアップロード |

### ファイル管理

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/__snaperro__/scenarios/:scenario/files` | ファイル一覧 |
| GET | `/__snaperro__/scenarios/:scenario/files/search` | ファイル検索 |
| GET | `/__snaperro__/scenarios/:scenario/files/:filename` | ファイル内容取得 |
| PUT | `/__snaperro__/scenarios/:scenario/files/:filename` | ファイル更新 |
| DELETE | `/__snaperro__/scenarios/:scenario/files/:filename` | ファイル削除 |
| POST | `/__snaperro__/scenarios/:scenario/files/upload` | ファイルアップロード |
| GET | `/__snaperro__/scenarios/:scenario/files/:filename/download` | ファイルダウンロード |

### SSE

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/__snaperro__/events` | SSEストリーム |

---

## API詳細

### GET /__snaperro__/status

サーバーの全状態を一括取得します。

**レスポンス**:
```json
{
  "version": "1.0.0",
  "mode": "smart",
  "currentScenario": "正常系フル",
  "scenarios": ["正常系フル", "空データ", "エラー系"],
  "folders": [
    { "name": "テスト", "scenariosCount": 2 }
  ],
  "files": [
    { "filename": "api_users_001.json", "endpoint": "/api/users", "method": "GET" }
  ]
}
```

---

### GET /__snaperro__/mode

**レスポンス**:
```json
{ "mode": "smart" }
```

---

### PUT /__snaperro__/mode

**リクエスト**:
```json
{ "mode": "record" }
```

**レスポンス**:
```json
{ "mode": "record" }
```

---

### GET /__snaperro__/scenarios

**レスポンス**:
```json
{
  "scenarios": ["正常系フル", "空データ"],
  "folders": [
    { "name": "テスト", "scenariosCount": 2 }
  ],
  "currentScenario": "正常系フル"
}
```

---

### POST /__snaperro__/scenarios

**リクエスト**:
```json
{ "name": "新規シナリオ" }
```

**レスポンス**:
```json
{ "name": "新規シナリオ" }
```

---

### PUT /__snaperro__/scenarios/current

**リクエスト**:
```json
{ "name": "エラー系" }
```

**レスポンス**:
```json
{
  "scenario": "エラー系",
  "files": [...]
}
```

---

### PUT /__snaperro__/scenarios/:name/rename

**リクエスト**:
```json
{ "newName": "新しい名前" }
```

---

### POST /__snaperro__/scenarios/:name/duplicate

**リクエスト**:
```json
{ "newName": "コピー先" }
```

---

### GET /__snaperro__/scenarios/:name/download

**レスポンス**: ZIPファイル（`application/zip`）

---

### POST /__snaperro__/scenarios/upload

**リクエスト**: `multipart/form-data`
- `file`: ZIPファイル

---

### GET /__snaperro__/scenarios/:scenario/files

**レスポンス**:
```json
{
  "files": [
    { "filename": "api_users_001.json", "endpoint": "/api/users", "method": "GET" },
    { "filename": "api_users_002.json", "endpoint": "/api/users", "method": "POST" }
  ]
}
```

---

### GET /__snaperro__/scenarios/:scenario/files/search

**クエリパラメータ**:
- `q`: 検索クエリ

**例**:
```
GET /__snaperro__/scenarios/demo/files/search?q=users
```

**レスポンス**:
```json
{
  "files": [
    { "filename": "api_users_001.json", "endpoint": "/api/users", "method": "GET" }
  ]
}
```

---

### GET /__snaperro__/scenarios/:scenario/files/:filename

**レスポンス**:
```json
{
  "endpoint": "/api/users/:id",
  "method": "GET",
  "request": {
    "pathParams": { "id": "123" },
    "queryParams": {},
    "headers": {},
    "body": null
  },
  "response": {
    "status": 200,
    "headers": { "content-type": "application/json" },
    "body": { "id": "123", "name": "John" }
  }
}
```

---

### PUT /__snaperro__/scenarios/:scenario/files/:filename

**リクエスト**: `FileData` オブジェクト（JSON）

---

### DELETE /__snaperro__/scenarios/:scenario/files/:filename

**レスポンス**:
```json
{ "deleted": true }
```

---

## エラーレスポンス

```json
{
  "error": "エラーメッセージ"
}
```

**ステータスコード**:
- `400`: リクエスト不正
- `404`: リソースが見つからない
- `500`: サーバーエラー

---

## 使用例

### curlでモード変更
```bash
curl -X PUT http://localhost:3333/__snaperro__/mode \
  -H "Content-Type: application/json" \
  -d '{"mode": "mock"}'
```

### curlでシナリオ切り替え
```bash
curl -X PUT http://localhost:3333/__snaperro__/scenarios/current \
  -H "Content-Type: application/json" \
  -d '{"name": "エラー系"}'
```

### curlでファイル検索
```bash
curl "http://localhost:3333/__snaperro__/scenarios/demo/files/search?q=users"
```

---

## 関連ドキュメント

- [sse.md](sse.md) - SSEイベントの詳細
- [scenario.md](scenario.md) - シナリオ管理
- [file-storage.md](file-storage.md) - ファイル管理
