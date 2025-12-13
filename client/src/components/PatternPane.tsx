import { Box, Button, Flex, Text, VStack } from "@chakra-ui/react";
import { useMemo, useState } from "react";
import { LuBox, LuChevronLeft, LuFolder, LuUpload } from "react-icons/lu";
import type { FolderInfo } from "../types";
import { CreateFolderModal } from "./CreateFolderModal";
import { CreatePatternModal } from "./CreatePatternModal";
import { ConfirmDialog } from "./dialogs/ConfirmDialog";
import { RenameDialog } from "./dialogs/RenameDialog";
import { FolderMenu } from "./FolderMenu";
import { PatternMenu } from "./PatternMenu";

interface PatternPaneProps {
  width: number;
  // Folder
  folders: FolderInfo[];
  currentFolder: string | null;
  onFolderSelect: (folder: string) => void;
  onFolderBack: () => void;
  onFolderCreate: (name: string) => void;
  onFolderRename: (oldName: string, newName: string) => void;
  onFolderDownload: (name: string) => void;
  onFolderUpload: (file: File) => void;
  onFolderDelete: (name: string) => void;
  // Pattern
  patterns: string[];
  currentPattern: string | null;
  onSelect: (pattern: string) => void;
  onCreate: (name: string) => void;
  onRename: (oldName: string, newName: string) => void;
  onDuplicate: (name: string) => void;
  onDelete: (name: string) => void;
}

/**
 * Left pane - Folder/Pattern list with navigation
 * Width: resizable
 */
export function PatternPane({
  width,
  folders,
  currentFolder,
  onFolderSelect,
  onFolderBack,
  onFolderCreate,
  onFolderRename,
  onFolderDownload,
  onFolderUpload,
  onFolderDelete,
  patterns,
  currentPattern,
  onSelect,
  onCreate,
  onRename,
  onDuplicate,
  onDelete,
}: PatternPaneProps) {
  // Pattern modal/dialog state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  // Folder modal/dialog state
  const [isFolderModalOpen, setIsFolderModalOpen] = useState(false);
  const [folderRenameTarget, setFolderRenameTarget] = useState<string | null>(null);
  const [folderDeleteTarget, setFolderDeleteTarget] = useState<string | null>(null);

  // Filter patterns for current folder
  const filteredPatterns = useMemo(() => {
    if (!currentFolder) return [];
    const prefix = `${currentFolder}/`;
    return patterns.filter((p) => p.startsWith(prefix)).map((p) => p.substring(prefix.length));
  }, [patterns, currentFolder]);

  const handleFolderZipUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onFolderUpload(file);
      e.target.value = "";
    }
  };

  const handlePatternRename = (newName: string) => {
    if (renameTarget) {
      onRename(renameTarget, newName);
    }
  };

  const handlePatternDelete = () => {
    if (deleteTarget) {
      onDelete(deleteTarget);
    }
  };

  const handleFolderRename = (newName: string) => {
    if (folderRenameTarget) {
      onFolderRename(folderRenameTarget, newName);
    }
  };

  const handleFolderDelete = () => {
    if (folderDeleteTarget) {
      onFolderDelete(folderDeleteTarget);
    }
  };

  return (
    <Flex w={`${width}px`} bg="gray.50" borderRight="1px" borderColor="gray.200" direction="column" flexShrink={0}>
      {/* Header */}
      <Box p={2} borderBottom="1px" borderColor="gray.200" bg="gray.100">
        {currentFolder === null ? (
          <Text fontWeight="600" fontSize="sm" color="gray.700">
            Folders
          </Text>
        ) : (
          <Flex alignItems="center" gap={1}>
            <Button
              variant="ghost"
              size="sm"
              px={2}
              minW="32px"
              h="28px"
              onClick={onFolderBack}
              _hover={{ bg: "gray.200" }}
              aria-label="Back to folders"
            >
              <LuChevronLeft size={20} />
            </Button>
            <Text fontWeight="600" fontSize="sm" color="gray.700" truncate>
              {currentFolder}
            </Text>
          </Flex>
        )}
      </Box>

      {/* List */}
      <Box flex={1} overflowY="auto">
        {currentFolder === null ? (
          // Folder list
          folders.length === 0 ? (
            <Text p={3} fontSize="xs" color="gray.500" textAlign="center">
              No folders
            </Text>
          ) : (
            folders.map((folder) => (
              <Flex key={folder.name} alignItems="center" _hover={{ bg: "gray.100" }} transition="all 0.15s ease">
                <Button
                  variant="ghost"
                  flex={1}
                  pl={3}
                  pr={2}
                  py={1.5}
                  h="auto"
                  justifyContent="flex-start"
                  fontSize="sm"
                  fontWeight="normal"
                  color="gray.700"
                  onClick={() => onFolderSelect(folder.name)}
                  title={folder.name}
                  borderRadius={0}
                  _hover={{ bg: "transparent" }}
                  gap={2}
                >
                  <LuFolder color="#f59e0b" size={16} />
                  <Text truncate flex={1} textAlign="left">
                    {folder.name}
                  </Text>
                  <Text fontSize="xs" color="gray.500">
                    ({folder.patternsCount})
                  </Text>
                </Button>
                <Box pr={1}>
                  <FolderMenu
                    folderName={folder.name}
                    onRename={() => setFolderRenameTarget(folder.name)}
                    onDownload={() => onFolderDownload(folder.name)}
                    onDelete={() => setFolderDeleteTarget(folder.name)}
                  />
                </Box>
              </Flex>
            ))
          )
        ) : // Pattern list
        filteredPatterns.length === 0 ? (
          <Text p={3} fontSize="xs" color="gray.500" textAlign="center">
            No patterns
          </Text>
        ) : (
          filteredPatterns.map((pattern) => {
            const fullName = `${currentFolder}/${pattern}`;
            const isSelected = currentPattern === fullName;
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
                  pl={3}
                  pr={2}
                  py={1.5}
                  h="auto"
                  justifyContent="flex-start"
                  fontSize="sm"
                  fontWeight="normal"
                  color={isSelected ? "accent.700" : "gray.700"}
                  onClick={() => onSelect(fullName)}
                  title={fullName}
                  borderRadius={0}
                  _hover={{ bg: "transparent" }}
                  gap={2}
                >
                  <LuBox color="#06b6d4" size={16} />
                  <Text truncate>{pattern}</Text>
                </Button>
                <Box pr={1}>
                  <PatternMenu
                    patternName={pattern}
                    onRename={() => setRenameTarget(fullName)}
                    onDuplicate={() => onDuplicate(fullName)}
                    onDelete={() => setDeleteTarget(fullName)}
                  />
                </Box>
              </Flex>
            );
          })
        )}
      </Box>

      {/* Bottom actions */}
      <VStack p={2} borderTop="1px" borderColor="gray.200" gap={1}>
        <Button
          size="xs"
          bg="accent.500"
          color="white"
          w="full"
          onClick={() => (currentFolder === null ? setIsFolderModalOpen(true) : setIsModalOpen(true))}
          _hover={{ bg: "accent.600" }}
          transition="all 0.15s ease"
          gap={1}
        >
          {currentFolder === null ? (
            <>
              <LuFolder size={14} /> New Folder
            </>
          ) : (
            <>
              <LuBox size={14} /> New Pattern
            </>
          )}
        </Button>
        {currentFolder === null && (
          <Button
            as="label"
            size="xs"
            bg="gray.200"
            color="gray.700"
            w="full"
            cursor="pointer"
            _hover={{ bg: "gray.300" }}
            transition="all 0.15s ease"
            gap={1}
          >
            <LuUpload size={14} /> Import Folder ZIP
            <input type="file" accept=".zip" onChange={handleFolderZipUpload} hidden />
          </Button>
        )}
      </VStack>

      {/* Pattern modals/dialogs */}
      <CreatePatternModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onCreate={onCreate} />

      <RenameDialog
        isOpen={renameTarget !== null}
        currentName={renameTarget?.split("/").pop() || ""}
        title="Rename Pattern"
        onClose={() => setRenameTarget(null)}
        onSubmit={handlePatternRename}
      />

      <ConfirmDialog
        isOpen={deleteTarget !== null}
        title="Delete Pattern"
        message={`Delete pattern "${deleteTarget?.split("/").pop()}"? This action cannot be undone.`}
        confirmLabel="Delete"
        onClose={() => setDeleteTarget(null)}
        onConfirm={handlePatternDelete}
      />

      {/* Folder modals/dialogs */}
      <CreateFolderModal
        isOpen={isFolderModalOpen}
        onClose={() => setIsFolderModalOpen(false)}
        onCreate={onFolderCreate}
      />

      <RenameDialog
        isOpen={folderRenameTarget !== null}
        currentName={folderRenameTarget || ""}
        title="Rename Folder"
        onClose={() => setFolderRenameTarget(null)}
        onSubmit={handleFolderRename}
      />

      <ConfirmDialog
        isOpen={folderDeleteTarget !== null}
        title="Delete Folder"
        message={`Delete folder "${folderDeleteTarget}" and all patterns inside? This action cannot be undone.`}
        confirmLabel="Delete"
        onClose={() => setFolderDeleteTarget(null)}
        onConfirm={handleFolderDelete}
      />
    </Flex>
  );
}
