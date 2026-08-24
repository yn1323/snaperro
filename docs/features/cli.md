# CLI

snaperro v2 の CLI は、初期化、起動、動作確認、既存データの移行、store 診断を担当します。すべて Node.js 22.12 以上で実行してください。

プロジェクトへ追加した場合の呼び出し例は `pnpm exec snaperro <command>` です。以下では短く `snaperro` と表記します。

## `init`

```bash
snaperro init
```

次を安全に初期化します。

- `snaperro.config.ts`
- `.snaperro/v2` の v2 store
- `Samples` folder 内の `demo`、`demo-empty`、`demo-error` scenario
- `.gitignore` の `.snaperro/v2/`

既存 config や `.gitignore` の内容は不用意に上書きしません。移行対象の `.snaperro/files` がある場合は、config、`.gitignore`、sample store を一つも書かずに停止します。先に `migrate --dry-run` と `migrate` を実行してください。空の legacy root と root 直下の `.gitkeep` だけは移行対象とみなしません。`store.json` を持つ既存 v2 store には何もせず、directory だけがある不完全な store は修復を推測せず停止します。既存 store の完全性は `doctor` で確認します。

sample store の公開後に directory の durability 確認だけが失敗した場合は、公開済みの path を含むエラーを表示します。store を自動削除せず、同じ `init` を再実行して既存 store を確認したうえで config と `.gitignore` の初期化を続行できます。公開前の失敗に加えて staging の削除も失敗した場合は、両方のエラーと残った staging path を表示します。

## `start`

```bash
snaperro start
```

| option | 既定値 | 説明 |
| --- | --- | --- |
| `-p, --port <port>` | config の値 | 起動時の port override |
| `-c, --config <path>` | `snaperro.config.ts` | v2 config file |
| `-e, --env <path>` | config と同じ directory の `.env` | 環境変数 file |
| `--no-watch` | watch 有効 | config と env file の監視を止める |
| `--skip-browser` | config の `openBrowser` | 今回の起動では管理画面を自動で開かない |
| `-v, --verbose` | 無効 | 詳細 log |

`.env` は shell ですでに設定されている環境変数を上書きしません。watch 中に新しい config の load や validation が失敗した場合、稼働中の generation を維持して error を表示します。

次の設定は server/store の境界なので、watch 中には変更できません。変更後に process を再起動してください。

- `storage.root`、`storage.maxImportBytes`
- `server.host`、`server.port`、`server.openBrowser`
- `server.allowedOrigins`、`server.controlToken`、`server.shutdownTimeoutMs`

移行対象の既存データがあり、対応する migration provenance を持つ v2 store がない場合、`start` は暗黙に移行せず `MigrationRequired` として停止します。native sample store や不完全な v2 store が併存する場合も停止するため、対象を backup または別名へ移してから [`migrate`](migration.md) を実行してください。

## `demo`

```bash
snaperro demo
snaperro demo --port 3333
```

起動中 server の v2 snapshot endpoint を確認してから `/__snaperro__/demo` を browser で開きます。server 自体は起動しないため、先に `start` が必要です。

## `postman`

```bash
snaperro postman > snaperro.postman_collection.json
```

同梱した v2 control collection を JSON として標準出力へ出します。command/query、body upload/download、folder/recording ZIP の stage/import/export、event stream、single-use download capability を含みます。進捗 message を混ぜないため、redirect してそのまま Postman へ import できます。

## `migrate`

```bash
snaperro migrate --dry-run
snaperro migrate
```

| option | 既定値 | 説明 |
| --- | --- | --- |
| `-s, --source <path>` | `.snaperro/files` | 移行元 directory |
| `--state <path>` | `.snaperro/state.json` | 移行元 state file |
| `-d, --destination <path>` | `.snaperro/v2` | 移行先 store |
| `--dry-run` | 無効 | validation と計画だけを行い、file を書かない |
| `--json` | human-readable | machine-readable JSON を出力 |

preflight、warning、error、source file/byte 数、scenario 数、整合性検査結果を表示します。dry-run と本移行のどちらでも移行元を変更しません。安全と確認できない既存 destination は上書きしません。

成功時は exit code `0`、blocking error 時は `1` です。

## `doctor`

```bash
snaperro doctor
snaperro doctor --json
```

| option | 既定値 | 説明 |
| --- | --- | --- |
| `-c, --config <path>` | `snaperro.config.ts` | 診断対象 config |
| `-e, --env <path>` | config と同じ directory の `.env` | config load に使う環境変数 file |
| `--json` | human-readable | machine-readable JSON を出力 |

次を読み取り専用で確認します。

1. Node.js が 22.12 以上か
2. `configVersion: 2` の config を load/validation できるか
3. `storage.root` が directory として存在するか
4. store metadata、catalog、manifest、blob の整合性
5. 移行対象の既存データに対し migration が未実施、または無関係な v2 destination が競合していないか

warning だけなら成功、fail が一つでもあれば exit code `1` です。`doctor` は file の修復、削除、migration を行いません。

## CI での利用

移行の事前確認や環境診断を script から扱う場合は `--json` と exit code を使います。human-readable output の文言を parse せず、JSON の `ok`、`checks`、`report` を参照してください。
