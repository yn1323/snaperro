import type { Mode } from "./ModeSelector";
import { ModeSelector } from "./ModeSelector";

type HeaderProps = {
  mode: Mode;
  onModeChange: (mode: Mode) => void;
  isLoading: boolean;
};

export function Header({ mode, onModeChange, isLoading }: HeaderProps) {
  const guiUrl =
    typeof window !== "undefined"
      ? `${window.location.protocol}//${window.location.hostname}:3333/__snaperro__/client`
      : "/__snaperro__/client";

  return (
    <header className="h-14 shrink-0 border-b border-[var(--border)] bg-[var(--bg-secondary)] px-4 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span className="text-xl">🐕</span>
        <h1 className="font-mono text-lg font-semibold tracking-tight">
          snaperro
          <span className="text-[var(--text-secondary)] font-normal ml-1.5 text-sm">demo</span>
        </h1>
      </div>

      <div className="flex items-center gap-4">
        <ModeSelector mode={mode} onChange={onModeChange} isLoading={isLoading} />

        <a
          href={guiUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="px-3 py-1.5 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border)] text-sm font-medium hover:bg-[var(--border)] transition-colors flex items-center gap-1.5"
        >
          Open GUI
          <span className="text-[var(--text-secondary)]">→</span>
        </a>
      </div>
    </header>
  );
}
