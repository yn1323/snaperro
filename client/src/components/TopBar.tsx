import { Box, Button, Flex, HStack, Spacer, Text } from "@chakra-ui/react";
import type { Mode } from "../types";
import { toaster } from "./ui/toaster";

interface TopBarProps {
  version: string;
  mode: Mode;
  connected: boolean;
  currentScenario: string | null;
  onModeChange: (mode: Mode) => void;
}

const modes: { value: Mode; label: string; icon: string }[] = [
  { value: "smart", label: "Smart", icon: "★" },
  { value: "proxy", label: "Proxy", icon: "→" },
  { value: "record", label: "Record", icon: "●" },
  { value: "mock", label: "Mock", icon: "◆" },
];

/**
 * Top bar
 * Displays mode switch buttons and connection status
 */
export function TopBar({ version, mode, connected, currentScenario, onModeChange }: TopBarProps) {
  const handleModeClick = (targetMode: Mode) => {
    // record, smart, mock はシナリオ選択が必要
    if ((targetMode === "record" || targetMode === "smart" || targetMode === "mock") && !currentScenario) {
      toaster.create({
        type: "warning",
        title: "No scenario selected",
        description: "Please select a scenario first.",
      });
    }
    onModeChange(targetMode);
  };

  return (
    <Flex
      h="48px"
      bg="gray.900"
      color="white"
      alignItems="center"
      px={4}
      gap={4}
      flexShrink={0}
      borderBottom="2px solid"
      borderColor="accent.500"
    >
      <HStack gap={2}>
        <Text fontSize="xl">🐕</Text>
        <Text fontSize="lg" fontWeight="600" letterSpacing="-0.02em">
          snaperro
        </Text>
        {version && (
          <Text fontSize="xs" color="gray.500">
            v{version}
          </Text>
        )}
      </HStack>

      <HStack gap={1} ml={6}>
        {modes.map(({ value, label, icon }) => {
          const isActive = mode === value;
          const isRecording = value === "record" && isActive;
          const isMock = value === "mock" && isActive;

          const getColor = () => {
            if (isRecording) return "recording";
            if (isMock) return "mock";
            if (value === "smart" && isActive) return "smart";
            return "accent";
          };
          const color = getColor();

          return (
            <Button
              key={value}
              size="sm"
              bg={isActive ? `${color}.500` : "transparent"}
              color={isActive ? "white" : "gray.400"}
              border="1px solid"
              borderColor={isActive ? `${color}.500` : "gray.700"}
              _hover={{
                bg: isActive ? `${color}.600` : "gray.800",
                borderColor: isActive ? `${color}.600` : "gray.600",
              }}
              onClick={() => handleModeClick(value)}
              transition="all 0.15s ease"
            >
              <Text mr={1.5} fontSize="xs">
                {icon}
              </Text>
              {label}
            </Button>
          );
        })}
      </HStack>

      <Spacer />

      <HStack gap={2}>
        <Box w={2} h={2} borderRadius="full" bg={connected ? "accent.400" : "recording.400"} />
        <Text fontSize="xs" color="gray.500">
          {connected ? "Connected" : "Disconnected"}
        </Text>
      </HStack>
    </Flex>
  );
}
