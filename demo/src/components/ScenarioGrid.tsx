import type { Scenario } from "../scenarios";
import { ScenarioCard } from "./ScenarioCard";

type ScenarioGridProps = {
  scenarios: Scenario[];
  onExecute: (url: string, method: string, requestBody?: unknown) => void;
  isLoading: boolean;
};

export function ScenarioGrid({ scenarios, onExecute, isLoading }: ScenarioGridProps) {
  // Group scenarios by category
  const basicScenarios = scenarios.filter((s) => s.category === "basic");
  const advancedScenarios = scenarios.filter((s) => s.category !== "basic");

  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-4">
      {/* Basic scenarios */}
      <div>
        <h2 className="font-mono text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wider mb-2 px-2">
          Basic
        </h2>
        <div className="space-y-1">
          {basicScenarios.map((scenario) => (
            <ScenarioCard key={scenario.id} scenario={scenario} onExecute={onExecute} isLoading={isLoading} />
          ))}
        </div>
      </div>

      {/* Advanced scenarios */}
      <div>
        <h2 className="font-mono text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wider mb-2 px-2">
          Advanced
        </h2>
        <div className="space-y-1">
          {advancedScenarios.map((scenario) => (
            <ScenarioCard key={scenario.id} scenario={scenario} onExecute={onExecute} isLoading={isLoading} />
          ))}
        </div>
      </div>
    </div>
  );
}
