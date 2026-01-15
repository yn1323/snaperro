# モード（Proxy / Record / Mock / Smart）

## 概要

snaperroは4つの動作モードを持ち、用途に応じて切り替えて使用します。

| モード | 動作 | 用途 |
|--------|------|------|
| **Proxy** | 実APIへ転送 | 本番同等の動作確認 |
| **Record** | 実APIへ転送 + JSON保存 | モックデータ作成 |
| **Mock** | 保存済みJSONを返却 | オフラインテスト |
| **Smart** | モックあり→Mock、なし→Record | 通常開発（推奨） |

## 関連ファイル

- **Server**: `server/handlers/proxy.ts`, `recorder.ts`, `mocker.ts`, `smart.ts`, `handler.ts`
- **Client**: `client/src/components/TopBar.tsx`
- **Types**: `shared/types/mode.ts`

---

## Proxyモード

### 動作
```
リクエスト → snaperro → 実API → レスポンス
```

### 特徴
- 設定ファイルで定義されたヘッダー（API Key等）を自動付与
- レスポンスはそのままクライアントへ返却
- ファイル保存なし

### 用途
- 実際のAPIと同じ挙動を確認したい場合
- API開発の初期段階

---

## Recordモード

### 動作
```
リクエスト → snaperro → 実API → レスポンス
                           ↓
                      JSON保存 + SSE通知
```

### 特徴
- 選択中のシナリオディレクトリに記録
- リクエスト情報（パラメータ、ヘッダー、ボディ）とレスポンスを保存
- **同じエンドポイント + 同じパラメータ** → ファイル上書き
- **同じエンドポイント + 異なるパラメータ** → 別ファイル生成

### 用途
- モックデータの初期作成
- 特定のAPIレスポンスを保存したい場合

---

## Mockモード

### 動作
```
リクエスト → snaperro → JSON検索 → レスポンス返却
```

### マッチング条件
1. HTTPメソッドが一致
2. エンドポイントが一致
3. パスパラメータが一致
4. クエリパラメータが一致
5. リクエストボディが一致（POST/PUT/PATCH）

### mockFallback設定
マッチするファイルがない場合の挙動を設定可能：

| 値 | 動作 |
|----|------|
| `"404"` | 404エラーを返す（デフォルト） |
| `"proxy"` | 実APIへ転送 |
| `"proxy&record"` | 実APIへ転送 + 記録 |

### 用途
- オフライン開発
- 安定したテスト環境
- CIでの自動テスト

---

## Smartモード

### 動作
```
リクエスト → JSON検索
              ↓
           見つかった？
          /          \
        Yes           No
         ↓             ↓
     Mock返却     Record実行
```

### 特徴
- モックがあれば即座に返却（APIコール不要）
- モックがなければ自動的に記録
- 2回目以降は記録されたモックを使用

### 用途
- **日常開発での推奨モード**
- APIレート制限の回避
- 開発効率の最大化

---

## データモデル

```typescript
// shared/types/mode.ts
export type Mode = "proxy" | "record" | "mock" | "smart";
```

---

## API

### 内部API（Control API）

#### モード取得
```
GET /__snaperro__/mode
```
**レスポンス**:
```json
{ "mode": "smart" }
```

#### モード変更
```
PUT /__snaperro__/mode
Content-Type: application/json

{ "mode": "record" }
```

---

## 設定オプション

| オプション | 型 | 説明 | デフォルト |
|-----------|-----|------|----------|
| `mockFallback` | `"404" \| "proxy" \| "proxy&record"` | Mockモードでファイルが見つからない時の挙動 | `"404"` |

---

## 使用例

### GUI での切り替え
トップバーの4つのボタンでモードを切り替えます。

### API での切り替え
```bash
# Smartモードに変更
curl -X PUT http://localhost:3333/__snaperro__/mode \
  -H "Content-Type: application/json" \
  -d '{"mode": "smart"}'
```

---

## 関連ドキュメント

- [file-storage.md](file-storage.md) - ファイル保存・マッチングの詳細
- [configuration.md](configuration.md) - mockFallback設定
