interface FileViewerProps {
  filePath: string | null;
  content: unknown;
  onDelete: (filePath: string) => void;
}

export function FileViewer({ filePath, content, onDelete }: FileViewerProps) {
  if (!filePath) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-text-secondary">
        <span className="text-5xl mb-4 opacity-50">📄</span>
        <p>ファイルを選択してください</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-bg-secondary">
        <h2 className="text-sm font-medium text-text-primary">{filePath}</h2>
        <button type="button" className="btn-secondary" onClick={() => onDelete(filePath)}>
          削除
        </button>
      </div>
      <pre className="flex-1 p-6 overflow-auto bg-bg-primary font-mono text-[13px] leading-relaxed text-text-primary m-0">
        {JSON.stringify(content, null, 2)}
      </pre>
    </div>
  );
}
