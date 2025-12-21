import { useCallback, useState } from "react";
import { withErrorHandling } from "../utils/error-handler";
import type { useSnaperroAPI } from "./useSnaperroAPI";

interface UseScenarioNavigationProps {
  api: ReturnType<typeof useSnaperroAPI>;
  onScenarioDeselect?: () => void;
}

interface UseScenarioNavigationReturn {
  currentFolder: string | null;
  setCurrentFolder: (folder: string | null) => void;
  handleFolderSelect: (folder: string) => void;
  handleFolderBack: () => Promise<void>;
  handleScenarioSelect: (scenario: string) => Promise<void>;
}

/**
 * Hook for managing folder/scenario navigation state
 */
export function useScenarioNavigation({
  api,
  onScenarioDeselect,
}: UseScenarioNavigationProps): UseScenarioNavigationReturn {
  const [currentFolder, setCurrentFolder] = useState<string | null>(null);

  const handleFolderSelect = useCallback((folder: string) => {
    setCurrentFolder(folder);
  }, []);

  const handleFolderBack = useCallback(async () => {
    setCurrentFolder(null);
    onScenarioDeselect?.();
    await withErrorHandling(() => api.setCurrentScenario(null), "Scenario deselect error");
  }, [api, onScenarioDeselect]);

  const handleScenarioSelect = useCallback(
    async (scenario: string) => {
      await withErrorHandling(() => api.setCurrentScenario(scenario), "Scenario select error");
    },
    [api],
  );

  return {
    currentFolder,
    setCurrentFolder,
    handleFolderSelect,
    handleFolderBack,
    handleScenarioSelect,
  };
}
