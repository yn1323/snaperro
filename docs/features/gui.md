# GUI

React 管理画面は `http://<host>:<port>/__snaperro__/client` で提供します。Hono server と同一 origin で動き、共有 v2 contract の command/query、upload/import stream、native download capability、イベント stream を利用します。

## 画面構成

```text
┌──────────────────────────────────────────────────────┐
│ connection / mode / current scenario                 │
├──────────────┬────────────────┬──────────────────────┤
│ folder /     │ recording      │ recording editor     │
│ scenario     │ list / search  │ body actions         │
├──────────────┴────────────────┴──────────────────────┤
│ request log                                           │
└──────────────────────────────────────────────────────┘
```

panel 幅は操作に合わせて調整でき、recording 一覧は endpoint ごとにまとめます。

## top bar

server version、connection state、mode、現在選択中 scenario、control token の設定状態を表示します。mode は `proxy`、`record`、`mock`、`smart` から切り替えます。

connection state は connecting、connected、reconnecting、resyncing、disconnected を区別します。reload や一時的な切断を「データが空」と誤認せず、snapshot の再取得中であることを表示します。

server が `401 UNAUTHORIZED` を返すと control token dialog を自動で開きます。token を入力すると HTTP とイベント接続の両方を同じ bearer token で再接続します。key icon から token の更新、clear、再接続もできます。

token は password input で受け取り、その page instance の private memory だけに保持します。`sessionStorage`、`localStorage`、URL、React の公開 state、markup、error message には保存・表示しません。reload、navigation、tab close で消えるため、次の接続時に再入力します。

## folder / scenario panel

folder view では次を行えます。

- folder の作成、名前変更、削除
- ZIP archive の import / export
- folder を開いて scenario 一覧へ移動

scenario view では次を行えます。

- scenario の作成、名前変更、複製、削除
- traffic が参照・記録する current scenario の選択
- folder 一覧へ戻る

削除は確認 dialog を経由します。server の catalog commit が成功してから UI state に反映し、失敗時に見た目だけ削除しません。

## recording panel

選択中 scenario の recording summary を cursor pagination で読み込みます。

- endpoint ごとの group 表示
- method、filename の表示
- filename、metadata/header、分離保存された非圧縮 request/response body を対象にした text search
- `Load more` による次 page の取得
- recording JSON/ZIP の import と、body を含む portable ZIP download

一覧 result には body byte 列を含めません。recording を開いたときに詳細 metadata を取得し、必要な body だけを個別に stream します。
検索結果の Previous/Next は editor 内の JSON 一致だけを移動します。filename または分離保存された非圧縮 body だけが一致した場合は、画面の body download で内容を確認します。`content-encoding` がある body は圧縮 byte 列を文字列として誤判定しないよう、本文検索の対象外です。

## editor

editor は recording の JSON 表現を編集します。

- format
- save、delete
- request body の upload / download
- response body の upload / download
- `Ctrl+S` / `Cmd+S` で保存

body upload は raw file を先に blob endpoint へ stream し、返された `BodyRef` を draft に設定します。巨大な body を editor 用 JSON に埋め込みません。

body を置き換えると、`BodyRef` を正本として `content-type`、`content-encoding`、`content-length` も同期します。古い representation header を残して mock response や request fingerprint と byte 実体を不一致にしません。

textarea の入力 buffer は server snapshot から分離します。key 入力ごとに大きな document 全体を React tree へ複製せず、明示的な parse/save 時に contract へ変換します。

## 未保存変更と競合

別 recording や scenario を開く前に dirty draft がある場合、破棄確認を表示します。イベントで remote change を受けた場合も draft を自動破棄しません。

| 状態 | GUI の動作 |
| --- | --- |
| 同じ recording が更新された | reload または draft 継続を選択 |
| 同じ recording が削除された | draft を保持し、保存を停止 |
| current scenario が変わった | 元 scenario へ戻るまで保存を停止 |
| 保存時 revision conflict | 最新値を取得し、古い draft の黙示上書きをしない |
| event sequence gap / runtime 変更 | snapshot を取得し直して resync |

## request log

下部 panel は traffic の完了と非同期の記録結果を同じ request 行へ反映します。時刻、method、path、実行 action/sub-action、status、所要時間、mock の match、保存中・保存成功・保存失敗と安全な失敗内容を確認できます。mock hit の `matched` は既存 recording の選択を表すだけで、`saved` とは表示しません。

request log は runtime telemetry であり、永続 recording 一覧とは別です。mock で既存 recording に一致した状態を `matched`、record/smart の非同期保存を `saving…`、`saved`、`failed` として区別します。同じ request ID の outcome event で一つの行を更新します。画面上で clear しても recording や store を削除しません。

## import / export の失敗

folder import は upload、archive validation、blob materialize、catalog commit を分離します。途中で失敗した場合は error を表示し、folder の一部だけを一覧へ追加しません。

folder export と body/recording download は、既定 60 秒で失効する single-use capability を browser の native download へ渡します。control token や byte 列を URL/JavaScript memory に入れません。一時 ZIP は完了、中断、失効、shutdown 後に削除します。再試行するときは export/download 操作をもう一度実行します。

## 同期の詳細

GUI が使う command/query は [control API](control-api.md)、snapshot と event の規則は [イベント同期](sse.md) を参照してください。
