import { Box, Button, Flex, HStack, Spacer, Text } from "@chakra-ui/react";
import type { Mode } from "../types";

interface TopBarProps {
  version: string;
  mode: Mode;
  connected: boolean;
  currentPattern: string | null;
  onModeChange: (mode: Mode) => void;
}

const modes: { value: Mode; label: string; icon: string }[] = [
  { value: "record", label: "Record", icon: "●" },
  { value: "proxy", label: "Proxy", icon: "→" },
  { value: "mock", label: "Mock", icon: "◆" },
];

/**
 * Top bar
 * Displays mode switch buttons and connection status
 */
export function TopBar({ version, mode, connected, currentPattern, onModeChange }: TopBarProps) {
  const handleModeClick = (targetMode: Mode) => {
    if (targetMode === "record" && !currentPattern) {
      alert("No pattern selected. Please select a pattern first.");
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

          return (
            <Button
              key={value}
              size="sm"
              bg={isActive ? (isRecording ? "recording.500" : "accent.500") : "transparent"}
              color={isActive ? "white" : "gray.400"}
              border="1px solid"
              borderColor={isActive ? (isRecording ? "recording.500" : "accent.500") : "gray.700"}
              _hover={{
                bg: isActive ? (isRecording ? "recording.600" : "accent.600") : "gray.800",
                borderColor: isActive ? (isRecording ? "recording.600" : "accent.600") : "gray.600",
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
