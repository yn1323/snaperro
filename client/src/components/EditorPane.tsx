import { Box, Button, Flex, HStack, Text, Textarea } from "@chakra-ui/react";
import { useEffect, useState } from "react";
import type { FileData } from "../types";

interface EditorPaneProps {
  fileData: FileData | null;
  filename: string | null;
  isLoading: boolean;
  onSave: (data: FileData) => void;
  onDelete: () => void;
}

/**
 * Right pane - JSON editor
 * Uses remaining width
 */
export function EditorPane({ fileData, filename, isLoading, onSave, onDelete }: EditorPaneProps) {
  const [editedContent, setEditedContent] = useState("");
  const [hasChanges, setHasChanges] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

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

      <Textarea
        value={editedContent}
        onChange={(e) => handleContentChange(e.target.value)}
        flex={1}
        p={4}
        fontFamily="mono"
        fontSize="sm"
        resize="none"
        bg="gray.900"
        color="gray.100"
        border="none"
        borderRadius={0}
        _focus={{ outline: "none", boxShadow: "none" }}
        spellCheck={false}
      />
    </Flex>
  );
}
