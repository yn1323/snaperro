import type { ReactNode } from "react";

interface LayoutProps {
  topBar: ReactNode;
  patternPane: ReactNode;
  filePane: ReactNode;
  editorPane: ReactNode;
}

/**
 * 3ペインレイアウト
 * - TopBar: モード切替
 * - 左ペイン: パターン一覧 (150px固定)
 * - 中央ペイン: ファイル一覧 (250px)
 * - 右ペイン: エディタ (残り幅)
 */
export function Layout({ topBar, patternPane, filePane, editorPane }: LayoutProps) {
  return (
    <div className="h-screen flex flex-col bg-gray-50">
      {/* トップバー */}
      {topBar}

      {/* メインコンテンツエリア */}
      <div className="flex-1 flex overflow-hidden">
        {/* 左ペイン - パターン (150px固定) */}
        {patternPane}

        {/* 中央ペイン - ファイル (250px) */}
        {filePane}

        {/* 右ペイン - エディタ (残り幅) */}
        {editorPane}
      </div>
    </div>
  );
}
