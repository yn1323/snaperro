import { z } from "zod/v4";
import { type Problem, ProblemSchema } from "../../shared/contracts-v2/index.js";

const ProblemEnvelopeSchema = z.object({ error: ProblemSchema }).strict();

export type ErrorType = "network" | "no-pattern" | "no-mock" | "bad-gateway" | "unknown";

export interface ErrorInfo {
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
}

function createErrorInfo(
  type: ErrorType,
  url: string,
  status?: number,
  statusText?: string,
  problem?: Problem,
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
        details: baseDetails,
      };
    case "bad-gateway":
      return {
        type,
        title: "Upstream Server Error",
        message: "Could not connect to the target API.",
        action: "Check if the target server is available.",
        details: { ...baseDetails, rawMessage: problem?.message ?? rawMessage },
      };
    default:
      return {
        type: "unknown",
        title: "Request Failed",
        message: "An unexpected error occurred.",
        action: "Please try again or check the server logs.",
        details: { ...baseDetails, rawMessage: problem?.message ?? rawMessage },
      };
  }
}

export function networkErrorInfo(url: string, rawMessage: string): ErrorInfo {
  return createErrorInfo("network", url, undefined, undefined, undefined, rawMessage);
}

export function invalidJsonErrorInfo(url: string, status: number, statusText: string): ErrorInfo {
  return createErrorInfo("unknown", url, status, statusText, undefined, "Response is not valid JSON");
}

export function responseTooLargeErrorInfo(url: string, status: number, statusText: string, limit: number): ErrorInfo {
  return createErrorInfo(
    "unknown",
    url,
    status,
    statusText,
    undefined,
    `Error response exceeded the ${limit} byte demo preview limit`,
  );
}

export function problemErrorInfo(value: unknown, url: string, status: number, statusText: string): ErrorInfo {
  const envelope = ProblemEnvelopeSchema.safeParse(value);
  if (!envelope.success) {
    return createErrorInfo(
      "unknown",
      url,
      status,
      statusText,
      undefined,
      "Error response did not match the v2 Problem envelope",
    );
  }
  const problem = envelope.data.error;
  const field = typeof problem.details?.field === "string" ? problem.details.field : null;
  const entity = typeof problem.details?.entity === "string" ? problem.details.entity : null;

  if (problem.code === "INVALID_ARGUMENT" && field === "currentScenarioId") {
    return createErrorInfo("no-pattern", url, status, statusText, problem);
  }
  if (problem.code === "NOT_FOUND" && entity === "mock") {
    return createErrorInfo("no-mock", url, status, statusText, problem);
  }
  if (problem.code === "UPSTREAM_UNAVAILABLE") {
    return createErrorInfo("bad-gateway", url, status, statusText, problem);
  }
  return createErrorInfo("unknown", url, status, statusText, problem);
}
