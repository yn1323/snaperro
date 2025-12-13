import { Button, Input } from "@chakra-ui/react";
import { useRef, useState } from "react";
import { DialogBody, DialogContent, DialogFooter, DialogHeader, DialogRoot, DialogTitle } from "./ui/dialog";

interface CreatePatternModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (name: string) => void;
}

/**
 * New pattern creation modal
 * Uses form submit to distinguish between IME conversion confirmation and submission
 */
export function CreatePatternModal({ isOpen, onClose, onCreate }: CreatePatternModalProps) {
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
          <DialogTitle>Create New Pattern</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <DialogBody>
            <Input
              ref={inputRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter pattern name"
            />
          </DialogBody>
          <DialogFooter gap={2}>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" colorPalette="blue" disabled={!name.trim()}>
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </DialogRoot>
  );
}
