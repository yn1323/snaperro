# revision とイベント同期

React 管理画面は、最初に snapshot を受け取り、その後 `/__snaperro__/v2/events` の Server-Sent Events で差分を適用します。イベントだけを永続的な履歴として扱わず、異常時は snapshot へ戻れる設計です。

## 接続 handshake

server は snapshot の取得と event subscriber の登録を同じ write barrier 内で行います。

```text
write barrier を取得
  → current snapshot と event watermark を取得
  → subscriber を登録
write barrier を解放
  → runtime.connected を最初に送信
  → 以降の event を sequence 順に送信
```

これにより「snapshot は古いが、その直後の変更 event も購読前で失った」という race を防ぎます。`runtime.connected` の payload は mode、current scenario、folder、scenario の正本となる bounded `ServerSnapshot` です。recording metadata は含めず、page/search query を正本にします。

## event envelope

すべての event は次を持ちます。

| field | 用途 |
| --- | --- |
| `protocolVersion` | 常に `2` |
| `runtimeId` | server process/runtime の識別 |
| `id` | event ID。SSE の `id:` と同じ |
| `sequence` | runtime 内の順序 |
| `revision` | event 適用後の state revision。telemetry は現在値を維持 |
| `occurredAt` | offset 付き ISO timestamp |
| `correlationId` | 原因となった command ID。該当時のみ |
| `type` | event type |
| `payload` | type 固有 payload |

SSE の `event:` には `type`、`data:` には envelope 全体の JSON を入れます。既定で 15 秒ごとに comment heartbeat を送り、proxy や browser の idle timeout を避けます。

## event type

| type | 種別 | 意味 |
| --- | --- | --- |
| `runtime.connected` | handshake | catalog snapshot と現在 watermark |
| `runtime.shutting-down` | lifecycle | server が終了処理へ入った |
| `mode.changed` | state | mode が変わった |
| `scenario.current-changed` | state | 現在の scenario が変わった |
| `folder.upserted` | state | folder を作成・更新・import した |
| `folder.deleted` | state | folder を削除した |
| `scenario.upserted` | state | scenario を作成・更新・複製した |
| `scenario.deleted` | state | scenario を削除した |
| `recording.upserted` | state | recording を作成・更新した |
| `recording.deleted` | state | recording を削除した |
| `request.completed` | telemetry | traffic request が完了した |
| `recording.outcome` | telemetry | 非同期 recording の保存結果が確定した |

recording summary event の payload は、`recording.upserted` が `recording`、`recording.deleted` が `recordingId` と `scenarioId` を持ちます。両方とも commit 後の `scenarioRevision` を含み、GUI の一覧 revision を同期します。

folder import と scenario duplicate は、recording summary 全件を event に含めません。folder import は folder と `recordingsInvalidated: true` だけを通知し、client は接続を張り直して新しい catalog snapshot を取得します。scenario duplicate は対象 scenario と同 marker を通知し、active scenario なら現在の pagination/search 条件で一覧を再取得します。どちらも編集中 document は dirty のまま再検証します。

client parser は1行・1 eventの累積UTF-8 byte数をそれぞれ4 MiBまでに制限します。超過時は保持中bufferを増やし続けず retryableなstream errorとして接続を破棄し、再接続先の `runtime.connected` から同期し直します。

`request.completed` の `matchedRecordingId` は mock が選んだ既存 recording だけを表し、保存成功を意味しません。保存状態は独立した `recordingOutcome`（`not-attempted` / `pending` / `saved` / `failed`）で表します。streaming response の capture はまず `pending` になり、完了後の `recording.outcome` が同じ `requestId` を使って `saved` または安全な `Problem` を含む `failed` へ更新します。

## revision の規則

state event は commit 済み state の revision を持ちます。client は現在 revision と連続する更新だけを適用します。`request.completed` と `recording.outcome` は catalog を変更しないため、発生時点の revision を保持します。

削除 event は catalog commit 後に publish されます。したがって GUI が event を受け取った時点で query からも対象は見えません。物理 file の GC 完了を待って表示を消すことはありません。

## client の判定

client は次の順で event を検査します。

1. Zod schema と `protocolVersion` を検証
2. `runtimeId` が接続中 runtime と一致するか確認
3. `sequence` で重複と gap を検出
4. state event の `revision` が期待どおり進むか確認
5. type 固有 payload を state へ適用

重複 event は再適用しません。sequence gap、未知 runtime、revision の飛び、schema error を検出したら、局所的な推測修復をせず snapshot と active recording query を取り直します。slow subscriber の待機 queue は event replay capacity と同じ上限を使い、超過時は中間 event を捨てて最新 event だけを残します。その sequence gap により client は同じ再同期経路へ入ります。

## reconnect

network 切断時は再接続しますが、server の event hub は process memory 内にあり、再起動をまたぐ durable replay を提供しません。再接続後の最初の `runtime.connected` snapshot を正本として state を作り直します。

ブラウザーが保持した古い event ID だけで完全同期できるとは仮定しないでください。自動化 client も、接続ごとの `runtime.connected` を必須 handshake として扱います。

## 編集中の recording

一覧 summary の remote revision が編集中 recording より新しくなっても、dirty draft を自動上書きしません。GUI は remote update、削除、scenario 切り替えを conflict state として表示します。

- remote update: reload または draft 継続を選ぶ
- remote delete: draft は画面に保持するが保存を止める
- scenario change: 元の scenario へ戻るまで保存を止める

保存時にも `expectedScenarioRevision` と `expectedContentRevision` を検査するため、event が遅延しても server 側で lost update を防ぎます。

## shutdown

正常終了時は `runtime.shutting-down` を可能な範囲で送信してから connection を閉じます。client は disconnected 表示へ移り、server が再開したら新しい `runtimeId` と snapshot で同期し直します。
