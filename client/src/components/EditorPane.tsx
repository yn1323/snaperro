import { Box, Button, Flex, HStack, Text, Textarea } from "@chakra-ui/react";
import { useEffect, useRef, useState } from "react";
import type { FileData } from "../types";

interface EditorPaneProps {
  fileData: FileData | null;
  filename: string | null;
  isLoading: boolean;
  onSave: (data: FileData) => void;
  onDelete: () => void;
  searchQuery?: string;
}

// Escape special regex characters
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Highlight matching text
function highlightText(text: string, query: string | undefined): React.ReactNode {
  if (!query) return text;
  const parts = text.split(new RegExp(`(${escapeRegExp(query)})`, "gi"));
  return parts.map((part, i) =>
    part.toLowerCase() === query.toLowerCase() ? (
      <mark key={i} style={{ background: "yellow", color: "black" }}>
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

/**
 * Right pane - JSON editor
 * Uses remaining width
 */
export function EditorPane({ fileData, filename, isLoading, onSave, onDelete, searchQuery }: EditorPaneProps) {
  const [editedContent, setEditedContent] = useState("");
  const [hasChanges, setHasChanges] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const preRef = useRef<HTMLPreElement>(null);

  // Sync scroll position between textarea and highlight layer
  const handleScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
    if (preRef.current) {
      preRef.current.scrollTop = e.currentTarget.scrollTop;
      preRef.current.scrollLeft = e.currentTarget.scrollLeft;
    }
  };

  // Update editor when file data changes
  useEffect(() => {
    if (fileData) {
      const formatted = JSON.stringify(fileData, null, 2);
      setEditedContent(formatted);
      setHasChanges(false);
      setParseError(null);
    } else {
      setEditedContent("");
      setHasChanges(false);
      setParseError(null);
    }
  }, [fileData]);

  const handleContentChange = (value: string) => {
    setEditedContent(value);
    setHasChanges(true);

    // JSON validation
    try {
      JSON.parse(value);
      setParseError(null);
    } catch (e) {
      setParseError(e instanceof Error ? e.message : "Invalid JSON");
    }
  };

  const handleFormat = () => {
    try {
      const parsed = JSON.parse(editedContent);
      const formatted = JSON.stringify(parsed, null, 2);
      setEditedContent(formatted);
      setParseError(null);
    } catch (e) {
      setParseError(e instanceof Error ? e.message : "Invalid JSON");
    }
  };

  const handleSave = () => {
    if (parseError) return;
    try {
      const data = JSON.parse(editedContent) as FileData;
      onSave(data);
      setHasChanges(false);
    } catch {
      // Parse should have succeeded if parseError is null
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "s") {
      e.preventDefault();
      if (!parseError && hasChanges) {
        handleSave();
      }
    }
  };

  // No file selected
  if (!filename) {
    return (
      <Flex flex={1} bg="gray.50" alignItems="center" justifyContent="center">
        <Text color="gray.500" fontSize="sm">
          Select a file
        </Text>
      </Flex>
    );
  }

  // Loading
  if (isLoading) {
    return (
      <Flex flex={1} bg="gray.50" alignItems="center" justifyContent="center">
        <Text color="gray.500" fontSize="sm">
          Loading...
        </Text>
      </Flex>
    );
  }

  return (
    <Flex flex={1} bg="white" direction="column" minW={0}>
      <Flex
        p={2}
        borderBottom="1px"
        borderColor="gray.200"
        bg="gray.50"
        alignItems="center"
        justifyContent="space-between"
        flexShrink={0}
      >
        <HStack gap={2} minW={0}>
          <Text fontWeight="600" fontSize="sm" color="gray.700" truncate title={filename}>
            {filename}
          </Text>
          {hasChanges && (
            <Text fontSize="xs" color="accent.600" flexShrink={0}>
              *Unsaved
            </Text>
          )}
        </HStack>
        <HStack gap={2} flexShrink={0}>
          <Button
            size="xs"
            bg="gray.200"
            color="gray.700"
            onClick={handleFormat}
            disabled={!!parseError}
            _hover={{ bg: "gray.300" }}
            transition="all 0.15s ease"
          >
            Format
          </Button>
          <Button
            size="xs"
            bg="accent.500"
            color="white"
            onClick={handleSave}
            disabled={!!parseError || !hasChanges}
            _hover={{ bg: "accent.600" }}
            _disabled={{ opacity: 0.5, cursor: "not-allowed" }}
            transition="all 0.15s ease"
          >
            Save
          </Button>
          <Button
            size="xs"
            bg="recording.500"
            color="white"
            onClick={onDelete}
            _hover={{ bg: "recording.600" }}
            transition="all 0.15s ease"
          >
            Delete
          </Button>
        </HStack>
      </Flex>

      {parseError && (
        <Box
          px={3}
          py={2}
          bg="recording.50"
          color="recording.600"
          fontSize="xs"
          borderBottom="1px"
          borderColor="recording.100"
          flexShrink={0}
        >
          JSON Error: {parseError}
        </Box>
      )}

      <Box position="relative" flex={1} overflow="hidden">
        {/* Background: Highlight display layer */}
        <Box
          as="pre"
          ref={preRef}
          position="absolute"
          inset={0}
          p={4}
          m={0}
          fontFamily="mono"
          fontSize="sm"
          lineHeight="1.5"
          letterSpacing="normal"
          bg="gray.900"
          color="gray.100"
          whiteSpace="pre-wrap"
          wordBreak="break-word"
          overflow="auto"
          pointerEvents="none"
        >
          {highlightText(editedContent, searchQuery)}
        </Box>

        {/* Foreground: Editable Textarea (transparent background) */}
        <Textarea
          value={editedContent}
          onChange={(e) => handleContentChange(e.target.value)}
          onScroll={handleScroll}
          onKeyDown={handleKeyDown}
          position="absolute"
          inset={0}
          p={4}
          fontFamily="mono"
          fontSize="sm"
          lineHeight="1.5"
          letterSpacing="normal"
          resize="none"
          overflow="auto"
          bg="transparent"
          color="transparent"
          caretColor="white"
          border="none"
          borderRadius={0}
          _focus={{ outline: "none", boxShadow: "none" }}
          spellCheck={false}
        />
      </Box>
    </Flex>
  );
}
