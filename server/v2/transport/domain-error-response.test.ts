import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { RevisionSchema } from "../../../shared/contracts-v2/primitives.js";
import {
  EntityNotFoundError,
  PayloadLimitExceededError,
  RevisionConflictError,
  StoreLockedError,
} from "../domain/errors.js";
import { domainErrorResponse } from "./domain-error-response.js";

function appFor(error: unknown) {
  const app = new Hono();
  app.get("/", () => {
    throw error;
  });
  app.onError(domainErrorResponse);
  return app;
}

describe("domainErrorResponse", () => {
  it("maps a not-found error without losing its machine-readable code", async () => {
    const response = await appFor(new EntityNotFoundError("scenario", "scn_missing0000000")).request("/");

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      error: { code: "NOT_FOUND", retryable: false, details: { entity: "scenario" } },
    });
  });

  it("maps optimistic concurrency conflicts to a retryable 409", async () => {
    const response = await appFor(new RevisionConflictError(RevisionSchema.parse(1), RevisionSchema.parse(2))).request(
      "/",
    );

    expect(response.status).toBe(409);
    expect(response.headers.get("retry-after")).toBe("1");
  });

  it("maps payload limits to 413", async () => {
    const response = await appFor(new PayloadLimitExceededError(10, 11)).request("/");
    expect(response.status).toBe(413);
  });

  it("maps a lost store lease to a retryable 423", async () => {
    const response = await appFor(new StoreLockedError("/store", "expired-writer")).request("/");

    expect(response.status).toBe(423);
    expect(response.headers.get("retry-after")).toBe("1");
    expect(await response.json()).toEqual({
      error: { code: "STORE_LOCKED", message: "The v2 store is already in use", retryable: true },
    });
  });

  it("does not expose unexpected error details", async () => {
    const response = await appFor(new Error("database password leaked")).request("/");
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: { code: "INTERNAL", message: "An unexpected error occurred", retryable: false },
    });
  });
});
