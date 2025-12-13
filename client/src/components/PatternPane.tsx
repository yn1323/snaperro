import { Box, Button, Flex, Text, VStack } from "@chakra-ui/react";
import { useState } from "react";
import { CreatePatternModal } from "./CreatePatternModal";
import { ConfirmDialog } from "./dialogs/ConfirmDialog";
import { RenameDialog } from "./dialogs/RenameDialog";
import { PatternMenu } from "./PatternMenu";

interface PatternPaneProps {
  patterns: string[];
  currentPattern: string | null;
  onSelect: (pattern: string) => void;
  onCreate: (name: string) => void;
  onUpload: (file: File) => void;
  onRename: (oldName: string, newName: string) => void;
  onDuplicate: (name: string) => void;
  onDownload: (name: string) => void;
  onDelete: (name: string) => void;
}

/**
 * Left pane - Pattern list
 * Width: 150px fixed
 */
export function PatternPane({
  patterns,
  currentPattern,
  onSelect,
  onCreate,
  onUpload,
  onRename,
  onDuplicate,
  onDownload,
  onDelete,
}: PatternPaneProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onUpload(file);
      e.target.value = "";
    }
  };

  const handleRename = (newName: string) => {
    if (renameTarget) {
      onRename(renameTarget, newName);
    }
  };

  const handleDelete = () => {
    if (deleteTarget) {
      onDelete(deleteTarget);
    }
  };

  return (
    <Flex w="150px" bg="gray.50" borderRight="1px" borderColor="gray.200" direction="column" flexShrink={0}>
      <Box p={2} borderBottom="1px" borderColor="gray.200" bg="gray.100">
        <Text fontWeight="600" fontSize="sm" color="gray.700">
          Patterns
        </Text>
      </Box>

      <Box flex={1} overflowY="auto">
        {patterns.length === 0 ? (
          <Text p={3} fontSize="xs" color="gray.500" textAlign="center">
            No patterns
          </Text>
        ) : (
          patterns.map((pattern) => {
            const isSelected = currentPattern === pattern;
            return (
              <Flex
                key={pattern}
                alignItems="center"
                bg={isSelected ? "accent.50" : undefined}
                borderLeft="2px"
                borderColor={isSelected ? "accent.500" : "transparent"}
                _hover={{ bg: isSelected ? "accent.50" : "gray.100" }}
                transition="all 0.15s ease"
              >
                <Button
                  variant="ghost"
                  flex={1}
                  px={2}
                  py={1.5}
                  h="auto"
                  justifyContent="flex-start"
                  fontSize="sm"
                  fontWeight="normal"
                  color={isSelected ? "accent.700" : "gray.700"}
                  onClick={() => onSelect(pattern)}
                  title={pattern}
                  borderRadius={0}
                  _hover={{ bg: "transparent" }}
                >
                  <Text truncate>{pattern}</Text>
                </Button>
                <Box pr={1}>
                  <PatternMenu
                    patternName={pattern}
                    onRename={() => setRenameTarget(pattern)}
                    onDuplicate={() => onDuplicate(pattern)}
                    onDownload={() => onDownload(pattern)}
                    onDelete={() => setDeleteTarget(pattern)}
                  />
                </Box>
              </Flex>
            );
          })
        )}
      </Box>

      <VStack p={2} borderTop="1px" borderColor="gray.200" gap={1}>
        <Button
          size="xs"
          bg="accent.500"
          color="white"
          w="full"
          onClick={() => setIsModalOpen(true)}
          _hover={{ bg: "accent.600" }}
          transition="all 0.15s ease"
        >
          + New
        </Button>
        <Button
          as="label"
          size="xs"
          bg="gray.200"
          color="gray.700"
          w="full"
          cursor="pointer"
          _hover={{ bg: "gray.300" }}
          transition="all 0.15s ease"
        >
          Import ZIP
          <input type="file" accept=".zip" onChange={handleFileUpload} hidden />
        </Button>
      </VStack>

      <CreatePatternModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onCreate={onCreate} />

      <RenameDialog
        isOpen={renameTarget !== null}
        currentName={renameTarget || ""}
        onClose={() => setRenameTarget(null)}
        onSubmit={handleRename}
      />

      <ConfirmDialog
        isOpen={deleteTarget !== null}
        title="Delete Pattern"
        message={`Delete pattern "${deleteTarget}"? This action cannot be undone.`}
        confirmLabel="Delete"
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
      />
    </Flex>
  );
}
