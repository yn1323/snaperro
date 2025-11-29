import styles from "./App.module.css";
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
      <div className={styles.loading}>
        <span className={styles.spinner}>🐕</span>
        <p>読み込み中...</p>
      </div>
    );
  }

  if (error || !status) {
    return (
      <div className={styles.error}>
        <span className={styles.errorIcon}>⚠️</span>
        <p>{error || "サーバーに接続できません"}</p>
        <p className={styles.hint}>サーバーが起動していることを確認してください</p>
      </div>
    );
  }

  return (
    <div className={styles.app}>
      <Header
        mode={status.mode}
        pattern={status.pattern}
        patterns={patterns}
        onModeChange={changeMode}
        onPatternChange={changePattern}
        onReset={resetCounter}
      />
      <main className={styles.main}>
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
