import type { Scenario } from "../scenarios";
import { ScenarioCard } from "./ScenarioCard";

type ScenarioGridProps = {
  scenarios: Scenario[];
  onExecute: (url: string) => void;
  isLoading: boolean;
};

export function ScenarioGrid({ scenarios, onExecute, isLoading }: ScenarioGridProps) {
  // Group scenarios by category
  const basicScenarios = scenarios.filter((s) => s.category === "basic");
  const advancedScenarios = scenarios.filter((s) => s.category !== "basic");

  return (
    <div className="space-y-8">
      {/* Basic scenarios */}
      <div>
        <h2 className="font-mono text-lg font-semibold mb-4 flex items-center gap-2">
          <span className="text-[var(--accent-cyan)]">{"// "}</span>
          Basic Endpoints
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {basicScenarios.map((scenario) => (
            <ScenarioCard key={scenario.id} scenario={scenario} onExecute={onExecute} isLoading={isLoading} />
          ))}
        </div>
      </div>

      {/* Advanced scenarios */}
      <div>
        <h2 className="font-mono text-lg font-semibold mb-4 flex items-center gap-2">
          <span className="text-[var(--accent-cyan)]">{"// "}</span>
          Advanced Scenarios
          <span className="text-sm font-normal text-[var(--text-secondary)]">
            - Path Parameters, Query Strings, Nested Resources
          </span>
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {advancedScenarios.map((scenario) => (
            <ScenarioCard key={scenario.id} scenario={scenario} onExecute={onExecute} isLoading={isLoading} />
          ))}
        </div>
      </div>
    </div>
  );
}
