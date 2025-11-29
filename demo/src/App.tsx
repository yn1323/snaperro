import { useCallback, useEffect, useState } from "react";
import { ApiTester } from "./components/ApiTester";
import { ResponseViewer } from "./components/ResponseViewer";
import { StatusBar } from "./components/StatusBar";
import { Tutorial } from "./components/Tutorial";

interface Status {
  mode: "proxy" | "record" | "mock";
  pattern: string;
}

interface ApiResponse {
  data: unknown;
  status: number;
  time: number;
}

export function App() {
  const [status, setStatus] = useState<Status | null>(null);
  const [response, setResponse] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/__snaperro__/status");
      const data = await res.json();
      setStatus(data);
    } catch {
      setError("snaperro サーバーに接続できません");
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 3000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  const handleApiCall = async (endpoint: string) => {
    setLoading(true);
    setError(null);
    const startTime = performance.now();

    try {
      const res = await fetch(endpoint);
      const data = await res.json();
      const endTime = performance.now();

      setResponse({
        data,
        status: res.status,
        time: Math.round(endTime - startTime),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "リクエストに失敗しました");
      setResponse(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container">
      <header className="header">
        <h1>
          <span>🐕</span>
          snaperro Demo
        </h1>
        <a href="http://localhost:3333/__snaperro__/gui/" target="_blank" rel="noopener noreferrer">
          snaperro GUI を開く
        </a>
      </header>

      <StatusBar status={status} />

      <Tutorial />

      <section className="section">
        <h2>API Tester</h2>
        <ApiTester onApiCall={handleApiCall} loading={loading} />
      </section>

      <section className="section">
        <h2>Response</h2>
        <ResponseViewer response={response} loading={loading} error={error} />
      </section>
    </div>
  );
}
