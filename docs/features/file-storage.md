# ファイル保存・マッチング

## 概要

snaperroはモックデータをJSONファイルとして保存・管理します。
Recordモードで記録し、Mockモードで読み込みます。

## 関連ファイル

- **Server**: `server/core/storage.ts`, `server/core/matcher.ts`
- **Types**: `shared/types/file.ts`

---

## ディレクトリ構造

```
.snaperro/
├── state.json              # 状態ファイル（モード、現在のシナリオ）
└── files/
    └── [シナリオ名]/
        ├── api_users_001.json
        ├── api_users_002.json
        └── api_users_{id}_001.json
```

---

## ファイル命名規則

| エンドポイント | ファイル名ベース |
|--------------|-----------------|
| `/api/users` | `api_users` |
| `/api/users/:id` | `api_users_{id}` |
| `/api/users/:userId/posts/:postId` | `api_users_{userId}_posts_{postId}` |

**連番**: 同じエンドポイントで異なるパラメータの場合、連番が付与されます。
- `api_users_{id}_001.json` （id=123, page=1）
- `api_users_{id}_002.json` （id=123, page=2）
- `api_users_{id}_003.json` （id=456, page=1）

---

## ファイル形式（FileData）

```json
{
  "endpoint": "/api/users/:id",
  "method": "GET",
  "request": {
    "pathParams": { "id": "123" },
    "queryParams": { "include": "posts" },
    "headers": { "authorization": "***MASKED***" },
    "body": null
  },
  "response": {
    "status": 200,
    "headers": {
      "content-type": "application/json"
    },
    "body": {
      "id": "123",
      "name": "John Doe",
      "email": "john@example.com"
    }
  }
}
```

---

## データモデル

```typescript
// shared/types/file.ts

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS" | "HEAD";

export type FileRequest = {
  pathParams: Record<string, string>;
  queryParams: Record<string, string | string[]>;
  headers: Record<string, string>;
  body: unknown | null;
};

export type FileResponse = {
  status: number;
  headers: Record<string, string>;
  body: unknown;
};

export type FileData = {
  endpoint: string;
  method: HttpMethod;
  request: FileRequest;
  response: FileResponse;
};
```

---

## マッチング処理

### マッチング条件

Mockモードでファイルを検索する際、以下の条件で照合します：

1. **HTTPメソッド** が一致
2. **エンドポイント** が一致（パスパラメータ展開後）
3. **パスパラメータ** が一致
4. **クエリパラメータ** が一致
5. **リクエストボディ** が一致（POST/PUT/PATCH）

### マッチング例

**リクエスト**:
```
GET /api/users/123?include=posts
```

**マッチするファイル**:
```json
{
  "endpoint": "/api/users/:id",
  "method": "GET",
  "request": {
    "pathParams": { "id": "123" },
    "queryParams": { "include": "posts" }
  }
}
```

---

## Record時の動作

### 新規記録
1. エンドポイントとパラメータに基づきファイル名を生成
2. 既存ファイルを検索
3. 同じパラメータのファイルがあれば**上書き**
4. なければ**新規連番ファイル**を作成

### 並行制御
Mutexを使用してアトミック書き込みを保証します。
複数リクエストが同時に記録されても競合しません。

---

## 検索機能

### 全文検索
```
GET /__snaperro__/scenarios/:scenario/files/search?q=<query>
```

**検索対象**:
- ファイル名
- エンドポイント
- ファイル内容（JSON全体）

### GUI検索
FilePaneの検索ボックスから検索可能。
デバウンス（300ms）でリアルタイム検索。

---

## ファイル操作

### 作成
Recordモードで自動作成、またはGUIからアップロード。

### 編集
GUIのEditorPaneでJSON編集 → 保存。

### 削除
GUIのEditorPaneから削除、またはAPI経由。

### 一括操作
- **ZIPエクスポート**: シナリオ単位でダウンロード
- **ZIPインポート**: シナリオとしてアップロード

---

## API

### ファイル一覧
```
GET /__snaperro__/scenarios/:scenario/files
```

### ファイル内容取得
```
GET /__snaperro__/scenarios/:scenario/files/:filename
```

### ファイル更新
```
PUT /__snaperro__/scenarios/:scenario/files/:filename
Content-Type: application/json

{ ...FileData }
```

### ファイル削除
```
DELETE /__snaperro__/scenarios/:scenario/files/:filename
```

### ファイルアップロード
```
POST /__snaperro__/scenarios/:scenario/files/upload
Content-Type: multipart/form-data

file: (JSONファイル)
```

---

## SSEイベント

| イベント | データ | タイミング |
|---------|--------|----------|
| `file_created` | `{ scenario, filename, endpoint, method }` | 記録時 |
| `file_updated` | `{ scenario, filename, endpoint, method }` | 更新時 |
| `file_deleted` | `{ scenario, filename }` | 削除時 |

---

## ヘッダーマスキング

記録時にセンシティブなヘッダーをマスクします。

**設定**:
```typescript
maskRequestHeaders: ['authorization', 'cookie', 'x-api-key']
```

**結果**:
```json
{
  "request": {
    "headers": {
      "authorization": "***MASKED***",
      "cookie": "***MASKED***"
    }
  }
}
```

---

## 関連ドキュメント

- [modes.md](modes.md) - Record/Mockモードの詳細
- [scenario.md](scenario.md) - シナリオ管理
- [configuration.md](configuration.md) - maskRequestHeaders設定
