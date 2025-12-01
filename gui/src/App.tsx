import { FileViewer } from "./components/FileViewer";
import { Header } from "./components/Header";
import { Sidebar } from "./components/Sidebar";
import { useSnaperro } from "./hooks/useSnaperro";

export function App() {
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
        />
        <FileViewer filePath={selectedFile} content={fileContent} onDelete={deleteFile} />
      </main>
    </div>
  );
}
