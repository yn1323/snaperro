import { createContext, type ReactNode, useContext, useEffect, useMemo } from "react";

import { V2AppController } from "./app-controller";
import { useExternalStore } from "./external-store";

const V2AppContext = createContext<V2AppController | null>(null);

export interface V2AppProviderProps {
  children?: ReactNode;
  controller?: V2AppController;
}

export function V2AppProvider({ children, controller }: V2AppProviderProps) {
  const value = useMemo(() => controller ?? new V2AppController(), [controller]);

  useEffect(() => {
    value.start();
    return () => value.stop();
  }, [value]);

  return <V2AppContext.Provider value={value}>{children}</V2AppContext.Provider>;
}

export function useV2AppController(): V2AppController {
  const controller = useContext(V2AppContext);
  if (!controller) throw new Error("useV2AppController must be used inside V2AppProvider");
  return controller;
}

export function useV2ServerState() {
  const controller = useV2AppController();
  return useExternalStore(controller.server);
}

export function useV2ViewState() {
  const controller = useV2AppController();
  return useExternalStore(controller.view);
}

export function useV2RecordingList() {
  const controller = useV2AppController();
  return useExternalStore(controller.recordings);
}

export function useV2DocumentState() {
  const controller = useV2AppController();
  return useExternalStore(controller.document);
}

export function useV2DocumentBuffer() {
  const controller = useV2AppController();
  return useExternalStore(controller.documentBuffer);
}

export function useV2OperationState() {
  const controller = useV2AppController();
  return useExternalStore(controller.operation);
}

export function useV2RequestLogs() {
  const controller = useV2AppController();
  return useExternalStore(controller.logs);
}

export function useV2ControlTokenState() {
  const controller = useV2AppController();
  return useExternalStore(controller.auth);
}
