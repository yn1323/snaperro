import { Box, Button, Flex } from "@chakra-ui/react";

export type Mode = "proxy" | "record" | "mock";

type ModeSelectorProps = {
  mode: Mode;
  onChange: (mode: Mode) => void;
  isLoading: boolean;
};

const modeConfig: Record<Mode, { label: string; icon: string; description: string }> = {
  proxy: {
    label: "Proxy",
    icon: "→",
    description: "Pass through to real API",
  },
  record: {
    label: "Record",
    icon: "●",
    description: "Save responses to files",
  },
  mock: {
    label: "Mock",
    icon: "◆",
    description: "Return saved responses",
  },
};

export function ModeSelector({ mode, onChange, isLoading }: ModeSelectorProps) {
  return (
    <Flex alignItems="center" gap={1} p={1} bg="white" borderRadius="lg" border="1px" borderColor="gray.200">
      {(Object.keys(modeConfig) as Mode[]).map((m) => {
        const config = modeConfig[m];
        const isActive = mode === m;
        const isRecording = m === "record" && isActive;
        const isMock = m === "mock" && isActive;

        const getColor = () => {
          if (isRecording) return "recording";
          if (isMock) return "mock";
          return "accent";
        };
        const color = getColor();

        return (
          <Button
            key={m}
            onClick={() => onChange(m)}
            disabled={isLoading}
            position="relative"
            px={4}
            py={2}
            borderRadius="md"
            fontFamily="mono"
            fontSize="sm"
            fontWeight="500"
            bg={isActive ? `${color}.50` : "transparent"}
            border="1px solid"
            borderColor={isActive ? `${color}.500` : "transparent"}
            color={isActive ? (isRecording ? `${color}.500` : `${color}.600`) : "gray.500"}
            opacity={isLoading ? 0.5 : 1}
            cursor={isLoading ? "not-allowed" : "pointer"}
            _hover={{ bg: !isActive && !isLoading ? "gray.100" : undefined }}
            title={config.description}
            transition="all 0.15s ease"
          >
            <Box as="span" ml={isRecording ? 2 : 0}>
              <Box as="span" mr={1.5} fontSize="xs">
                {config.icon}
              </Box>
              {config.label}
            </Box>
          </Button>
        );
      })}
    </Flex>
  );
}
