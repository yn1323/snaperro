import { Box, Button, Flex, Text, VStack } from "@chakra-ui/react";
import { useMemo, useState } from "react";
import { LuBox, LuChevronLeft, LuFolder, LuUpload } from "react-icons/lu";
import type { FolderInfo } from "../types";
import { CreateFolderModal } from "./CreateFolderModal";
import { CreateScenarioModal } from "./CreateScenarioModal";
import { ConfirmDialog } from "./dialogs/ConfirmDialog";
import { RenameDialog } from "./dialogs/RenameDialog";
import { FolderMenu } from "./FolderMenu";
import { ScenarioMenu } from "./ScenarioMenu";

interface ScenarioPaneProps {
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
  // Scenario
  scenarios: string[];
  currentScenario: string | null;
  onSelect: (scenario: string) => void;
  onCreate: (name: string) => void;
  onRename: (oldName: string, newName: string) => void;
  onDuplicate: (name: string) => void;
  onDelete: (name: string) => void;
}

/**
 * Left pane - Folder/Scenario list with navigation
 * Width: resizable
 */
export function ScenarioPane({
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
  scenarios,
  currentScenario,
  onSelect,
  onCreate,
  onRename,
  onDuplicate,
  onDelete,
}: ScenarioPaneProps) {
  // Scenario modal/dialog state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  // Folder modal/dialog state
  const [isFolderModalOpen, setIsFolderModalOpen] = useState(false);
  const [folderRenameTarget, setFolderRenameTarget] = useState<string | null>(null);
  const [folderDeleteTarget, setFolderDeleteTarget] = useState<string | null>(null);

  // Filter scenarios for current folder
  const filteredScenarios = useMemo(() => {
    if (!currentFolder) return [];
    const prefix = `${currentFolder}/`;
    return scenarios.filter((p) => p.startsWith(prefix)).map((p) => p.substring(prefix.length));
  }, [scenarios, currentFolder]);

  const handleFolderZipUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onFolderUpload(file);
      e.target.value = "";
    }
  };

  const handleScenarioRename = (newName: string) => {
    if (renameTarget) {
      onRename(renameTarget, newName);
    }
  };

  const handleScenarioDelete = () => {
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
                    ({folder.scenariosCount})
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
        ) : // Scenario list
        filteredScenarios.length === 0 ? (
          <Text p={3} fontSize="xs" color="gray.500" textAlign="center">
            No scenarios
          </Text>
        ) : (
          filteredScenarios.map((scenario) => {
            const fullName = `${currentFolder}/${scenario}`;
            const isSelected = currentScenario === fullName;
            return (
              <Flex
                key={scenario}
                alignItems="center"
                bg={isSelected ? "accent.100" : undefined}
                borderLeft={isSelected ? "4px solid" : "4px solid transparent"}
                borderLeftColor={isSelected ? "accent.500" : "transparent"}
                _hover={{ bg: isSelected ? "accent.100" : "gray.100" }}
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
                  fontWeight={isSelected ? "semibold" : "normal"}
                  color={isSelected ? "accent.700" : "gray.700"}
                  onClick={() => onSelect(fullName)}
                  title={fullName}
                  borderRadius={0}
                  _hover={{ bg: "transparent" }}
                  gap={2}
                >
                  <LuBox color={isSelected ? "#10b981" : "#06b6d4"} size={16} />
                  <Text truncate>{scenario}</Text>
                </Button>
                <Box pr={1}>
                  <ScenarioMenu
                    scenarioName={scenario}
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
              <LuBox size={14} /> New Scenario
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

      {/* Scenario modals/dialogs */}
      <CreateScenarioModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onCreate={onCreate} />

      <RenameDialog
        isOpen={renameTarget !== null}
        currentName={renameTarget?.split("/").pop() || ""}
        title="Rename Scenario"
        onClose={() => setRenameTarget(null)}
        onSubmit={handleScenarioRename}
      />

      <ConfirmDialog
        isOpen={deleteTarget !== null}
        title="Delete Scenario"
        message={`Delete scenario "${deleteTarget?.split("/").pop()}"? This action cannot be undone.`}
        confirmLabel="Delete"
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleScenarioDelete}
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
        message={`Delete folder "${folderDeleteTarget}" and all scenarios inside? This action cannot be undone.`}
        confirmLabel="Delete"
        onClose={() => setFolderDeleteTarget(null)}
        onConfirm={handleFolderDelete}
      />
    </Flex>
  );
}
