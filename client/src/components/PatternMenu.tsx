import { IconButton } from "@chakra-ui/react";
import { MenuContent, MenuItem, MenuRoot, MenuSeparator, MenuTrigger } from "./ui/menu";

interface PatternMenuProps {
  patternName: string;
  onRename: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

/**
 * Pattern action menu (⋮ dropdown)
 */
export function PatternMenu({ patternName, onRename, onDuplicate, onDelete }: PatternMenuProps) {
  return (
    <MenuRoot>
      <MenuTrigger asChild>
        <IconButton
          aria-label={`Menu for ${patternName}`}
          variant="ghost"
          size="xs"
          color="gray.500"
          _hover={{ color: "gray.700", bg: "gray.200" }}
          onClick={(e) => e.stopPropagation()}
        >
          ⋮
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
