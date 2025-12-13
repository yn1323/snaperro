import { Button, Text } from "@chakra-ui/react";
import { DialogBody, DialogContent, DialogFooter, DialogHeader, DialogRoot, DialogTitle } from "../ui/dialog";

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  onClose: () => void;
  onConfirm: () => void;
}

/**
 * Generic confirmation dialog
 */
export function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmLabel = "Delete",
  onClose,
  onConfirm,
}: ConfirmDialogProps) {
  const handleConfirm = () => {
    onConfirm();
    onClose();
  };

  return (
    <DialogRoot role="alertdialog" open={isOpen} onOpenChange={(e) => !e.open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <Text fontSize="sm" color="gray.600">
            {message}
          </Text>
        </DialogBody>
        <DialogFooter gap={2}>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button colorPalette="red" onClick={handleConfirm}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </DialogRoot>
  );
}
