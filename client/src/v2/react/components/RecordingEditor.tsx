import { Box, Button, Flex, HStack, Spinner, Text, Textarea } from "@chakra-ui/react";
import { useCallback, useRef, useState } from "react";
import { LuDownload, LuUpload } from "react-icons/lu";

import { ConfirmDialog } from "../../../components/dialogs/ConfirmDialog";
import {
  useV2AppController,
  useV2DocumentBuffer,
  useV2DocumentState,
  useV2OperationState,
  useV2ViewState,
} from "../app-provider";
import { findTextMatch } from "../text-search";
import { runUiAction } from "../ui-action";

export function RecordingEditor() {
  const controller = useV2AppController();
  const documentState = useV2DocumentState();
  const buffer = useV2DocumentBuffer();
  const operation = useV2OperationState();
  const view = useV2ViewState();
  const detachBufferRef = useRef<(() => void) | null>(null);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [searchNotice, setSearchNotice] = useState<{
    query: string;
    documentGeneration: number;
    message: string;
  } | null>(null);
  const contextBlocked = documentState.conflict !== null;
  const activeSearchNotice =
    searchNotice?.query === view.searchQuery && searchNotice.documentGeneration === buffer.generation
      ? searchNotice.message
      : null;

  const attachEditor = useCallback(
    (target: HTMLTextAreaElement | null) => {
      detachBufferRef.current?.();
      editorRef.current = target;
      detachBufferRef.current = target ? controller.documentBuffer.attach(target) : null;
    },
    [controller],
  );

  const uploadBody = (target: "request" | "response", event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void runUiAction(() => controller.uploadDocumentBody(target, file), `${target} body upload failed`);
  };

  const selectSearchMatch = (direction: "next" | "previous") => {
    const editor = editorRef.current;
    const query = view.searchQuery.trim();
    if (!editor || !query) return;
    const from = direction === "next" ? editor.selectionEnd : editor.selectionStart;
    const match = findTextMatch(editor.value, query, from, direction);
    if (!match) {
      setSearchNotice({
        query: view.searchQuery,
        documentGeneration: buffer.generation,
        message: "No match in the editable JSON. The result may match its filename or a detached body.",
      });
      return;
    }
    setSearchNotice(null);
    editor.focus();
    editor.setSelectionRange(match.start, match.end, direction === "next" ? "forward" : "backward");
  };

  if (!documentState.recordingId) {
    return (
      <Flex flex={1} bg="gray.50" align="center" justify="center">
        <Text color="gray.500" fontSize="sm">
          Select a recording
        </Text>
      </Flex>
    );
  }
  const recordingId = documentState.recordingId;

  if (documentState.phase === "loading") {
    return (
      <Flex flex={1} bg="gray.50" align="center" justify="center" gap={2}>
        <Spinner size="sm" />
        <Text color="gray.500" fontSize="sm">
          Loading recording...
        </Text>
      </Flex>
    );
  }

  return (
    <Flex flex={1} bg="white" direction="column" minW={0}>
      <Flex p={2} borderBottom="1px" borderColor="gray.200" bg="gray.50" align="center" justify="space-between" gap={2}>
        <HStack gap={2} minW={0}>
          <Text fontWeight="600" fontSize="sm" color="gray.700" truncate title={documentState.recording?.filename}>
            {documentState.recording?.filename ?? "Recording"}
          </Text>
          {buffer.dirty ? (
            <Text fontSize="xs" color="accent.600" flexShrink={0}>
              *Unsaved
            </Text>
          ) : null}
        </HStack>
        <HStack gap={1} flexWrap="wrap" justify="flex-end">
          {view.searchQuery.trim() ? (
            <>
              <Button size="xs" variant="ghost" onClick={() => selectSearchMatch("previous")}>
                Previous JSON match
              </Button>
              <Button size="xs" variant="ghost" onClick={() => selectSearchMatch("next")}>
                Next JSON match
              </Button>
            </>
          ) : null}
          <BodyActions
            target="request"
            onUpload={uploadBody}
            onDownload={() => controller.downloadDocumentBody("request")}
            uploadDisabled={documentState.saving || operation.pending || contextBlocked}
          />
          <BodyActions
            target="response"
            onUpload={uploadBody}
            onDownload={() => controller.downloadDocumentBody("response")}
            uploadDisabled={documentState.saving || operation.pending || contextBlocked}
          />
          <Button
            size="xs"
            variant="outline"
            onClick={() => controller.formatDocument()}
            disabled={documentState.saving}
          >
            Format
          </Button>
          <Button
            size="xs"
            bg="accent.500"
            color="white"
            disabled={!buffer.dirty || documentState.saving || operation.pending || contextBlocked}
            onClick={() => void runUiAction(() => controller.saveDocument(), "Recording save failed")}
          >
            {documentState.saving ? "Saving..." : "Save"}
          </Button>
          <Button
            size="xs"
            colorPalette="red"
            onClick={() => setDeleteOpen(true)}
            disabled={operation.pending || contextBlocked}
          >
            Delete
          </Button>
        </HStack>
      </Flex>

      {view.searchQuery.trim() ? (
        <Box
          px={3}
          py={1.5}
          bg="blue.50"
          color="blue.800"
          fontSize="xs"
          role={activeSearchNotice ? "status" : undefined}
        >
          {activeSearchNotice ??
            "Search includes filenames and unencoded request/response bodies. Match navigation scans the editable JSON only; download a body to inspect its bytes."}
        </Box>
      ) : null}

      {documentState.conflict ? (
        <Flex px={3} py={2} bg="orange.50" color="orange.800" fontSize="xs" align="center" gap={2} role="alert">
          <Text flex={1}>
            {documentState.conflict.kind === "deleted"
              ? "This recording was deleted on the server. Your local draft is still available here."
              : documentState.conflict.kind === "scenario-changed"
                ? "The active scenario changed on the server. Return to this draft's scenario before saving."
                : "This recording changed on the server. Reload it or keep editing this draft."}
          </Text>
          {documentState.conflict.kind === "updated" ? (
            <Button
              size="xs"
              variant="outline"
              disabled={documentState.saving || operation.pending}
              onClick={() => controller.reloadDocument()}
            >
              Reload
            </Button>
          ) : null}
          {documentState.conflict.kind === "updated" ? (
            <Button
              size="xs"
              variant="ghost"
              disabled={documentState.saving || operation.pending}
              onClick={() => controller.keepConflictedDraft()}
            >
              Keep draft
            </Button>
          ) : null}
          {documentState.conflict.kind === "scenario-changed" ? (
            <Button
              size="xs"
              variant="outline"
              onClick={() => void runUiAction(() => controller.returnToDocumentScenario(), "Scenario selection failed")}
            >
              Return to scenario
            </Button>
          ) : null}
        </Flex>
      ) : null}

      {buffer.parseError || documentState.error ? (
        <Box px={3} py={2} bg="red.50" color="red.700" fontSize="xs" role="alert">
          {buffer.parseError ?? documentState.error?.message}
        </Box>
      ) : null}

      <Textarea
        ref={attachEditor}
        flex={1}
        p={4}
        fontFamily="mono"
        fontSize="sm"
        lineHeight="1.5"
        resize="none"
        overflow="auto"
        bg="gray.50"
        border="none"
        borderRadius={0}
        spellCheck={false}
        aria-label="Recording JSON editor"
        onInput={() => controller.markDocumentChanged()}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
            event.preventDefault();
            if (buffer.dirty && !documentState.saving && !operation.pending && !contextBlocked) {
              void runUiAction(() => controller.saveDocument(), "Recording save failed");
            }
          }
        }}
      />

      <ConfirmDialog
        isOpen={deleteOpen}
        title="Delete Recording"
        message={`Delete recording "${documentState.recording?.filename ?? ""}"? This action cannot be undone.`}
        confirmDisabled={operation.pending}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => runUiAction(() => controller.deleteRecording(recordingId), "Delete failed")}
      />
      <ConfirmDialog
        isOpen={documentState.pendingRecordingId !== null || documentState.pendingScenarioId !== null}
        title="Discard unsaved changes?"
        message={
          documentState.pendingScenarioId
            ? "Switching scenarios will discard the current unsaved draft."
            : "Opening another recording will discard the current unsaved draft."
        }
        confirmLabel={documentState.pendingScenarioId ? "Discard and switch" : "Discard and open"}
        confirmDisabled={operation.pending}
        onClose={() => {
          controller.cancelDiscardAndOpen();
          controller.cancelDiscardAndSelectScenario();
        }}
        onConfirm={() => {
          if (documentState.pendingScenarioId) {
            return runUiAction(() => controller.confirmDiscardAndSelectScenario(), "Scenario selection failed");
          }
          return runUiAction(() => controller.confirmDiscardAndOpen(), "Recording selection failed");
        }}
      />
    </Flex>
  );
}

function BodyActions({
  target,
  onUpload,
  onDownload,
  uploadDisabled,
}: {
  target: "request" | "response";
  onUpload: (target: "request" | "response", event: React.ChangeEvent<HTMLInputElement>) => void;
  onDownload: () => void | Promise<void>;
  uploadDisabled: boolean;
}) {
  const label = target === "request" ? "Request" : "Response";
  return (
    <HStack gap={0}>
      <Button
        as="label"
        size="xs"
        variant="ghost"
        px={1}
        cursor="pointer"
        disabled={uploadDisabled}
        aria-label={`Upload ${target} body`}
        title={`Replace ${label.toLowerCase()} body`}
      >
        <LuUpload />
        <input type="file" hidden disabled={uploadDisabled} onChange={(event) => onUpload(target, event)} />
      </Button>
      <Button
        size="xs"
        variant="ghost"
        px={1}
        onClick={() => void runUiAction(() => Promise.resolve(onDownload()), `${label} body download failed`)}
        aria-label={`Download ${target} body`}
      >
        <LuDownload />
      </Button>
    </HStack>
  );
}
