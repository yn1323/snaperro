import { Button, Input } from "@chakra-ui/react";
import { useRef, useState } from "react";
import { DialogBody, DialogContent, DialogFooter, DialogHeader, DialogRoot, DialogTitle } from "../ui/dialog";

interface CreateModalProps {
  isOpen: boolean;
  title: string;
  placeholder: string;
  submitLabel?: string;
  onClose: () => void;
  onCreate: (name: string) => void;
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
  onClose,
  onCreate,
}: CreateModalProps) {
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleOpenChange = (details: { open: boolean }) => {
    if (details.open) {
      setName("");
    } else {
      onClose();
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim()) {
      onCreate(name.trim());
      onClose();
    }
  };

  return (
    <DialogRoot open={isOpen} onOpenChange={handleOpenChange} initialFocusEl={() => inputRef.current}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <DialogBody>
            <Input ref={inputRef} value={name} onChange={(e) => setName(e.target.value)} placeholder={placeholder} />
          </DialogBody>
          <DialogFooter gap={2}>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" colorPalette="blue" disabled={!name.trim()}>
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </DialogRoot>
  );
}
