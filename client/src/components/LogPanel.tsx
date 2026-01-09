import { Box, Flex, IconButton, Text } from "@chakra-ui/react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { LuChevronDown, LuChevronUp, LuTrash2 } from "react-icons/lu";
import type { RequestLogEventData } from "../types";

// Constants
const STORAGE_KEY_OPEN = "snaperro-log-panel-open";
const STORAGE_KEY_HEIGHT = "snaperro-log-panel-height";
const DEFAULT_HEIGHT = 200;
const MIN_HEIGHT = 100;
const MAX_HEIGHT_VH = 50;
const MAX_LOGS = 500;

interface LogPanelProps {
  registerRequestLogHandler: (handler: (log: RequestLogEventData) => void) => () => void;
}

// Method badge colors
const methodColors: Record<string, { bg: string; color: string }> = {
  GET: { bg: "blue.500", color: "white" },
  POST: { bg: "green.500", color: "white" },
  PUT: { bg: "orange.500", color: "white" },
  PATCH: { bg: "yellow.500", color: "black" },
  DELETE: { bg: "red.500", color: "white" },
};

// Status color
function getStatusColor(status: number): string {
  if (status >= 500) return "red.500";
  if (status >= 400) return "orange.500";
  if (status >= 300) return "yellow.600";
  return "green.500";
}

// Action colors
const actionColors: Record<string, string> = {
  proxy: "blue.500",
  record: "red.500",
  mock: "green.500",
};

// Format time with milliseconds
function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  const time = date.toLocaleTimeString("ja-JP");
  const ms = String(date.getMilliseconds()).padStart(3, "0");
  return `${time}.${ms}`;
}

// Individual log entry component (memoized)
const LogEntry = memo(function LogEntry({ log }: { log: RequestLogEventData }) {
  const time = formatTime(log.timestamp);
  const methodStyle = methodColors[log.method] || { bg: "gray.500", color: "white" };
  const statusColor = getStatusColor(log.status);

  // Action display - show subAction directly if present (e.g., smart mode falling back to mock/record)
  const actionDisplay = log.subAction || log.action;

  return (
    <Flex
      px={3}
      py={1.5}
      fontSize="xs"
      fontFamily="mono"
      _hover={{ bg: "gray.50" }}
      gap={2}
      alignItems="center"
      borderBottom="1px solid"
      borderColor="gray.100"
    >
      <Text color="gray.400" flexShrink={0} w="100px">
        {time}
      </Text>
      <Box
        bg={methodStyle.bg}
        color={methodStyle.color}
        px={1.5}
        py={0.5}
        borderRadius="sm"
        fontSize="2xs"
        fontWeight="bold"
        flexShrink={0}
        w="50px"
        textAlign="center"
      >
        {log.method}
      </Box>
      <Text flex={1} truncate color="gray.700" title={log.path}>
        {log.path}
      </Text>
      <Text color={actionColors[actionDisplay] || "gray.400"} flexShrink={0}>
        {actionDisplay}
      </Text>
      <Text color="gray.400" flex={1} truncate title={log.filePath}>
        {log.filePath ?? ""}
      </Text>
      <Text color={statusColor} fontWeight="semibold" flexShrink={0} w="32px" textAlign="right">
        {log.status}
      </Text>
      <Text color="gray.400" flexShrink={0} w="80px" textAlign="right">
        {log.duration}ms
      </Text>
    </Flex>
  );
});

export const LogPanel = memo(function LogPanel({ registerRequestLogHandler }: LogPanelProps) {
  // State
  const [logs, setLogs] = useState<RequestLogEventData[]>([]);
  const [isOpen, setIsOpen] = useState(() => localStorage.getItem(STORAGE_KEY_OPEN) === "true");
  const [height, setHeight] = useState(() => Number(localStorage.getItem(STORAGE_KEY_HEIGHT)) || DEFAULT_HEIGHT);

  // Refs
  const logsContainerRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const startYRef = useRef(0);
  const startHeightRef = useRef(0);

  // Subscribe to request log events
  useEffect(() => {
    const unsubscribe = registerRequestLogHandler((log) => {
      setLogs((prev) => {
        const newLogs = [...prev, log];
        // Keep only the last MAX_LOGS entries
        return newLogs.slice(-MAX_LOGS);
      });
    });

    return unsubscribe;
  }, [registerRequestLogHandler]);

  // Auto-scroll to bottom when new log arrives
  const logsLength = logs.length;
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally trigger scroll on log count change
  useEffect(() => {
    if (logsContainerRef.current && isOpen) {
      logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
    }
  }, [logsLength, isOpen]);

  // Persist open state
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_OPEN, String(isOpen));
  }, [isOpen]);

  // Persist height
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_HEIGHT, String(height));
  }, [height]);

  // Toggle panel
  const handleToggle = useCallback(() => {
    setIsOpen((prev) => !prev);
  }, []);

  // Clear logs
  const handleClear = useCallback(() => {
    setLogs([]);
  }, []);

  // Resize handling
  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDraggingRef.current = true;
      startYRef.current = e.clientY;
      startHeightRef.current = height;
    },
    [height],
  );

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;

      const delta = startYRef.current - e.clientY;
      const maxHeight = window.innerHeight * (MAX_HEIGHT_VH / 100);
      const newHeight = Math.max(MIN_HEIGHT, Math.min(maxHeight, startHeightRef.current + delta));
      setHeight(newHeight);
    };

    const handleMouseUp = () => {
      isDraggingRef.current = false;
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  // Latest log for collapsed view
  const latestLog = logs[logs.length - 1];

  // Collapsed view (single line footer)
  if (!isOpen) {
    return (
      <Flex
        h="32px"
        px={3}
        py={4}
        bg="gray.100"
        borderTop="1px solid"
        borderColor="gray.200"
        align="center"
        fontSize="xs"
        fontFamily="mono"
        gap={2}
        cursor="pointer"
        _hover={{ bg: "gray.200" }}
        onClick={handleToggle}
      >
        {latestLog ? (
          <>
            <Text color="gray.400" flexShrink={0} w="100px">
              {formatTime(latestLog.timestamp)}
            </Text>
            <Box
              bg={methodColors[latestLog.method]?.bg || "gray.500"}
              color={methodColors[latestLog.method]?.color || "white"}
              px={1.5}
              py={0.5}
              borderRadius="sm"
              fontSize="2xs"
              fontWeight="bold"
              flexShrink={0}
            >
              {latestLog.method}
            </Box>
            <Text flex={1} truncate color="gray.600">
              {latestLog.path}
            </Text>
            <Text color={actionColors[latestLog.subAction || latestLog.action] || "gray.400"}>
              {latestLog.subAction || latestLog.action}
            </Text>
            <Text color={getStatusColor(latestLog.status)} fontWeight="semibold">
              {latestLog.status}
            </Text>
          </>
        ) : (
          <Text color="gray.400" flex={1}>
            No requests yet
          </Text>
        )}
        <IconButton aria-label="Expand log panel" size="xs" variant="ghost" py={1}>
          <LuChevronUp />
        </IconButton>
      </Flex>
    );
  }

  // Expanded view
  return (
    <Box borderTop="1px solid" borderColor="gray.200" bg="white">
      {/* Resize handle */}
      <Box
        h="1px"
        cursor="row-resize"
        bg="gray.200"
        _hover={{ bg: "blue.300" }}
        transition="background 0.15s ease"
        onMouseDown={handleResizeStart}
      />

      {/* Header */}
      <Flex h="28px" px={3} py={4} bg="gray.100" align="center" gap={2}>
        <Text fontWeight="medium" fontSize="xs" color="gray.600">
          Request Log ({logs.length})
        </Text>
        <Box flex={1} />
        <IconButton
          aria-label="Clear logs"
          size="xs"
          variant="ghost"
          py={1}
          _hover={{ bg: "gray.200" }}
          onClick={handleClear}
        >
          <LuTrash2 />
        </IconButton>
        <IconButton
          aria-label="Collapse log panel"
          size="xs"
          variant="ghost"
          py={1}
          _hover={{ bg: "gray.200" }}
          onClick={handleToggle}
        >
          <LuChevronDown />
        </IconButton>
      </Flex>

      {/* Log list */}
      <Box ref={logsContainerRef} h={`${height - 32}px`} overflowY="auto" bg="white">
        {logs.length === 0 ? (
          <Flex h="100%" align="center" justify="center">
            <Text color="gray.400" fontSize="sm">
              No requests yet
            </Text>
          </Flex>
        ) : (
          logs.map((log) => <LogEntry key={log.id} log={log} />)
        )}
      </Box>
    </Box>
  );
});
