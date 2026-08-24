import { Button, Input, Text } from "@chakra-ui/react";
import { useEffect, useRef, useState } from "react";

import {
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogRoot,
  DialogTitle,
} from "../../../components/ui/dialog";
import type { V2AppController } from "../app-controller";
import type { ControlTokenState } from "../control-token-session";

interface ControlTokenDialogProps {
  controller: V2AppController;
  auth: ControlTokenState;
  isOpen: boolean;
  onClose: () => void;
}

export function ControlTokenDialog({ controller, auth, isOpen, onClose }: ControlTokenDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [hasDraft, setHasDraft] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    if (inputRef.current) inputRef.current.value = "";
    setHasDraft(false);
    setValidationError(null);
  }, [isOpen]);

  const save = () => {
    const value = inputRef.current?.value ?? "";
    try {
      controller.updateControlToken(value);
      onClose();
    } catch {
      setValidationError("Enter a valid control token.");
    }
  };

  const clear = () => {
    controller.clearControlToken();
    onClose();
  };

  return (
    <DialogRoot
      open={isOpen}
      onOpenChange={(details) => !details.open && onClose()}
      initialFocusEl={() => inputRef.current}
    >
      <DialogContent portalled={false}>
        <DialogHeader>
          <DialogTitle>Control token</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <Text
            mb={3}
            fontSize="sm"
            color={auth.required ? "red.700" : "gray.600"}
            role={auth.required ? "alert" : undefined}
          >
            {auth.required
              ? auth.hasToken
                ? "The stored token was rejected. Enter a new control token and reconnect."
                : "This server requires a control token. Enter it to connect."
              : "Enter a new control token, or reconnect with the token already held by this page."}
          </Text>
          <Input
            ref={inputRef}
            type="password"
            autoComplete="off"
            aria-label="Control token"
            placeholder="Control token"
            onInput={(event) => {
              setHasDraft(event.currentTarget.value.trim().length > 0);
              if (validationError) setValidationError(null);
            }}
          />
          {validationError ? (
            <Text mt={2} fontSize="xs" color="red.700" role="alert">
              {validationError}
            </Text>
          ) : null}
          <Text mt={2} fontSize="xs" color="gray.500">
            The token is kept only in memory and is cleared when this page is reloaded, navigated away from, or closed.
          </Text>
        </DialogBody>
        <DialogFooter gap={2}>
          {!auth.required ? (
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          ) : null}
          {auth.hasToken ? (
            <Button colorPalette="red" variant="outline" onClick={clear}>
              Clear and reconnect
            </Button>
          ) : null}
          <Button
            variant="outline"
            onClick={() => {
              controller.reconnect();
              onClose();
            }}
            disabled={!auth.hasToken}
          >
            Reconnect
          </Button>
          <Button colorPalette="blue" onClick={save} disabled={!hasDraft}>
            Save and reconnect
          </Button>
        </DialogFooter>
      </DialogContent>
    </DialogRoot>
  );
}
