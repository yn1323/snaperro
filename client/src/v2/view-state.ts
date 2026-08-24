import type { FolderId, RecordingId, ScenarioId, ServerSnapshot } from "./contracts";

export type ResourceKind = "folder" | "scenario" | "recording";

export type ResourceRef =
  | { kind: "folder"; id: FolderId }
  | { kind: "scenario"; id: ScenarioId }
  | { kind: "recording"; id: RecordingId };

export type ViewDialogState =
  | { kind: "closed" }
  | { kind: "create-folder" }
  | { kind: "create-scenario"; folderId: FolderId }
  | { kind: "rename"; resource: ResourceRef }
  | { kind: "delete"; resource: ResourceRef };

export interface ViewState {
  scenarioContextId: ScenarioId | null;
  currentFolderId: FolderId | null;
  selectedRecordingId: RecordingId | null;
  searchQuery: string;
  dialog: ViewDialogState;
}

export type ViewStateAction =
  | { type: "server.reconciled"; snapshot: ServerSnapshot }
  | { type: "folder.selected"; folderId: FolderId }
  | { type: "folder.cleared" }
  | { type: "recording.selected"; recordingId: RecordingId | null }
  | { type: "search.changed"; query: string }
  | { type: "dialog.opened"; dialog: Exclude<ViewDialogState, { kind: "closed" }> }
  | { type: "dialog.closed" }
  | { type: "reset" };

export function createViewState(snapshot?: ServerSnapshot): ViewState {
  const currentScenario = snapshot?.currentScenarioId ? snapshot.scenarios[snapshot.currentScenarioId] : undefined;
  return {
    scenarioContextId: snapshot?.currentScenarioId ?? null,
    currentFolderId: currentScenario?.folderId ?? null,
    selectedRecordingId: null,
    searchQuery: "",
    dialog: { kind: "closed" },
  };
}

function resourceExists(snapshot: ServerSnapshot, resource: ResourceRef): boolean {
  switch (resource.kind) {
    case "folder":
      return Boolean(snapshot.folders[resource.id]);
    case "scenario":
      return Boolean(snapshot.scenarios[resource.id]);
    case "recording":
      // Recording membership is authoritative only in the paged list store.
      return true;
  }
}

function reconcileDialog(dialog: ViewDialogState, snapshot: ServerSnapshot): ViewDialogState {
  switch (dialog.kind) {
    case "closed":
    case "create-folder":
      return dialog;
    case "create-scenario":
      return snapshot.folders[dialog.folderId] ? dialog : { kind: "closed" };
    case "rename":
    case "delete":
      return resourceExists(snapshot, dialog.resource) ? dialog : { kind: "closed" };
  }
}

export function reconcileViewState(state: ViewState, snapshot: ServerSnapshot): ViewState {
  const scenarioChanged = state.scenarioContextId !== snapshot.currentScenarioId;
  const currentScenario = snapshot.currentScenarioId ? snapshot.scenarios[snapshot.currentScenarioId] : undefined;

  let currentFolderId = state.currentFolderId;
  if (scenarioChanged && currentScenario) {
    currentFolderId = currentScenario.folderId;
  } else if (currentFolderId && !snapshot.folders[currentFolderId]) {
    currentFolderId = currentScenario?.folderId ?? null;
  }

  return {
    scenarioContextId: snapshot.currentScenarioId,
    currentFolderId,
    selectedRecordingId: scenarioChanged ? null : state.selectedRecordingId,
    searchQuery: scenarioChanged ? "" : state.searchQuery,
    dialog: reconcileDialog(state.dialog, snapshot),
  };
}

/**
 * Reconciles catalog-owned selection without assuming that the bounded startup
 * snapshot contains paged recording metadata.
 */
export function reconcileCatalogViewState(state: ViewState, snapshot: ServerSnapshot): ViewState {
  const scenarioChanged = state.scenarioContextId !== snapshot.currentScenarioId;
  const currentScenario = snapshot.currentScenarioId ? snapshot.scenarios[snapshot.currentScenarioId] : undefined;

  let currentFolderId = state.currentFolderId;
  if (scenarioChanged && currentScenario) currentFolderId = currentScenario.folderId;
  else if (currentFolderId && !snapshot.folders[currentFolderId]) currentFolderId = currentScenario?.folderId ?? null;

  return {
    scenarioContextId: snapshot.currentScenarioId,
    currentFolderId,
    selectedRecordingId: scenarioChanged ? null : state.selectedRecordingId,
    searchQuery: scenarioChanged ? "" : state.searchQuery,
    dialog: reconcileDialog(state.dialog, snapshot),
  };
}

/** Clears a selected recording only after the paged recording store knows it is absent. */
export function reconcilePagedRecordingSelection(
  state: ViewState,
  scenarioId: ScenarioId | null,
  availableRecordingIds: ReadonlySet<RecordingId>,
): ViewState {
  if (state.scenarioContextId !== scenarioId) return { ...state, selectedRecordingId: null };
  if (state.selectedRecordingId && !availableRecordingIds.has(state.selectedRecordingId)) {
    return { ...state, selectedRecordingId: null };
  }
  return state;
}

export function reduceViewState(state: ViewState, action: ViewStateAction): ViewState {
  switch (action.type) {
    case "server.reconciled":
      return reconcileViewState(state, action.snapshot);
    case "folder.selected":
      return { ...state, currentFolderId: action.folderId };
    case "folder.cleared":
      return { ...state, currentFolderId: null };
    case "recording.selected":
      return { ...state, selectedRecordingId: action.recordingId };
    case "search.changed":
      return { ...state, searchQuery: action.query };
    case "dialog.opened":
      return { ...state, dialog: action.dialog };
    case "dialog.closed":
      return { ...state, dialog: { kind: "closed" } };
    case "reset":
      return createViewState();
    default: {
      const exhaustive: never = action;
      return exhaustive;
    }
  }
}
