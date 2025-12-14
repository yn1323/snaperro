import { CreateModal } from "./dialogs/CreateModal";

interface CreateFolderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (name: string) => void;
}

/**
 * New folder creation modal
 */
export function CreateFolderModal({ isOpen, onClose, onCreate }: CreateFolderModalProps) {
  return (
    <CreateModal
      isOpen={isOpen}
      title="Create New Folder"
      placeholder="Enter folder name"
      onClose={onClose}
      onCreate={onCreate}
    />
  );
}
