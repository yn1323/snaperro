import { Button, Input } from "@chakra-ui/react";
import { useEffect, useRef, useState } from "react";
import { DialogBody, DialogContent, DialogFooter, DialogHeader, DialogRoot, DialogTitle } from "../ui/dialog";

interface RenameDialogProps {
  isOpen: boolean;
  currentName: string;
  title?: string;
  onClose: () => void;
  onSubmit: (newName: string) => void;
}

/**
 * Rename dialog
 */
export function RenameDialog({ isOpen, currentName, title = "Rename Pattern", onClose, onSubmit }: RenameDialogProps) {
  const [name, setName] = useState(currentName);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync name with currentName when dialog opens
  useEffect(() => {
    if (isOpen) {
      setName(currentName);
      setTimeout(() => {
        inputRef.current?.select();
      }, 50);
    }
  }, [isOpen, currentName]);

  const handleOpenChange = (details: { open: boolean }) => {
    if (!details.open) {
      onClose();
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed && trimmed !== currentName) {
      onSubmit(trimmed);
      onClose();
    }
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
            />
          </DialogBody>
          <DialogFooter gap={2}>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" colorPalette="blue" disabled={!isValid}>
              Rename
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </DialogRoot>
  );
}
