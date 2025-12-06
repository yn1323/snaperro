export type Mode = "proxy" | "record" | "mock";

type ModeSelectorProps = {
  mode: Mode;
  onChange: (mode: Mode) => void;
  isLoading: boolean;
};

const modeConfig: Record<Mode, { label: string; color: string; bgColor: string; description: string }> = {
  proxy: {
    label: "Proxy",
    color: "var(--accent-cyan)",
    bgColor: "rgba(34, 211, 238, 0.1)",
    description: "Pass through to real API",
  },
  record: {
    label: "Record",
    color: "var(--accent-red)",
    bgColor: "rgba(248, 113, 113, 0.1)",
    description: "Save responses to files",
  },
  mock: {
    label: "Mock",
    color: "var(--accent-green)",
    bgColor: "rgba(74, 222, 128, 0.1)",
    description: "Return saved responses",
  },
};

export function ModeSelector({ mode, onChange, isLoading }: ModeSelectorProps) {
  return (
    <div className="flex items-center gap-1 p-1 bg-[var(--bg-primary)] rounded-lg">
      {(Object.keys(modeConfig) as Mode[]).map((m) => {
        const config = modeConfig[m];
        const isActive = mode === m;

        return (
          <button
            key={m}
            type="button"
            onClick={() => onChange(m)}
            disabled={isLoading}
            className={`
              relative px-4 py-2 rounded-md font-mono text-sm font-medium transition-all
              ${isLoading ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}
              ${
                isActive
                  ? "text-[var(--text-primary)]"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }
            `}
            style={{
              backgroundColor: isActive ? config.bgColor : "transparent",
              borderColor: isActive ? config.color : "transparent",
              borderWidth: "1px",
              borderStyle: "solid",
            }}
            title={config.description}
          >
            {m === "record" && isActive && (
              <span
                className="absolute left-2 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full recording-pulse"
                style={{ backgroundColor: config.color }}
              />
            )}
            <span className={m === "record" && isActive ? "ml-2" : ""}>{config.label}</span>
          </button>
        );
      })}
    </div>
  );
}
