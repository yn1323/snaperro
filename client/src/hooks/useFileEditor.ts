import { useCallback, useEffect, useState } from "react";
import type { FileData } from "../types";
import { withErrorHandling } from "../utils/error-handler";
import type { useSnaperroAPI } from "./useSnaperroAPI";

interface UseFileEditorProps {
  api: ReturnType<typeof useSnaperroAPI>;
  currentScenario: string | null;
}

interface UseFileEditorReturn {
  selectedFile: string | null;
  setSelectedFile: (file: string | null) => void;
  fileData: FileData | null;
  isLoadingFile: boolean;
  deleteFileTarget: string | null;
  handleFileSave: (data: FileData) => Promise<void>;
  handleFileDelete: () => void;
  handleFileDeleteConfirm: () => Promise<void>;
  handleFileUpload: (file: File) => Promise<void>;
  handleFileDownload: (filename: string) => Promise<void>;
  resetFileSelection: () => void;
  closeDeleteConfirm: () => void;
}

/**
 * Hook for managing file editor state and operations
 */
export function useFileEditor({ api, currentScenario }: UseFileEditorProps): UseFileEditorReturn {
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileData, setFileData] = useState<FileData | null>(null);
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const [deleteFileTarget, setDeleteFileTarget] = useState<string | null>(null);

  // Load content when file is selected
  useEffect(() => {
    if (!currentScenario || !selectedFile) {
      setFileData(null);
      return;
    }

    const loadFile = async () => {
      setIsLoadingFile(true);
      const data = await withErrorHandling(() => api.getFile(currentScenario, selectedFile), "File load error");
      setFileData(data ?? null);
      setIsLoadingFile(false);
    };

    loadFile();
  }, [currentScenario, selectedFile, api]);

  const handleFileSave = useCallback(
    async (data: FileData) => {
      if (!currentScenario || !selectedFile) return;
      await withErrorHandling(async () => {
        await api.updateFile(currentScenario, selectedFile, data);
        setFileData(data);
      }, "File save error");
    },
    [api, currentScenario, selectedFile],
  );

  const handleFileDelete = useCallback(() => {
    if (selectedFile) {
      setDeleteFileTarget(selectedFile);
    }
  }, [selectedFile]);

  const handleFileDeleteConfirm = useCallback(async () => {
    if (!deleteFileTarget || !currentScenario) return;
    await withErrorHandling(async () => {
      await api.deleteFile(currentScenario, deleteFileTarget);
      setSelectedFile(null);
      setFileData(null);
    }, "File delete error");
    setDeleteFileTarget(null);
  }, [api, currentScenario, deleteFileTarget]);

  const handleFileUpload = useCallback(
    async (file: File) => {
      if (!currentScenario) return;
      await withErrorHandling(() => api.uploadFile(currentScenario, file), "File upload error");
    },
    [api, currentScenario],
  );

  const handleFileDownload = useCallback(
    async (filename: string) => {
      if (!currentScenario) return;
      await withErrorHandling(() => api.downloadFile(currentScenario, filename), "File download error");
    },
    [api, currentScenario],
  );

  const resetFileSelection = useCallback(() => {
    setSelectedFile(null);
    setFileData(null);
  }, []);

  const closeDeleteConfirm = useCallback(() => {
    setDeleteFileTarget(null);
  }, []);

  return {
    selectedFile,
    setSelectedFile,
    fileData,
    isLoadingFile,
    deleteFileTarget,
    handleFileSave,
    handleFileDelete,
    handleFileDeleteConfirm,
    handleFileUpload,
    handleFileDownload,
    resetFileSelection,
    closeDeleteConfirm,
  };
}
