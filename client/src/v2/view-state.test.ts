import { describe, expect, it } from "vitest";

import { parseServerSnapshot } from "./contracts";
import { ids, snapshotAt } from "./test-fixtures";
import {
  createViewState,
  reconcileCatalogViewState,
  reconcilePagedRecordingSelection,
  reduceViewState,
} from "./view-state";

describe("view state reducer", () => {
  it("follows the authoritative scenario and clears scenario-scoped view state", () => {
    const initial = snapshotAt(1);
    let state = createViewState(initial);
    state = reduceViewState(state, { type: "recording.selected", recordingId: ids.recording });
    state = reduceViewState(state, { type: "search.changed", query: "users" });

    const changed = parseServerSnapshot({
      ...initial,
      revision: 2,
      currentScenarioId: ids.otherScenario,
      folders: {
        ...initial.folders,
        [ids.otherFolder]: { id: ids.otherFolder, name: "Other Folder" },
      },
      scenarios: {
        ...initial.scenarios,
        [ids.otherScenario]: {
          id: ids.otherScenario,
          folderId: ids.otherFolder,
          name: "Other Scenario",
        },
      },
    });
    state = reduceViewState(state, { type: "server.reconciled", snapshot: changed });

    expect(state.scenarioContextId).toBe(ids.otherScenario);
    expect(state.currentFolderId).toBe(ids.otherFolder);
    expect(state.selectedRecordingId).toBeNull();
    expect(state.searchQuery).toBe("");
  });

  it("preserves recording state until the paged store observes a deletion", () => {
    const snapshot = snapshotAt(1);
    let state = createViewState(snapshot);
    state = reduceViewState(state, { type: "recording.selected", recordingId: ids.recording });
    state = reduceViewState(state, {
      type: "dialog.opened",
      dialog: { kind: "delete", resource: { kind: "recording", id: ids.recording } },
    });

    state = reduceViewState(state, {
      type: "server.reconciled",
      snapshot: parseServerSnapshot({ ...snapshot, revision: 2 }),
    });

    expect(state.selectedRecordingId).toBe(ids.recording);
    expect(state.dialog).toEqual({ kind: "delete", resource: { kind: "recording", id: ids.recording } });
    expect(state.currentFolderId).toBe(ids.folder);
  });

  it("closes create dialogs whose parent folder disappeared", () => {
    const snapshot = snapshotAt(1);
    let state = createViewState(snapshot);
    state = reduceViewState(state, {
      type: "dialog.opened",
      dialog: { kind: "create-scenario", folderId: ids.folder },
    });

    const empty = parseServerSnapshot({
      ...snapshot,
      revision: 2,
      currentScenarioId: null,
      folders: {},
      scenarios: {},
    });
    state = reduceViewState(state, { type: "server.reconciled", snapshot: empty });

    expect(state.currentFolderId).toBeNull();
    expect(state.dialog).toEqual({ kind: "closed" });
  });

  it("preserves a paged recording selection across bounded catalog snapshots", () => {
    const bounded = snapshotAt(1);
    let state = createViewState(bounded);
    state = reduceViewState(state, { type: "recording.selected", recordingId: ids.recording });

    state = reconcileCatalogViewState(state, parseServerSnapshot({ ...bounded, revision: 2, mode: "record" }));
    expect(state.selectedRecordingId).toBe(ids.recording);

    state = reconcilePagedRecordingSelection(state, ids.scenario, new Set());
    expect(state.selectedRecordingId).toBeNull();
  });

  it("does not replace local folder navigation on unrelated server events", () => {
    const initial = parseServerSnapshot({
      ...snapshotAt(1),
      folders: {
        ...snapshotAt(1).folders,
        [ids.otherFolder]: { id: ids.otherFolder, name: "Other Folder" },
      },
    });
    let state = createViewState(initial);
    state = reduceViewState(state, { type: "folder.selected", folderId: ids.otherFolder });

    state = reconcileCatalogViewState(state, parseServerSnapshot({ ...initial, revision: 2, mode: "record" }));

    expect(state.currentFolderId).toBe(ids.otherFolder);
  });
});
