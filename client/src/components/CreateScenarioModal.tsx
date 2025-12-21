import { CreateModal } from "./dialogs/CreateModal";

interface CreateScenarioModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (name: string) => void;
}

/**
 * New scenario creation modal
 */
export function CreateScenarioModal({ isOpen, onClose, onCreate }: CreateScenarioModalProps) {
  return (
    <CreateModal
      isOpen={isOpen}
      title="Create New Scenario"
      placeholder="Enter scenario name"
      onClose={onClose}
      onCreate={onCreate}
    />
  );
}
