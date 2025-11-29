# snaperro デモページ

## 概要

`npx snaperro demo` コマンドで、JSON Placeholder API を使ったデモ環境を起動できます。
このデモでは、snaperro の主要機能（Proxy / Record / Mock モード）を実際に体験できます。

## 起動方法

```bash
# デモを起動
npx snaperro demo

# ポート指定（デフォルト: 5173）
npx snaperro demo --port 8080
```

起動すると：
1. snaperro サーバーが `http://localhost:3333` で起動
2. デモページが `http://localhost:5173` で起動
3. ブラウザが自動で開く

## デモで使用する API

[JSON Placeholder](https://jsonplaceholder.typicode.com) の API を使用します：

| エンドポイント | 説明 |
|---------------|------|
| GET /users | ユーザー一覧（10件） |
| GET /users/:id | 特定ユーザー |
| GET /posts | 投稿一覧（100件） |
| GET /posts/:id | 特定投稿 |
| GET /comments?postId=:id | 特定投稿のコメント |

## チュートリアル

### Step 1: Proxy モードで確認

1. モードが「Proxy」になっていることを確認
2. 「Get Users」ボタンをクリック
3. 実際の JSON Placeholder API からデータが取得される
4. レスポンスが表示される

### Step 2: Record モードで録画

1. GUI（`http://localhost:3333/__snaperro__/gui/`）を開く
2. 「+ 新規パターン」で「demo-pattern」を作成
3. モードを「Record」に切り替え
4. デモページで「Get Users」をクリック
5. GUI のファイル一覧に `users/GET_1.json` が追加される

### Step 3: Mock モードで再生

1. モードを「Mock」に切り替え
2. デモページで「Get Users」をクリック
3. 保存された JSON が返される（実際の API にはアクセスしない）

### Step 4: 連番の確認

1. Record モードで同じ API を複数回叩く
2. `GET_1.json`, `GET_2.json`, `GET_3.json` と連番で保存される
3. Mock モードでは、リクエスト順に対応するファイルが返される

### Step 5: パターン切替

1. 新しいパターン「empty-pattern」を作成
2. Record モードで別のデータを録画
3. パターンを切り替えると、異なるモックデータが返される

## 画面構成

```
┌─────────────────────────────────────────────────────────────┐
│  snaperro Demo                                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Tutorial                                           │   │
│  │  Step 1: Proxy モードで確認                          │   │
│  │  Step 2: Record モードで録画                         │   │
│  │  ...                                                │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  API Tester                                         │   │
│  │  [Get Users] [Get User #1] [Get Posts] ...          │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Response                                           │   │
│  │  {                                                  │   │
│  │    "id": 1,                                         │   │
│  │    "name": "Leanne Graham",                         │   │
│  │    ...                                              │   │
│  │  }                                                  │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 関連リンク

- [snaperro GUI](http://localhost:3333/__snaperro__/gui/) - モード切替・パターン管理
- [JSON Placeholder](https://jsonplaceholder.typicode.com) - デモで使用する API
