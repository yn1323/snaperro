import { useCallback, useState } from "react";
import { GuidePanel } from "./components/GuidePanel";
import { Header } from "./components/Header";
import type { Mode } from "./components/ModeSelector";
import { ResponsePanel } from "./components/ResponsePanel";
import { ScenarioGrid } from "./components/ScenarioGrid";
import { scenarios } from "./scenarios";

const API_BASE = "/__snaperro__";

type RequestInfo = {
  url: string;
  method: string;
};

type ResponseInfo = {
  status: number;
  body: unknown;
};

export default function App() {
  const [mode, setMode] = useState<Mode>("proxy");
  const [isLoading, setIsLoading] = useState(false);
  const [currentRequest, setCurrentRequest] = useState<RequestInfo | null>(null);
  const [response, setResponse] = useState<ResponseInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  // モード変更時にサーバーと同期
  const handleModeChange = useCallback(async (newMode: Mode) => {
    setMode(newMode);
    try {
      await fetch(`${API_BASE}/mode`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: newMode }),
      });
    } catch (err) {
      console.error("Failed to sync mode:", err);
    }
  }, []);

  // シナリオ実行
  const handleExecute = useCallback(async (url: string) => {
    setIsLoading(true);
    setError(null);
    setCurrentRequest({ url, method: "GET" });
    setResponse(null);

    try {
      const res = await fetch(url);
      const body = await res.json();

      setResponse({
        status: res.status,
        body,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error occurred");
    } finally {
      setIsLoading(false);
    }
  }, []);

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <Header mode={mode} onModeChange={handleModeChange} isLoading={isLoading} />
      <main className="max-w-6xl mx-auto px-6 py-8 space-y-8">
        <ScenarioGrid scenarios={scenarios} onExecute={handleExecute} isLoading={isLoading} />
        <ResponsePanel request={currentRequest} response={response} mode={mode} isLoading={isLoading} error={error} />
        <GuidePanel mode={mode} />
      </main>
    </div>
  );
}
