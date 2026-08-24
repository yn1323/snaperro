# v2 実装上の不変条件

この文書は、実装を変更するときに壊してはいけない境界をまとめたものです。利用方法は [日本語 README](../../README_ja.md)、構成全体は [アーキテクチャ](../ARCHITECTURE.md) を参照してください。

## 契約の正本

`shared/contracts-v2` の Zod スキーマを、ブラウザーとサーバーの通信、永続エンティティ、ID、revision の正本とします。ブラウザーとサーバーが別々の型や JSON 形式を定義してはいけません。

書き込みは command、読み取りは query に分離します。すべての envelope は `protocolVersion: 2` を持ち、未知のフィールドや不正な ID を境界で拒否します。

## 整合性

- catalog の変更は `expectedRevision`、recording の変更は `expectedScenarioRevision` と `expectedContentRevision` で競合を検出します。
- recording の新しい manifest を先に不変ファイルとして保存し、最後に catalog の参照を CAS 更新して可視化します。
- blob は受信した生バイト列を SHA-256 で参照し、JSON metadata に埋め込みません。
- 永続 JSON は同一ディレクトリの一時ファイルへ書き、ファイル同期、rename、ディレクトリ同期の順で確定します。
- プロセス内 mutex と store lease を同時に使い、複数 writer の更新を直列化します。

削除は catalog の commit で即座に見えなくなります。参照されなくなった manifest と blob の物理削除は GC が行い、commit 前の staging と競合しないよう既定 1 時間の猶予を置きます。

## ストリーミング

request/response body と folder/recording import/export は、全体をメモリへ展開せずストリームとして処理します。サイズ上限、abort、backpressure、部分ファイルの破棄をすべての経路で維持してください。download は control token と分離した same-origin、single-use、短寿命の capability から native browser stream で行います。record 中のクライアント切断後に upstream を読み切るかは `recording.completeOnClientDisconnect` に従います。

## migration

migration は copy-on-write です。移行元を変更せず、別の staging store を完成・検証した後だけ destination 名へ切り替えます。移行元 identity から決定的 ID を生成し、同じ入力に対する再実行を冪等にします。既存 destination の由来を証明できない場合は上書きしません。

## transport と同期

snapshot の取得とイベント購読開始は同じ write barrier 内で行い、接続時の取りこぼしを防ぎます。クライアントは `runtimeId`、`sequence`、`revision` を検証し、欠落、再起動、競合を検出したら snapshot から再同期します。イベント履歴はプロセス再起動をまたいで永続化しません。

## 変更時の gate

`pnpm lint`、3 種類の type-check、`pnpm test:all`、`pnpm build`、`pnpm verify:package` をすべて通します。wire schema、store commit、migration、安全制限には単体または contract test を追加してください。

npm publish は `v<package version>` tag だけを入口にし、checkout した commit と tag の参照先が一致し、その commit が `origin/main` の履歴に含まれることを full-history checkout で検証します。検証後も同じ commit で全 gate と package 内容の確認を行い、OIDC provenance 付きで publish します。GitHub 側でも `npm` environment と release tag の保護を維持してください。
