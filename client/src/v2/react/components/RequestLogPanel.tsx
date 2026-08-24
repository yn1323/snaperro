import { Badge, Box, Button, Flex, IconButton, Text } from "@chakra-ui/react";
import { useState } from "react";
import { LuChevronDown, LuChevronUp, LuTrash2 } from "react-icons/lu";
import { useV2AppController, useV2RequestLogs } from "../app-provider";
import type { RequestActivity } from "../app-state";

const METHOD_COLORS: Record<string, string> = {
  GET: "blue",
  POST: "green",
  PUT: "orange",
  PATCH: "yellow",
  DELETE: "red",
};

function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  return `${date.toLocaleTimeString("ja-JP")}.${String(date.getMilliseconds()).padStart(3, "0")}`;
}

function statusColor(status: number): string {
  if (status >= 500) return "red.600";
  if (status >= 400) return "orange.600";
  if (status >= 300) return "yellow.600";
  return "green.600";
}

export function RequestLogPanel() {
  const controller = useV2AppController();
  const { entries } = useV2RequestLogs();
  const [open, setOpen] = useState(false);
  const latest = entries.at(-1);

  if (!open) {
    return (
      <Button
        type="button"
        variant="ghost"
        w="full"
        h="32px"
        px={3}
        bg="gray.100"
        borderTop="1px solid"
        borderColor="gray.200"
        borderRadius={0}
        justifyContent="stretch"
        gap={2}
        cursor="pointer"
        onClick={() => setOpen(true)}
        aria-label="Expand request log"
        _hover={{ bg: "gray.200" }}
      >
        {latest ? (
          <CompactLog log={latest} />
        ) : (
          <Text fontSize="xs" color="gray.400" flex={1}>
            No requests yet
          </Text>
        )}
        <LuChevronUp aria-hidden />
      </Button>
    );
  }

  return (
    <Box borderTop="1px solid" borderColor="gray.200" bg="white">
      <Flex h="32px" px={3} bg="gray.100" align="center" gap={2}>
        <Text fontWeight="medium" fontSize="xs" color="gray.600">
          Request Log ({entries.length})
        </Text>
        <Box flex={1} />
        <IconButton aria-label="Clear request log" size="xs" variant="ghost" onClick={() => controller.clearLogs()}>
          <LuTrash2 />
        </IconButton>
        <IconButton aria-label="Collapse request log" size="xs" variant="ghost" onClick={() => setOpen(false)}>
          <LuChevronDown />
        </IconButton>
      </Flex>
      <Box h="200px" overflowY="auto">
        {entries.length ? (
          entries.map((log) => <LogRow key={`${log.kind}-${log.id}-${log.timestamp}`} log={log} />)
        ) : (
          <Text p={4} color="gray.400">
            No requests yet
          </Text>
        )}
      </Box>
    </Box>
  );
}

function CompactLog({ log }: { log: RequestActivity }) {
  return (
    <Flex flex={1} minW={0} align="center" gap={2} fontFamily="mono" fontSize="xs">
      <Text color="gray.400" w="100px" flexShrink={0}>
        {formatTime(log.timestamp)}
      </Text>
      <Badge colorPalette={METHOD_COLORS[log.method] ?? "gray"}>{log.method}</Badge>
      <Text truncate flex={1}>
        {log.path}
      </Text>
      <Text color="gray.500">{log.subAction ?? log.action}</Text>
      <Text color={statusColor(log.status)} fontWeight="semibold">
        {log.status}
      </Text>
      <Text color="gray.400">{`${log.durationMs.toFixed(1)}ms`}</Text>
      {log.matchedRecordingId ? (
        <Text color="blue.600" title={log.matchedRecordingId}>
          matched
        </Text>
      ) : null}
      <RecordingStatus log={log} />
    </Flex>
  );
}

function LogRow({ log }: { log: RequestActivity }) {
  return (
    <Flex px={3} py={1.5} borderBottom="1px solid" borderColor="gray.100" align="center" gap={2} fontSize="xs">
      <CompactLog log={log} />
    </Flex>
  );
}

function RecordingStatus({ log }: { log: RequestActivity }) {
  switch (log.recordingOutcome.state) {
    case "not-attempted":
      return null;
    case "pending":
      return <Text color="orange.600">saving…</Text>;
    case "saved":
      return (
        <Text color="accent.600" title={log.recordingOutcome.recordingId}>
          saved
        </Text>
      );
    case "failed":
      return (
        <Text
          color="red.600"
          maxW="240px"
          truncate
          title={`${log.recordingOutcome.problem.code}: ${log.recordingOutcome.problem.message}`}
        >
          failed: {log.recordingOutcome.problem.message}
        </Text>
      );
  }
}
