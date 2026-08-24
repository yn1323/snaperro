# snaperro v2 ドキュメント

snaperro v2 の利用方法は [日本語 README](../README_ja.md) だけで一通り確認できます。このディレクトリでは、設定、通信契約、保存方式などを実装単位で詳しく説明します。

## 利用者向け

- [CLI](features/cli.md): 初期化、起動、demo、Postman、migration、診断
- [設定](features/configuration.md): `configVersion: 2` の全設定項目
- [4 つのモード](features/modes.md): proxy / record / mock / smart の動作
- [folder / scenario / recording](features/scenario.md): データモデルと操作
- [GUI](features/gui.md): 管理画面の機能と競合時の動作
- [migration](features/migration.md): 既存データを非破壊で v2 store へ移す手順
- [セキュリティ](features/security.md): bind、token、origin、upload の境界

## 実装・連携向け

- [アーキテクチャ](ARCHITECTURE.md): Hono × React、application 層、store、同期の全体像
- [control API](features/control-api.md): typed command/query と stream endpoint
- [イベント同期](features/sse.md): revision とイベント stream による再同期
- [ファイル保存](features/file-storage.md): catalog、manifest、blob、atomic commit、GC
- [実装上の不変条件](impl/README.md): 改修時に維持する整合性と release gate

## 用語

| 用語 | 意味 |
| --- | --- |
| folder | 複数の scenario をまとめる表示単位 |
| scenario | 一組の mock 状態。選択中の scenario が照合・記録対象になる |
| recording | 一つの request fingerprint と response の組 |
| catalog revision | folder、scenario、選択状態など全体構造の版 |
| scenario revision | scenario 内 recording 集合の版 |
| content revision | 一つの recording 内容の版 |
| blob | request / response body の生 byte 列を SHA-256 で保存したもの |
| snapshot | 管理画面が同期開始・再同期に使う現在状態 |
