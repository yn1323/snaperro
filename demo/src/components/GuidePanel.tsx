import type { Mode } from "./ModeSelector";

type GuidePanelProps = {
  mode: Mode;
};

const steps = [
  {
    number: 1,
    mode: "record" as Mode,
    title: "Record",
    action: "「User by ID」を実行",
    result: "レスポンスがファイルに保存されます",
    icon: "●",
  },
  {
    number: 2,
    mode: null,
    title: "Edit",
    action: "Open GUI でJSONを編集",
    result: "好きなデータに変更できます",
    icon: "✎",
  },
  {
    number: 3,
    mode: "mock" as Mode,
    title: "Mock",
    action: "同じリクエストを実行",
    result: "編集したデータが返ります",
    icon: "◆",
  },
];

const modeHints: Record<Mode, { icon: string; text: string; subtext: string }> = {
  proxy: {
    icon: "→",
    text: "Proxy Mode",
    subtext: "リクエストはそのまま本物のAPIに転送されます",
  },
  record: {
    icon: "●",
    text: "Record Mode",
    subtext: "レスポンスがファイルに保存されます",
  },
  mock: {
    icon: "◆",
    text: "Mock Mode",
    subtext: "保存されたデータが返されます",
  },
};

const modeColors: Record<Mode, string> = {
  proxy: "var(--accent-cyan)",
  record: "var(--accent-red)",
  mock: "var(--accent-green)",
};

export function GuidePanel({ mode }: GuidePanelProps) {
  const currentHint = modeHints[mode];
  const currentColor = modeColors[mode];

  return (
    <div className="guide-panel bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl overflow-hidden animate-fade-in-up">
      {/* ヘッダー */}
      <div className="px-6 py-5 border-b border-[var(--border)] bg-[var(--bg-tertiary)]/30">
        <div className="flex items-center gap-4">
          <div
            className="flex items-center justify-center w-11 h-11 rounded-xl"
            style={{
              background: `linear-gradient(135deg, ${currentColor}15, ${currentColor}05)`,
              boxShadow: `0 0 20px ${currentColor}10`,
            }}
          >
            <span className="text-2xl" style={{ filter: "drop-shadow(0 0 8px rgba(255,255,255,0.1))" }}>
              💡
            </span>
          </div>
          <div>
            <h3 className="font-mono font-semibold text-lg tracking-tight">Try this</h3>
            <p className="text-sm text-[var(--text-secondary)] mt-0.5">snaperroの基本的な使い方を体験してみましょう</p>
          </div>
        </div>
      </div>

      {/* ステップリスト */}
      <div className="p-6">
        <div className="relative">
          {/* コネクターライン */}
          <div
            className="absolute left-[22px] top-[44px] bottom-[44px] w-px"
            style={{
              background: `linear-gradient(to bottom, ${currentColor}40, var(--border), ${currentColor}40)`,
            }}
          />

          <div className="space-y-4">
            {steps.map((step) => {
              const isActiveStep = step.mode === mode;
              const stepColor = step.mode ? modeColors[step.mode] : "var(--text-secondary)";

              return (
                <div
                  key={step.number}
                  className="relative flex items-start gap-5 p-4 rounded-xl transition-all duration-300"
                  style={{
                    backgroundColor: isActiveStep ? `${stepColor}08` : "transparent",
                    borderLeft: isActiveStep ? `3px solid ${stepColor}` : "3px solid transparent",
                    marginLeft: isActiveStep ? "-3px" : "0",
                  }}
                >
                  {/* ステップ番号 */}
                  <div
                    className="relative z-10 flex items-center justify-center w-11 h-11 rounded-xl shrink-0 font-mono font-bold text-sm transition-all duration-300"
                    style={{
                      backgroundColor: isActiveStep ? `${stepColor}20` : "var(--bg-tertiary)",
                      color: isActiveStep ? stepColor : "var(--text-secondary)",
                      boxShadow: isActiveStep ? `0 0 20px ${stepColor}30` : "none",
                    }}
                  >
                    <span
                      className={`absolute inset-0 rounded-xl transition-opacity duration-300 ${isActiveStep ? "opacity-100" : "opacity-0"}`}
                      style={{
                        background: `radial-gradient(circle at center, ${stepColor}10, transparent 70%)`,
                      }}
                    />
                    <span className="relative">{step.number}</span>
                  </div>

                  {/* コンテンツ */}
                  <div className="flex-1 min-w-0 pt-1">
                    <div className="flex items-center gap-3 flex-wrap">
                      {step.mode && (
                        <span
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-mono text-xs font-medium transition-all duration-300"
                          style={{
                            backgroundColor: `${stepColor}15`,
                            color: stepColor,
                            boxShadow: isActiveStep ? `0 0 12px ${stepColor}20` : "none",
                          }}
                        >
                          <span
                            className={`text-[0.5rem] ${isActiveStep && step.mode === "record" ? "animate-pulse" : ""}`}
                          >
                            {step.icon}
                          </span>
                          {step.title}
                        </span>
                      )}
                      {!step.mode && (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[var(--bg-tertiary)] font-mono text-xs font-medium text-[var(--text-secondary)]">
                          <span className="text-[0.6rem]">{step.icon}</span>
                          {step.title}
                        </span>
                      )}
                      <span className="font-mono text-sm text-[var(--text-primary)]">{step.action}</span>
                    </div>
                    <p className="font-mono text-xs text-[var(--text-secondary)] mt-2 flex items-center gap-2">
                      <span
                        className="inline-block w-4 h-px"
                        style={{
                          background: isActiveStep
                            ? `linear-gradient(to right, ${stepColor}, transparent)`
                            : "var(--border)",
                        }}
                      />
                      {step.result}
                    </p>
                  </div>

                  {/* アクティブインジケーター */}
                  {isActiveStep && (
                    <div
                      className="absolute right-4 top-1/2 -translate-y-1/2 px-2 py-0.5 rounded text-[0.65rem] font-mono font-medium uppercase tracking-wider"
                      style={{
                        backgroundColor: `${stepColor}15`,
                        color: stepColor,
                      }}
                    >
                      now
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* 現在のモードヒント */}
        <div
          className="mt-6 p-4 rounded-xl transition-all duration-500"
          style={{
            background: `linear-gradient(135deg, ${currentColor}08, ${currentColor}03)`,
            borderLeft: `3px solid ${currentColor}`,
            boxShadow: `0 0 30px ${currentColor}08`,
          }}
        >
          <div className="flex items-center gap-3">
            <span
              className={`font-mono text-sm ${mode === "record" ? "animate-pulse" : ""}`}
              style={{ color: currentColor }}
            >
              {currentHint.icon}
            </span>
            <div>
              <p className="font-mono text-sm font-medium" style={{ color: currentColor }}>
                {currentHint.text}
              </p>
              <p className="font-mono text-xs text-[var(--text-secondary)] mt-0.5">{currentHint.subtext}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
