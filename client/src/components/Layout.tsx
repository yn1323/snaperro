import { Flex } from "@chakra-ui/react";
import { type ReactNode, useCallback } from "react";
import { usePaneWidths } from "../hooks/usePaneWidths";
import { ResizeHandle } from "./ResizeHandle";

interface LayoutProps {
  topBar: ReactNode;
  scenarioPane: (width: number) => ReactNode;
  filePane: (width: number) => ReactNode;
  editorPane: ReactNode;
}

/**
 * 3-pane layout with resizable sidebars
 * - TopBar: Mode switching
 * - Left pane: Scenario list (resizable)
 * - Center pane: File list (resizable)
 * - Right pane: Editor (remaining width)
 */
export function Layout({ topBar, scenarioPane, filePane, editorPane }: LayoutProps) {
  const { scenarioWidth, fileWidth, setScenarioWidth, setFileWidth } = usePaneWidths();

  const handleScenarioResize = useCallback(
    (delta: number) => {
      setScenarioWidth(scenarioWidth + delta);
    },
    [scenarioWidth, setScenarioWidth],
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
        {scenarioPane(scenarioWidth)}
        <ResizeHandle onResize={handleScenarioResize} />
        {filePane(fileWidth)}
        <ResizeHandle onResize={handleFileResize} />
        {editorPane}
      </Flex>
    </Flex>
  );
}
