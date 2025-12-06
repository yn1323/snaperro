import { useState } from "react";
import { buildUrl, type Scenario } from "../scenarios";

type ScenarioCardProps = {
  scenario: Scenario;
  onExecute: (url: string, method: string, requestBody?: unknown) => void;
  isLoading: boolean;
};

const iconMap: Record<string, string> = {
  users: "👥",
  posts: "📝",
  comments: "💬",
  user: "👤",
  post: "📄",
  filter: "🔍",
  nested: "📂",
};

const categoryColors: Record<string, string> = {
  basic: "#71717a",
  pathParam: "#22d3ee",
  queryString: "#a78bfa",
  nested: "#fb923c",
};

export function ScenarioCard({ scenario, onExecute, isLoading }: ScenarioCardProps) {
  const [paramValue, setParamValue] = useState(scenario.paramOptions?.[0]?.value || "");

  const handleExecute = () => {
    const url = buildUrl(scenario, paramValue);
    onExecute(url, scenario.method, scenario.requestBody);
  };

  const accentColor = categoryColors[scenario.category];

  return (
    <div className="group rounded-lg px-2 py-2 hover:bg-[var(--bg-tertiary)] transition-colors">
      <div className="flex items-center gap-2">
        {/* Icon */}
        <span className="text-base shrink-0">{iconMap[scenario.icon] || "📦"}</span>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            {scenario.method !== "GET" && (
              <span className="shrink-0 px-1 py-0.5 rounded text-[10px] font-bold bg-[var(--accent-cyan)] text-[var(--bg-primary)]">
                {scenario.method}
              </span>
            )}
            <span className="font-mono text-sm font-medium truncate">{scenario.title}</span>
            {scenario.category !== "basic" && (
              <span
                className="shrink-0 w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: accentColor }}
                title={scenario.category}
              />
            )}
          </div>

          {/* Param selector (inline) */}
          {scenario.paramOptions && (
            <select
              value={paramValue}
              onChange={(e) => setParamValue(e.target.value)}
              className="mt-1 w-full bg-[var(--bg-primary)] border border-[var(--border)] rounded px-2 py-1 font-mono text-xs focus:outline-none focus:border-[var(--accent-cyan)]"
            >
              {scenario.paramOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label} ({opt.value})
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Run button */}
        <button
          type="button"
          onClick={handleExecute}
          disabled={isLoading}
          className={`
            shrink-0 px-2 py-1 rounded font-mono text-xs font-medium transition-all
            bg-[var(--bg-primary)] border border-[var(--border)]
            ${isLoading ? "opacity-50 cursor-not-allowed" : "hover:border-[var(--accent-cyan)] hover:text-[var(--accent-cyan)]"}
          `}
        >
          Run
        </button>
      </div>
    </div>
  );
}
