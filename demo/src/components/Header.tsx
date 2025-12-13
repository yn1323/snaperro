import { Flex, Heading, HStack, Link, Text } from "@chakra-ui/react";
import type { Mode } from "./ModeSelector";
import { ModeSelector } from "./ModeSelector";

type HeaderProps = {
  mode: Mode;
  onModeChange: (mode: Mode) => void;
  isLoading: boolean;
};

export function Header({ mode, onModeChange, isLoading }: HeaderProps) {
  const guiUrl =
    typeof window !== "undefined"
      ? `${window.location.protocol}//${window.location.hostname}:3333/__snaperro__/client`
      : "/__snaperro__/client";

  return (
    <Flex
      as="header"
      h="14"
      flexShrink={0}
      borderBottom="1px"
      borderColor="gray.200"
      bg="white"
      px={4}
      alignItems="center"
      justifyContent="space-between"
      boxShadow="0 1px 3px rgba(0,0,0,0.05)"
    >
      <HStack gap={2}>
        <Text fontSize="xl">🐕</Text>
        <Heading as="h1" size="md" fontFamily="mono" fontWeight="600" letterSpacing="-0.02em">
          snaperro
          <Text as="span" color="gray.500" fontWeight="normal" ml={1.5} fontSize="sm">
            demo
          </Text>
        </Heading>
      </HStack>

      <HStack gap={4}>
        <ModeSelector mode={mode} onChange={onModeChange} isLoading={isLoading} />

        <Link
          href={guiUrl}
          target="_blank"
          rel="noopener noreferrer"
          px={3}
          py={1.5}
          fontSize="sm"
          fontWeight="500"
          borderRadius="lg"
          border="1px"
          borderColor="gray.200"
          _hover={{ bg: "gray.50", borderColor: "accent.300" }}
          transition="all 0.15s ease"
        >
          Open GUI
          <Text as="span" color="accent.500" ml={1.5}>
            →
          </Text>
        </Link>
      </HStack>
    </Flex>
  );
}
