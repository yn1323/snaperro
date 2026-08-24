import { Box, Button, Flex, Text } from "@chakra-ui/react";
import { useMemo, useState } from "react";
import { LuBox, LuChevronLeft, LuFolder, LuFolderPlus, LuPlus, LuUpload } from "react-icons/lu";

import { CreateFolderModal } from "../../../components/CreateFolderModal";
import { CreateScenarioModal } from "../../../components/CreateScenarioModal";
import { ConfirmDialog } from "../../../components/dialogs/ConfirmDialog";
import { RenameDialog } from "../../../components/dialogs/RenameDialog";
import { FolderMenu } from "../../../components/FolderMenu";
import { ScenarioMenu } from "../../../components/ScenarioMenu";
import type { FolderId, FolderSummary, ScenarioId, ScenarioSummary } from "../../contracts";
import { useV2AppController, useV2OperationState, useV2ServerState, useV2ViewState } from "../app-provider";
import { runUiAction } from "../ui-action";

interface CatalogPaneProps {
  width: number;
}

type RenameTarget =
  | { kind: "folder"; id: FolderId; name: string }
  | { kind: "scenario"; id: ScenarioId; name: string }
  | null;

type DeleteTarget = RenameTarget;

export function CatalogPane({ width }: CatalogPaneProps) {
  const controller = useV2AppController();
  const { realtime } = useV2ServerState();
  const view = useV2ViewState();
  const operation = useV2OperationState();
  const snapshot = realtime.snapshot;
  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [createScenarioOpen, setCreateScenarioOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<RenameTarget>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);

  const folders = useMemo(
    () => Object.values(snapshot?.folders ?? {}).sort((left, right) => left.name.localeCompare(right.name)),
    [snapshot?.folders],
  );
  const scenarios = useMemo(
    () => Object.values(snapshot?.scenarios ?? {}).sort((left, right) => left.name.localeCompare(right.name)),
    [snapshot?.scenarios],
  );
  const currentFolder = view.currentFolderId ? snapshot?.folders[view.currentFolderId] : undefined;
  const visibleScenarios = currentFolder ? scenarios.filter((scenario) => scenario.folderId === currentFolder.id) : [];

  const importFolder = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void runUiAction(() => controller.importFolder(file), "Folder import failed");
  };

  const scenarioCount = (folder: FolderSummary) =>
    scenarios.filter((scenario) => scenario.folderId === folder.id).length;

  const rename = (name: string): Promise<boolean> => {
    if (!renameTarget) return Promise.resolve(false);
    const action =
      renameTarget.kind === "folder"
        ? () => controller.renameFolder(renameTarget.id, name)
        : () => controller.renameScenario(renameTarget.id, name);
    return runUiAction(action, "Rename failed");
  };

  const remove = (): Promise<boolean> => {
    if (!deleteTarget) return Promise.resolve(false);
    const action =
      deleteTarget.kind === "folder"
        ? () => controller.deleteFolder(deleteTarget.id)
        : () => controller.deleteScenario(deleteTarget.id);
    return runUiAction(action, "Delete failed");
  };

  return (
    <Flex w={`${width}px`} bg="gray.50" borderRight="1px" borderColor="gray.200" direction="column" flexShrink={0}>
      <Flex p={2} borderBottom="1px" borderColor="gray.200" bg="gray.100" align="center" justify="space-between">
        {!currentFolder ? (
          <>
            <Text fontWeight="600" fontSize="sm" color="gray.700">
              Folders
            </Text>
            <Flex gap={1}>
              <Button
                variant="ghost"
                size="xs"
                p={1}
                minW="24px"
                h="24px"
                color="gray.500"
                disabled={operation.pending}
                onClick={() => setCreateFolderOpen(true)}
                aria-label="Create folder"
              >
                <LuFolderPlus size={16} />
              </Button>
              <Button
                as="label"
                variant="ghost"
                size="xs"
                p={1}
                minW="24px"
                h="24px"
                color="gray.500"
                cursor="pointer"
                aria-label="Import folder ZIP"
                disabled={operation.pending}
              >
                <LuUpload size={16} />
                <input
                  type="file"
                  accept=".zip,application/zip"
                  onChange={importFolder}
                  disabled={operation.pending}
                  hidden
                />
              </Button>
            </Flex>
          </>
        ) : (
          <>
            <Flex align="center" gap={1} flex={1} minW={0}>
              <Button
                variant="ghost"
                size="sm"
                px={2}
                minW="28px"
                h="24px"
                onClick={() => controller.selectFolder(null)}
                aria-label="Back to folders"
              >
                <LuChevronLeft size={18} />
              </Button>
              <Text fontWeight="600" fontSize="sm" color="gray.700" truncate>
                {currentFolder.name}
              </Text>
            </Flex>
            <Button
              variant="ghost"
              size="xs"
              p={1}
              minW="24px"
              h="24px"
              color="gray.500"
              disabled={operation.pending}
              onClick={() => setCreateScenarioOpen(true)}
              aria-label="Create scenario"
            >
              <LuPlus size={16} />
            </Button>
          </>
        )}
      </Flex>

      <Box flex={1} overflowY="auto">
        {!currentFolder ? (
          folders.length ? (
            folders.map((folder) => (
              <FolderRow
                key={folder.id}
                folder={folder}
                scenariosCount={scenarioCount(folder)}
                onOpen={() => controller.selectFolder(folder.id)}
                onRename={() => setRenameTarget({ kind: "folder", id: folder.id, name: folder.name })}
                onExport={() => void runUiAction(() => controller.exportFolder(folder.id), "Folder export failed")}
                onDelete={() => setDeleteTarget({ kind: "folder", id: folder.id, name: folder.name })}
              />
            ))
          ) : (
            <EmptyLabel>No folders</EmptyLabel>
          )
        ) : visibleScenarios.length ? (
          visibleScenarios.map((scenario) => (
            <ScenarioRow
              key={scenario.id}
              scenario={scenario}
              selected={snapshot?.currentScenarioId === scenario.id}
              disabled={operation.pending}
              onSelect={() =>
                void runUiAction(() => controller.selectScenario(scenario.id), "Scenario selection failed")
              }
              onRename={() => setRenameTarget({ kind: "scenario", id: scenario.id, name: scenario.name })}
              onDuplicate={() =>
                void runUiAction(() => controller.duplicateScenario(scenario.id), "Scenario duplication failed")
              }
              onDelete={() => setDeleteTarget({ kind: "scenario", id: scenario.id, name: scenario.name })}
            />
          ))
        ) : (
          <EmptyLabel>No scenarios</EmptyLabel>
        )}
      </Box>

      <CreateFolderModal
        isOpen={createFolderOpen}
        submitDisabled={operation.pending}
        onClose={() => setCreateFolderOpen(false)}
        onCreate={(name) => runUiAction(() => controller.createFolder(name), "Folder creation failed")}
      />
      <CreateScenarioModal
        isOpen={createScenarioOpen}
        submitDisabled={operation.pending}
        onClose={() => setCreateScenarioOpen(false)}
        onCreate={(name) => {
          if (!currentFolder) return Promise.resolve(false);
          return runUiAction(() => controller.createScenario(currentFolder.id, name), "Scenario creation failed");
        }}
      />
      <RenameDialog
        isOpen={renameTarget !== null}
        currentName={renameTarget?.name ?? ""}
        title={renameTarget?.kind === "folder" ? "Rename Folder" : "Rename Scenario"}
        submitDisabled={operation.pending}
        onClose={() => setRenameTarget(null)}
        onSubmit={rename}
      />
      <ConfirmDialog
        isOpen={deleteTarget !== null}
        title={deleteTarget?.kind === "folder" ? "Delete Folder" : "Delete Scenario"}
        message={
          deleteTarget?.kind === "folder"
            ? `Delete folder "${deleteTarget.name}" and every scenario inside? This action cannot be undone.`
            : `Delete scenario "${deleteTarget?.name ?? ""}"? This action cannot be undone.`
        }
        confirmDisabled={operation.pending}
        onClose={() => setDeleteTarget(null)}
        onConfirm={remove}
      />
    </Flex>
  );
}

function EmptyLabel({ children }: { children: string }) {
  return (
    <Text p={3} fontSize="xs" color="gray.500" textAlign="center">
      {children}
    </Text>
  );
}

function FolderRow({
  folder,
  scenariosCount,
  onOpen,
  onRename,
  onExport,
  onDelete,
}: {
  folder: FolderSummary;
  scenariosCount: number;
  onOpen: () => void;
  onRename: () => void;
  onExport: () => void;
  onDelete: () => void;
}) {
  return (
    <Flex align="center" _hover={{ bg: "gray.100" }}>
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
        borderRadius={0}
        onClick={onOpen}
        gap={2}
      >
        <LuFolder color="#f59e0b" size={16} />
        <Text truncate flex={1} textAlign="left">
          {folder.name}
        </Text>
        <Text fontSize="xs" color="gray.500">
          ({scenariosCount})
        </Text>
      </Button>
      <Box pr={1}>
        <FolderMenu folderName={folder.name} onRename={onRename} onDownload={onExport} onDelete={onDelete} />
      </Box>
    </Flex>
  );
}

function ScenarioRow({
  scenario,
  selected,
  disabled,
  onSelect,
  onRename,
  onDuplicate,
  onDelete,
}: {
  scenario: ScenarioSummary;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
  onRename: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  return (
    <Flex
      align="center"
      bg={selected ? "accent.100" : undefined}
      borderLeft="4px solid"
      borderLeftColor={selected ? "accent.500" : "transparent"}
      _hover={{ bg: selected ? "accent.100" : "gray.100" }}
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
        fontWeight={selected ? "semibold" : "normal"}
        color={selected ? "accent.700" : "gray.700"}
        borderRadius={0}
        disabled={disabled}
        onClick={onSelect}
        gap={2}
      >
        <LuBox color={selected ? "#10b981" : "#06b6d4"} size={16} />
        <Text truncate>{scenario.name}</Text>
      </Button>
      <Box pr={1}>
        <ScenarioMenu scenarioName={scenario.name} onRename={onRename} onDuplicate={onDuplicate} onDelete={onDelete} />
      </Box>
    </Flex>
  );
}
