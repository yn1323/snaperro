import { Flex } from "@chakra-ui/react";
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
    <Flex direction="column" h="100vh" bg="gray.50">
      {topBar}
      <Flex flex={1} overflow="hidden" minW={0}>
        {patternPane}
        {filePane}
        {editorPane}
      </Flex>
    </Flex>
  );
}
