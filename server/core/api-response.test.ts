import { describe, expect, it } from "vitest";
import { conflictError, internalError, notFoundError, validationError } from "./api-response.js";

describe("notFoundError", () => {
  it("creates error for scenario", () => {
    expect(notFoundError("scenario", "test-scenario")).toEqual({
      error: "Not found",
      resource: "scenario",
      name: "test-scenario",
    });
  });

  it("creates error for folder", () => {
    expect(notFoundError("folder", "my-folder")).toEqual({
      error: "Not found",
      resource: "folder",
      name: "my-folder",
    });
  });

  it("creates error for file", () => {
    expect(notFoundError("file", "GET_api_users.json")).toEqual({
      error: "Not found",
      resource: "file",
      name: "GET_api_users.json",
    });
  });
});

describe("validationError", () => {
  it("creates error with details", () => {
    expect(validationError("Missing required field: name")).toEqual({
      error: "Invalid request",
      details: "Missing required field: name",
    });
  });

  it("creates error for invalid JSON", () => {
    expect(validationError("Invalid JSON file")).toEqual({
      error: "Invalid request",
      details: "Invalid JSON file",
    });
  });
});

describe("conflictError", () => {
  it("creates error for scenario", () => {
    expect(conflictError("scenario", "existing-scenario")).toEqual({
      error: "Scenario already exists",
      name: "existing-scenario",
    });
  });

  it("creates error for folder", () => {
    expect(conflictError("folder", "existing-folder")).toEqual({
      error: "Folder already exists",
      name: "existing-folder",
    });
  });
});

describe("internalError", () => {
  it("creates error with message", () => {
    expect(internalError("Database connection failed")).toEqual({
      error: "Internal server error",
      details: "Database connection failed",
    });
  });

  it("creates error with generic message", () => {
    expect(internalError("Unknown error")).toEqual({
      error: "Internal server error",
      details: "Unknown error",
    });
  });
});
