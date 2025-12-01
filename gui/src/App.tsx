import { useCallback, useEffect, useState } from "react";
import { FileViewer } from "./components/FileViewer";
import { Header } from "./components/Header";
import { Sidebar } from "./components/Sidebar";
import { useSnaperro } from "./hooks/useSnaperro";

const MIN_SIDEBAR_WIDTH = 200;
const MAX_SIDEBAR_WIDTH = 500;
const DEFAULT_SIDEBAR_WIDTH = 280;

export function App() {
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [isResizing, setIsResizing] = useState(false);

  const handleMouseDown = useCallback(() => {
    setIsResizing(true);
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      const newWidth = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, e.clientX));
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    }

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing]);

  const {
    status,
    patterns,
    files,
    selectedFile,
    fileContent,
    loading,
    error,
    changeMode,
    changePattern,
    createPattern,
    resetCounter,
    selectFile,
    deleteFile,
  } = useSnaperro();

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-4">
        <span className="text-5xl animate-bounce">🐕</span>
        <p>読み込み中...</p>
      </div>
    );
  }

  if (error || !status) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-4">
        <span className="text-5xl">⚠️</span>
        <p>{error || "サーバーに接続できません"}</p>
        <p className="text-text-secondary text-sm">サーバーが起動していることを確認してください</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen">
      <Header
        mode={status.mode}
        pattern={status.pattern}
        patterns={patterns}
        onModeChange={changeMode}
        onPatternChange={changePattern}
        onReset={resetCounter}
      />
      <main className="flex-1 flex overflow-hidden">
        <Sidebar
          pattern={status.pattern}
          patterns={patterns}
          files={files}
          selectedFile={selectedFile}
          onPatternSelect={changePattern}
          onFileSelect={selectFile}
          onCreatePattern={createPattern}
          width={sidebarWidth}
        />
        <button
          type="button"
          aria-label="Resize sidebar"
          className="w-0.5 cursor-col-resize shrink-0 rounded-none bg-border hover:bg-accent transition-colors duration-150"
          style={{ padding: 0, backgroundColor: isResizing ? "var(--color-accent)" : undefined }}
          onMouseDown={handleMouseDown}
        />
        <FileViewer filePath={selectedFile} content={fileContent} onDelete={deleteFile} />
      </main>
    </div>
  );
}
