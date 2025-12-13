import { Box, IconButton } from "@chakra-ui/react";
import { MenuContent, MenuItem, MenuRoot, MenuSeparator, MenuTrigger } from "./ui/menu";

interface FolderMenuProps {
  folderName: string;
  onRename: () => void;
  onDelete: () => void;
}

/**
 * Folder action menu (⋮ dropdown)
 */
export function FolderMenu({ folderName, onRename, onDelete }: FolderMenuProps) {
  return (
    <MenuRoot>
      <MenuTrigger asChild>
        <IconButton
          aria-label={`Menu for ${folderName}`}
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
