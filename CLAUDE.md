# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

snaperro（スナペーロ）- GUI付きモックプロキシサーバー。複数APIからのレスポンスを記録・再生し、開発・テストを効率化する。詳細は [doc/2025-11-29_プロジェクト方針.md](doc/2025-11-29_プロジェクト方針.md)、[doc/2025-12-01_概要.md](doc/2025-12-01_概要.md) を参照。

## コマンド

```bash
pnpm install          # 依存関係インストール
pnpm format           # Biomeでフォーマット + lint修正
pnpm lint             # Biomeでlintチェックのみ
```

## ローカルCLI実行

```bash
pnpm build && npx . init      # ビルド後にCLI実行
npx tsx src/cli/index.ts init # ビルドなしで直接実行
```

## コミット前チェック

```bash
pnpm type-check && pnpm format
```

※ `type-check` スクリプトは未実装（TypeScript設定後に追加予定）

## 技術スタック

- パッケージマネージャー: pnpm
- Linter/Formatter: Biome
- バリデーション: Zod
- 日付: dayjs

## 核心制約

### NEVER（絶対禁止）
- NEVER: data-testidをテストで使用

### YOU MUST（必須事項）
- YOU MUST: 質問をする場合は、1つずつ質問してください
- YOU MUST: ユーザーの指示で不明瞭な箇所は必ず聞き返してください
- YOU MUST: コミット前に必ず`pnpm type-check`, `pnpm format`を実行してエラーがないことを確認

### IMPORTANT（重要事項）
- IMPORTANT: 作業開始前に計画することを好む
- IMPORTANT: utf-8を利用すること
- IMPORTANT: 言語について
   - アプリケーションのメッセージ、UI、コメント: 英語
   - doc: 日本語
   - コンソール出力: 英語
   - README: 英語（README_jaは日本語）
