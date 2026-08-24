# 設定

snaperro v2 は `snaperro.config.ts` の default export を読み込み、Zod schema で検証します。root には必ず `configVersion: 2` と `apis` を指定します。

## 全体例

```ts
import { defineConfig } from "snaperro";

export default defineConfig({
  configVersion: 2,
  server: {
    host: "127.0.0.1",
    port: 3333,
    openBrowser: true,
    allowedOrigins: [],
    shutdownTimeoutMs: 5_000,
  },
  storage: {
    root: ".snaperro/v2",
    maxImportBytes: 512 * 1024 * 1024,
  },
  recording: {
    completeOnClientDisconnect: true,
    maxRequestBodyBytes: 256 * 1024 * 1024,
    maskRequestHeaders: ["authorization", "cookie"],
  },
  proxy: {},
  mock: {
    fallback: "404",
  },
  apis: {
    users: {
      name: "Users API",
      target: "https://api.example.com",
      routes: ["GET /users", "POST /users", "/users/:id"],
      headers: {
        "x-api-key": process.env.USERS_API_KEY ?? "",
      },
      maskRequestHeaders: ["x-api-key"],
    },
  },
});
```

`defineConfig` は同じ v2 schema で入力を検証し、型補完を提供します。設定に secret を直書きせず、環境変数を参照してください。

## `server`

| 項目 | 型 / 制約 | 既定値 | 説明 |
| --- | --- | --- | --- |
| `host` | 空でない string | `127.0.0.1` | bind する host |
| `port` | `1..65535` の整数 | `3333` | bind する port |
| `openBrowser` | boolean | `true` | 起動時に管理画面を開く |
| `allowedOrigins` | HTTP(S) URL の配列 | `[]` | 同一 origin 以外で許可する control origin |
| `controlToken` | 16 文字以上 | なし | control endpoint の bearer token |
| `shutdownTimeoutMs` | `100..60000` の整数 | `5000` | graceful shutdown の各停止フェーズと、stream・pin の後処理の待機上限 |

`allowedOrigins` は path、query、fragment を除いた origin へ正規化し、正規化後の重複を拒否します。credential を含む URL、`null` origin になる scheme、HTTP(S) 以外は指定できません。

`127.0.0.1`、`::1`、`localhost` 以外へ bind する場合は `controlToken` が必須です。詳細は [セキュリティ](security.md) を参照してください。

## `storage`

| 項目 | 型 / 制約 | 既定値 | 説明 |
| --- | --- | --- | --- |
| `root` | 空でない path | `.snaperro/v2` | v2 filesystem store |
| `maxImportBytes` | 正の安全な整数 | 512 MiB | body upload と folder/recording archive の upload・展開量上限 |

相対 `root` は current working directory ではなく、config file の directory を基準に絶対 path へ変換します。

## `recording`

| 項目 | 型 / 制約 | 既定値 | 説明 |
| --- | --- | --- | --- |
| `completeOnClientDisconnect` | boolean | `true` | client 切断後も upstream response の記録を続ける |
| `maxRequestBodyBytes` | 正の安全な整数 | 256 MiB | fingerprint/記録対象 request body の上限 |
| `maskRequestHeaders` | 空でない header 名の配列 | `[]` | 全 API 共通で保存時に mask する request header |

mask は大文字小文字を区別しない header 名として扱います。API ごとの `maskRequestHeaders` と合わせて適用します。不正な HTTP header 名と、大文字小文字だけが異なる重複指定は起動時に拒否します。

## `mock`

`fallback` は選択中 scenario に一致する recording がない場合の動作です。

| 値 | 動作 |
| --- | --- |
| `404` | not found を返す |
| `proxy` | upstream へ転送するが記録しない |
| `proxy&record` | upstream へ転送し、response を記録する |

既定値は `404` です。`smart` mode はこの fallback とは別に、miss を常に upstream へ転送して記録します。

## `proxy`

会社ネットワークなどで upstream 接続に forward proxy が必要な場合だけ `url` を指定します。

```ts
proxy: {
  url: "http://proxy.example.com:8080",
}
```

`url` は HTTP(S) URL だけを許可します。認証付き proxy の credential は指定できますが、log では mask します。未指定時は `HTTPS_PROXY`、`HTTP_PROXY`、`https_proxy`、`http_proxy` の順に利用し、どれもなければ upstream へ直接接続します。config の `proxy.url` が最優先です。不正な環境変数は値を表示せず起動を拒否します。

## `apis`

key は API の内部識別子です。各 API は次を持ちます。

| 項目 | 必須 | 説明 |
| --- | --- | --- |
| `name` | 必須 | 管理画面に表示する名前 |
| `target` | 必須 | upstream base URL |
| `routes` | 必須 | 1 件以上の route pattern |
| `headers` | 任意 | upstream request へ追加する header |
| `maskRequestHeaders` | 任意 | この API だけで保存時に mask する header |

route は `"/users/:id"` のように全 method を受ける形式か、`"GET /users/:id"` のように method を限定する形式です。複数の pattern が一致するときは static segment の多い route、次に method 指定 route を優先します。同じ優先度で重なる route は宣言順へ依存させず compile 時に拒否します。

`target` は HTTP(S) の base URL です。base path は利用できますが、credential、query、fragment は指定できません。incoming request の path は base path の後ろへ連結し、query は incoming request の値をそのまま使います。

`headers` の名前は HTTP token、値は Fetch で安全に再構築できる最大 8 KiB の値だけを許可し、CR、LF、NUL、非 byte 文字を拒否します。`Host`、`Content-Length` と hop-by-hop header は request routing / framing が管理するため指定できません。大文字小文字だけが異なる header の重複も起動時に拒否します。

組み込みの `jsonPlaceholder` は常に custom API と merge されます。同じ key を指定した場合だけ custom 定義が上書きし、異なる key の route が衝突した場合は起動を拒否します。root とすべての入れ子 object は strict で、typo を含む未知 key を無視しません。

## load と reload

`start` は config と既定 `.env`、または `--env` で指定した file を監視します。変更をまとめて直列に reload し、candidate generation の準備が成功してから切り替えます。失敗した candidate は破棄し、稼働中 generation を維持します。

次は起動中に変えられません。

- `storage.root`、`storage.maxImportBytes`
- `server.host`、`server.port`、`server.openBrowser`
- `server.allowedOrigins`、`server.controlToken`、`server.shutdownTimeoutMs`

これらを変更した場合は server を再起動してください。`--no-watch` を指定するとすべての自動 reload を止めます。
