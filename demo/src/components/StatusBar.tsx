interface Status {
  mode: "proxy" | "record" | "mock";
  pattern: string;
}

interface StatusBarProps {
  status: Status | null;
}

export function StatusBar({ status }: StatusBarProps) {
  if (!status) {
    return (
      <div className="status-bar">
        <span className="loading">接続中...</span>
      </div>
    );
  }

  return (
    <div className="status-bar">
      <div className="status-item">
        <span className="status-label">Mode:</span>
        <span className={`status-value ${status.mode}`}>{status.mode.toUpperCase()}</span>
      </div>
      <div className="status-item">
        <span className="status-label">Pattern:</span>
        <span className="status-value">{status.pattern || "(none)"}</span>
      </div>
    </div>
  );
}
