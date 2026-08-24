# セキュリティ

snaperro は既定で loopback の `127.0.0.1` にだけ bind します。開発用 traffic と記録済み API data を扱うため、non-loopback へ公開する場合は control token と origin を明示的に設定してください。

## bind policy

```ts
server: {
  host: "127.0.0.1",
  port: 3333,
}
```

`127.0.0.1`、`::1`、`localhost` が loopback として認識されます。それ以外の host を設定すると、16 文字以上の `server.controlToken` がない config は load 時に拒否されます。

```ts
server: {
  host: "0.0.0.0",
  port: 3333,
  controlToken: process.env.SNAPERRO_CONTROL_TOKEN,
  allowedOrigins: ["https://tools.example.com"],
}
```

token を config、log、repository へ直接保存しないでください。`snaperro start --env <path>` または process environment から渡します。shell ですでに設定された値が `.env` より優先されます。

## bearer token

`controlToken` が設定されている場合、`/__snaperro__/v2/*` のすべての request で次が必要です。

```http
Authorization: Bearer <token>
```

欠落・不一致は `401 UNAUTHORIZED` と `WWW-Authenticate: Bearer` になります。token は同じ byte length を確認した上で timing-safe comparison します。

token は user traffic の upstream 認証情報ではありません。設定した API route へ送る credential は各 `apis.<key>.headers` で別に管理します。

管理画面は `401` challenge を受けると password input の token dialog を開きます。入力した token は HTTP とイベント接続で共通利用し、その page instance の private memory だけに保持します。`sessionStorage`、`localStorage`、URL、React の公開 state、markup、画面上の error message へ保存・表示しません。

reload、navigation、tab close で token は消え、次の接続時に再入力が必要です。top bar の key icon から token の更新、clear、再接続ができます。body/ZIP download は認証済み query が短時間だけ有効な single-use capability path を発行し、browser の native download で開きます。control token 自体を URL へ埋め込みません。

## origin

browser が `Origin` header を送る場合、起動時に `server.host` と `server.port` から確定した control UI origin、または `server.allowedOrigins` に完全一致する origin だけを許可します。wildcard bind の `0.0.0.0` と `::` は、管理画面を開く loopback origin の `127.0.0.1` と `::1` に固定します。request URL や `Host` header から許可 origin を組み立てないため、attacker-controlled host を同一 origin と誤認しません。不許可 origin は token 検証前に `403 ORIGIN_FORBIDDEN` です。

許可した origin にだけ CORS response header を返し、`Vary: Origin` を設定します。`*` wildcard は使いません。

起動時に確定した control UI origin の管理画面だけで使うなら `allowedOrigins: []` のままで構いません。別 origin の tool を許可する場合だけ、HTTP(S) の scheme、host、port を含む URL を列挙してください。path、query、fragment は origin へ正規化され、credential、HTTP(S) 以外、正規化後の重複は起動時に拒否されます。

## 管理 namespace

control endpoint は `/__snaperro__/v2/*` に限定します。管理画面と demo の static asset は `/__snaperro__/client`、`/__snaperro__/demo` です。

未定義の `/__snaperro__/*` は upstream traffic へ fall through しません。設定 API が同じ path を持っていても、管理 namespace として遮断します。

管理画面と demo の HTML には、同一 origin の script/connect だけを許可する Content Security Policy、`worker-src 'none'`、frame 埋め込み拒否、opener 分離を設定します。static asset は `nosniff` と same-origin resource policy を付けて配信します。

## 将来の hardening: origin 分離

現行構成は user traffic と control GUI/API を一つの Hono listener と origin で提供し、`/__snaperro__` namespace、bearer token、origin 検証で境界を作ります。upstream が返す HTML は user traffic origin 上で実行される可能性があるため、control token を Web Storage に置かず memory-only にすることが現在の重要な防御です。

将来の構造的な hardening では、proxy traffic と control GUI/API を別 listener・別 origin に分離し、upstream 由来 content が control origin で実行されない構成を検討します。これは現時点で利用できる設定ではありません。分離が実装されるまでは既定の loopback bind を維持し、non-loopback 公開時は control token と必要最小限の `allowedOrigins` を必ず使用してください。

## body upload/download

body upload と folder/recording import は全量を memory に保持せず stream します。`storage.maxImportBytes` を宣言された `Content-Length` と実受信量の両方に適用し、超過時は `413 PAYLOAD_LIMIT_EXCEEDED` です。負数、小数、安全な整数範囲外、複数値へ結合された `Content-Length` は staging を始める前に `400 INVALID_ARGUMENT` で拒否します。header 未指定または上限以下の場合も、実受信量の検査が正本です。

control command/query と JSON response の共有上限は 8 MiB、SSE の1行・1 event は 4 MiB です。catalog は folder 1,024件、scenario 4,096件、直列化後 3 MiB、scenario manifest は recording 1,000件、直列化後 16 MiBに制限します。path/query/header は各256件・UTF-8合計256 KiBまでです。上限超過のimport/commitは可視化前に `413 PAYLOAD_LIMIT_EXCEEDED` となり、既存catalogを変更しません。

download capability は 32 byte の random 値から作り、server はその SHA-256 だけを一時的に保持します。有効期限は既定 60 秒で、最初の取得で asynchronous open より前に無効化します。不正形式、未知、使用済み、期限切れはすべて同じ `404 NOT_FOUND` です。download response は次の header を使います。

- `X-Content-Type-Options: nosniff`
- `Cache-Control: no-store`
- `Content-Security-Policy: default-src 'none'; sandbox`
- `Referrer-Policy: no-referrer`
- exact bytes の `Content-Length`

元 response の content encoding を標準 `Content-Encoding` で送ると browser が自動 decode して保存 bytes が変わるため、`X-Snaperro-Content-Encoding` で metadata として通知します。

## ZIP import

folder/recording archive は commit 前に次を検証します。

- absolute path、`..`、空 segment、backslash、NUL を含む entry path
- 重複 entry と暗号化 entry
- store/deflate 以外の圧縮 method
- 100,000 を超える entry
- 16 MiB を超える central directory metadata、または不整合な directory 範囲
- upload size と展開後 size
- manifest schema と未知 entry
- catalog/scenario/recording 件数と直列化 size
- manifest が参照する blob の存在、size、SHA-256 digest

一つでも違反があれば archive 全体を拒否します。展開先 path を archive の文字列連結で決めず、検証済み blob だけを content-addressed store へ materialize します。

stage した import は既定 5 分で失効します。同時保持件数と合計 byte 数にも上限があり、server 起動時に見つけた新しい orphan archive も使用量へ算入して、期限到達後に回収します。

一つの `transferId` を import command が atomic に claim するため、同時に複数の folder/scenario へ commit できません。revision conflict、store lock、abort など `retryable: true` の失敗だけは claim を解放して再試行でき、それ以外の失敗と成功では stage を消費します。

export は展開後の合計だけでなく、header と central directory を含む完成 ZIP の実 byte 数も `storage.maxImportBytes` 以下であることを確認します。同じ設定の server が自分で作った archive を size 超過で import できない状態にはしません。

## request header の mask

記録時に保存したくない request header は、全 API 共通の `recording.maskRequestHeaders` または API ごとの `maskRequestHeaders` へ指定します。

```ts
recording: {
  maskRequestHeaders: ["authorization", "cookie"],
},
apis: {
  payments: {
    // ...
    maskRequestHeaders: ["x-api-key"],
  },
},
```

mask は保存時の保護です。upstream へ request を送るために必要な header 自体を削除する設定ではありません。response body や任意の JSON field を自動 redact する機能ではないため、機密 data を含む環境での記録範囲は別途制限してください。

## 運用上の注意

- snaperro を internet へ直接公開しない
- `storage.root` と `.env` の filesystem permission を制限する
- backup/export に body と header が含まれる前提で扱う
- non-loopback bind 後は network 側の firewall も併用する
- upgrade/migration 後は `snaperro doctor` で store integrity を確認する
