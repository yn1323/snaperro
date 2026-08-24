# snaperro

[English](README.md)

snaperro は、実 API の応答を記録し、シナリオごとに再生できるローカル開発用の mock proxy です。Hono のサーバーと React の管理画面を一つのプロセスで起動し、JSON に限らない大きな body もストリーミングで扱います。

## 主な機能

- `proxy`、`record`、`mock`、`smart` の 4 モード
- folder / scenario / recording の作成、編集、複製、検索、削除
- folder / recording 単位の移植可能な ZIP import / export と body upload / download
- revision 付き command/query と Server-Sent Events による管理画面の同期
- content-addressed blob、原子的な metadata 更新、整合性検査を備えた v2 store

## 必要環境

- Node.js 22.12 以上
- npm、pnpm、または同等の Node.js package manager

## インストールと初期化

プロジェクトの開発依存へ追加します。

```bash
pnpm add -D snaperro
pnpm exec snaperro init
```

`init` は次を作成します。

- `snaperro.config.ts`: `configVersion: 2` の設定
- `.snaperro/v2`: sample folder と demo scenario を含む v2 store
- `.gitignore` の `.snaperro/v2/` エントリー

`store.json` を持つ既存の v2 store は変更しません。移行対象の `.snaperro/files` がある場合、`init` は config、`.gitignore`、sample store のどれも書かずに停止するため、先に `migrate --dry-run` と `migrate` を実行してください。空の legacy root と、root 直下に `.gitkeep` だけがある場合は停止しません。directory だけがある不完全な v2 store は、自動上書きせずエラーにします。既存 store の完全性は `doctor` で確認できます。

## 起動

```bash
pnpm exec snaperro start
```

既定では `127.0.0.1:3333` で待ち受け、管理画面を開きます。

- 管理画面: `http://127.0.0.1:3333/__snaperro__/client`
- demo: `http://127.0.0.1:3333/__snaperro__/demo`
- 対象 API: 設定した route を同じ origin へ送信します。例: `http://127.0.0.1:3333/users`

設定ファイルは監視されます。監視を止める場合は `--no-watch` を付けます。host、port、storage など起動境界に関わる設定を変えた場合は再起動してください。

## 設定

最小構成は次のとおりです。`storage.root` は設定ファイルの場所を基準に解決されます。

```ts
import { defineConfig } from "snaperro";

export default defineConfig({
  configVersion: 2,
  server: {
    host: "127.0.0.1",
    port: 3333,
  },
  storage: {
    root: ".snaperro/v2",
  },
  mock: {
    fallback: "404",
  },
  apis: {
    example: {
      name: "Example API",
      target: "https://api.example.com",
      routes: ["GET /api/users", "POST /api/users", "/api/users/:id"],
      headers: {},
      maskRequestHeaders: ["authorization", "cookie"],
    },
  },
});
```

主な既定値は次のとおりです。

| 設定 | 既定値 | 用途 |
| --- | --- | --- |
| `server.host` | `127.0.0.1` | 待受 host |
| `server.port` | `3333` | 待受 port |
| `server.openBrowser` | `true` | 起動時に管理画面を開く |
| `server.allowedOrigins` | `[]` | 同一 origin 以外から管理機能を使う場合の許可 origin |
| `storage.root` | `.snaperro/v2` | v2 store |
| `storage.maxImportBytes` | 512 MiB | upload と展開後 archive の上限 |
| `recording.maxRequestBodyBytes` | 256 MiB | 記録対象 request body の上限 |
| `recording.completeOnClientDisconnect` | `true` | client 切断後も upstream response の記録を完了する |
| `mock.fallback` | `404` | recording が見つからない場合の動作 |

設定は strict に検証され、未知のキーや曖昧な route は起動時に拒否されます。組み込みの `jsonPlaceholder` API は常に追加され、同じキーのユーザー設定で置き換えられます。別キーで組み込み route と競合させることはできません。

`mock.fallback` は `404`、`proxy`、`proxy&record` から選びます。`recording.maskRequestHeaders` は全 API 共通、API ごとの `maskRequestHeaders` はその API だけに適用されます。会社ネットワークの upstream proxy は `proxy.url`、または `HTTPS_PROXY`、`HTTP_PROXY`、小文字版の順で指定できます。config の指定が常に優先されます。

設定項目の全体は [設定](docs/features/configuration.md) を参照してください。

## 4 つのモード

| モード | recording がある | recording がない | 永続化 |
| --- | --- | --- | --- |
| `proxy` | upstream へ転送 | upstream へ転送 | しない |
| `record` | upstream へ転送 | upstream へ転送 | response を選択中 scenario へ記録 |
| `mock` | 一致する response を返す | `mock.fallback` に従う | fallback が `proxy&record` の場合だけ記録 |
| `smart` | 一致する response を返す | upstream へ転送 | 見つからなかった response を記録 |

照合には method、route、path parameter、正規化した query、request body の fingerprint を使います。記録を読み書きするモードでは scenario を選択してください。

## 管理画面

管理画面では次の操作ができます。

- モードと現在の scenario の切り替え
- folder の作成、名前変更、削除、ZIP import / export
- scenario の作成、名前変更、複製、削除
- recording の一覧、metadata/header/body を含む検索、ページ送り、JSON/ZIP import、編集、削除、ZIP export
- request / response body の upload / download、editor JSON 内の検索一致への移動、request log の確認（server 検索は filename と分離保存された非圧縮 body byte も対象）

更新には catalog、scenario、recording ごとの revision を使います。別の画面や process が先に更新した場合は、古い内容で上書きせず競合として扱います。イベントの欠落や server 再起動を検出した場合は snapshot を取得し直します。

## 大きな response と保存方式

request / response body は metadata JSON に埋め込みません。生の byte 列を SHA-256 blob として保存し、通信時も stream のまま転送します。そのため、大きな response を一つの巨大な JSON response や全量 buffer に変換しません。

download は、短時間だけ有効な single-use capability を発行して browser の native download へ渡します。control token を URL に入れず、File System Access API がない browser でも大容量ファイルを JavaScript memory に展開しません。

folder、scenario、recording には表示名と独立した安定 ID があります。scenario ごとの immutable manifest を保存してから、catalog の manifest pointer を最後に原子的に更新します。削除は catalog 更新時点で即座に管理画面と query へ反映され、不要になった blob は安全な猶予後に回収されます。

保存レイアウトと crash consistency は [ファイル保存](docs/features/file-storage.md) を参照してください。

## 既存データの移行

移行前に server を停止し、次の順で実行します。

```bash
pnpm exec snaperro migrate --dry-run
pnpm exec snaperro migrate
# 旧設定を configVersion: 2 の設定へ置き換える
pnpm exec snaperro doctor
```

既定の移行元は `.snaperro/files` と `.snaperro/state.json`、移行先は `.snaperro/v2` です。migration は copy-on-write で行われ、移行元の file は変更しません。別の staging store を完成させて整合性を検証した後だけ移行先として確定します。source fingerprint は stream で計算し、parse 前の上限は v1 recording JSON が1 fileあたり256 MiB、v1 state が1 MiBです。

data migrator は実行可能な TypeScript 設定を書き換えません。`doctor` または `start` の前に、既存設定を上記の `configVersion: 2` 形式へ更新してください。`init` も既存の設定 file を意図的に上書きしません。

既存の移行先を安全に同一 migration の結果と確認できない場合は、上書きせず停止します。移行対象の v1 data と、無関係な native v2 store または不完全な v2 store が併存する場合は、`init`、`start`、`doctor` も停止します。receipt は source provenance と元 byte の blob を保護するものであり、移行後の v2 catalog で通常の名前変更や削除をしても診断できます。CI や script で結果を扱う場合は `migrate --json` と `doctor --json` を利用できます。詳細は [migration](docs/features/migration.md) を参照してください。

## CLI

| command | 役割 | 主な option |
| --- | --- | --- |
| `snaperro init` | 設定と sample v2 store を初期化 | なし |
| `snaperro start` | Hono server と React 管理画面を起動 | `--port`、`--config`、`--env`、`--no-watch`、`--skip-browser`、`--verbose` |
| `snaperro demo` | 起動中 server の demo page を開く | `--port`、`--config` |
| `snaperro postman` | 全 v2 command/query/stream の Postman collection を標準出力へ出す | なし |
| `snaperro migrate` | 既存データを v2 store へ copy-on-write 移行 | `--source`、`--state`、`--destination`、`--dry-run`、`--json` |
| `snaperro doctor` | config、Node.js、store metadata と整合性を読み取り専用で診断 | `--config`、`--env`、`--json` |

詳細は [CLI](docs/features/cli.md) を参照してください。

## 管理機能の通信

管理画面は `/__snaperro__/v2` 配下の typed command/query、body/import stream、イベント stream を使います。契約は共有 Zod schema で request と response の両側を検証します。書き込み command は期待 revision を必須とし、競合を明示します。

export/download query は永続データを変更せず、一時的な download capability だけを発行します。取得先の `/__snaperro__/downloads/<capability>` は capability 自体を認可情報とし、短時間・一回限りで利用できます。

これは公開済み URL ごとに resource を直接操作する方式ではありません。自動化から利用する場合は [control API](docs/features/control-api.md) と [イベント同期](docs/features/sse.md) の契約に従ってください。

## セキュリティ

既定では loopback の `127.0.0.1` にだけ bind します。LAN や container network など loopback 以外へ公開する場合、16 文字以上の `server.controlToken` が必須です。

```ts
server: {
  host: "0.0.0.0",
  port: 3333,
  controlToken: process.env.SNAPERRO_CONTROL_TOKEN,
  allowedOrigins: ["https://tools.example.com"],
}
```

管理機能への request には `Authorization: Bearer <token>` を付けます。管理画面は `401` を受けると token 入力を求め、page memory だけに保持して HTTP とイベント接続へ共通利用します。reload、navigation、tab close 後は消えるため再入力が必要です。browser から別 origin で接続する場合は、その origin を `allowedOrigins` に明示してください。token を source control、URL、Web Storage へ保存しないでください。詳細は [セキュリティ](docs/features/security.md) を参照してください。

## 開発と CI

```bash
pnpm install
pnpm lint
pnpm type-check
pnpm type-check:client
pnpm type-check:demo
pnpm test:all
pnpm build
pnpm verify:package
```

単体 test は server、store、migration、CLI、browser client を対象に Vitest で実行します。GitHub Actions は pull request と `main` への push で lint/type-check、全 unit/contract/E2E/performance test、build、公開 package 内容の検査を行います。

## 詳細ドキュメント

- [ドキュメント一覧](docs/INDEX.md)
- [アーキテクチャ](docs/ARCHITECTURE.md)
- [folder / scenario / recording](docs/features/scenario.md)
- [モード](docs/features/modes.md)
- [GUI](docs/features/gui.md)
- [ファイル保存](docs/features/file-storage.md)
- [control API](docs/features/control-api.md)
- [イベント同期](docs/features/sse.md)

## License

MIT
