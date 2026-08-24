import { Button, Input } from "@chakra-ui/react";
import { useEffect, useRef, useState } from "react";
import { DialogBody, DialogContent, DialogFooter, DialogHeader, DialogRoot, DialogTitle } from "../ui/dialog";
import { createDialogActionGuard, type DialogActionGuard } from "./async-dialog-action";

interface RenameDialogProps {
  isOpen: boolean;
  currentName: string;
  title?: string;
  submitDisabled?: boolean;
  onClose: () => void;
  onSubmit: (newName: string) => boolean | Promise<boolean>;
}

/**
 * Rename dialog
 */
export function RenameDialog({
  isOpen,
  currentName,
  title = "Rename Pattern",
  submitDisabled = false,
  onClose,
  onSubmit,
}: RenameDialogProps) {
  const [name, setName] = useState(currentName);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const guard = useRef<DialogActionGuard | null>(null);
  guard.current ??= createDialogActionGuard();
  const blocked = submitDisabled || submitting;

  // Sync name with currentName when dialog opens
  useEffect(() => {
    if (isOpen) {
      setName(currentName);
      const timer = setTimeout(() => {
        inputRef.current?.select();
      }, 50);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [isOpen, currentName]);

  const handleClose = () => guard.current?.requestClose(onClose, submitDisabled);

  const handleOpenChange = (details: { open: boolean }) => {
    if (!details.open) handleClose();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || trimmed === currentName || guard.current?.isPending() || submitDisabled) return;
    setSubmitting(true);
    void guard.current
      ?.run(() => onSubmit(trimmed), onClose, submitDisabled)
      .finally(() => setSubmitting(false))
      .catch(() => undefined);
  };

  const isValid = name.trim() && name.trim() !== currentName;

  return (
    <DialogRoot open={isOpen} onOpenChange={handleOpenChange} initialFocusEl={() => inputRef.current}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <DialogBody>
            <Input
              ref={inputRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter new pattern name"
              disabled={blocked}
            />
          </DialogBody>
          <DialogFooter gap={2}>
            <Button type="button" variant="outline" disabled={blocked} onClick={handleClose}>
              Cancel
            </Button>
            <Button type="submit" colorPalette="blue" disabled={!isValid || blocked}>
              Rename
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </DialogRoot>
  );
}
