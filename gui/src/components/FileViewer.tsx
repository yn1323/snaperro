import styles from "./FileViewer.module.css";

interface FileViewerProps {
  filePath: string | null;
  content: unknown;
  onDelete: (filePath: string) => void;
}

export function FileViewer({ filePath, content, onDelete }: FileViewerProps) {
  if (!filePath) {
    return (
      <div className={styles.empty}>
        <span className={styles.emptyIcon}>📄</span>
        <p>ファイルを選択してください</p>
      </div>
    );
  }

  return (
    <div className={styles.viewer}>
      <div className={styles.header}>
        <h2 className={styles.title}>{filePath}</h2>
        <button
          className="btn-secondary"
          onClick={() => onDelete(filePath)}
        >
          削除
        </button>
      </div>
      <pre className={styles.content}>
        {JSON.stringify(content, null, 2)}
      </pre>
    </div>
  );
}
