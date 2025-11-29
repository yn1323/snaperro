import type { Mode } from "../api/client";
import styles from "./Header.module.css";

interface HeaderProps {
  mode: Mode;
  pattern: string;
  patterns: string[];
  onModeChange: (mode: Mode) => void;
  onPatternChange: (pattern: string) => void;
  onReset: () => void;
}

const MODES: { value: Mode; label: string; color: string }[] = [
  { value: "proxy", label: "Proxy", color: "#60a5fa" },
  { value: "record", label: "Record", color: "#f87171" },
  { value: "mock", label: "Mock", color: "#4ade80" },
];

export function Header({ mode, pattern, patterns, onModeChange, onPatternChange, onReset }: HeaderProps) {
  return (
    <header className={styles.header}>
      <div className={styles.logo}>
        <span className={styles.emoji}>🐕</span>
        <span className={styles.title}>snaperro</span>
      </div>

      <div className={styles.controls}>
        <div className={styles.modeSelector}>
          <span className={styles.label}>Mode:</span>
          {MODES.map((m) => (
            <button
              type="button"
              key={m.value}
              className={`${styles.modeBtn} ${mode === m.value ? styles.active : ""}`}
              style={{ "--mode-color": m.color } as React.CSSProperties}
              onClick={() => onModeChange(m.value)}
            >
              {m.label}
            </button>
          ))}
        </div>

        <div className={styles.patternSelector}>
          <span className={styles.label}>Pattern:</span>
          <select value={pattern} onChange={(e) => onPatternChange(e.target.value)} className={styles.select}>
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
