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
    <header className="border-b border-[var(--border)] bg-[var(--bg-secondary)]">
      <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🐕</span>
          <h1 className="font-mono text-xl font-semibold tracking-tight">
            snaperro
            <span className="text-[var(--text-secondary)] font-normal ml-2">demo</span>
          </h1>
        </div>

        <div className="flex items-center gap-6">
          <ModeSelector mode={mode} onChange={onModeChange} isLoading={isLoading} />

          <a
            href={guiUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-2 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border)] text-sm font-medium hover:bg-[var(--border)] transition-colors"
          >
            Open GUI
          </a>
        </div>
      </div>
    </header>
  );
}
