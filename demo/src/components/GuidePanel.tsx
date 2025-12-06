import type { Mode } from "./ModeSelector";

type GuidePanelProps = {
  mode: Mode;
};

const modeHints: Record<Mode, { icon: string; text: string; subtext: string }> = {
  proxy: {
    icon: "→",
    text: "Proxy",
    subtext: "Forwarding requests",
  },
  record: {
    icon: "●",
    text: "Record",
    subtext: "Saving responses",
  },
  mock: {
    icon: "◆",
    text: "Mock",
    subtext: "Returning saved data",
  },
};

const modeColors: Record<Mode, string> = {
  proxy: "var(--accent-cyan)",
  record: "var(--accent-red)",
  mock: "var(--accent-green)",
};

export function GuidePanel({ mode }: GuidePanelProps) {
  const hint = modeHints[mode];
  const color = modeColors[mode];

  return (
    <div
      className="shrink-0 px-4 py-3 border-t border-[var(--border)] transition-colors duration-300"
      style={{ borderLeftColor: color, borderLeftWidth: "3px" }}
    >
      <div className="flex items-center gap-2">
        <span className={`font-mono text-sm ${mode === "record" ? "animate-pulse" : ""}`} style={{ color }}>
          {hint.icon}
        </span>
        <span className="font-mono text-sm font-medium" style={{ color }}>
          {hint.text}
        </span>
        <span className="font-mono text-xs text-[var(--text-secondary)]">{hint.subtext}</span>
      </div>
    </div>
  );
}
