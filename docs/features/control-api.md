# control API

snaperro v2 の管理機能は `/__snaperro__/v2` 配下にあります。書き込みを command、読み取りを query、大きな byte 列を upload/import stream と native download に分け、すべての JSON 契約を共有 Zod schema で検証します。

この interface は管理画面と同じ内部契約を使う高度な連携向けです。command/query の schema は `shared/contracts-v2` が正本です。

## endpoint

| method / path | 用途 | response |
| --- | --- | --- |
| `GET /__snaperro__/v2/snapshot` | 現在の server snapshot | JSON |
| `POST /__snaperro__/v2/commands` | 型付き書き込み | JSON |
| `POST /__snaperro__/v2/queries` | 型付き読み取り | JSON |
| `GET /__snaperro__/v2/events` | revision 付き event stream | `text/event-stream` |
| `POST /__snaperro__/v2/bodies` | raw body upload | `BodyRef` JSON |
| `POST /__snaperro__/v2/transfers/imports?filename=...` | folder ZIP の検証・stage | transfer JSON |
| `POST /__snaperro__/v2/transfers/recording-imports?filename=...` | recording ZIP の検証・stage | transfer JSON |
| `GET /__snaperro__/downloads/:capability` | 発行済み download の一回限りの取得 | byte stream |

未定義の `/__snaperro__/*` は user traffic として upstream へ転送しません。

## envelope

command は `protocolVersion: 2`、一意な `commandId`、`type` と type 固有 payload を持ちます。catalog を変える command は `expectedRevision`、recording を変える command は `expectedScenarioRevision` を使います。recording 更新・削除には `expectedContentRevision` も必要です。

```json
{
  "protocolVersion": 2,
  "commandId": "cmd_0123456789abcdef",
  "type": "mode.set",
  "expectedRevision": 12,
  "mode": "smart"
}
```

成功時は type 固有 result を返します。

```json
{
  "revision": 13,
  "mode": "smart"
}
```

query は永続データを変更せず、`protocolVersion: 2` と `type` を受け取ります。export/download query だけは短命な capability と一時 file を作りますが、catalog、manifest、blob の状態は変えません。

```json
{
  "protocolVersion": 2,
  "type": "recording.list",
  "scenarioId": "scn_0123456789abcdef",
  "limit": 50
}
```

schema は strict です。未知 field、不正な prefix の ID、範囲外 revision/limit、参照不整合を許容しません。

## command type

| type | 操作 | 競合 token |
| --- | --- | --- |
| `mode.set` | mode を変更 | catalog revision |
| `scenario.select` | 現在の scenario を変更または解除 | catalog revision |
| `folder.create` | folder を作成 | catalog revision |
| `folder.rename` | folder 名を変更 | catalog revision |
| `folder.delete` | folder と配下 scenario を削除 | catalog revision |
| `folder.import` | stage 済み archive を commit | catalog revision |
| `scenario.create` | folder 内へ scenario を作成 | catalog revision |
| `scenario.rename` | scenario 名を変更 | catalog revision |
| `scenario.duplicate` | scenario を別の安定 ID で複製 | catalog revision |
| `scenario.delete` | scenario を削除 | catalog revision |
| `recording.create` | recording を作成 | scenario revision |
| `recording.import` | stage 済み recording ZIP を作成として commit | scenario revision |
| `recording.update` | recording を更新 | scenario + content revision |
| `recording.delete` | recording を削除 | scenario + content revision |

同じ revision に対する書き込みが先に commit されていた場合は `REVISION_CONFLICT` です。client は最新状態を query し直し、利用者の変更を黙って上書きしません。

## query type

| type | 読み取る内容 |
| --- | --- |
| `runtime.snapshot` | runtime、revision、mode、現在の scenario、folder/scenario summary。recording は含めない |
| `folder.list` | folder 一覧 |
| `folder.export` | folder ZIP の `DownloadTicket` |
| `scenario.list` | scenario 一覧。folder で絞り込み可能 |
| `scenario.get` | scenario 詳細 |
| `recording.list` | recording summary の page |
| `recording.search` | scenario 内検索の page |
| `recording.get` | recording metadata |
| `recording.body` | request または response の `BodyRef` |
| `recording.export` | body を含む移植可能な recording ZIP の `DownloadTicket` |
| `body.download` | raw body の `DownloadTicket` |

list/search は cursor pagination です。`limit` の既定値は 50、最大値は 200 です。body byte 列は JSON result に含めません。

## body stream

`POST /bodies` の request body は raw bytes です。`Content-Type` と `Content-Encoding` は blob metadata に保存し、成功すると status `201` で次の `BodyRef` を返します。

```json
{
  "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "size": 1234,
  "mediaType": "application/json",
  "contentEncoding": null
}
```

download は `body.download` query で capability を発行してから、返された `downloadPath` を一回だけ取得します。exact raw bytes を browser の native download へ流すため、JavaScript memory に全量を保持しません。

body と folder/recording ZIP の upload 上限は `storage.maxImportBytes` です。宣言された `Content-Length` だけでなく、実際に受信した byte 数でも検査します。不正な宣言値は stream 処理を始める前に拒否します。

## folder transfer

import は二段階です。

1. `Content-Type: application/zip` の raw stream を `/transfers/imports?filename=folder.zip` へ送る
2. 返された `transferId` と folder 名を `folder.import` command へ渡す

ZIP は stage 時に format、path、entry、展開 size を検証します。`folder.import` command は `transferId` を単回 claim し、blob を materialize しながら size と digest を検証して、すべてが成功してから catalog へ commit します。失敗した archive を部分反映しません。`retryable: true` の失敗では claim を解放して同じ transfer を再試行でき、それ以外の失敗では消費します。

成功resultは `revision`、作成した `folder`、`recordingsInvalidated: true` だけを返します。全scenario配列は返さず、GUIはsnapshotを再取得します。catalog/manifest aggregate上限を超える場合は `413 PAYLOAD_LIMIT_EXCEEDED` で、catalogは変更しません。

export は `folder.export` query で `DownloadTicket` を得ます。ZIP は scenario/recording metadata と deduplicate した body blob を含むため、別の v2 store へ移植できます。

## recording transfer

recording export も metadata だけの JSON ではなく、参照する request/response blob を含む self-contained ZIP です。永続 ID、revision、timestamp、派生 fingerprint は archive に含めません。folder archiveだけはv1 duplicate shadowの `matchable` を保持します。import 先で新しい ID を割り当て、blob 実体を検証して fingerprint を再導出します。

import は `/transfers/recording-imports` へ ZIP を stage し、返された `transferId`、対象 `scenarioId`、`expectedScenarioRevision` を `recording.import` command へ渡します。JSON import は body を含まない従来の手動入力として GUI で引き続き利用できます。

## download capability

`folder.export`、`recording.export`、`body.download` の result は次の `download` を返します。

```json
{
  "download": {
    "downloadPath": "/__snaperro__/downloads/<43-character-capability>",
    "expiresAt": "2026-08-24T00:00:00.000Z",
    "filename": "recording.snaperro.zip",
    "mediaType": "application/zip",
    "size": 12345
  }
}
```

capability は暗号学的乱数から作り、server は hash だけを memory に保持します。既定 60 秒で失効し、取得開始前に atomic に消費します。同時取得は一つだけ成功し、使用済み・期限切れ・未知の値は同じ `404` です。期限判定は server clock を正本とし、browser は clock skew で有効な取得を拒まないよう `expiresAt` を事前判定しません。shutdown 開始後は新しい ticket を発行せず、生成中の ZIP と取得中の body/ZIP stream を中断します。ZIP 一時 file は完了、中断、期限切れ、shutdown のいずれでも削除します。再試行時は query から新しい ticket を発行してください。

## error

error response は次の envelope です。

```json
{
  "error": {
    "code": "REVISION_CONFLICT",
    "message": "...",
    "retryable": true,
    "details": {}
  }
}
```

代表的な status は invalid input `400`、unauthorized `401`、forbidden origin `403`、not found `404`、revision/name conflict `409`、payload too large `413`、store lease `423`、upstream unavailable `502` です。`retryable: true` の場合は `Retry-After` も返します。

## 認証と origin

`server.controlToken` が設定されている場合、すべての `/__snaperro__/v2/*` request に `Authorization: Bearer <token>` が必要です。browser の `Origin` が同一 origin でない場合は `server.allowedOrigins` に完全な origin URL を追加します。

`/__snaperro__/downloads/:capability` は bearer middleware の外側です。capability 自体だけを認可情報として扱うため、control token を URL、redirect、download request へ含めません。download path は同一 origin の相対 path に限定します。詳細は [セキュリティ](security.md) を参照してください。
