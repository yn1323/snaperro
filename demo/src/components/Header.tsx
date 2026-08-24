import { Button, Flex, Heading, HStack, Link, Text } from "@chakra-ui/react";
import { LuKeyRound } from "react-icons/lu";
import type { DemoConnectionState } from "../control/demo-control";
import type { Mode } from "./ModeSelector";
import { ModeSelector } from "./ModeSelector";

type HeaderProps = {
  mode: Mode;
  onModeChange: (mode: Mode) => void;
  isLoading: boolean;
  connection: DemoConnectionState;
  controlError: string | null;
  hasControlToken: boolean;
  onControlTokenClick: () => void;
};

export function Header({
  mode,
  onModeChange,
  isLoading,
  connection,
  controlError,
  hasControlToken,
  onControlTokenClick,
}: HeaderProps) {
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
        <Text
          maxW="240px"
          truncate
          fontFamily="mono"
          fontSize="xs"
          color={controlError ? "red.600" : "gray.500"}
          role={controlError ? "alert" : "status"}
          title={controlError ?? connection}
        >
          {controlError ?? connection}
        </Text>
        <ModeSelector mode={mode} onChange={onModeChange} isLoading={isLoading} />

        <Button
          size="sm"
          variant="ghost"
          aria-label={hasControlToken ? "Update demo control token" : "Configure demo control token"}
          title={hasControlToken ? "Update control token" : "Configure control token"}
          onClick={onControlTokenClick}
        >
          <LuKeyRound />
        </Button>

        <Link
          href="/__snaperro__/client"
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
