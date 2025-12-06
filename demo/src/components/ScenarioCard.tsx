import { useState } from "react";
import { buildUrl, type Scenario } from "../scenarios";

type ScenarioCardProps = {
  scenario: Scenario;
  onExecute: (url: string) => void;
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

const categoryBadge: Record<string, { label: string; color: string }> = {
  basic: { label: "Basic", color: "#71717a" },
  pathParam: { label: "Path Param", color: "#22d3ee" },
  queryString: { label: "Query String", color: "#a78bfa" },
  nested: { label: "Nested", color: "#fb923c" },
};

export function ScenarioCard({ scenario, onExecute, isLoading }: ScenarioCardProps) {
  const [paramValue, setParamValue] = useState(scenario.paramOptions?.[0]?.value || "");

  const handleExecute = () => {
    const url = buildUrl(scenario, paramValue);
    onExecute(url);
  };

  const badge = categoryBadge[scenario.category];

  return (
    <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl p-4 hover:border-[#3f3f46] transition-colors">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xl">{iconMap[scenario.icon] || "📦"}</span>
          <h3 className="font-mono font-semibold">{scenario.title}</h3>
        </div>
        <span
          className="text-xs px-2 py-1 rounded-full font-mono"
          style={{
            backgroundColor: `${badge.color}20`,
            color: badge.color,
          }}
        >
          {badge.label}
        </span>
      </div>

      <p className="font-mono text-sm text-[var(--text-secondary)] mb-4">{scenario.description}</p>

      {scenario.paramOptions && (
        <div className="mb-4">
          <label
            htmlFor={`param-${scenario.id}`}
            className="block text-xs text-[var(--text-secondary)] mb-1.5 font-mono"
          >
            {scenario.paramType === "path" ? "Path Parameter" : "Query String"}: {scenario.paramName}
          </label>
          <select
            id={`param-${scenario.id}`}
            value={paramValue}
            onChange={(e) => setParamValue(e.target.value)}
            className="w-full bg-[var(--bg-primary)] border border-[var(--border)] rounded-lg px-3 py-2 font-mono text-sm focus:outline-none focus:border-[var(--accent-cyan)]"
          >
            {scenario.paramOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label} ({opt.value})
              </option>
            ))}
          </select>
        </div>
      )}

      <button
        type="button"
        onClick={handleExecute}
        disabled={isLoading}
        className={`
          w-full py-2.5 rounded-lg font-mono text-sm font-medium transition-all
          bg-[var(--bg-tertiary)] border border-[var(--border)]
          ${isLoading ? "opacity-50 cursor-not-allowed" : "hover:bg-[var(--border)] hover:border-[#3f3f46]"}
        `}
      >
        {isLoading ? "Loading..." : "Execute"}
      </button>
    </div>
  );
}
