# 4 つのモード

snaperro は request ごとに route と fingerprint を決定し、現在の mode に従って proxy、record、mock を組み合わせます。mode の切り替えは revision 付き command として全 client に同期されます。

各 request は受付時に一度だけ catalog を読み、その時点の mode と選択中 scenario を処理完了まで固定します。処理中に管理画面から mode や scenario が変更されても、一つの request が新旧状態を混在させることはありません。

## 比較

| mode | upstream へ接続 | recording を参照 | response を保存 |
| --- | --- | --- | --- |
| `proxy` | 常に | しない | しない |
| `record` | 常に | しない | 選択中 scenario へ保存 |
| `mock` | miss 時は fallback に従う | 選択中 scenario | `proxy&record` fallback のときだけ保存 |
| `smart` | miss 時だけ | 選択中 scenario | miss response を保存 |

## `proxy`

すべての matching route を upstream へ転送し、返ってきた status、header、body を client へ流します。store を読み書きしないため scenario の選択は不要です。

## `record`

すべての matching route を upstream へ転送しながら response を選択中 scenario へ記録します。同じ request fingerprint がすでに存在する場合は、その scenario の recording を更新します。

scenario が選択されていない場合は記録先を推測せず失敗します。

## `mock`

選択中 scenario から fingerprint が一致する recording を探し、保存済み status、header、body を返します。見つからない場合は `mock.fallback` に従います。

- `404`: not found を返す
- `proxy`: upstream response をそのまま返す
- `proxy&record`: upstream response を返し、選択中 scenario へ記録する

## `smart`

一致する recording があれば mock response を返します。見つからなければ upstream へ転送して response を記録します。通常利用では、既存 fixture を維持しながら未記録 request だけを補う mode です。

## request matching

fingerprint は次の情報から決まります。

1. HTTP method
2. 設定で一致した route pattern
3. path parameter
4. key/value を正規化した query parameter
5. request body の内容

host や表示用 filename では識別しません。同じ意味の query を安定して照合し、body が異なる request は別 recording として扱います。

request body が `recording.maxRequestBodyBytes` を超える場合、無制限に memory を消費して fingerprint を作りません。記録できない理由を typed error と request log に残します。

## streaming

proxy と record の response は upstream から client へ chunk 単位で流します。record 時は同じ stream を blob writer にも渡し、backpressure を維持します。

blob書き込みやrecording commitだけが失敗した場合も、すでに得たupstream responseのstatus・header・bodyはclientへ最後まで返します。request logでは通信結果と保存結果を分け、保存失敗を`recording.outcome`として通知します。不完全なrecordingはcatalogへ公開しません。

client 切断後の動作は `recording.completeOnClientDisconnect` で選びます。`true` は記録を完成させ、`false` は upstream と stage 中の保存を中止します。どちらの場合も、不完全な recording を catalog へ公開しません。
