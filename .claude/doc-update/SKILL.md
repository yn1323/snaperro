---
name: doc-update
description: 機能実装後のドキュメント更新をサポート。新機能追加、API変更、画面追加、スキーマ変更時に docs/ARCHITECTURE.md、docs/INDEX.md、docs/features/*.md を更新する手順と判断基準を提供。
---

# ドキュメント更新ガイド

## 更新フロー

1. 今回の変更内容を確認
2. 下記の判断基準で更新対象を特定
3. 該当ドキュメントを更新
4. 更新内容をユーザーに報告

## 更新判断基準

### 更新が必要
| 変更内容 | 更新対象 |
|----------|----------|
| 新機能追加 | `docs/features/新機能.md` 新規作成 + `docs/INDEX.md` |
| 既存機能の仕様変更 | 該当の `docs/features/*.md` |
| データモデル変更 | 該当の `docs/features/*.md` データモデルセクション |
| API追加・削除 | 該当の `docs/features/*.md` APIセクション |
| 画面追加・削除 | 該当の `docs/features/*.md` 画面一覧 |
| コンポーネント構造変更 | `docs/ARCHITECTURE.md` 機能マッピング |
| ディレクトリ構造変更 | `docs/ARCHITECTURE.md` ディレクトリ構造図 |
| 技術スタック変更 | `docs/ARCHITECTURE.md` 技術スタック |
| 状態管理変更 | `docs/ARCHITECTURE.md` 状態管理セクション |

### 更新不要
- バグ修正（仕様変更なし）
- リファクタリング（構造変更なし）
- スタイル修正
- テスト追加
- パフォーマンス改善

## 各ファイルの更新内容

### docs/ARCHITECTURE.md
- ディレクトリ構造図
- 機能→ファイルマッピング
- ファイル→機能マッピング
- データフロー図
- コンポーネント責務
- 状態管理（server: state.ts、client: SSE同期）
- 技術スタック

### docs/INDEX.md
- 機能一覧テーブル
- 新機能のリンク追加

### docs/features/*.md
テンプレートは [templates.md](references/templates.md) 参照

## チェックリスト

- [ ] 新しいデータ型追加？ → データモデル更新
- [ ] 新しいAPI追加？ → APIセクション更新
- [ ] 新しい画面追加？ → 画面一覧更新
- [ ] 新しいコンポーネント追加？ → コンポーネント構成更新
- [ ] ディレクトリ構造変更？ → ARCHITECTURE.md更新
- [ ] 新機能？ → features/*.md新規作成 + INDEX.md追加
