import { Badge, Box, Button, Flex, HStack, Spinner, Text } from "@chakra-ui/react";
import type { ErrorInfo } from "../App";
import type { Mode } from "./ModeSelector";

type ResponsePanelProps = {
  request: {
    url: string;
    method: string;
  } | null;
  response: {
    status: number;
    body: unknown;
  } | null;
  mode: Mode;
  isLoading: boolean;
  error: ErrorInfo | null;
};

const modeConfig: Record<Mode, { label: string; icon: string }> = {
  smart: { label: "Smart", icon: "★" },
  proxy: { label: "Proxy", icon: "→" },
  record: { label: "Record", icon: "●" },
  mock: { label: "Mock", icon: "◆" },
};

const getStatusColorPalette = (status: number): string => {
  if (status >= 200 && status < 300) return "green";
  if (status >= 300 && status < 400) return "yellow";
  if (status >= 400 && status < 500) return "orange";
  return "red";
};

function highlightJson(json: string): string {
  return json
    .replace(/"([^"]+)"(?=\s*:)/g, '<span class="json-key">"$1"</span>')
    .replace(/:\s*"([^"]*)"/g, ': <span class="json-string">"$1"</span>')
    .replace(/:\s*(-?\d+\.?\d*)/g, ': <span class="json-number">$1</span>')
    .replace(/:\s*(true|false|null)/g, ': <span class="json-boolean">$1</span>');
}

export function ResponsePanel({ request, response, mode, isLoading, error }: ResponsePanelProps) {
  const config = modeConfig[mode];
  const isRecording = mode === "record";

  if (!request && !isLoading && !error) {
    return (
      <Flex
        h="full"
        bg="white"
        border="1px"
        borderColor="gray.200"
        borderRadius="xl"
        direction="column"
        alignItems="center"
        justifyContent="center"
      >
        <Flex w={12} h={12} borderRadius="full" bg="gray.100" alignItems="center" justifyContent="center" mb={3}>
          <Text fontSize="2xl" opacity={0.5}>
            📡
          </Text>
        </Flex>
        <Text fontFamily="mono" color="gray.500" fontSize="sm">
          Select a scenario and click "Run"
        </Text>
        <Text fontFamily="mono" color="gray.500" fontSize="xs" mt={1} opacity={0.6}>
          Response will be displayed here
        </Text>
      </Flex>
    );
  }

  return (
    <Box
      h="full"
      bg="white"
      border="1px"
      borderColor="gray.200"
      borderRadius="xl"
      overflow="hidden"
      display="flex"
      flexDirection="column"
    >
      <Flex
        flexShrink={0}
        px={4}
        py={3}
        borderBottom="1px"
        borderColor="gray.200"
        bg="gray.50"
        alignItems="center"
        justifyContent="space-between"
        flexWrap="wrap"
        gap={3}
      >
        <HStack gap={3} minW={0} flex={1}>
          {request && (
            <>
              <Badge bg="gray.200" color="gray.600" fontFamily="mono" fontSize="xs" fontWeight="600" flexShrink={0}>
                {request.method}
              </Badge>
              <Text as="code" fontFamily="mono" fontSize="sm" truncate>
                {request.url}
              </Text>
            </>
          )}
        </HStack>

        <HStack gap={3} flexShrink={0}>
          <Badge
            bg={isRecording ? "recording.50" : "accent.50"}
            color={isRecording ? "recording.500" : "accent.600"}
            fontFamily="mono"
            fontSize="xs"
            fontWeight="500"
          >
            <Text as="span" fontSize="0.6rem" mr={1} className={isRecording ? "animate-pulse" : ""}>
              {config.icon}
            </Text>
            {config.label}
          </Badge>

          {response && (
            <Badge
              colorPalette={getStatusColorPalette(response.status)}
              fontFamily="mono"
              fontSize="xs"
              fontWeight="600"
            >
              <Box as="span" w="1.5" h="1.5" borderRadius="full" bg="currentColor" mr={2} />
              {response.status}
            </Badge>
          )}
        </HStack>
      </Flex>

      <Box position="relative" flex={1} minH={0} overflow="hidden">
        {isLoading && (
          <Flex
            position="absolute"
            inset={0}
            bg="whiteAlpha.800"
            backdropFilter="blur(4px)"
            alignItems="center"
            justifyContent="center"
            zIndex={10}
          >
            <HStack gap={3} px={5} py={3} borderRadius="xl" bg="gray.50" border="1px" borderColor="gray.200">
              <Spinner size="sm" color="accent.500" />
              <Text fontFamily="mono" fontSize="sm" color="gray.500">
                Fetching...
              </Text>
            </HStack>
          </Flex>
        )}

        {error && (
          <Flex h="full" alignItems="center" justifyContent="center" p={4}>
            <Box
              maxW="md"
              w="full"
              px={5}
              py={4}
              borderRadius="xl"
              bg="recording.50"
              border="1px"
              borderColor="recording.100"
            >
              <HStack gap={2} mb={3}>
                <Text fontSize="xl">⚠️</Text>
                <Text fontFamily="mono" fontSize="md" fontWeight="600" color="recording.600">
                  {error.title}
                </Text>
              </HStack>

              <Text fontFamily="mono" fontSize="sm" mb={2}>
                {error.message}
              </Text>

              <Text fontFamily="mono" fontSize="sm" color="gray.600" mb={4}>
                {error.action}
              </Text>

              <Box pt={3} borderTop="1px" borderColor="recording.100">
                <Text
                  fontFamily="mono"
                  fontSize="xs"
                  color="gray.500"
                  textTransform="uppercase"
                  letterSpacing="wider"
                  mb={2}
                >
                  Details
                </Text>
                <Box spaceY={1} fontFamily="mono" fontSize="xs">
                  {error.details.status && (
                    <Flex gap={2}>
                      <Text color="gray.500">Status:</Text>
                      <Text color="recording.500">
                        {error.details.status} {error.details.statusText}
                      </Text>
                    </Flex>
                  )}
                  <Flex gap={2}>
                    <Text color="gray.500">URL:</Text>
                    <Text wordBreak="break-all">{error.details.url}</Text>
                  </Flex>
                  {error.details.endpoint && (
                    <Flex gap={2}>
                      <Text color="gray.500">Endpoint:</Text>
                      <Text>{error.details.endpoint}</Text>
                    </Flex>
                  )}
                  {error.details.rawMessage && (
                    <Flex gap={2}>
                      <Text color="gray.500">Message:</Text>
                      <Text wordBreak="break-all">{error.details.rawMessage}</Text>
                    </Flex>
                  )}
                </Box>
              </Box>
            </Box>
          </Flex>
        )}

        {response && !error && (
          <Flex h="full" direction="column" p={4}>
            <Flex flexShrink={0} alignItems="center" justifyContent="space-between" mb={2}>
              <Text fontFamily="mono" fontSize="xs" color="gray.500" textTransform="uppercase" letterSpacing="wider">
                Response Body
              </Text>
              <Text fontFamily="mono" fontSize="xs" color="gray.500" opacity={0.6}>
                {typeof response.body === "object" ? `${JSON.stringify(response.body).length} bytes` : ""}
              </Text>
            </Flex>

            <Box position="relative" flex={1} minH={0} role="group">
              <Box
                position="absolute"
                left={0}
                top={0}
                bottom={0}
                w="3px"
                borderRadius="full"
                bg={response.status < 300 ? "green.400" : response.status < 400 ? "yellow.400" : "recording.400"}
              />

              <Box
                as="pre"
                className="json-display"
                h="full"
                pl={4}
                pr={4}
                py={3}
                borderRadius="lg"
                bg="gray.50"
                border="1px"
                borderColor="gray.200"
                overflow="auto"
                fontFamily="mono"
                fontSize="sm"
                lineHeight="relaxed"
                // biome-ignore lint/security/noDangerouslySetInnerHtml: For JSON highlighting
                dangerouslySetInnerHTML={{
                  __html: highlightJson(JSON.stringify(response.body, null, 2)),
                }}
              />

              <Button
                size="xs"
                position="absolute"
                top={3}
                right={3}
                opacity={0}
                _groupHover={{ opacity: 1 }}
                transition="opacity 0.15s ease"
                fontFamily="mono"
                bg="gray.200"
                color="gray.700"
                _hover={{ bg: "gray.300" }}
                onClick={() => {
                  navigator.clipboard.writeText(JSON.stringify(response.body, null, 2));
                }}
              >
                Copy
              </Button>
            </Box>
          </Flex>
        )}

        {!response && !error && !isLoading && request && (
          <Flex h="full" alignItems="center" justifyContent="center">
            <Text fontFamily="mono" fontSize="sm" color="gray.500">
              Waiting for response...
            </Text>
          </Flex>
        )}
      </Box>
    </Box>
  );
}
