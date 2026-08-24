import { useState } from "react";

import { ModeHelpDialog } from "../../components/dialogs/ModeHelpDialog";
import { Layout } from "../../components/Layout";
import { TopBar } from "../../components/TopBar";
import { Toaster } from "../../components/ui/toaster";
import { useFavicon } from "../../hooks/useFavicon";
import { useV2AppController, useV2ControlTokenState, useV2OperationState, useV2ServerState } from "./app-provider";
import { CatalogPane } from "./components/CatalogPane";
import { ControlTokenDialog } from "./components/ControlTokenDialog";
import { RecordingEditor } from "./components/RecordingEditor";
import { RecordingPane } from "./components/RecordingPane";
import { RequestLogPanel } from "./components/RequestLogPanel";
import { runUiAction } from "./ui-action";

export function V2App() {
  const controller = useV2AppController();
  const server = useV2ServerState();
  const operation = useV2OperationState();
  const auth = useV2ControlTokenState();
  const [helpOpen, setHelpOpen] = useState(false);
  const [tokenOpen, setTokenOpen] = useState(false);
  const snapshot = server.realtime.snapshot;
  const connected = server.connection === "connected";
  const favicon = !connected ? "⚠️" : snapshot?.mode === "record" ? "🔴" : snapshot?.mode === "proxy" ? "🌐" : "🐕";
  useFavicon(favicon);

  return (
    <>
      <Layout
        topBar={
          <TopBar
            version={snapshot?.version ?? ""}
            mode={snapshot?.mode ?? "smart"}
            connected={connected}
            currentScenario={snapshot?.currentScenarioId ?? null}
            disabled={!snapshot || operation.pending}
            connectionLabel={operation.label ?? connectionLabel(server.connection)}
            connectionError={server.error?.message ?? null}
            hasControlToken={auth.hasToken}
            onControlTokenClick={() => setTokenOpen(true)}
            onModeChange={(mode) => void runUiAction(() => controller.setMode(mode), "Mode change failed")}
            onHelpClick={() => setHelpOpen(true)}
          />
        }
        scenarioPane={(width) => <CatalogPane width={width} />}
        filePane={(width) => <RecordingPane width={width} />}
        editorPane={<RecordingEditor />}
        logPanel={<RequestLogPanel />}
      />
      <ModeHelpDialog isOpen={helpOpen} onClose={() => setHelpOpen(false)} />
      <ControlTokenDialog
        controller={controller}
        auth={auth}
        isOpen={tokenOpen || auth.required}
        onClose={() => setTokenOpen(false)}
      />
      <Toaster />
    </>
  );
}

function connectionLabel(connection: string): string {
  switch (connection) {
    case "connected":
      return "Connected";
    case "connecting":
      return "Connecting...";
    case "reconnecting":
      return "Reconnecting...";
    case "resyncing":
      return "Resyncing...";
    default:
      return "Disconnected";
  }
}
