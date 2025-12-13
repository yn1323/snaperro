import { Box, Flex, Text } from "@chakra-ui/react";
import type { Mode } from "./ModeSelector";

type GuidePanelProps = {
  mode: Mode;
};

const modeHints: Record<Mode, { icon: string; text: string; subtext: string }> = {
  proxy: {
    icon: "→",
    text: "Proxy",
    subtext: "Forwarding requests",
  },
  record: {
    icon: "●",
    text: "Record",
    subtext: "Saving responses",
  },
  mock: {
    icon: "◆",
    text: "Mock",
    subtext: "Returning saved data",
  },
};

export function GuidePanel({ mode }: GuidePanelProps) {
  const hint = modeHints[mode];
  const isRecording = mode === "record";

  return (
    <Box
      flexShrink={0}
      px={4}
      py={3}
      borderTop="1px"
      borderColor="gray.200"
      borderLeft="3px solid"
      borderLeftColor={isRecording ? "recording.400" : "accent.500"}
      transition="all 0.15s ease"
    >
      <Flex alignItems="center" gap={2}>
        <Text
          fontFamily="mono"
          fontSize="sm"
          color={isRecording ? "recording.500" : "accent.600"}
          className={isRecording ? "animate-pulse" : ""}
        >
          {hint.icon}
        </Text>
        <Text fontFamily="mono" fontSize="sm" fontWeight="500" color={isRecording ? "recording.500" : "accent.600"}>
          {hint.text}
        </Text>
        <Text fontFamily="mono" fontSize="xs" color="gray.500">
          {hint.subtext}
        </Text>
      </Flex>
    </Box>
  );
}
