import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "snaperro-pane-widths";

interface PaneWidths {
  scenario: number;
  file: number;
}

const DEFAULT_WIDTHS: PaneWidths = {
  scenario: 150,
  file: 250,
};

function loadWidths(): PaneWidths {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return {
        scenario: typeof parsed.scenario === "number" ? parsed.scenario : DEFAULT_WIDTHS.scenario,
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

  const setScenarioWidth = useCallback((width: number) => {
    setWidths((prev) => ({ ...prev, scenario: width }));
  }, []);

  const setFileWidth = useCallback((width: number) => {
    setWidths((prev) => ({ ...prev, file: width }));
  }, []);

  return {
    scenarioWidth: widths.scenario,
    fileWidth: widths.file,
    setScenarioWidth,
    setFileWidth,
  };
}
