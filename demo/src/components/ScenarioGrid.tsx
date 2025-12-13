import { Box, Text, VStack } from "@chakra-ui/react";
import type { Scenario } from "../scenarios";
import { ScenarioCard } from "./ScenarioCard";

type ScenarioGridProps = {
  scenarios: Scenario[];
  onExecute: (url: string, method: string, requestBody?: unknown) => void;
  isLoading: boolean;
};

export function ScenarioGrid({ scenarios, onExecute, isLoading }: ScenarioGridProps) {
  const basicScenarios = scenarios.filter((s) => s.category === "basic");
  const advancedScenarios = scenarios.filter((s) => s.category !== "basic");

  return (
    <Box flex={1} overflowY="auto" p={3}>
      <VStack gap={4} align="stretch">
        <Box>
          <Text
            as="h2"
            fontFamily="mono"
            fontSize="xs"
            fontWeight="medium"
            color="gray.500"
            textTransform="uppercase"
            letterSpacing="wider"
            mb={2}
            px={2}
          >
            Basic
          </Text>
          <VStack gap={1} align="stretch">
            {basicScenarios.map((scenario) => (
              <ScenarioCard key={scenario.id} scenario={scenario} onExecute={onExecute} isLoading={isLoading} />
            ))}
          </VStack>
        </Box>

        <Box>
          <Text
            as="h2"
            fontFamily="mono"
            fontSize="xs"
            fontWeight="medium"
            color="gray.500"
            textTransform="uppercase"
            letterSpacing="wider"
            mb={2}
            px={2}
          >
            Advanced
          </Text>
          <VStack gap={1} align="stretch">
            {advancedScenarios.map((scenario) => (
              <ScenarioCard key={scenario.id} scenario={scenario} onExecute={onExecute} isLoading={isLoading} />
            ))}
          </VStack>
        </Box>
      </VStack>
    </Box>
  );
}
