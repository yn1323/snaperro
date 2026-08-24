import { CreateModal } from "./dialogs/CreateModal";

interface CreateFolderModalProps {
  isOpen: boolean;
  submitDisabled?: boolean;
  onClose: () => void;
  onCreate: (name: string) => boolean | Promise<boolean>;
}

/**
 * New folder creation modal
 */
export function CreateFolderModal({ isOpen, submitDisabled, onClose, onCreate }: CreateFolderModalProps) {
  return (
    <CreateModal
      isOpen={isOpen}
      title="Create New Folder"
      placeholder="Enter folder name"
      submitDisabled={submitDisabled}
      onClose={onClose}
      onCreate={onCreate}
    />
  );
}
