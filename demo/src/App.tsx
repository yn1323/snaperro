import { Box, Flex } from "@chakra-ui/react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ControlTokenPrompt } from "./components/ControlTokenPrompt";
import { GuidePanel } from "./components/GuidePanel";
import { Header } from "./components/Header";
import type { Mode } from "./components/ModeSelector";
import { ResponsePanel } from "./components/ResponsePanel";
import { ScenarioGrid } from "./components/ScenarioGrid";
import { DemoControl } from "./control/demo-control";
import { executeDemoTraffic, LatestExecution } from "./demo-execution";
import type { ResponsePreview } from "./response-preview";
import { scenarios } from "./scenarios";
import { type ErrorInfo, networkErrorInfo } from "./traffic-errors";

interface RequestInfo {
  url: string;
  method: string;
}

interface ResponseInfo {
  status: number;
  preview: ResponsePreview;
}

export interface DemoAppProps {
  control?: DemoControl;
  fetch?: typeof globalThis.fetch;
}

export default function App({ control: providedControl, fetch: providedFetch }: DemoAppProps = {}) {
  const control = useMemo(() => providedControl ?? new DemoControl(), [providedControl]);
  const trafficFetch = useRef(providedFetch ?? globalThis.fetch.bind(globalThis));
  const latestExecution = useRef(new LatestExecution());
  const controlState = useSyncExternalStore(
    control.state.subscribe,
    control.state.getSnapshot,
    control.state.getSnapshot,
  );
  const auth = useSyncExternalStore(control.auth.subscribe, control.auth.getSnapshot, control.auth.getSnapshot);
  const [tokenOpen, setTokenOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [currentRequest, setCurrentRequest] = useState<RequestInfo | null>(null);
  const [response, setResponse] = useState<ResponseInfo | null>(null);
  const [error, setError] = useState<ErrorInfo | null>(null);

  useEffect(() => {
    control.start();
    return () => {
      latestExecution.current.cancel();
      control.stop();
    };
  }, [control]);

  const handleModeChange = useCallback(
    (mode: Mode) => {
      void control.setMode(mode).catch(() => undefined);
    },
    [control],
  );

  const handleExecute = useCallback(async (url: string, method: string, requestBody?: unknown) => {
    setIsLoading(true);
    setError(null);
    setCurrentRequest({ url, method });
    setResponse(null);
    await latestExecution.current.run(
      (signal) => executeDemoTraffic(trafficFetch.current, url, method, requestBody, signal),
      {
        onSuccess: (outcome) => {
          setResponse(outcome.response);
          setError(outcome.error);
        },
        onError: (requestError) => {
          setError(networkErrorInfo(url, requestError instanceof Error ? requestError.message : "Unknown error"));
        },
        onSettled: () => setIsLoading(false),
      },
    );
  }, []);

  return (
    <Flex h="100vh" direction="column" bg="gray.50">
      <Header
        mode={controlState.mode}
        onModeChange={handleModeChange}
        isLoading={isLoading || controlState.changingMode}
        connection={controlState.connection}
        controlError={controlState.error?.message ?? null}
        hasControlToken={auth.hasToken}
        onControlTokenClick={() => setTokenOpen(true)}
      />
      <Flex flex={1} minH={0}>
        <Flex as="aside" w="320px" borderRight="1px" borderColor="gray.200" direction="column" bg="white">
          <ScenarioGrid scenarios={scenarios} onExecute={handleExecute} isLoading={isLoading} />
          <GuidePanel mode={controlState.mode} />
        </Flex>
        <Box as="main" flex={1} p={4} minW={0} bg="gray.100">
          <ResponsePanel
            request={currentRequest}
            response={response}
            mode={controlState.mode}
            isLoading={isLoading}
            error={error}
          />
        </Box>
      </Flex>
      <ControlTokenPrompt
        control={control}
        auth={auth}
        open={tokenOpen || auth.required}
        onClose={() => setTokenOpen(false)}
      />
    </Flex>
  );
}
