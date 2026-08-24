# アーキテクチャ

snaperro v2 は、Hono の一つの server process 内に traffic plane と control plane を分離し、React 管理画面を同一 origin から提供します。通信契約は共有 Zod schema、永続化は catalog / immutable manifest / content-addressed blob に統一しています。

## 全体像

```text
API client
   │ user traffic
   ▼
Hono server ── route table ── TrafficService ── upstream API
   │                                  │
   │                                  └── mock lookup / streaming recording
   │
   ├── /__snaperro__/client ── React GUI
   ├── /__snaperro__/demo   ── demo UI
   ├── /__snaperro__/v2/*   ── command/query/upload/import/events
   └── /__snaperro__/downloads/* ── single-use capability stream
                                      │
                                      ▼
                            application services + ports
                                      │
                                      ▼
                         filesystem store + event hub
```

`/__snaperro__/*` は管理用 namespace です。未定義の管理 path は user traffic として upstream へ転送せず、not found にします。

## レイヤー

| レイヤー | 主な責務 |
| --- | --- |
| `shared/contracts-v2` | ID、entity、command、query、event、problem の Zod schema |
| `server/v2/config` | `configVersion: 2` の load、validation、route compile |
| `server/v2/domain` | folder、scenario、recording、mode の規則 |
| `server/v2/application` | command/query handler、use case、port、write coordination |
| `server/v2/store` | catalog、manifest、blob、lease、migration、integrity、GC |
| `server/v2/traffic` | route matching、fingerprint、mock、proxy、streaming record |
| `server/v2/transfer` | folder/recording ZIP、import staging、download capability の検証と stream |
| `server/v2/transport` | Hono endpoint、security、request/response adapter |
| `server/v2/runtime` | generation、設定 reload、lifecycle、shutdown |
| `client/src/v2` | typed HTTP client、イベント同期、React state と UI |

依存方向は transport / UI から application と shared contract へ向けます。application は filesystem や Hono に直接依存せず、repository、blob、commit、lease、GC の port を介します。

## traffic plane

1. Hono が設定済み route を照合し、path parameter と upstream target を決定します。
2. request method、route、path parameter、正規化した query、request body から fingerprint を作ります。
3. 現在の mode に従い、upstream へ転送するか、選択中 scenario の recording を返します。
4. 記録時は upstream response を client と blob writer へ backpressure 付きで流します。
5. blob と新しい scenario manifest を stage し、catalog CAS を最後の commit marker として更新します。

body 全体を JSON envelope や単一 buffer へ変換しません。request body には `recording.maxRequestBodyBytes`、import には `storage.maxImportBytes` を適用し、上限超過や中断時は部分成果を可視化しません。

`recording.completeOnClientDisconnect: true` の場合、client が response の途中で切断しても upstream を読み切って記録を完了します。`false` の場合はその処理を中止します。

設定reloadでtraffic generationを切り替える際も、返却済みresponseに紐づく保存処理が完了するまで旧generationのleaseを保持します。drain期限を超えた場合だけ旧generationをabortし、stableなapplication/storeを閉じる前に保存結果を確定させます。

## control plane

control plane は少数の固定 endpoint と型付き envelope を使います。

```text
React / automation
   ├── command ── validation ── CommandBus ── write coordinator ── store
   ├── query   ── validation ── QueryBus ───────────────────────── store
   ├── body upload / import stream ──────── blob/transfer
   ├── download query ── capability issue ──────── native stream
   └── events ◀──────────────── EventHub ◀── committed change / telemetry
```

command は `expectedRevision` などを受け取り、古い snapshot に基づく上書きを拒否します。読み取り query は永続 state を更新しません。`folder.export`、`recording.export`、`body.download` だけは、有効期限付きの一時 download capability を発行します。契約外の payload、未知 ID、参照不整合は transport または domain 境界で problem response に変換されます。

## 一貫性と commit

### catalog と scenario

catalog は folder、scenario、現在選択中 scenario、各 scenario の見えている manifest revision を保持します。recording metadata は scenario ごとの immutable manifest に分離します。

recording 更新は次の順で行います。

```text
blob commit
  → next manifest を一時 file に保存
  → immutable manifest として確定
  → expected catalog/scenario revision を再検証
  → catalog pointer を atomic CAS
  → revision 付き event を publish
```

catalog CAS より前に process が停止した場合、stage 済み manifest/blob は参照されないだけで、以前の catalog は完全なままです。参照されない file は猶予期間後に GC が回収します。

### 同時書き込み

process 内 mutex に加えて filesystem store lease を取得します。複数 process が同じ store を操作しても、catalog の期待 revision と scenario revision の双方で lost update を防ぎます。recording 自身には content revision があり、同じ recording の編集競合も区別します。

## React の同期

初期表示は snapshot で作り、その後の commit をイベント stream で反映します。snapshot の取得と購読登録は同じ write barrier 内で行うため、両者の間で更新を取りこぼしません。

client は `runtimeId`、`sequence`、`revision` を追跡します。重複は無視し、sequence gap、server 再起動、revision conflict を検出すると新しい snapshot を取得します。イベント履歴は process memory 内だけにあり、再起動をまたぐ再生は前提にしません。

編集中の recording は server state と draft を分離します。remote update を検出しても dirty draft を黙って破棄せず、保存競合または明示的な再読み込みとして扱います。

## 設定 reload と lifecycle

`start` は設定 file を監視し、新しい設定を validation してから generation を切り替えます。route、mode 周辺の runtime 設定は新しい traffic generation へ反映します。host、port、storage root、import 上限、server security など server/store の境界を変える設定は process 再起動が必要です。

shutdown 時は新規処理を止め、`runtime.shutting-down` を通知します。listener と active generation の停止、続く transfer・event・store の解放は、各フェーズを設定された timeout で制限します。

## 保存構造

```text
.snaperro/v2/
├── store.json
├── catalog.json
├── manifests/
│   └── <scenario-id>/
│       └── <revision>.json
├── blobs/
│   └── sha256/
│       └── <prefix>/
│           ├── <digest>
│           └── <digest>.meta.json
├── transfers/
├── gc/
├── .tmp/
├── .store.lease
└── migration-v1.json   # migration した store のみ
```

詳細は [ファイル保存](features/file-storage.md) を参照してください。

## セキュリティ境界

server は既定で `127.0.0.1` に bind します。non-loopback bind には control token を必須とし、control endpoint で bearer token と origin を検証します。token 比較は timing 差を避けます。download は control token と分離した same-origin、single-use、短寿命の capability で開き、`no-store`、`nosniff`、referrer 拒否を付けます。

ZIP import は path traversal、重複 entry、暗号化 entry、未対応圧縮、entry 数、展開後 size、digest を検証してから commit します。詳しくは [セキュリティ](features/security.md) を参照してください。

## 検証

共有 contract、application service、filesystem store、traffic、transfer、transport、CLI、client 同期を Vitest で単体・contract test します。CI は lint、server/client/demo の type-check、全 test、build、公開 package 内容の検査を独立 job で実行します。
