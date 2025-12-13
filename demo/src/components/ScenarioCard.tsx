import { Badge, Box, Button, Flex, HStack, NativeSelect, Text } from "@chakra-ui/react";
import { useState } from "react";
import { buildUrl, type Scenario } from "../scenarios";

type ScenarioCardProps = {
  scenario: Scenario;
  onExecute: (url: string, method: string, requestBody?: unknown) => void;
  isLoading: boolean;
};

const iconMap: Record<string, string> = {
  users: "👥",
  posts: "📝",
  comments: "💬",
  user: "👤",
  post: "📄",
  filter: "🔍",
  nested: "📂",
};

const categoryColors: Record<string, string> = {
  basic: "gray.400",
  pathParam: "accent.500",
  queryString: "purple.400",
  nested: "orange.400",
};

export function ScenarioCard({ scenario, onExecute, isLoading }: ScenarioCardProps) {
  const [paramValue, setParamValue] = useState(scenario.paramOptions?.[0]?.value || "");
  const [bodyOptionValue, setBodyOptionValue] = useState(scenario.requestBodyOptions?.[0]?.value || "");

  const handleExecute = () => {
    const url = buildUrl(scenario, paramValue);
    let body = scenario.requestBody;
    if (scenario.requestBodyOptions && bodyOptionValue) {
      const selectedOption = scenario.requestBodyOptions.find((opt) => opt.value === bodyOptionValue);
      body = selectedOption?.body;
    }
    onExecute(url, scenario.method, body);
  };

  const accentColor = categoryColors[scenario.category];

  return (
    <Box
      px={2}
      py={2}
      borderRadius="lg"
      border="1px solid transparent"
      _hover={{ bg: "gray.50", borderColor: "gray.200" }}
      transition="all 0.15s ease"
      role="group"
    >
      <Flex alignItems="center" gap={2}>
        <Text fontSize="md" flexShrink={0}>
          {iconMap[scenario.icon] || "📦"}
        </Text>

        <Box flex={1} minW={0}>
          <HStack gap={2}>
            {scenario.method !== "GET" && (
              <Badge bg="gray.200" color="gray.600" fontSize="10px" fontWeight="600" flexShrink={0}>
                {scenario.method}
              </Badge>
            )}
            <Text fontFamily="mono" fontSize="sm" fontWeight="500" truncate>
              {scenario.title}
            </Text>
            {scenario.category !== "basic" && (
              <Box w="1.5" h="1.5" borderRadius="full" bg={accentColor} flexShrink={0} title={scenario.category} />
            )}
          </HStack>

          {scenario.paramOptions && (
            <NativeSelect.Root size="xs" mt={1}>
              <NativeSelect.Field
                value={paramValue}
                onChange={(e) => setParamValue(e.target.value)}
                fontFamily="mono"
                bg="gray.50"
                borderColor="gray.200"
                _hover={{ borderColor: "gray.300" }}
                _focus={{ borderColor: "accent.500" }}
              >
                {scenario.paramOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label} ({opt.value})
                  </option>
                ))}
              </NativeSelect.Field>
            </NativeSelect.Root>
          )}

          {scenario.requestBodyOptions && (
            <NativeSelect.Root size="xs" mt={1}>
              <NativeSelect.Field
                value={bodyOptionValue}
                onChange={(e) => setBodyOptionValue(e.target.value)}
                fontFamily="mono"
                bg="gray.50"
                borderColor="gray.200"
                _hover={{ borderColor: "gray.300" }}
                _focus={{ borderColor: "accent.500" }}
              >
                {scenario.requestBodyOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </NativeSelect.Field>
            </NativeSelect.Root>
          )}
        </Box>

        <Button
          size="xs"
          variant="outline"
          fontFamily="mono"
          onClick={handleExecute}
          disabled={isLoading}
          flexShrink={0}
          borderColor="gray.300"
          color="gray.600"
          _hover={{ borderColor: "accent.500", color: "accent.600", bg: "accent.50" }}
          transition="all 0.15s ease"
        >
          Run
        </Button>
      </Flex>
    </Box>
  );
}
