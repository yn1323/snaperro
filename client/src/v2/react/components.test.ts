import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { createDialogActionGuard } from "../../components/dialogs/async-dialog-action";
import { ConfirmDialog } from "../../components/dialogs/ConfirmDialog";
import { MockModeGuideCard, MockModeTip } from "../../components/dialogs/ModeHelpDialog";
import { Provider } from "../../components/ui/provider";
import { RecordingSchema, RequestIdSchema, RevisionSchema } from "../contracts";
import { ids } from "../test-fixtures";
import { V2AppController } from "./app-controller";
import { V2AppProvider } from "./app-provider";
import { createRecordingDocumentState, createRecordingListState } from "./app-state";
import { ControlTokenDialog } from "./components/ControlTokenDialog";
import { RecordingEditor } from "./components/RecordingEditor";
import { RecordingPane } from "./components/RecordingPane";
import { RequestLogPanel } from "./components/RequestLogPanel";

const recording = RecordingSchema.parse({
  id: ids.recording,
  scenarioId: ids.scenario,
  filename: "users.json",
  route: "/users",
  method: "GET",
  requestFingerprint: "a".repeat(64),
  request: { pathParams: {}, query: [], headers: [], body: null },
  response: { status: 200, statusText: "OK", headers: [], body: null },
  revision: 3,
  createdAt: "2026-08-24T00:00:00.000Z",
  updatedAt: "2026-08-24T00:00:00.000Z",
});

describe("v2 React components", () => {
  it("blocks cancel, overlay close, and duplicate dialog actions until the asynchronous action succeeds", async () => {
    let settle!: (successful: boolean) => void;
    const result = new Promise<boolean>((resolve) => {
      settle = resolve;
    });
    const guard = createDialogActionGuard();
    const onClose = vi.fn();
    const onConfirm = vi.fn(() => result);

    const confirmation = guard.run(onConfirm, onClose);
    guard.requestClose(onClose);
    guard.requestClose(onClose);
    await guard.run(onConfirm, onClose);
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
    settle(true);
    await confirmation;
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("keeps a confirmation open when its asynchronous action fails", async () => {
    const guard = createDialogActionGuard();
    const onClose = vi.fn();

    await guard.run(async () => false, onClose);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("disables both confirmation actions and close paths while its parent is blocked", async () => {
    const guard = createDialogActionGuard();
    const onClose = vi.fn();
    const onConfirm = vi.fn(async () => true);
    guard.requestClose(onClose, true);
    await guard.run(onConfirm, onClose, true);
    expect(onClose).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();

    const markup = renderToStaticMarkup(
      createElement(
        Provider,
        null,
        createElement(ConfirmDialog, {
          isOpen: true,
          title: "Delete recording",
          message: "Delete this recording?",
          confirmDisabled: true,
          onClose: () => undefined,
          onConfirm: async () => true,
        }),
      ),
    );

    expect(markup.match(/disabled=""/gu)).toHaveLength(2);
  });

  it("describes Mock mode hits, configured miss fallbacks, and the strict offline condition", () => {
    const markup = renderToStaticMarkup(
      createElement(
        Provider,
        null,
        createElement("div", null, createElement(MockModeGuideCard), createElement(MockModeTip)),
      ),
    );

    expect(markup).toContain("Saved response on hit; configured fallback on miss");
    expect(markup).toContain("Saved response");
    expect(markup).toContain("Configured fallback");
    expect(markup).toContain("404 / proxy / proxy&amp;record");
    expect(markup).toContain("Only fallback 404 guarantees offline use and no real");
    expect(markup).not.toContain("Strict mock-only responses");
  });

  it("renders the recording editor with accessible controls and no test-only selectors", () => {
    const controller = new V2AppController();
    controller.document.set({
      ...createRecordingDocumentState(),
      recordingId: recording.id,
      phase: "ready",
      recording,
    });
    controller.documentBuffer.load("{}");

    const markup = renderToStaticMarkup(
      createElement(Provider, null, createElement(V2AppProvider, { controller }, createElement(RecordingEditor))),
    );

    expect(markup).toContain('aria-label="Recording JSON editor"');
    expect(markup).toContain('aria-label="Upload request body"');
    expect(markup).toContain('aria-label="Download response body"');
    expect(markup).not.toContain("data-testid");
  });

  it("distinguishes server body search from navigation inside editable JSON", () => {
    const controller = new V2AppController();
    controller.document.set({
      ...createRecordingDocumentState(),
      recordingId: recording.id,
      phase: "ready",
      recording,
      observedContentRevision: recording.revision,
    });
    controller.documentBuffer.load("{}");
    controller.setSearchQuery("detached-body-match");

    const markup = renderToStaticMarkup(
      createElement(Provider, null, createElement(V2AppProvider, { controller }, createElement(RecordingEditor))),
    );

    expect(markup).toContain("Previous JSON match");
    expect(markup).toContain("Search includes filenames and unencoded request/response bodies");
    expect(markup).toContain("Match navigation scans the editable JSON only");
  });

  it("renders an unauthorized token prompt without rendering the stored secret", () => {
    const token = "component-private-token";
    const controller = new V2AppController();
    controller.auth.setToken(token);
    controller.auth.requireToken();

    const markup = renderToStaticMarkup(
      createElement(
        Provider,
        null,
        createElement(ControlTokenDialog, {
          controller,
          auth: controller.auth.getSnapshot(),
          isOpen: true,
          onClose: () => undefined,
        }),
      ),
    );

    expect(markup).toContain('aria-label="Control token"');
    expect(markup).toContain("The stored token was rejected");
    expect(markup).toContain("kept only in memory");
    expect(markup).toContain("Save and reconnect");
    expect(markup).not.toContain(token);
    expect(markup).not.toContain("data-testid");
  });

  it("keeps JSON import and exposes the recording ZIP import as separate accessible actions", () => {
    const controller = new V2AppController();
    controller.recordings.set({
      ...createRecordingListState(),
      scenarioId: ids.scenario,
      scenarioRevision: RevisionSchema.parse(5),
      status: "ready",
      items: [],
    });

    const markup = renderToStaticMarkup(
      createElement(
        Provider,
        null,
        createElement(V2AppProvider, { controller }, createElement(RecordingPane, { width: 300 })),
      ),
    );

    expect(markup).toContain('aria-label="Import recording JSON"');
    expect(markup).toContain('accept=".json,application/json"');
    expect(markup).toContain('aria-label="Import recording ZIP"');
    expect(markup).toContain('accept=".zip,application/zip"');
    expect(markup).not.toContain("data-testid");
  });

  it("distinguishes a mock match from a saved recording in the request log", () => {
    const controller = new V2AppController();
    controller.logs.set({
      entries: [
        {
          kind: "completed",
          id: RequestIdSchema.parse("req_aaaaaaaaaaaaaaaa"),
          timestamp: "2026-08-24T00:00:00.000Z",
          method: "GET",
          path: "/users",
          action: "mock",
          status: 200,
          matchedRecordingId: ids.recording,
          recordingOutcome: { state: "not-attempted" },
          durationMs: 12,
        },
      ],
    });

    const markup = renderToStaticMarkup(
      createElement(Provider, null, createElement(V2AppProvider, { controller }, createElement(RequestLogPanel))),
    );

    expect(markup).toContain("matched");
    expect(markup).not.toContain("saved");

    controller.logs.set({
      entries: [
        {
          ...controller.logs.getSnapshot().entries[0],
          matchedRecordingId: undefined,
          recordingOutcome: { state: "saved", recordingId: ids.recording },
        },
      ],
    });
    const savedMarkup = renderToStaticMarkup(
      createElement(Provider, null, createElement(V2AppProvider, { controller }, createElement(RequestLogPanel))),
    );
    expect(savedMarkup).toContain("saved");
    expect(savedMarkup).not.toContain("matched");
  });

  it("renders the safe capture failure detail on the correlated request row", () => {
    const controller = new V2AppController();
    controller.logs.set({
      entries: [
        {
          kind: "completed",
          id: RequestIdSchema.parse("req_bbbbbbbbbbbbbbbb"),
          timestamp: "2026-08-24T00:00:00.000Z",
          method: "POST",
          path: "/users",
          action: "record",
          status: 201,
          recordingOutcome: {
            state: "failed",
            problem: { code: "INTERNAL", message: "Recording could not be saved", retryable: false },
          },
          durationMs: 15,
        },
      ],
    });

    const markup = renderToStaticMarkup(
      createElement(Provider, null, createElement(V2AppProvider, { controller }, createElement(RequestLogPanel))),
    );

    expect(markup).toContain("failed: Recording could not be saved");
  });
});
