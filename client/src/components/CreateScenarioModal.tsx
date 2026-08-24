import { CreateModal } from "./dialogs/CreateModal";

interface CreateScenarioModalProps {
  isOpen: boolean;
  submitDisabled?: boolean;
  onClose: () => void;
  onCreate: (name: string) => boolean | Promise<boolean>;
}

/**
 * New scenario creation modal
 */
export function CreateScenarioModal({ isOpen, submitDisabled, onClose, onCreate }: CreateScenarioModalProps) {
  return (
    <CreateModal
      isOpen={isOpen}
      title="Create New Scenario"
      placeholder="Enter scenario name"
      submitDisabled={submitDisabled}
      onClose={onClose}
      onCreate={onCreate}
    />
  );
}
