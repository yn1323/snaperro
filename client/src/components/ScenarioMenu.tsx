import { IconButton } from "@chakra-ui/react";
import { MenuContent, MenuItem, MenuRoot, MenuSeparator, MenuTrigger } from "./ui/menu";

interface ScenarioMenuProps {
  scenarioName: string;
  onRename: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

/**
 * Scenario action menu (... dropdown)
 */
export function ScenarioMenu({ scenarioName, onRename, onDuplicate, onDelete }: ScenarioMenuProps) {
  return (
    <MenuRoot>
      <MenuTrigger asChild>
        <IconButton
          aria-label={`Menu for ${scenarioName}`}
          variant="ghost"
          size="xs"
          color="gray.500"
          _hover={{ color: "gray.700", bg: "gray.200" }}
          onClick={(e) => e.stopPropagation()}
        >
          ...
        </IconButton>
      </MenuTrigger>
      <MenuContent>
        <MenuItem value="rename" onClick={onRename}>
          Rename
        </MenuItem>
        <MenuItem value="duplicate" onClick={onDuplicate}>
          Duplicate
        </MenuItem>
        <MenuSeparator />
        <MenuItem value="delete" color="red.500" onClick={onDelete}>
          Delete
        </MenuItem>
      </MenuContent>
    </MenuRoot>
  );
}
