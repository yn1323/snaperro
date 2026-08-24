import { Badge, Box, Button, Flex, Input, Spinner, Text } from "@chakra-ui/react";
import { useEffect, useMemo, useState } from "react";
import { LuFileArchive, LuSearch, LuUpload, LuX } from "react-icons/lu";

import {
  AccordionItem,
  AccordionItemContent,
  AccordionItemTrigger,
  AccordionRoot,
} from "../../../components/ui/accordion";
import type { RecordingSummary } from "../../contracts";
import { useV2AppController, useV2OperationState, useV2RecordingList, useV2ViewState } from "../app-provider";
import { runUiAction } from "../ui-action";

const METHOD_COLORS: Record<string, { bg: string; color: string }> = {
  GET: { bg: "green.100", color: "green.700" },
  POST: { bg: "blue.100", color: "blue.700" },
  PUT: { bg: "yellow.100", color: "yellow.700" },
  PATCH: { bg: "orange.100", color: "orange.700" },
  DELETE: { bg: "red.100", color: "red.700" },
  OPTIONS: { bg: "gray.200", color: "gray.600" },
  HEAD: { bg: "gray.200", color: "gray.600" },
};

interface RecordingPaneProps {
  width: number;
}

export function RecordingPane({ width }: RecordingPaneProps) {
  const controller = useV2AppController();
  const list = useV2RecordingList();
  const operation = useV2OperationState();
  const view = useV2ViewState();
  const [expandedGroups, setExpandedGroups] = useState<string[]>([]);

  useEffect(() => {
    const timer = globalThis.setTimeout(() => {
      void controller.refreshRecordings(view.searchQuery).catch(() => undefined);
    }, 300);
    return () => globalThis.clearTimeout(timer);
  }, [controller, view.searchQuery]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset expansion when the scenario identity changes
  useEffect(() => setExpandedGroups([]), [list.scenarioId]);

  const grouped = useMemo(() => {
    const groups = new Map<string, RecordingSummary[]>();
    for (const recording of list.items) {
      groups.set(recording.endpoint, [...(groups.get(recording.endpoint) ?? []), recording]);
    }
    return [...groups.entries()]
      .map(([endpoint, items]) => ({ endpoint, items }))
      .sort((left, right) => left.endpoint.localeCompare(right.endpoint));
  }, [list.items]);

  const uploadJson = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void runUiAction(() => controller.uploadRecording(file), "Recording import failed");
  };

  const uploadArchive = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void runUiAction(() => controller.importRecordingArchive(file), "Recording ZIP import failed");
  };

  const loading = list.status === "loading";
  return (
    <Flex w={`${width}px`} bg="white" borderRight="1px" borderColor="gray.200" direction="column" flexShrink={0}>
      <Flex p={2} borderBottom="1px" borderColor="gray.200" bg="gray.50" align="center" justify="space-between">
        <Text fontWeight="600" fontSize="sm" color="gray.700">
          Recordings ({list.items.length}
          {list.nextCursor ? "+" : ""})
        </Text>
        <Flex gap={1}>
          <Button
            as="label"
            variant="ghost"
            size="xs"
            p={1}
            minW="24px"
            h="24px"
            color="gray.500"
            cursor={list.scenarioId && !operation.pending ? "pointer" : "not-allowed"}
            disabled={!list.scenarioId || operation.pending}
            aria-label="Import recording JSON"
          >
            <LuUpload size={16} />
            <input
              type="file"
              accept=".json,application/json"
              onChange={uploadJson}
              disabled={!list.scenarioId || operation.pending}
              hidden
            />
          </Button>
          <Button
            as="label"
            variant="ghost"
            size="xs"
            p={1}
            minW="24px"
            h="24px"
            color="gray.500"
            cursor={list.scenarioId && !operation.pending ? "pointer" : "not-allowed"}
            disabled={!list.scenarioId || operation.pending}
            aria-label="Import recording ZIP"
          >
            <LuFileArchive size={16} />
            <input
              type="file"
              accept=".zip,application/zip"
              onChange={uploadArchive}
              disabled={!list.scenarioId || operation.pending}
              hidden
            />
          </Button>
        </Flex>
      </Flex>

      <Box p={2} borderBottom="1px" borderColor="gray.200">
        <Flex position="relative" align="center">
          <Box position="absolute" left={2} color="gray.400" pointerEvents="none" zIndex={1}>
            <LuSearch size={14} />
          </Box>
          <Input
            size="sm"
            value={view.searchQuery}
            onChange={(event) => controller.setSearchQuery(event.target.value)}
            placeholder="Search recordings..."
            aria-label="Search recordings"
            pl={7}
            pr={loading || view.searchQuery ? 7 : 2}
            disabled={!list.scenarioId}
          />
          {loading ? (
            <Box position="absolute" right={2}>
              <Spinner size="xs" color="accent.500" />
            </Box>
          ) : view.searchQuery ? (
            <Button
              variant="ghost"
              position="absolute"
              right={0}
              minW="28px"
              h="28px"
              p={1}
              color="gray.400"
              onClick={() => controller.setSearchQuery("")}
              aria-label="Clear recording search"
            >
              <LuX size={14} />
            </Button>
          ) : null}
        </Flex>
      </Box>

      <Box flex={1} overflowY="auto">
        {list.error ? (
          <Flex p={2} gap={2} align="center" bg="red.50" color="red.700" role="alert">
            <Text fontSize="xs" flex={1}>
              {list.error.message}
            </Text>
            <Button
              size="xs"
              variant="outline"
              disabled={loading}
              onClick={() => void controller.refreshRecordings(view.searchQuery).catch(() => undefined)}
            >
              Retry
            </Button>
          </Flex>
        ) : null}
        {loading && list.items.length === 0 ? (
          <Flex p={4} align="center" justify="center" gap={2} color="gray.500">
            <Spinner size="sm" />
            <Text fontSize="sm">Loading...</Text>
          </Flex>
        ) : grouped.length === 0 && !list.error ? (
          <Text p={4} fontSize="sm" color="gray.500" textAlign="center">
            {list.scenarioId ? (view.searchQuery ? "No results" : "No recordings") : "Select a scenario"}
          </Text>
        ) : (
          <AccordionRoot multiple value={expandedGroups} onValueChange={(details) => setExpandedGroups(details.value)}>
            {grouped.map((group) => (
              <AccordionItem key={group.endpoint} value={group.endpoint}>
                <AccordionItemTrigger px={2} py={1.5} bg="gray.100" borderRadius={0}>
                  <Text fontSize="xs" color="gray.700" truncate flex={1} textAlign="left">
                    {group.endpoint}
                  </Text>
                  <Text fontSize="xs" color="gray.500">
                    ({group.items.length})
                  </Text>
                </AccordionItemTrigger>
                <AccordionItemContent p={0}>
                  {group.items.map((recording) => (
                    <RecordingRow
                      key={recording.id}
                      recording={recording}
                      selected={view.selectedRecordingId === recording.id}
                      disabled={operation.pending}
                      onSelect={() => controller.openRecording(recording.id)}
                      onDownload={() =>
                        void runUiAction(() => controller.downloadRecording(recording.id), "Recording download failed")
                      }
                    />
                  ))}
                </AccordionItemContent>
              </AccordionItem>
            ))}
          </AccordionRoot>
        )}
        {list.nextCursor ? (
          <Button
            w="full"
            size="sm"
            variant="ghost"
            borderRadius={0}
            disabled={list.status === "loading-more"}
            onClick={() => void runUiAction(() => controller.loadMoreRecordings(), "Could not load more recordings")}
          >
            {list.status === "loading-more" ? "Loading..." : "Load more"}
          </Button>
        ) : null}
      </Box>
    </Flex>
  );
}

function RecordingRow({
  recording,
  selected,
  disabled,
  onSelect,
  onDownload,
}: {
  recording: RecordingSummary;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
  onDownload: () => void;
}) {
  return (
    <Flex
      w="full"
      borderBottom="1px"
      borderColor="gray.100"
      bg={selected ? "accent.50" : undefined}
      borderLeft="2px solid"
      borderLeftColor={selected ? "accent.500" : "transparent"}
      align="center"
    >
      <Button
        variant="ghost"
        flex={1}
        minW={0}
        h="auto"
        p={2}
        pl={4}
        borderRadius={0}
        justifyContent="flex-start"
        disabled={disabled}
        onClick={onSelect}
        aria-label={`Open ${recording.filename}`}
      >
        <Flex w="full" minW={0} align="center" gap={2}>
          <Badge
            bg={METHOD_COLORS[recording.method]?.bg ?? "gray.200"}
            color={METHOD_COLORS[recording.method]?.color ?? "gray.600"}
            fontFamily="mono"
            fontSize="2xs"
          >
            {recording.method}
          </Badge>
          <Text flex={1} fontSize="xs" color="gray.500" truncate title={recording.filename}>
            {recording.filename}
          </Text>
        </Flex>
      </Button>
      <Button
        variant="ghost"
        size="xs"
        p={1}
        mr={1}
        minW="24px"
        h="24px"
        color="gray.400"
        disabled={disabled}
        onClick={onDownload}
        aria-label={`Download ${recording.filename}`}
      >
        ⬇
      </Button>
    </Flex>
  );
}
