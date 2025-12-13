import { IconButton } from "@chakra-ui/react";
import { MenuContent, MenuItem, MenuRoot, MenuSeparator, MenuTrigger } from "./ui/menu";

interface FolderMenuProps {
  folderName: string;
  onRename: () => void;
  onDownload: () => void;
  onDelete: () => void;
}

/**
 * Folder action menu (⋮ dropdown)
 */
export function FolderMenu({ folderName, onRename, onDownload, onDelete }: FolderMenuProps) {
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
        <MenuItem value="download" onClick={onDownload}>
          Download ZIP
        </MenuItem>
        <MenuSeparator />
        <MenuItem value="delete" color="red.500" onClick={onDelete}>
          Delete
        </MenuItem>
      </MenuContent>
    </MenuRoot>
  );
}
