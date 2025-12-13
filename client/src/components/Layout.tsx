import { Flex } from "@chakra-ui/react";
import { type ReactNode, useCallback } from "react";
import { usePaneWidths } from "../hooks/usePaneWidths";
import { ResizeHandle } from "./ResizeHandle";

interface LayoutProps {
  topBar: ReactNode;
  patternPane: (width: number) => ReactNode;
  filePane: (width: number) => ReactNode;
  editorPane: ReactNode;
}

/**
 * 3-pane layout with resizable sidebars
 * - TopBar: Mode switching
 * - Left pane: Pattern list (resizable)
 * - Center pane: File list (resizable)
 * - Right pane: Editor (remaining width)
 */
export function Layout({ topBar, patternPane, filePane, editorPane }: LayoutProps) {
  const { patternWidth, fileWidth, setPatternWidth, setFileWidth } = usePaneWidths();

  const handlePatternResize = useCallback(
    (delta: number) => {
      setPatternWidth(patternWidth + delta);
    },
    [patternWidth, setPatternWidth],
  );

  const handleFileResize = useCallback(
    (delta: number) => {
      setFileWidth(fileWidth + delta);
    },
    [fileWidth, setFileWidth],
  );

  return (
    <Flex direction="column" h="100vh" bg="gray.50">
      {topBar}
      <Flex flex={1} overflow="hidden" minW={0}>
        {patternPane(patternWidth)}
        <ResizeHandle onResize={handlePatternResize} />
        {filePane(fileWidth)}
        <ResizeHandle onResize={handleFileResize} />
        {editorPane}
      </Flex>
    </Flex>
  );
}
