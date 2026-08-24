# folder / scenario / recording

v2 の管理単位は folder、scenario、recording の 3 階層です。path や表示名ではなく安定した opaque ID で参照するため、名前変更をしても選択状態や参照が壊れません。

```text
folder
└── scenario
    ├── recording
    ├── recording
    └── ...
```

## folder

folder は scenario のまとまりです。管理画面または typed command から次を行えます。

- 作成、名前変更、削除
- ZIP archive の import
- ZIP archive への export

folder を削除すると、catalog から folder と配下 scenario が一度の commit で見えなくなります。参照されなくなった manifest と blob の物理削除は GC に委ねます。

export は server 側で self-contained archive を stage し、短命な single-use capability から native download します。import は archive を upload・検証・stage した後、`folder.import` command で catalog へ commit します。

## scenario

scenario は一組の mock 状態で、必ず一つの folder に属します。次を行えます。

- 作成、名前変更、複製、削除
- 現在の scenario として選択
- recording の一覧、検索、ページ送り

scenario の recording metadata は revision ごとの immutable manifest に保存します。catalog は現在見える manifest の pointer と件数を持ちます。

複製時は元 scenario の recording 集合を新しい安定 ID の scenario として作ります。選択中 scenario を削除した場合は、存在しない ID を選択状態に残しません。

## recording

recording は、一つの request fingerprint と返す response の組です。

主な情報は次のとおりです。

- 論理 filename と安定した recording ID
- method、route、request fingerprint
- request の path/query/header/body reference
- response の status/header/body reference
- 作成・更新日時と content revision

request / response body は metadata 内の値ではなく、`BodyRef` で SHA-256 blob を参照します。

```ts
type BodyRef = {
  sha256: string;
  size: number;
  mediaType: string | null;
  contentEncoding: string | null;
};
```

body がない場合は `null` です。JSON かどうかは filename ではなく media type と利用箇所で扱い、保存する blob は常に受信した生 byte 列です。

## 作成と編集

recording は traffic の `record` / `smart`、JSON/ZIP import、管理画面での編集から作成・更新できます。body は先に upload して `BodyRef` を得てから、recording command に含めます。

portable ZIP export は recording metadata と参照 blob を一緒に格納します。import 時は ID、revision、timestamp、request fingerprint を持ち込まず、対象 scenario で新しい ID を発行し、blob の digest/size を検証して fingerprint を再導出します。

更新には次の revision が関係します。

| revision | 防ぐ競合 |
| --- | --- |
| catalog revision | folder/scenario 構造や現在選択の lost update |
| scenario revision | 同じ scenario の recording 集合の lost update |
| content revision | 同じ recording 本文の古い編集による上書き |

期待 revision が一致しない command は conflict になります。client は最新 snapshot/recording を取得し、dirty draft を保持したまま利用者に再読込または再編集を求めます。

## 一覧と検索

recording の一覧と検索は cursor pagination です。既定は 50 件、最大 200 件です。metadata/header に加え、content encoding のない request/response body を UTF-8 text として stream 検索します。大きな body は一覧や検索結果に含めず、download 時も native stream を使います。

## ID と名前

folder、scenario、recording ID はそれぞれ `fld_`、`scn_`、`rec_` prefix を持つ opaque value です。新規作成では random UUID を基にし、migration では同じ source identity から同じ ID を決定的に生成します。

表示名と filename は人が操作する label であり、永続参照や URL path の代わりには使いません。
