import { describe, expect, it } from "vitest";
import { problemErrorInfo } from "./traffic-errors";

describe("demo traffic Problem handling", () => {
  it("maps the official no-scenario Problem envelope to actionable guidance", () => {
    const error = problemErrorInfo(
      {
        error: {
          code: "INVALID_ARGUMENT",
          message: "No scenario is selected",
          retryable: false,
          details: { field: "currentScenarioId" },
        },
      },
      "/users",
      400,
      "Bad Request",
    );

    expect(error).toMatchObject({ type: "no-pattern", title: "No Pattern Selected", details: { status: 400 } });
  });

  it("maps official mock and upstream Problems without relying on status text", () => {
    expect(
      problemErrorInfo(
        {
          error: {
            code: "NOT_FOUND",
            message: "mock was not found",
            retryable: false,
            details: { entity: "mock", id: "fingerprint" },
          },
        },
        "/users",
        404,
        "",
      ).type,
    ).toBe("no-mock");
    expect(
      problemErrorInfo(
        {
          error: { code: "UPSTREAM_UNAVAILABLE", message: "The upstream request failed", retryable: true },
        },
        "/users",
        502,
        "",
      ),
    ).toMatchObject({ type: "bad-gateway", details: { rawMessage: "The upstream request failed" } });
  });

  it("rejects legacy flat errors as a contract mismatch", () => {
    const error = problemErrorInfo(
      { code: "NOT_FOUND", message: "mock was not found", retryable: false },
      "/users",
      404,
      "Not Found",
    );

    expect(error).toMatchObject({
      type: "unknown",
      details: { rawMessage: "Error response did not match the v2 Problem envelope" },
    });
  });
});
