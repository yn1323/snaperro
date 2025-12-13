import { useCallback, useEffect, useState } from "react";

import { ConfirmDialog } from "./components/dialogs/ConfirmDialog";
import { EditorPane } from "./components/EditorPane";
import { FilePane } from "./components/FilePane";
import { Layout } from "./components/Layout";
import { PatternPane } from "./components/PatternPane";
import { TopBar } from "./components/TopBar";
import { useFavicon } from "./hooks/useFavicon";
import { useSnaperroAPI } from "./hooks/useSnaperroAPI";
import { useSnaperroSSE } from "./hooks/useSnaperroSSE";
import type { FileData, Mode } from "./types";

export default function App() {
  const { state, connected } = useSnaperroSSE();
  const api = useSnaperroAPI();

  // Dynamic favicon based on connection and mode
  const favicon = !connected ? "⚠️" : state.mode === "record" ? "🔴" : state.mode === "proxy" ? "🌐" : "🐕";
  useFavicon(favicon);

  // Local state
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileData, setFileData] = useState<FileData | null>(null);
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const [deleteFileTarget, setDeleteFileTarget] = useState<string | null>(null);
  const [currentFolder, setCurrentFolder] = useState<string | null>(null);

  // Reset file selection when pattern changes
  const currentPattern = state.currentPattern;
  useEffect(() => {
    // Clear file selection when currentPattern changes
    if (currentPattern !== undefined) {
      setSelectedFile(null);
      setFileData(null);
    }
  }, [currentPattern]);

  // Load content when file is selected
  useEffect(() => {
    const pattern = state.currentPattern;
    if (!pattern || !selectedFile) {
      setFileData(null);
      return;
    }

    const loadFile = async () => {
      setIsLoadingFile(true);
      try {
        const data = await api.getFile(pattern, selectedFile);
        setFileData(data);
      } catch (err) {
        console.error("File load error:", err);
        setFileData(null);
      } finally {
        setIsLoadingFile(false);
      }
    };

    loadFile();
  }, [state.currentPattern, selectedFile, api]);

  // ============================================================
  // Event handlers
  // ============================================================

  const handleModeChange = useCallback(
    async (mode: Mode) => {
      try {
        await api.setMode(mode);
      } catch (err) {
        console.error("Mode change error:", err);
      }
    },
    [api],
  );

  const handlePatternSelect = useCallback(
    async (pattern: string) => {
      try {
        await api.setCurrentPattern(pattern);
      } catch (err) {
        console.error("Pattern select error:", err);
      }
    },
    [api],
  );

  const handlePatternCreate = useCallback(
    async (name: string) => {
      try {
        const fullName = currentFolder ? `${currentFolder}/${name}` : name;
        await api.createPattern(fullName);
      } catch (err) {
        console.error("Pattern create error:", err);
      }
    },
    [api, currentFolder],
  );

  const handlePatternUpload = useCallback(
    async (file: File) => {
      try {
        await api.uploadPattern(file);
      } catch (err) {
        console.error("Pattern upload error:", err);
      }
    },
    [api],
  );

  const handlePatternRename = useCallback(
    async (oldName: string, newName: string) => {
      try {
        await api.renamePattern(oldName, newName);
      } catch (err) {
        console.error("Pattern rename error:", err);
      }
    },
    [api],
  );

  const handlePatternDuplicate = useCallback(
    async (name: string) => {
      try {
        await api.duplicatePattern(name, `${name}_copy`);
      } catch (err) {
        console.error("Pattern duplicate error:", err);
      }
    },
    [api],
  );

  const handlePatternDownload = useCallback(
    async (name: string) => {
      try {
        await api.downloadPattern(name);
      } catch (err) {
        console.error("Pattern download error:", err);
      }
    },
    [api],
  );

  const handlePatternDelete = useCallback(
    async (name: string) => {
      try {
        await api.deletePattern(name);
      } catch (err) {
        console.error("Pattern delete error:", err);
      }
    },
    [api],
  );

  // Folder handlers
  const handleFolderSelect = useCallback((folder: string) => {
    setCurrentFolder(folder);
  }, []);

  const handleFolderBack = useCallback(async () => {
    setCurrentFolder(null);
    setSelectedFile(null);
    setFileData(null);
    try {
      await api.setCurrentPattern(null);
    } catch (err) {
      console.error("Pattern deselect error:", err);
    }
  }, [api]);

  const handleFolderCreate = useCallback(
    async (name: string) => {
      try {
        await api.createFolder(name);
      } catch (err) {
        console.error("Folder create error:", err);
      }
    },
    [api],
  );

  const handleFolderRename = useCallback(
    async (oldName: string, newName: string) => {
      try {
        await api.renameFolder(oldName, newName);
        if (currentFolder === oldName) {
          setCurrentFolder(newName);
        }
      } catch (err) {
        console.error("Folder rename error:", err);
      }
    },
    [api, currentFolder],
  );

  const handleFolderDelete = useCallback(
    async (name: string) => {
      try {
        await api.deleteFolder(name);
        if (currentFolder === name) {
          setCurrentFolder(null);
        }
      } catch (err) {
        console.error("Folder delete error:", err);
      }
    },
    [api, currentFolder],
  );

  const handleFileSave = useCallback(
    async (data: FileData) => {
      if (!state.currentPattern || !selectedFile) return;
      try {
        await api.updateFile(state.currentPattern, selectedFile, data);
        setFileData(data);
      } catch (err) {
        console.error("File save error:", err);
      }
    },
    [api, state.currentPattern, selectedFile],
  );

  const handleFileDelete = useCallback(() => {
    if (selectedFile) {
      setDeleteFileTarget(selectedFile);
    }
  }, [selectedFile]);

  const handleFileDeleteConfirm = useCallback(async () => {
    if (!deleteFileTarget || !state.currentPattern) return;
    try {
      await api.deleteFile(state.currentPattern, deleteFileTarget);
      setSelectedFile(null);
      setFileData(null);
    } catch (err) {
      console.error("ファイル削除エラー:", err);
    }
    setDeleteFileTarget(null);
  }, [api, state.currentPattern, deleteFileTarget]);

  const handleFileUpload = useCallback(
    async (file: File) => {
      if (!state.currentPattern) return;
      try {
        await api.uploadFile(state.currentPattern, file);
      } catch (err) {
        console.error("File upload error:", err);
      }
    },
    [api, state.currentPattern],
  );

  const handleFileDownload = useCallback(
    async (filename: string) => {
      if (!state.currentPattern) return;
      try {
        await api.downloadFile(state.currentPattern, filename);
      } catch (err) {
        console.error("File download error:", err);
      }
    },
    [api, state.currentPattern],
  );

  return (
    <>
      <Layout
        topBar={
          <TopBar
            version={state.version}
            mode={state.mode}
            connected={connected}
            currentPattern={state.currentPattern}
            onModeChange={handleModeChange}
          />
        }
        patternPane={(width) => (
          <PatternPane
            width={width}
            folders={state.folders}
            currentFolder={currentFolder}
            onFolderSelect={handleFolderSelect}
            onFolderBack={handleFolderBack}
            onFolderCreate={handleFolderCreate}
            onFolderRename={handleFolderRename}
            onFolderDelete={handleFolderDelete}
            patterns={state.patterns}
            currentPattern={state.currentPattern}
            onSelect={handlePatternSelect}
            onCreate={handlePatternCreate}
            onUpload={handlePatternUpload}
            onRename={handlePatternRename}
            onDuplicate={handlePatternDuplicate}
            onDownload={handlePatternDownload}
            onDelete={handlePatternDelete}
          />
        )}
        filePane={(width) => (
          <FilePane
            width={width}
            files={state.files}
            selectedFile={selectedFile}
            onSelect={setSelectedFile}
            onUpload={handleFileUpload}
            onDownload={handleFileDownload}
          />
        )}
        editorPane={
          <EditorPane
            fileData={fileData}
            filename={selectedFile}
            isLoading={isLoadingFile}
            onSave={handleFileSave}
            onDelete={handleFileDelete}
          />
        }
      />

      {/* File delete confirmation dialog */}
      <ConfirmDialog
        isOpen={deleteFileTarget !== null}
        title="Delete File"
        message={`Delete file "${deleteFileTarget}"? This action cannot be undone.`}
        confirmLabel="Delete"
        onClose={() => setDeleteFileTarget(null)}
        onConfirm={handleFileDeleteConfirm}
      />
    </>
  );
}
