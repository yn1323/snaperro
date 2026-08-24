import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { RecordingDraftSchema, RecordingSchema } from "../../../shared/contracts-v2/entities.js";
import {
  CommandIdSchema,
  RecordingIdSchema,
  RevisionSchema,
  RuntimeIdSchema,
  ScenarioIdSchema,
} from "../../../shared/contracts-v2/primitives.js";
import type { CommandBusPort, QueryBusPort } from "../application/ports.js";
import { createControlApi } from "./control-api.js";

function dependencies() {
  const commands = {
    execute: vi.fn(async (command) => ({ revision: RevisionSchema.parse(1), mode: command.mode })),
  } as unknown as CommandBusPort;
  const queries = {
    execute: vi.fn(async () => ({
      protocolVersion: 2,
      runtimeId: RuntimeIdSchema.parse("run_1234567890abcdef"),
      revision: RevisionSchema.parse(0),
      version: "2.0.0-test",
      mode: "smart",
      currentScenarioId: null,
      folders: {},
      scenarios: {},
    })),
  } as unknown as QueryBusPort;
  return { commands, queries };
}

function appFor(deps = dependencies(), maxJsonBodyBytes?: number) {
  const app = new Hono();
  app.route("/control", createControlApi({ ...deps, maxJsonBodyBytes }));
  return { app, ...deps };
}

describe("v2 control API", () => {
  it("returns a runtime-validated snapshot", async () => {
    const { app, queries } = appFor();
    const response = await app.request("/control/snapshot");

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ protocolVersion: 2, mode: "smart", folders: {} });
    expect(queries.execute).toHaveBeenCalledOnce();
  });

  it("validates and dispatches a command", async () => {
    const { app, commands } = appFor();
    const response = await app.request("/control/commands", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        protocolVersion: 2,
        commandId: CommandIdSchema.parse("cmd_1234567890abcdef"),
        expectedRevision: RevisionSchema.parse(0),
        type: "mode.set",
        mode: "record",
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ revision: 1, mode: "record" });
    expect(commands.execute).toHaveBeenCalledOnce();
  });

  it("accepts the largest legal recording metadata under the shared default JSON limit", async () => {
    const scenarioId = ScenarioIdSchema.parse("scn_1234567890abcdef");
    const recordingId = RecordingIdSchema.parse("rec_1234567890abcdef");
    const fields = Array.from({ length: 32 }, (_, index) => [`x-${index}`, "a".repeat(8_000)] as [string, string]);
    const draft = RecordingDraftSchema.parse({
      route: "/dense",
      method: "GET",
      request: { pathParams: Object.fromEntries(fields), query: fields, headers: fields, body: null },
      response: { status: 200, statusText: "OK", headers: fields, body: null },
    });
    const recording = RecordingSchema.parse({
      ...draft,
      id: recordingId,
      scenarioId,
      filename: "dense.json",
      requestFingerprint: "a".repeat(64),
      matchable: true,
      revision: 0,
      createdAt: "2026-08-24T00:00:00.000Z",
      updatedAt: "2026-08-24T00:00:00.000Z",
    });
    const deps = dependencies();
    deps.commands.execute = vi.fn(async () => ({ revision: 1, scenarioRevision: 1, recording })) as never;
    const { app, commands } = appFor(deps);

    const response = await app.request("/control/commands", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        protocolVersion: 2,
        commandId: CommandIdSchema.parse("cmd_1234567890abcdef"),
        type: "recording.create",
        scenarioId,
        expectedScenarioRevision: 0,
        filename: "dense.json",
        recording: draft,
      }),
    });

    expect(response.status).toBe(200);
    expect(commands.execute).toHaveBeenCalledOnce();
    expect(await response.json()).toMatchObject({ recording: { id: recordingId } });
  });

  it("returns a structured 400 for a contract violation", async () => {
    const { app, commands } = appFor();
    const response = await app.request("/control/commands", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ protocolVersion: 2, type: "mode.set", mode: "invalid" }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "INVALID_ARGUMENT" } });
    expect(commands.execute).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON and unsupported content types", async () => {
    const { app } = appFor();
    const malformed = await app.request("/control/queries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{",
    });
    const wrongType = await app.request("/control/queries", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "{}",
    });

    expect(malformed.status).toBe(400);
    expect(wrongType.status).toBe(400);
  });

  it("enforces the configured JSON body limit while streaming", async () => {
    const { app } = appFor(dependencies(), 32);
    const response = await app.request("/control/commands", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payload: "x".repeat(100) }),
    });

    expect(response.status).toBe(413);
  });
});
