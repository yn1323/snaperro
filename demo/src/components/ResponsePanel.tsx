import type { ErrorInfo } from "../App";
import type { Mode } from "./ModeSelector";

type ResponsePanelProps = {
  request: {
    url: string;
    method: string;
  } | null;
  response: {
    status: number;
    body: unknown;
  } | null;
  mode: Mode;
  isLoading: boolean;
  error: ErrorInfo | null;
};

const modeConfig: Record<Mode, { label: string; color: string; icon: string }> = {
  proxy: { label: "Proxy", color: "var(--accent-cyan)", icon: "→" },
  record: { label: "Record", color: "var(--accent-red)", icon: "●" },
  mock: { label: "Mock", color: "var(--accent-green)", icon: "◆" },
};

const statusColor = (status: number): string => {
  if (status >= 200 && status < 300) return "#4ade80"; // green
  if (status >= 300 && status < 400) return "#facc15"; // yellow
  if (status >= 400 && status < 500) return "#fb923c"; // orange
  return "#f87171"; // red
};

// JSONシンタックスハイライト
function highlightJson(json: string): string {
  return (
    json
      // 文字列キー（プロパティ名）
      .replace(/"([^"]+)"(?=\s*:)/g, '<span class="json-key">"$1"</span>')
      // 文字列値
      .replace(/:\s*"([^"]*)"/g, ': <span class="json-string">"$1"</span>')
      // 数値
      .replace(/:\s*(-?\d+\.?\d*)/g, ': <span class="json-number">$1</span>')
      // boolean/null
      .replace(/:\s*(true|false|null)/g, ': <span class="json-boolean">$1</span>')
  );
}

export function ResponsePanel({ request, response, mode, isLoading, error }: ResponsePanelProps) {
  const config = modeConfig[mode];

  // 初期状態（まだリクエストしていない）
  if (!request && !isLoading && !error) {
    return (
      <div className="h-full bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl flex flex-col items-center justify-center">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-[var(--bg-tertiary)] mb-3">
          <span className="text-2xl opacity-50">📡</span>
        </div>
        <p className="font-mono text-[var(--text-secondary)] text-sm">シナリオを選んで「Run」をクリック</p>
        <p className="font-mono text-[var(--text-secondary)] text-xs mt-1 opacity-60">レスポンスがここに表示されます</p>
      </div>
    );
  }

  return (
    <div className="h-full bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl overflow-hidden flex flex-col">
      {/* ヘッダー：リクエスト情報 */}
      <div className="shrink-0 px-4 py-3 border-b border-[var(--border)] bg-[var(--bg-tertiary)]/50">
        <div className="flex items-center justify-between flex-wrap gap-3">
          {/* リクエストURL */}
          <div className="flex items-center gap-3 min-w-0 flex-1">
            {request && (
              <>
                <span className="shrink-0 px-2.5 py-1 rounded-md bg-[var(--accent-cyan)]/20 text-[var(--accent-cyan)] font-mono text-xs font-bold tracking-wider">
                  {request.method}
                </span>
                <code className="font-mono text-sm text-[var(--text-primary)] truncate">{request.url}</code>
              </>
            )}
          </div>

          {/* ステータス + モード */}
          <div className="flex items-center gap-3 shrink-0">
            {/* モード表示 */}
            <div
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-mono text-xs font-medium transition-all"
              style={{
                backgroundColor: `${config.color}15`,
                color: config.color,
                boxShadow: `0 0 12px ${config.color}20`,
              }}
            >
              <span className={mode === "record" ? "animate-pulse" : ""} style={{ fontSize: "0.6rem" }}>
                {config.icon}
              </span>
              {config.label}
            </div>

            {/* ステータスコード */}
            {response && (
              <div
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg font-mono text-xs font-bold"
                style={{
                  backgroundColor: `${statusColor(response.status)}15`,
                  color: statusColor(response.status),
                }}
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: statusColor(response.status) }} />
                {response.status}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* コンテンツエリア */}
      <div className="relative flex-1 min-h-0 overflow-hidden">
        {/* ローディング */}
        {isLoading && (
          <div className="absolute inset-0 bg-[var(--bg-secondary)]/80 backdrop-blur-sm flex items-center justify-center z-10">
            <div className="flex items-center gap-3 px-5 py-3 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border)]">
              <div className="relative w-5 h-5">
                <div
                  className="absolute inset-0 rounded-full border-2 border-transparent animate-spin"
                  style={{
                    borderTopColor: config.color,
                    borderRightColor: config.color,
                  }}
                />
              </div>
              <span className="font-mono text-sm text-[var(--text-secondary)]">Fetching...</span>
            </div>
          </div>
        )}

        {/* エラー表示 */}
        {error && (
          <div className="h-full flex items-center justify-center p-4">
            <div className="max-w-md w-full px-5 py-4 rounded-xl bg-[#f8717110] border border-[#f8717125]">
              {/* タイトル */}
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xl">⚠️</span>
                <h3 className="font-mono text-base font-semibold text-[var(--accent-red)]">{error.title}</h3>
              </div>

              {/* メッセージ */}
              <p className="font-mono text-sm text-[var(--text-primary)] mb-2">{error.message}</p>

              {/* アクション */}
              <p className="font-mono text-sm text-[var(--text-secondary)] mb-4">{error.action}</p>

              {/* 詳細情報 */}
              <div className="pt-3 border-t border-[#f8717120]">
                <p className="font-mono text-xs text-[var(--text-secondary)] uppercase tracking-wider mb-2">Details</p>
                <div className="space-y-1 font-mono text-xs">
                  {error.details.status && (
                    <div className="flex gap-2">
                      <span className="text-[var(--text-secondary)]">Status:</span>
                      <span className="text-[var(--accent-red)]">
                        {error.details.status} {error.details.statusText}
                      </span>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <span className="text-[var(--text-secondary)]">URL:</span>
                    <span className="text-[var(--text-primary)] break-all">{error.details.url}</span>
                  </div>
                  {error.details.endpoint && (
                    <div className="flex gap-2">
                      <span className="text-[var(--text-secondary)]">Endpoint:</span>
                      <span className="text-[var(--text-primary)]">{error.details.endpoint}</span>
                    </div>
                  )}
                  {error.details.rawMessage && (
                    <div className="flex gap-2">
                      <span className="text-[var(--text-secondary)]">Message:</span>
                      <span className="text-[var(--text-primary)] break-all">{error.details.rawMessage}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* レスポンスボディ */}
        {response && !error && (
          <div className="h-full flex flex-col p-4">
            {/* ラベル */}
            <div className="shrink-0 flex items-center justify-between mb-2">
              <span className="font-mono text-xs text-[var(--text-secondary)] uppercase tracking-wider">
                Response Body
              </span>
              <span className="font-mono text-xs text-[var(--text-secondary)] opacity-60">
                {typeof response.body === "object" ? `${JSON.stringify(response.body).length} bytes` : ""}
              </span>
            </div>

            {/* JSONコードブロック */}
            <div className="relative group flex-1 min-h-0">
              {/* 装飾的なグラデーションライン */}
              <div
                className="absolute left-0 top-0 bottom-0 w-0.5 rounded-full opacity-60"
                style={{
                  background: `linear-gradient(to bottom, ${config.color}, transparent)`,
                }}
              />

              <pre
                className="json-display h-full pl-4 pr-4 py-3 rounded-lg bg-[var(--bg-primary)] border border-[var(--border)] overflow-auto font-mono text-sm leading-relaxed"
                // biome-ignore lint/security/noDangerouslySetInnerHtml: JSONハイライト用
                dangerouslySetInnerHTML={{
                  __html: highlightJson(JSON.stringify(response.body, null, 2)),
                }}
              />

              {/* コピーボタン */}
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(JSON.stringify(response.body, null, 2));
                }}
                className="absolute top-3 right-3 px-2 py-1 rounded-md bg-[var(--bg-tertiary)] border border-[var(--border)] font-mono text-xs text-[var(--text-secondary)] opacity-0 group-hover:opacity-100 transition-opacity hover:bg-[var(--border)]"
              >
                Copy
              </button>
            </div>
          </div>
        )}

        {/* リクエスト中でレスポンスがまだない場合のプレースホルダー */}
        {!response && !error && !isLoading && request && (
          <div className="h-full flex items-center justify-center">
            <p className="font-mono text-sm text-[var(--text-secondary)]">Waiting for response...</p>
          </div>
        )}
      </div>
    </div>
  );
}
