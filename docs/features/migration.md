# migration

既存データは、移行元を変更しない copy-on-write migration で v2 store へ移します。`start` は暗黙変換を行わないため、server を停止して dry-run、本移行、診断の順で実行してください。

## 標準手順

```bash
pnpm exec snaperro migrate --dry-run
pnpm exec snaperro migrate
# 旧設定を configVersion: 2 の設定へ置き換える
pnpm exec snaperro doctor
```

migration は data だけを対象とし、実行可能な TypeScript 設定は自動編集しません。既存の `snaperro.config.ts` は [configuration](configuration.md) の `configVersion: 2` 形式へ更新してください。`init` は既存設定を上書きしないため、旧設定を残したままでは `doctor` と `start` が fail closed します。

既定 path は次のとおりです。

| 用途 | path |
| --- | --- |
| recording 移行元 | `.snaperro/files` |
| state 移行元 | `.snaperro/state.json` |
| v2 destination | `.snaperro/v2` |

別の場所を使う場合は `--source`、`--state`、`--destination` を指定します。
これらは互いに包含しない独立した path を指定してください。preflight は symbolic link を解決した実体 path でも包含関係を検査します。

## dry-run

`--dry-run` は file を作成せず、次を行います。

1. source directory 内の symbolic link entry に追従せず走査
2. source file を固定長 chunk で読み、raw SHA-256 と全体 fingerprint を計算
3. recording JSON と state を size 上限内だけ読み込んで validation
4. folder/scenario の mapping と決定的 ID を計画
5. 本移行と同じ catalog / manifest の件数・serialized byte 上限を検証
6. 重複 filename/fingerprint、衝突する表示名、skip 対象を報告

report には source file 数、byte 数、scenario、warning、error、`sourceUnchanged` を含みます。blocking error が一つでもあれば本移行へ進まないでください。

inventory の hash 計算は file 全体を memory に保持しません。JSON として parse する v1 recording は1 fileあたり256 MiB、`.snaperro/state.json` は1 MiBが既定上限です。上限ちょうどは受理し、1 byteでも超えた場合は対象 path と実 byte 数を含む blocking error にします。巨大 file を推測変換したり、途中まで読んで移行したりはしません。

state file が存在しない場合は state なしとして移行できます。JSON の構文または shape が旧形式でなければ warning として state だけを無視しますが、I/O error や読み取り中の変更は mode / current scenario を推測で欠落させず blocking error にします。

## layout mapping

移行元の一段 directory は、scenario ごとに独立した folder へ割り当てます。

```text
.snaperro/files/demo/*.json
  → folder "_demo"
  → scenario "demo"
```

二段以上の directory は、先頭 segment を folder、残りを `/` でつないだ scenario 表示名として保持します。

```text
.snaperro/files/team/happy/*.json
  → folder "team"
  → scenario "happy"

.snaperro/files/team/error/timeout/*.json
  → folder "team"
  → scenario "error/timeout"
```

空の leaf scenario directory も scenario として保持します。表示名から ID を作らず、source identity の SHA-256 から `fld_`、`scn_`、`rec_` ID を決定するため、同じ source は同じ ID へ移行されます。

## 本移行

本移行は次の順で行います。

```text
source/state を inventory
  → destination の sibling staging directory を作成
  → v2 metadata/catalog/manifests/blobs を構築
  → 元 JSON の exact raw bytes を provenance blob として保存
  → migration receipt を保存
  → v2 store 全体の整合性を検証
  → source/state fingerprint を再確認
  → staging directory を destination へ rename
```

最後の再確認までに source が変わった場合は停止します。完成前の staging を destination として公開せず、移行元は成功・失敗にかかわらず変更しません。

rename 後の parent directory 同期に失敗した場合、destination は公開済みですが crash durability を確認できないため、その不確定状態を明示して失敗します。destination は削除せず、同じ `migrate` を再実行すると migration receipt、source fingerprint、store integrity を再検査し、一致すれば `already-applied` として完了します。公開前に失敗し、staging directory の削除にも失敗した場合は、元の失敗と残った staging path の両方を報告します。

元 state の mode と current scenario は、対応する v2 ID へ変換できる場合に store metadata/catalog へ反映します。

## body の変換

各 recording の request/response body を生 byte 列へ変換し、SHA-256 blob として保存します。media type が JSON の場合は値を JSON byte 列へ serialize し、それ以外は raw/string の意味を維持します。

v1 recorder は Fetch が展開した後の body 値を保存しながら、元 response の `Content-Encoding` と `Content-Length` を JSON に残していました。migration は body 値を decoded representation として扱い、request/response の `BodyRef.contentEncoding` を `null` にします。旧 `Content-Encoding` は除去し、`Content-Length` は実際に保存した decoded blob size へ置き換えます。gzip 等へ再圧縮したと誤認する metadata は作りません。

v1 の path parameter は URL 上の percent-encoded 値で保存されていたため、migration 時に 1 回だけ decode し、v2 の route matcher と同じ値で recording と fingerprint を作ります。不正な percent escape は推測で補正せず、該当 file を示す preflight error として本移行を停止します。

HEAD と status 204/205/304 の response body は HTTP 表現として保存せず、余計な blob も作りません。最終 response として配信できない 1xx status や、安全に再構築できない header/status text は dry-run で error にします。元 JSON 自体は次の provenance に残ります。

変換後 body とは別に、元 recording file 全体の exact raw bytes と digest を provenance として保存します。これにより migration receipt と source inventory の対応を後から検証できます。

同じ request identity の v1 file が複数ある場合も削除しません。旧 matcher と同じ code-unit filename 順の先頭だけを active candidate とし、残りは non-matchable shadow として保持します。active file の削除または request 編集時は同じ identity の先頭 shadow を同一 commit で昇格し、shadow の request を固有 identity へ編集した場合も active になります。response だけの編集では winner を変えません。

## destination の扱い

destination がない場合だけ、新しい staging から作成します。すでに destination がある場合は次のどちらかです。

- migration receipt、source fingerprint、entry、store integrity が一致する: `already-applied` として成功
- 一致を証明できない、または壊れている: 上書きせず失敗

既存 destination を削除して再試行するかは自動判断しません。必要なら先に別名へ backup し、利用者が対象を確認してください。

`init`、`start`、`doctor` は同じ判定を使います。移行対象の v1 data と、migration provenance を持たない native または不完全な v2 destination が併存する場合は conflict として停止します。空の source root と root 直下の `.gitkeep` だけは移行対象ではありません。ただし `.gitkeep` だけを含む leaf scenario directory は、空 scenario として移行対象です。

## `doctor`

移行成功後は必ず `snaperro doctor` を実行します。metadata/catalog/manifest/blob に加え、migration receipt に記録した元 file digest と provenance blob を検証します。receipt は移行時点の source inventory の証明であり、移行後の visible catalog を固定するものではありません。通常の recording / scenario / folder の名前変更や削除後も診断は成功し、元 byte の provenance blob が改ざんされた場合は失敗します。

`doctor` は読み取り専用です。error を見つけても source や destination を修復・削除しません。

## automation

```bash
pnpm exec snaperro migrate --dry-run --json
pnpm exec snaperro migrate --json
pnpm exec snaperro doctor --json
```

各 command は成功時 `0`、blocking error 時 `1` を返します。log 文面ではなく JSON の `ok` と `report` / `checks` を判定してください。
