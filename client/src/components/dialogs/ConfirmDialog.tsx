import { Button, Text } from "@chakra-ui/react";
import { useRef, useState } from "react";
import { DialogBody, DialogContent, DialogFooter, DialogHeader, DialogRoot, DialogTitle } from "../ui/dialog";
import { createDialogActionGuard, type DialogActionGuard } from "./async-dialog-action";

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  confirmDisabled?: boolean;
  onClose: () => void;
  onConfirm: () => boolean | Promise<boolean>;
}

/**
 * Generic confirmation dialog
 */
export function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmLabel = "Delete",
  confirmDisabled = false,
  onClose,
  onConfirm,
}: ConfirmDialogProps) {
  const guard = useRef<DialogActionGuard | null>(null);
  guard.current ??= createDialogActionGuard();
  const [confirming, setConfirming] = useState(false);
  const blocked = confirmDisabled || confirming;
  const handleClose = () => guard.current?.requestClose(onClose, confirmDisabled);
  const handleConfirm = () => {
    if (guard.current?.isPending() || confirmDisabled) return;
    setConfirming(true);
    void guard.current
      ?.run(onConfirm, onClose, confirmDisabled)
      .finally(() => setConfirming(false))
      .catch(() => undefined);
  };

  return (
    <DialogRoot role="alertdialog" open={isOpen} onOpenChange={(e) => !e.open && handleClose()}>
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
          <Button variant="outline" disabled={blocked} onClick={handleClose}>
            Cancel
          </Button>
          <Button colorPalette="red" disabled={blocked} onClick={handleConfirm}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </DialogRoot>
  );
}
