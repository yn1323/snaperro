import { useCallback, useEffect, useState } from "react";

import { ConfirmDialog } from "./components/dialogs/ConfirmDialog";
import { ModeHelpDialog } from "./components/dialogs/ModeHelpDialog";
import { EditorPane } from "./components/EditorPane";
import { FilePane } from "./components/FilePane";
import { Layout } from "./components/Layout";
import { ScenarioPane } from "./components/ScenarioPane";
import { TopBar } from "./components/TopBar";
import { Toaster } from "./components/ui/toaster";
import { useFavicon } from "./hooks/useFavicon";
import { useFileEditor } from "./hooks/useFileEditor";
import { useScenarioNavigation } from "./hooks/useScenarioNavigation";
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

  // Mode help dialog state
  const [isModeHelpOpen, setIsModeHelpOpen] = useState(false);

  // File editor hook
  const fileEditor = useFileEditor({
    api,
    currentScenario: state.currentScenario,
  });

  // Scenario navigation hook
  const navigation = useScenarioNavigation({
    api,
    onScenarioDeselect: fileEditor.resetFileSelection,
  });

  // Reset file selection when scenario changes
  useEffect(() => {
    if (state.currentScenario !== undefined) {
      fileEditor.resetFileSelection();
    }
  }, [state.currentScenario, fileEditor.resetFileSelection]);

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
  // Scenario CRUD handlers
  // ============================================================
  const handleScenarioCreate = useCallback(
    async (name: string) => {
      const fullName = navigation.currentFolder ? `${navigation.currentFolder}/${name}` : name;
      await withErrorHandling(() => api.createScenario(fullName), "Scenario create error");
    },
    [api, navigation.currentFolder],
  );

  const handleScenarioRename = useCallback(
    async (oldName: string, newName: string) => {
      await withErrorHandling(() => api.renameScenario(oldName, newName), "Scenario rename error");
    },
    [api],
  );

  const handleScenarioDuplicate = useCallback(
    async (name: string) => {
      await withErrorHandling(() => api.duplicateScenario(name, `${name}_copy`), "Scenario duplicate error");
    },
    [api],
  );

  const handleScenarioDelete = useCallback(
    async (name: string) => {
      await withErrorHandling(() => api.deleteScenario(name), "Scenario delete error");
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
            currentScenario={state.currentScenario}
            onModeChange={handleModeChange}
            onHelpClick={() => setIsModeHelpOpen(true)}
          />
        }
        scenarioPane={(width) => (
          <ScenarioPane
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
            scenarios={state.scenarios}
            currentScenario={state.currentScenario}
            onSelect={navigation.handleScenarioSelect}
            onCreate={handleScenarioCreate}
            onRename={handleScenarioRename}
            onDuplicate={handleScenarioDuplicate}
            onDelete={handleScenarioDelete}
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
            scenario={state.currentScenario}
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

      {/* Mode help dialog */}
      <ModeHelpDialog isOpen={isModeHelpOpen} onClose={() => setIsModeHelpOpen(false)} />

      <Toaster />
    </>
  );
}
