# ドキュメントテンプレート

## docs/features/*.md テンプレート

```markdown
# 機能名

## 概要

[機能の説明]

## 関連ファイル

- **Server**: `server/handlers/...`, `server/core/...`
- **Client**: `client/src/components/...`
- **CLI**: `cli/commands/...`
- **Types**: `server/types/...`, `shared/types/...`

## 主な機能

- 機能1
- 機能2

## データモデル

\`\`\`typescript
// 主要な型定義
export type ExampleType = {
  field1: string;
  field2: number;
};
\`\`\`

## API

### 内部API（Control API）
- `GET /__snaperro__/...` - 説明
- `PUT /__snaperro__/...` - 説明

## 設定オプション

| オプション | 型 | 説明 | デフォルト |
|-----------|-----|------|----------|
| `option1` | `string` | 説明 | `"default"` |

## SSEイベント

| イベント | データ | 説明 |
|---------|--------|------|
| `event_name` | `{ field: type }` | 説明 |

## 使用例

\`\`\`typescript
// コード例
\`\`\`

## 関連ドキュメント

- [関連機能.md](関連機能.md) - 説明
```

---

## docs/INDEX.md への追記形式

```markdown
| 機能名 | [機能名.md](features/機能名.md) | 概要説明 |
```

---

## docs/ARCHITECTURE.md 機能マッピング形式

### 機能→ファイルマッピング
```markdown
| 機能名 | Server | Client | CLI |
|--------|--------|--------|-----|
| 機能名 | `handlers/xxx.ts` | `components/Xxx.tsx` | - |
```

### ファイル→機能マッピング（逆引き）
```markdown
### 機能名
| ファイルパス | 責務 |
|-------------|------|
| `server/handlers/...` | リクエスト処理 |
| `server/core/...` | ビジネスロジック |
| `client/src/components/...` | UI表示 |
```

---

## データフロー図形式

```markdown
### モード名モード
\`\`\`
Client → Snaperro → 処理内容 → レスポンス
\`\`\`
```

---

## 状態管理形式

```markdown
### サーバー状態（server/core/state.ts）
| 状態 | 型 | 説明 |
|------|-----|------|
| `mode` | `Mode` | 動作モード |
| `currentScenario` | `string \| null` | 選択中のシナリオ |
```
