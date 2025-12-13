import { Box, IconButton } from "@chakra-ui/react";
import { MenuContent, MenuItem, MenuRoot, MenuSeparator, MenuTrigger } from "./ui/menu";

interface PatternMenuProps {
  patternName: string;
  onRename: () => void;
  onDuplicate: () => void;
  onDownload: () => void;
  onDelete: () => void;
}

/**
 * Pattern action menu (⋮ dropdown)
 */
export function PatternMenu({ patternName, onRename, onDuplicate, onDownload, onDelete }: PatternMenuProps) {
  return (
    <MenuRoot>
      <MenuTrigger asChild>
        <IconButton
          aria-label={`Menu for ${patternName}`}
          variant="ghost"
          size="xs"
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
        <MenuItem value="download" onClick={onDownload}>
          Download ZIP
        </MenuItem>
        <MenuSeparator />
        <Box color="red.500">
          <MenuItem value="delete" onClick={onDelete}>
            Delete
          </MenuItem>
        </Box>
      </MenuContent>
    </MenuRoot>
  );
}
