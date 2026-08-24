import { Box, Button, Flex, Input, Text } from "@chakra-ui/react";
import { useEffect, useRef, useState } from "react";
import type { ControlTokenState } from "../../../client/src/v2/react/control-token-session";
import type { DemoControl } from "../control/demo-control";

export interface ControlTokenPromptProps {
  auth: ControlTokenState;
  control: DemoControl;
  open: boolean;
  onClose: () => void;
}

export function ControlTokenPrompt({ auth, control, open, onClose }: ControlTokenPromptProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [hasDraft, setHasDraft] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (inputRef.current) inputRef.current.value = "";
    setHasDraft(false);
    setValidationError(null);
    inputRef.current?.focus();
  }, [open]);

  if (!open) return null;

  const close = () => {
    if (!auth.required) onClose();
  };

  return (
    <Flex
      position="fixed"
      inset={0}
      zIndex={100}
      bg="blackAlpha.500"
      align="center"
      justify="center"
      px={4}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <Box
        as="form"
        role="dialog"
        aria-modal="true"
        aria-labelledby="demo-control-token-title"
        bg="white"
        borderRadius="xl"
        boxShadow="xl"
        maxW="md"
        w="full"
        p={5}
        onSubmit={(event) => {
          event.preventDefault();
          try {
            control.updateControlToken(inputRef.current?.value ?? "");
            onClose();
          } catch {
            setValidationError("Enter a valid control token.");
          }
        }}
      >
        <Text id="demo-control-token-title" fontWeight="600" fontSize="lg" mb={2}>
          Control token
        </Text>
        <Text
          mb={3}
          fontSize="sm"
          color={auth.required ? "red.700" : "gray.600"}
          role={auth.required ? "alert" : undefined}
        >
          {auth.required
            ? auth.hasToken
              ? "The current token was rejected. Enter a new control token to reconnect."
              : "This server requires a control token. Enter it to connect the demo."
            : "Enter a new control token, or reconnect with the token held by this page."}
        </Text>
        <Input
          ref={inputRef}
          type="password"
          autoComplete="off"
          aria-label="Demo control token"
          placeholder="Control token"
          onInput={(event) => {
            setHasDraft(event.currentTarget.value.trim().length > 0);
            if (validationError) setValidationError(null);
          }}
        />
        {validationError ? (
          <Text role="alert" mt={2} color="red.700" fontSize="xs">
            {validationError}
          </Text>
        ) : null}
        <Text mt={2} color="gray.500" fontSize="xs">
          The token is kept only in memory and is cleared when this page is reloaded, navigated away from, or closed.
        </Text>
        <Flex mt={5} justify="flex-end" gap={2} wrap="wrap">
          {!auth.required ? (
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          ) : null}
          {auth.hasToken ? (
            <Button
              type="button"
              colorPalette="red"
              variant="outline"
              onClick={() => {
                control.clearControlToken();
                onClose();
              }}
            >
              Clear and reconnect
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            disabled={!auth.hasToken}
            onClick={() => {
              control.reconnect();
              onClose();
            }}
          >
            Reconnect
          </Button>
          <Button type="submit" colorPalette="blue" disabled={!hasDraft}>
            Save and reconnect
          </Button>
        </Flex>
      </Box>
    </Flex>
  );
}
