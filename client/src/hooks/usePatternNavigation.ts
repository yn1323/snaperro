import { useCallback, useState } from "react";
import { withErrorHandling } from "../utils/error-handler";
import type { useSnaperroAPI } from "./useSnaperroAPI";

interface UsePatternNavigationProps {
  api: ReturnType<typeof useSnaperroAPI>;
  onPatternDeselect?: () => void;
}

interface UsePatternNavigationReturn {
  currentFolder: string | null;
  setCurrentFolder: (folder: string | null) => void;
  handleFolderSelect: (folder: string) => void;
  handleFolderBack: () => Promise<void>;
  handlePatternSelect: (pattern: string) => Promise<void>;
}

/**
 * Hook for managing folder/pattern navigation state
 */
export function usePatternNavigation({
  api,
  onPatternDeselect,
}: UsePatternNavigationProps): UsePatternNavigationReturn {
  const [currentFolder, setCurrentFolder] = useState<string | null>(null);

  const handleFolderSelect = useCallback((folder: string) => {
    setCurrentFolder(folder);
  }, []);

  const handleFolderBack = useCallback(async () => {
    setCurrentFolder(null);
    onPatternDeselect?.();
    await withErrorHandling(() => api.setCurrentPattern(null), "Pattern deselect error");
  }, [api, onPatternDeselect]);

  const handlePatternSelect = useCallback(
    async (pattern: string) => {
      await withErrorHandling(() => api.setCurrentPattern(pattern), "Pattern select error");
    },
    [api],
  );

  return {
    currentFolder,
    setCurrentFolder,
    handleFolderSelect,
    handleFolderBack,
    handlePatternSelect,
  };
}
