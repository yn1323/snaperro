interface ApiResponse {
  data: unknown;
  status: number;
  time: number;
}

interface ResponseViewerProps {
  response: ApiResponse | null;
  loading: boolean;
  error: string | null;
}

export function ResponseViewer({ response, loading, error }: ResponseViewerProps) {
  if (loading) {
    return (
      <div className="response-viewer">
        <span className="loading">Loading...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="response-viewer">
        <span className="error">{error}</span>
      </div>
    );
  }

  if (!response) {
    return (
      <div className="response-viewer">
        <span className="loading">API ボタンをクリックしてリクエストを送信してください</span>
      </div>
    );
  }

  return (
    <div className="response-viewer">
      <div style={{ marginBottom: "0.5rem", color: "var(--text-secondary)", fontSize: "0.875rem" }}>
        Status: {response.status} | Time: {response.time}ms
      </div>
      <pre>{JSON.stringify(response.data, null, 2)}</pre>
    </div>
  );
}
