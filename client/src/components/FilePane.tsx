import { Badge, Box, Button, Flex, Input, Spinner, Text } from "@chakra-ui/react";
import { useEffect, useMemo, useState } from "react";
import { LuSearch, LuUpload, LuX } from "react-icons/lu";
import { useSnaperroAPI } from "../hooks/useSnaperroAPI";
import type { FileInfo, SearchResult } from "../types";

const METHOD_COLORS: Record<string, { bg: string; color: string }> = {
  GET: { bg: "green.100", color: "green.700" },
  POST: { bg: "blue.100", color: "blue.700" },
  PUT: { bg: "yellow.100", color: "yellow.700" },
  PATCH: { bg: "orange.100", color: "orange.700" },
  DELETE: { bg: "red.100", color: "red.700" },
  OPTIONS: { bg: "gray.200", color: "gray.600" },
  HEAD: { bg: "gray.200", color: "gray.600" },
};

interface FilePaneProps {
  width: number;
  files: FileInfo[];
  selectedFile: string | null;
  onSelect: (filename: string) => void;
  onUpload: (file: File) => void;
  onDownload: (filename: string) => void;
  pattern: string | null;
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
}

/**
 * Center pane - File list
 * Width: resizable
 */
export function FilePane({
  width,
  files,
  selectedFile,
  onSelect,
  onUpload,
  onDownload,
  pattern,
  searchQuery,
  onSearchQueryChange,
}: FilePaneProps) {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const api = useSnaperroAPI();

  // Reset accordion when pattern changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: Reset when files change
  useEffect(() => {
    setExpandedGroups(new Set());
  }, [files]);

  // Debounced server search
  useEffect(() => {
    if (!searchQuery.trim() || !pattern) {
      setSearchResults(null);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const results = await api.searchFiles(pattern, searchQuery);
        setSearchResults(results);
      } catch {
        setSearchResults(null);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery, pattern, api]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onUpload(file);
      e.target.value = "";
    }
  };

  // Group files by endpoint
  const groupedFiles = useMemo(() => {
    const groups: Map<string, FileInfo[]> = new Map();

    for (const file of files) {
      const key = file.endpoint;
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)?.push(file);
    }

    return Array.from(groups.entries())
      .map(([endpoint, groupFiles]) => ({ endpoint, files: groupFiles }))
      .sort((a, b) => a.endpoint.localeCompare(b.endpoint));
  }, [files]);

  // Search filter
  const filteredGroups = useMemo(() => {
    if (!searchQuery.trim()) return groupedFiles;

    // If server search results are available, use them
    if (searchResults) {
      const matchedFilenames = new Set(searchResults.map((r) => r.filename));
      return groupedFiles
        .map((group) => ({
          ...group,
          files: group.files.filter((f) => matchedFilenames.has(f.filename)),
        }))
        .filter((group) => group.files.length > 0);
    }

    // Fallback to local search (while waiting for server results)
    const query = searchQuery.toLowerCase();
    return groupedFiles
      .map((group) => ({
        ...group,
        files: group.files.filter(
          (f) => f.filename.toLowerCase().includes(query) || f.endpoint.toLowerCase().includes(query),
        ),
      }))
      .filter((group) => group.files.length > 0);
  }, [groupedFiles, searchQuery, searchResults]);

  const toggleGroup = (endpoint: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(endpoint)) {
        next.delete(endpoint);
      } else {
        next.add(endpoint);
      }
      return next;
    });
  };

  return (
    <Flex w={`${width}px`} bg="white" borderRight="1px" borderColor="gray.200" direction="column" flexShrink={0}>
      <Box p={2} borderBottom="1px" borderColor="gray.200" bg="gray.50">
        <Text fontWeight="600" fontSize="sm" color="gray.700">
          Files ({files.length})
        </Text>
      </Box>

      <Box p={2} borderBottom="1px" borderColor="gray.200">
        <Flex position="relative" align="center">
          <Box position="absolute" left={2} color="gray.400" pointerEvents="none" zIndex={1}>
            <LuSearch size={14} />
          </Box>
          <Input
            size="sm"
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            placeholder="Search..."
            pl={7}
            pr={isSearching || searchQuery ? 7 : 2}
            bg="gray.50"
            border="1px solid"
            borderColor="gray.200"
            _hover={{ borderColor: "gray.300" }}
            _focus={{ borderColor: "accent.500", boxShadow: "0 0 0 1px var(--chakra-colors-accent-500)" }}
          />
          {isSearching && (
            <Box position="absolute" right={2}>
              <Spinner size="xs" color="accent.500" />
            </Box>
          )}
          {searchQuery && !isSearching && (
            <Box
              position="absolute"
              right={2}
              color="gray.400"
              cursor="pointer"
              _hover={{ color: "gray.600" }}
              onClick={() => onSearchQueryChange("")}
            >
              <LuX size={14} />
            </Box>
          )}
        </Flex>
      </Box>

      <Box flex={1} overflowY="auto">
        {filteredGroups.length === 0 ? (
          <Text p={4} fontSize="sm" color="gray.500" textAlign="center">
            {files.length === 0 ? "No files" : isSearching ? "Searching..." : "No results"}
          </Text>
        ) : (
          filteredGroups.map((group) => (
            <Box key={group.endpoint}>
              <Button
                variant="ghost"
                w="full"
                px={2}
                py={1.5}
                h="auto"
                bg="gray.100"
                borderBottom="1px"
                borderColor="gray.200"
                borderRadius={0}
                justifyContent="flex-start"
                onClick={() => toggleGroup(group.endpoint)}
                _hover={{ bg: "gray.200" }}
                transition="all 0.15s ease"
              >
                <Text fontSize="xs" color="gray.500">
                  {expandedGroups.has(group.endpoint) ? "▼" : "▶"}
                </Text>
                <Text fontSize="xs" color="gray.700" truncate flex={1} ml={1} textAlign="left" title={group.endpoint}>
                  {group.endpoint}
                </Text>
                <Text fontSize="xs" color="gray.500">
                  ({group.files.length})
                </Text>
              </Button>

              {expandedGroups.has(group.endpoint) &&
                group.files.map((file) => {
                  const isSelected = selectedFile === file.filename;
                  return (
                    <Box
                      key={file.filename}
                      as="button"
                      w="full"
                      p={2}
                      pl={4}
                      borderBottom="1px"
                      borderColor="gray.100"
                      textAlign="left"
                      cursor="pointer"
                      bg={isSelected ? "accent.50" : undefined}
                      borderLeft={isSelected ? "2px solid" : "2px solid transparent"}
                      borderLeftColor={isSelected ? "accent.500" : "transparent"}
                      _hover={{ bg: isSelected ? "accent.50" : "gray.50" }}
                      onClick={() => onSelect(file.filename)}
                      transition="all 0.15s ease"
                    >
                      <Flex alignItems="center" gap={2}>
                        <Badge
                          bg={METHOD_COLORS[file.method]?.bg ?? "gray.200"}
                          color={METHOD_COLORS[file.method]?.color ?? "gray.600"}
                          fontFamily="mono"
                          fontSize="2xs"
                          px={1.5}
                          py={0.5}
                          fontWeight="500"
                        >
                          {file.method}
                        </Badge>
                        <Text flex={1} fontSize="xs" color="gray.500" truncate title={file.filename}>
                          {file.filename}
                        </Text>
                        <Button
                          variant="ghost"
                          size="xs"
                          p={1}
                          minW="auto"
                          h="auto"
                          color="gray.400"
                          _hover={{ color: "accent.500" }}
                          onClick={(e) => {
                            e.stopPropagation();
                            onDownload(file.filename);
                          }}
                          title="Download"
                        >
                          ⬇
                        </Button>
                      </Flex>
                    </Box>
                  );
                })}
            </Box>
          ))
        )}
      </Box>

      <Box p={2} borderTop="1px" borderColor="gray.200">
        <Button
          as="label"
          size="xs"
          bg="accent.500"
          color="white"
          w="full"
          cursor="pointer"
          _hover={{ bg: "accent.600" }}
          transition="all 0.15s ease"
          gap={1}
        >
          <LuUpload size={14} /> Import JSON File
          <input type="file" accept=".json" onChange={handleFileUpload} hidden />
        </Button>
      </Box>
    </Flex>
  );
}
