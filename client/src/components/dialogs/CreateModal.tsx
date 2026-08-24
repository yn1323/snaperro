import { Button, Input } from "@chakra-ui/react";
import { useEffect, useRef, useState } from "react";
import { DialogBody, DialogContent, DialogFooter, DialogHeader, DialogRoot, DialogTitle } from "../ui/dialog";
import { createDialogActionGuard, type DialogActionGuard } from "./async-dialog-action";

interface CreateModalProps {
  isOpen: boolean;
  title: string;
  placeholder: string;
  submitLabel?: string;
  submitDisabled?: boolean;
  onClose: () => void;
  onCreate: (name: string) => boolean | Promise<boolean>;
}

/**
 * Generic create modal for creating named resources (patterns, folders, etc.)
 * Uses form submit to distinguish between IME conversion confirmation and submission
 */
export function CreateModal({
  isOpen,
  title,
  placeholder,
  submitLabel = "Create",
  submitDisabled = false,
  onClose,
  onCreate,
}: CreateModalProps) {
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const guard = useRef<DialogActionGuard | null>(null);
  guard.current ??= createDialogActionGuard();
  const blocked = submitDisabled || submitting;

  useEffect(() => {
    if (isOpen) setName("");
  }, [isOpen]);

  const handleClose = () => guard.current?.requestClose(onClose, submitDisabled);

  const handleOpenChange = (details: { open: boolean }) => {
    if (!details.open) handleClose();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || guard.current?.isPending() || submitDisabled) return;
    setSubmitting(true);
    void guard.current
      ?.run(() => onCreate(trimmed), onClose, submitDisabled)
      .finally(() => setSubmitting(false))
      .catch(() => undefined);
  };

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
              placeholder={placeholder}
              disabled={blocked}
            />
          </DialogBody>
          <DialogFooter gap={2}>
            <Button type="button" variant="outline" disabled={blocked} onClick={handleClose}>
              Cancel
            </Button>
            <Button type="submit" colorPalette="blue" disabled={!name.trim() || blocked}>
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </DialogRoot>
  );
}
