import { CreateModal } from "./dialogs/CreateModal";

interface CreatePatternModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (name: string) => void;
}

/**
 * New pattern creation modal
 */
export function CreatePatternModal({ isOpen, onClose, onCreate }: CreatePatternModalProps) {
  return (
    <CreateModal
      isOpen={isOpen}
      title="Create New Pattern"
      placeholder="Enter pattern name"
      onClose={onClose}
      onCreate={onCreate}
    />
  );
}
