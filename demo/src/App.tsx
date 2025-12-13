import { Box, Flex } from "@chakra-ui/react";
import { useCallback, useState } from "react";
import { GuidePanel } from "./components/GuidePanel";
import { Header } from "./components/Header";
import type { Mode } from "./components/ModeSelector";
import { ResponsePanel } from "./components/ResponsePanel";
import { ScenarioGrid } from "./components/ScenarioGrid";
import { scenarios } from "./scenarios";

const API_BASE = "/__snaperro__";

type RequestInfo = {
  url: string;
  method: string;
};

type ResponseInfo = {
  status: number;
  body: unknown;
};

export type ErrorType = "network" | "no-pattern" | "no-mock" | "bad-gateway" | "unknown";

export type ErrorInfo = {
  type: ErrorType;
  title: string;
  message: string;
  action: string;
  details: {
    url: string;
    status?: number;
    statusText?: string;
    endpoint?: string;
    rawMessage?: string;
  };
};

function createErrorInfo(
  type: ErrorType,
  url: string,
  status?: number,
  statusText?: string,
  // biome-ignore lint/suspicious/noExplicitAny: API response type varies
  responseBody?: any,
  rawMessage?: string,
): ErrorInfo {
  const baseDetails = { url, status, statusText, rawMessage };

  switch (type) {
    case "network":
      return {
        type,
        title: "Connection Failed",
        message: "Could not connect to snaperro server.",
        action: "Make sure the server is running: npx snaperro start",
        details: baseDetails,
      };
    case "no-pattern":
      return {
        type,
        title: "No Pattern Selected",
        message: "Please select a pattern in the GUI first.",
        action: "Click [Open GUI] to select a pattern.",
        details: baseDetails,
      };
    case "no-mock":
      return {
        type,
        title: "No Matching Mock Found",
        message: "No mock data exists for this request.",
        action: "Try [Record] mode first to save the response, or create a mock file in the GUI.",
        details: {
          ...baseDetails,
          endpoint: responseBody?.endpoint,
        },
      };
    case "bad-gateway":
      return {
        type,
        title: "Upstream Server Error",
        message: "Could not connect to the target API.",
        action: "Check if the target server is available.",
        details: {
          ...baseDetails,
          rawMessage: responseBody?.message || rawMessage,
        },
      };
    default:
      return {
        type: "unknown",
        title: "Request Failed",
        message: "An unexpected error occurred.",
        action: "Please try again or check the server logs.",
        details: baseDetails,
      };
  }
}

export default function App() {
  const [mode, setMode] = useState<Mode>("proxy");
  const [isLoading, setIsLoading] = useState(false);
  const [currentRequest, setCurrentRequest] = useState<RequestInfo | null>(null);
  const [response, setResponse] = useState<ResponseInfo | null>(null);
  const [error, setError] = useState<ErrorInfo | null>(null);

  const handleModeChange = useCallback(async (newMode: Mode) => {
    setMode(newMode);
    try {
      await fetch(`${API_BASE}/mode`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: newMode }),
      });
    } catch (err) {
      console.error("Failed to sync mode:", err);
    }
  }, []);

  const handleExecute = useCallback(async (url: string, method: string, requestBody?: unknown) => {
    setIsLoading(true);
    setError(null);
    setCurrentRequest({ url, method });
    setResponse(null);

    try {
      const res = await fetch(url, {
        method,
        headers: requestBody ? { "Content-Type": "application/json" } : undefined,
        body: requestBody ? JSON.stringify(requestBody) : undefined,
      });

      let body: unknown = null;
      if (res.status !== 304 && res.status !== 204) {
        try {
          body = await res.json();
        } catch {
          setError(createErrorInfo("unknown", url, res.status, res.statusText, null, "Response is not valid JSON"));
          return;
        }
      }

      if (!res.ok) {
        const responseBody = body as { error?: string; endpoint?: string; message?: string };

        if (res.status === 400 && responseBody.error === "No pattern selected") {
          setError(createErrorInfo("no-pattern", url, res.status, res.statusText, responseBody));
        } else if (res.status === 404 && responseBody.error === "No matching mock found") {
          setError(createErrorInfo("no-mock", url, res.status, res.statusText, responseBody));
        } else if (res.status === 502 && responseBody.error === "Bad Gateway") {
          setError(createErrorInfo("bad-gateway", url, res.status, res.statusText, responseBody));
        } else {
          setError(createErrorInfo("unknown", url, res.status, res.statusText, responseBody, responseBody.error));
        }
        return;
      }

      setResponse({
        status: res.status,
        body,
      });
    } catch (err) {
      const rawMessage = err instanceof Error ? err.message : "Unknown error";
      setError(createErrorInfo("network", url, undefined, undefined, null, rawMessage));
    } finally {
      setIsLoading(false);
    }
  }, []);

  return (
    <Flex h="100vh" direction="column" bg="gray.50">
      <Header mode={mode} onModeChange={handleModeChange} isLoading={isLoading} />
      <Flex flex={1} minH={0}>
        <Flex as="aside" w="320px" borderRight="1px" borderColor="gray.200" direction="column" bg="white">
          <ScenarioGrid scenarios={scenarios} onExecute={handleExecute} isLoading={isLoading} />
          <GuidePanel mode={mode} />
        </Flex>
        <Box as="main" flex={1} p={4} minW={0} bg="gray.100">
          <ResponsePanel request={currentRequest} response={response} mode={mode} isLoading={isLoading} error={error} />
        </Box>
      </Flex>
    </Flex>
  );
}
