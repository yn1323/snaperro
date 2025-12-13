import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "snaperro-pane-widths";

interface PaneWidths {
  pattern: number;
  file: number;
}

const DEFAULT_WIDTHS: PaneWidths = {
  pattern: 150,
  file: 250,
};

function loadWidths(): PaneWidths {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return {
        pattern: typeof parsed.pattern === "number" ? parsed.pattern : DEFAULT_WIDTHS.pattern,
        file: typeof parsed.file === "number" ? parsed.file : DEFAULT_WIDTHS.file,
      };
    }
  } catch {
    // Ignore parse errors
  }
  return DEFAULT_WIDTHS;
}

function saveWidths(widths: PaneWidths): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(widths));
  } catch {
    // Ignore storage errors
  }
}

export function usePaneWidths() {
  const [widths, setWidths] = useState<PaneWidths>(loadWidths);

  useEffect(() => {
    saveWidths(widths);
  }, [widths]);

  const setPatternWidth = useCallback((width: number) => {
    setWidths((prev) => ({ ...prev, pattern: width }));
  }, []);

  const setFileWidth = useCallback((width: number) => {
    setWidths((prev) => ({ ...prev, file: width }));
  }, []);

  return {
    patternWidth: widths.pattern,
    fileWidth: widths.file,
    setPatternWidth,
    setFileWidth,
  };
}
