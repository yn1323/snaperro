# ファイル保存

snaperro v2 の filesystem store は、構造情報、scenario ごとの recording metadata、大きな body を分離します。catalog を最後の可視化 marker にすることで、削除の反映遅延、途中書き込み、巨大 JSON response を避けます。

## layout

```text
.snaperro/v2/
├── store.json
├── catalog.json
├── manifests/
│   └── scn_<id>/
│       ├── 0000000000000000.json
│       └── 0000000000000001.json
├── blobs/
│   └── sha256/
│       └── ab/
│           ├── abcdef...        # exact raw bytes
│           └── abcdef....meta.json
├── transfers/                   # runtime 内の一時 import/export
├── gc/                          # GC marker
├── .tmp/                        # blob staging（終了済み process の残骸は起動時に削除）
├── tmp/                         # request body spool（終了済み process の残骸は起動時に削除）
├── .store.lease                 # writer lease 中のみ
└── migration-v1.json            # migration 済み store のみ
```

ID や digest の一部を省略して示しています。store 内の path は表示名に依存しないため、folder/scenario/recording の名前変更で file tree を移動しません。

## `store.json`

store の不変 metadata です。

- schema version `2`
- store identity と作成時刻
- catalog、manifest、blob の固定 layout
- migration した場合の source format、fingerprint、件数、byte 数、import 済み state

通常の書き込みで更新しません。schema や layout が一致しない store を推測で読みません。

## `catalog.json`

現在見える構造の正本です。

- catalog revision
- mode と現在選択中 scenario ID
- folder と scenario summary
- 各 scenario の recording 件数と scenario revision
- 各 scenario が参照する manifest revision

recording metadata や body byte 列は含めません。folder/scenario の作成・名前変更・削除は、この catalog の CAS commit が成功した時点で全 query と GUI に反映されます。

scenario revision は visible manifest revision と常に同じ値です。scenario の名前変更は catalog revision と `updatedAt` だけを進め、recording 集合の ETag である scenario revision と manifest pointer は変更しません。読み込み時に両者が違う catalog は破損として拒否します。

## immutable manifest

各 scenario の recording 集合を `manifests/<scenario-id>/<revision>.json` に保存します。既存 manifest を書き換えず、revision ごとに新しい file を作ります。

recording commit は次の順です。

1. 新しい body blob を commit
2. 次の scenario manifest を stage
3. immutable manifest file を確定
4. catalog と scenario の期待 revision を確認
5. catalog の manifest pointer と件数を atomic CAS

4 または 5 で競合した場合、新 manifest を以前の catalog から見える状態にはしません。catalog CAS が唯一の可視化 marker です。

## content-addressed blob

body は `blobs/sha256/<先頭2文字>/<64文字digest>` に exact raw bytes で保存します。隣接する `.meta.json` は canonical blob の digest と size を保持します。media type と content encoding は同じbyte列でもrecordingごとに異なり得るため、各 `BodyRef` が表現metadataを保持します。

recording は次の reference だけを持ちます。

```ts
type BodyRef = {
  sha256: string;
  size: number;
  mediaType: string | null;
  contentEncoding: string | null;
};
```

同じ byte 列は同じ digest を共有できます。open 時は reference の size と実fileを照合し、`doctor` の完全性検査では sidecar に加えてblob fileを読み、実digestとsizeも検証します。

## atomic write

永続 JSON は次の順で確定します。

```text
同じ filesystem 上の一時 file を排他的に作成
  → 全 byte を書く
  → file を fsync
  → destination へ rename
  → parent directory を fsync
```

process crash 後に半分だけ書かれた `catalog.json` を正常 metadata として扱いません。blob も一時 path へ stream し、受信が完了して digest/size が確定してから content-addressed path へ移します。

## writer coordination

一つの process 内では mutex、process 間では store root ごとの `.store.lease` を使います。lease token と期限を検証し、同時 writer は待機または `STORE_LOCKED` になります。

lease だけに依存せず、catalog revision、scenario revision、recording content revision の CAS を併用します。lease 切れや別 process の更新があっても古い state で上書きしません。

## 削除と GC

論理削除は catalog commit で完了します。管理画面から消すために disk の再走査や blob の削除完了を待ちません。

参照されない manifest/blob は GC 対象です。ただし commit 前に stage した直後の file と競合しないよう、既定で mtime が 1 時間以上古い orphan だけを削除します。server は起動時と参照変更時に走査を予約し、猶予期間後の再走査も lifecycle 内でまとめて実行します。一時的に走査できなかった場合は次の周期で再試行します。migration receipt が原本保存用に参照する blob は orphan とみなしません。

管理画面からuploadしたbodyは、既定24時間のpending pinとしてGC rootに含めます。同じdigestを複数draftが共有し得るため、recording commit時にはpinを早期削除せずTTLまで保持します。24時間を超えて保存しなかった場合は回収され得ますが、欠損参照をcommitせずerrorにするためbodyを再uploadしてください。importがcommit前に失敗してmaterialize済みblobが残った場合も、requestのabort状態に依存せず猶予後に回収します。

mock response、body download、archive exportが開いたblobはstreamのclose/cancelまでactive pinで保護します。GCはpinを共有filesystemから読み、lease ownershipを各delete直前に再検証するため、別processの削除・保存と競合して読み出し途中のblobを消しません。

この分離により、削除の表示は即時、物理回収は安全に遅延させられます。

## integrity check

`snaperro doctor` は読み取り専用で次を検証します。

- `store.json` と `catalog.json` の schema
- folder/scenario/manifest pointer の参照整合性
- scenario summary と visible manifest の revision/recording 件数
- recording ID、filename、fingerprint の一意性
- `BodyRef`、sidecar、blob size、SHA-256 digest
- migration receipt と source provenance reference
- orphan / 予期しない path の warning

error があれば store を自動修復せず診断を失敗させます。まず backup を確保し、原因を特定してから対応してください。

## backup

一貫した backup を取るときは server を停止し、`storage.root` 全体を copy してください。個別の `catalog.json` や最新 manifest だけでは body と migration provenance を復元できません。

folder または recording を他環境へ移す場合は、filesystem layout を直接 copy せず GUI または `folder.export` / `recording.export` query が返す self-contained ZIP を使います。manifest と参照 body の生 byte 列がひとつの archive に入るため、別 store でも import できます。

query は、有効期限が短く single-use の same-origin download capability を返します。browser はその path を native download で開き、server は取得開始前に capability を無効化します。ZIP は stream の完了、中断、失敗、または capability の期限切れ後に削除されるため、再取得時は新しい query を実行します。
