import type { Mode } from "../api/client";

interface HeaderProps {
  mode: Mode;
  pattern: string;
  patterns: string[];
  onModeChange: (mode: Mode) => void;
  onPatternChange: (pattern: string) => void;
  onReset: () => void;
}

const MODES: { value: Mode; label: string; bgClass: string }[] = [
  { value: "proxy", label: "Proxy", bgClass: "bg-mode-proxy" },
  { value: "record", label: "Record", bgClass: "bg-mode-record" },
  { value: "mock", label: "Mock", bgClass: "bg-mode-mock" },
];

export function Header({ mode, pattern, patterns, onModeChange, onPatternChange, onReset }: HeaderProps) {
  return (
    <header className="flex items-center justify-between px-6 py-4 bg-bg-secondary border-b border-border">
      <div className="flex items-center gap-2">
        <span className="text-2xl">🐕</span>
        <span className="text-xl font-semibold">snaperro</span>
      </div>

      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2">
          <span className="text-text-secondary text-sm">Mode:</span>
          {MODES.map((m) => (
            <button
              type="button"
              key={m.value}
              className={`px-3 py-1.5 rounded text-[13px] transition-all duration-200 ${
                mode === m.value ? `${m.bgClass} text-white` : "bg-bg-tertiary text-text-primary hover:bg-border"
              }`}
              onClick={() => onModeChange(m.value)}
            >
              {m.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-text-secondary text-sm">Pattern:</span>
          <select value={pattern} onChange={(e) => onPatternChange(e.target.value)} className="min-w-[150px]">
            <option value="">(none)</option>
            {patterns.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>

        <button type="button" className="btn-secondary" onClick={onReset}>
          Reset Counter
        </button>
      </div>
    </header>
  );
}
