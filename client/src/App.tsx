import { useCallback, useEffect, useState } from "react";

import { ConfirmDialog } from "./components/dialogs/ConfirmDialog";
import { EditorPane } from "./components/EditorPane";
import { FilePane } from "./components/FilePane";
import { Layout } from "./components/Layout";
import { PatternPane } from "./components/PatternPane";
import { TopBar } from "./components/TopBar";
import { Toaster } from "./components/ui/toaster";
import { useFavicon } from "./hooks/useFavicon";
import { useFileEditor } from "./hooks/useFileEditor";
import { usePatternNavigation } from "./hooks/usePatternNavigation";
import { useSnaperroAPI } from "./hooks/useSnaperroAPI";
import { useSnaperroSSE } from "./hooks/useSnaperroSSE";
import type { Mode } from "./types";
import { withErrorHandling } from "./utils/error-handler";

export default function App() {
  const { state, connected } = useSnaperroSSE();
  const api = useSnaperroAPI();

  // Dynamic favicon based on connection and mode
  const favicon = !connected ? "⚠️" : state.mode === "record" ? "🔴" : state.mode === "proxy" ? "🌐" : "🐕";
  useFavicon(favicon);

  // Search state
  const [searchQuery, setSearchQuery] = useState("");

  // File editor hook
  const fileEditor = useFileEditor({
    api,
    currentPattern: state.currentPattern,
  });

  // Pattern navigation hook
  const navigation = usePatternNavigation({
    api,
    onPatternDeselect: fileEditor.resetFileSelection,
  });

  // Reset file selection when pattern changes
  useEffect(() => {
    if (state.currentPattern !== undefined) {
      fileEditor.resetFileSelection();
    }
  }, [state.currentPattern, fileEditor.resetFileSelection]);

  // ============================================================
  // Mode handler
  // ============================================================
  const handleModeChange = useCallback(
    async (mode: Mode) => {
      await withErrorHandling(() => api.setMode(mode), "Mode change error");
    },
    [api],
  );

  // ============================================================
  // Pattern CRUD handlers
  // ============================================================
  const handlePatternCreate = useCallback(
    async (name: string) => {
      const fullName = navigation.currentFolder ? `${navigation.currentFolder}/${name}` : name;
      await withErrorHandling(() => api.createPattern(fullName), "Pattern create error");
    },
    [api, navigation.currentFolder],
  );

  const handlePatternRename = useCallback(
    async (oldName: string, newName: string) => {
      await withErrorHandling(() => api.renamePattern(oldName, newName), "Pattern rename error");
    },
    [api],
  );

  const handlePatternDuplicate = useCallback(
    async (name: string) => {
      await withErrorHandling(() => api.duplicatePattern(name, `${name}_copy`), "Pattern duplicate error");
    },
    [api],
  );

  const handlePatternDelete = useCallback(
    async (name: string) => {
      await withErrorHandling(() => api.deletePattern(name), "Pattern delete error");
    },
    [api],
  );

  // ============================================================
  // Folder CRUD handlers
  // ============================================================
  const handleFolderCreate = useCallback(
    async (name: string) => {
      await withErrorHandling(() => api.createFolder(name), "Folder create error");
    },
    [api],
  );

  const handleFolderRename = useCallback(
    async (oldName: string, newName: string) => {
      await withErrorHandling(async () => {
        await api.renameFolder(oldName, newName);
        if (navigation.currentFolder === oldName) {
          navigation.setCurrentFolder(newName);
        }
      }, "Folder rename error");
    },
    [api, navigation],
  );

  const handleFolderDownload = useCallback(
    async (name: string) => {
      await withErrorHandling(() => api.downloadFolder(name), "Folder download error");
    },
    [api],
  );

  const handleFolderUpload = useCallback(
    async (file: File) => {
      await withErrorHandling(() => api.uploadFolder(file), "Folder upload error");
    },
    [api],
  );

  const handleFolderDelete = useCallback(
    async (name: string) => {
      await withErrorHandling(async () => {
        await api.deleteFolder(name);
        if (navigation.currentFolder === name) {
          navigation.setCurrentFolder(null);
        }
      }, "Folder delete error");
    },
    [api, navigation],
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
            currentFolder={navigation.currentFolder}
            onFolderSelect={navigation.handleFolderSelect}
            onFolderBack={navigation.handleFolderBack}
            onFolderCreate={handleFolderCreate}
            onFolderRename={handleFolderRename}
            onFolderDownload={handleFolderDownload}
            onFolderUpload={handleFolderUpload}
            onFolderDelete={handleFolderDelete}
            patterns={state.patterns}
            currentPattern={state.currentPattern}
            onSelect={navigation.handlePatternSelect}
            onCreate={handlePatternCreate}
            onRename={handlePatternRename}
            onDuplicate={handlePatternDuplicate}
            onDelete={handlePatternDelete}
          />
        )}
        filePane={(width) => (
          <FilePane
            width={width}
            files={state.files}
            selectedFile={fileEditor.selectedFile}
            onSelect={fileEditor.setSelectedFile}
            onUpload={fileEditor.handleFileUpload}
            onDownload={fileEditor.handleFileDownload}
            pattern={state.currentPattern}
            searchQuery={searchQuery}
            onSearchQueryChange={setSearchQuery}
          />
        )}
        editorPane={
          <EditorPane
            fileData={fileEditor.fileData}
            filename={fileEditor.selectedFile}
            isLoading={fileEditor.isLoadingFile}
            onSave={fileEditor.handleFileSave}
            onDelete={fileEditor.handleFileDelete}
            searchQuery={searchQuery}
          />
        }
      />

      {/* File delete confirmation dialog */}
      <ConfirmDialog
        isOpen={fileEditor.deleteFileTarget !== null}
        title="Delete File"
        message={`Delete file "${fileEditor.deleteFileTarget}"? This action cannot be undone.`}
        confirmLabel="Delete"
        onClose={fileEditor.closeDeleteConfirm}
        onConfirm={fileEditor.handleFileDeleteConfirm}
      />

      <Toaster />
    </>
  );
}
