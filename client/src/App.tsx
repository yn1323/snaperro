import { useCallback, useEffect, useState } from "react";
import { EditorPane } from "./components/EditorPane";
import { FilePane } from "./components/FilePane";
import { Layout } from "./components/Layout";
import { PatternPane } from "./components/PatternPane";
import { TopBar } from "./components/TopBar";
import { useSnaperroAPI } from "./hooks/useSnaperroAPI";
import { useSnaperroSSE } from "./hooks/useSnaperroSSE";
import type { FileData, Mode } from "./types";

export default function App() {
  const { state, connected } = useSnaperroSSE();
  const api = useSnaperroAPI();

  // ローカル状態
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileData, setFileData] = useState<FileData | null>(null);
  const [isLoadingFile, setIsLoadingFile] = useState(false);

  // パターン変更時にファイル選択をリセット
  const currentPattern = state.currentPattern;
  useEffect(() => {
    // currentPatternが変更されたらファイル選択をクリア
    if (currentPattern !== undefined) {
      setSelectedFile(null);
      setFileData(null);
    }
  }, [currentPattern]);

  // ファイル選択時にコンテンツを読み込み
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
        console.error("ファイル読み込みエラー:", err);
        setFileData(null);
      } finally {
        setIsLoadingFile(false);
      }
    };

    loadFile();
  }, [state.currentPattern, selectedFile, api]);

  // ============================================================
  // イベントハンドラ
  // ============================================================

  const handleModeChange = useCallback(
    async (mode: Mode) => {
      try {
        await api.setMode(mode);
      } catch (err) {
        console.error("モード変更エラー:", err);
      }
    },
    [api],
  );

  const handlePatternSelect = useCallback(
    async (pattern: string) => {
      try {
        await api.setCurrentPattern(pattern);
      } catch (err) {
        console.error("パターン選択エラー:", err);
      }
    },
    [api],
  );

  const handlePatternCreate = useCallback(
    async (name: string) => {
      try {
        await api.createPattern(name);
      } catch (err) {
        console.error("パターン作成エラー:", err);
      }
    },
    [api],
  );

  const handlePatternUpload = useCallback(
    async (file: File) => {
      try {
        await api.uploadPattern(file);
      } catch (err) {
        console.error("パターンアップロードエラー:", err);
      }
    },
    [api],
  );

  const handleFileSave = useCallback(
    async (data: FileData) => {
      if (!state.currentPattern || !selectedFile) return;
      try {
        await api.updateFile(state.currentPattern, selectedFile, data);
        setFileData(data);
      } catch (err) {
        console.error("ファイル保存エラー:", err);
      }
    },
    [api, state.currentPattern, selectedFile],
  );

  const handleFileDelete = useCallback(async () => {
    if (!state.currentPattern || !selectedFile) return;
    if (!window.confirm(`ファイル "${selectedFile}" を削除しますか？`)) return;
    try {
      await api.deleteFile(state.currentPattern, selectedFile);
      setSelectedFile(null);
      setFileData(null);
    } catch (err) {
      console.error("ファイル削除エラー:", err);
    }
  }, [api, state.currentPattern, selectedFile]);

  return (
    <Layout
      topBar={<TopBar mode={state.mode} connected={connected} onModeChange={handleModeChange} />}
      patternPane={
        <PatternPane
          patterns={state.patterns}
          currentPattern={state.currentPattern}
          onSelect={handlePatternSelect}
          onCreate={handlePatternCreate}
          onUpload={handlePatternUpload}
        />
      }
      filePane={<FilePane files={state.files} selectedFile={selectedFile} onSelect={setSelectedFile} />}
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
  );
}
