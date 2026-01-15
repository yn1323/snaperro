# 設定ファイル

## 概要

`snaperro.config.ts` でsnaperroの動作を設定します。
TypeScriptで記述するため、型安全で補完も効きます。

## 関連ファイル

- **Server**: `server/types/config.ts`, `server/core/config.ts`
- **Templates**: `templates/snaperro.config.ts`

---

## 基本構成

```typescript
import { defineConfig } from 'snaperro';

export default defineConfig({
  port: 3333,
  filesDir: '.snaperro/files',
  mockFallback: '404',
  maskRequestHeaders: ['authorization', 'cookie'],

  upstreamProxy: {
    url: 'http://proxy.company.com:8080',
  },

  apis: {
    userService: {
      name: 'ユーザーサービス',
      target: 'https://api.example.com',
      headers: {
        'X-Api-Key': process.env.API_KEY!,
      },
      routes: [
        '/api/users',
        '/api/users/:id',
      ],
      maskRequestHeaders: ['x-custom-secret'],
    },
  },
});
```

---

## 設定オプション

### グローバル設定

| オプション | 型 | 説明 | デフォルト |
|-----------|-----|------|----------|
| `port` | `number` | サーバーポート | `3333` |
| `filesDir` | `string` | モックデータ保存先 | `.snaperro/files` |
| `mockFallback` | `"404" \| "proxy" \| "proxy&record"` | Mockモードでファイルが見つからない時 | `"404"` |
| `maskRequestHeaders` | `string[]` | マスクするヘッダー（全API共通） | - |
| `upstreamProxy` | `object` | 上流プロキシ設定 | - |
| `apis` | `object` | API定義（必須） | - |

---

### API設定（apis）

```typescript
apis: {
  [apiKey: string]: {
    name: string;           // 表示名
    target: string;         // プロキシ先URL
    routes: string[];       // ルートパターン
    headers?: object;       // 追加ヘッダー
    maskRequestHeaders?: string[];  // マスクするヘッダー
  }
}
```

| フィールド | 型 | 必須 | 説明 |
|-----------|-----|------|------|
| `name` | `string` | ○ | API表示名（GUI・ログ用） |
| `target` | `string` | ○ | プロキシ先のベースURL |
| `routes` | `string[]` | ○ | マッチするルートパターン |
| `headers` | `object` | - | リクエストに追加するヘッダー |
| `maskRequestHeaders` | `string[]` | - | マスクするリクエストヘッダー |

---

### ルートパターン

```typescript
routes: [
  '/api/users',           // 完全一致
  '/api/users/:id',       // パスパラメータ
  '/api/users/:id/posts', // ネストしたパス
  'GET /api/health',      // メソッド指定
]
```

**パスパラメータ**:
- `:id` → `{ id: "123" }` として抽出
- 複数指定可能: `/api/users/:userId/posts/:postId`

**メソッド指定**:
- `GET /api/users` → GETリクエストのみマッチ
- メソッド指定なし → 全メソッドにマッチ

---

### 上流プロキシ（upstreamProxy）

企業ネットワーク等でプロキシ経由が必要な場合に設定します。

```typescript
upstreamProxy: {
  url: 'http://proxy.company.com:8080',
  // または認証付き
  url: 'http://user:password@proxy.company.com:8080',
}
```

**環境変数でも設定可能**:
```bash
export HTTPS_PROXY=http://proxy.company.com:8080
export NO_PROXY=localhost,127.0.0.1
```

---

### ヘッダーマスキング（maskRequestHeaders）

記録時にセンシティブなヘッダーをマスクします。

```typescript
// グローバル設定（全API共通）
maskRequestHeaders: ['authorization', 'cookie'],

// API個別設定
apis: {
  userService: {
    maskRequestHeaders: ['x-custom-secret'],
    // ...
  },
}
```

**マスク処理**: 値が `"***MASKED***"` に置換されます。

---

## データモデル

```typescript
// server/types/config.ts

export type SnaperroConfig = {
  port?: number;
  filesDir?: string;
  mockFallback?: "404" | "proxy" | "proxy&record";
  maskRequestHeaders?: string[];
  upstreamProxy?: {
    url: string;
  };
  apis: {
    [key: string]: {
      name: string;
      target: string;
      routes: string[];
      headers?: Record<string, string>;
      maskRequestHeaders?: string[];
    };
  };
};
```

---

## 環境変数

`.env` ファイルで機密情報を管理します。

```bash
# .env
API_KEY=your-secret-api-key
USER_SERVICE_TOKEN=your-token
```

```typescript
// snaperro.config.ts
apis: {
  userService: {
    headers: {
      'X-Api-Key': process.env.API_KEY!,
    },
    // ...
  },
}
```

---

## 設定ファイルの監視

`snaperro start` 実行中、設定ファイルの変更を監視し自動リロードします。

```bash
# 監視を無効化する場合
npx snaperro start --no-watch
```

---

## 設定例

### 複数API

```typescript
export default defineConfig({
  apis: {
    userService: {
      name: 'ユーザーAPI',
      target: 'https://user-api.example.com',
      routes: ['/api/users', '/api/users/:id'],
    },
    orderService: {
      name: '注文API',
      target: 'https://order-api.example.com',
      routes: ['/api/orders', '/api/orders/:id'],
    },
    authService: {
      name: '認証API',
      target: 'https://auth-api.example.com',
      headers: {
        'X-Api-Key': process.env.AUTH_API_KEY!,
      },
      routes: ['/api/auth/login', '/api/auth/logout'],
    },
  },
});
```

### エラーテスト用

```typescript
export default defineConfig({
  mockFallback: 'proxy&record', // モックがなければ自動記録
  apis: {
    // ...
  },
});
```

---

## 関連ドキュメント

- [cli.md](cli.md) - CLIオプション
- [modes.md](modes.md) - mockFallback設定
- [file-storage.md](file-storage.md) - ファイル保存の詳細
