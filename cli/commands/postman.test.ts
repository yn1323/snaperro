import { describe, expect, it } from "vitest";
import { COMMAND_TYPES, CommandSchema } from "../../shared/contracts-v2/commands.js";
import { QUERY_TYPES, QuerySchema } from "../../shared/contracts-v2/queries.js";
import { createPostmanCollection } from "../postman-collection.js";

describe("Postman collection", () => {
  it("covers and validates every command and query with inherited bearer auth", () => {
    const collection = createPostmanCollection();
    const commands = collection.item.find((group) => group.name === "Commands")?.item ?? [];
    const queries = collection.item.find((group) => group.name === "Queries")?.item ?? [];
    const parseBodies = (items: typeof commands) =>
      items.map((item) => {
        const body = item.request?.body;
        return JSON.parse(body?.mode === "raw" ? body.raw : "null") as Record<string, unknown>;
      });
    const commandBodies = commands.map((item, index) => {
      const body = item.request?.body;
      const raw = body?.mode === "raw" ? body.raw : "null";
      const guid = `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;
      return JSON.parse(raw.replaceAll("{{$guid}}", guid)) as Record<string, unknown>;
    });
    const queryBodies = parseBodies(queries);

    expect(commandBodies.map((body) => body.type)).toEqual(COMMAND_TYPES);
    expect(queryBodies.map((body) => body.type)).toEqual(QUERY_TYPES);
    for (const body of commandBodies) expect(() => CommandSchema.parse(body)).not.toThrow();
    expect(new Set(commandBodies.map((body) => body.commandId)).size).toBe(COMMAND_TYPES.length);
    for (const body of queryBodies) expect(() => QuerySchema.parse(body)).not.toThrow();
    expect(collection.auth).toEqual({
      type: "bearer",
      bearer: [{ key: "token", value: "{{controlToken}}", type: "string" }],
    });
    expect(collection.variable).toContainEqual({ key: "controlToken", value: "", type: "string" });
    expect(JSON.stringify(collection)).not.toContain("localhost:3333");
  });

  it("generates a fresh contract-compatible command id for every command request", () => {
    const commands = createPostmanCollection().item.find((group) => group.name === "Commands")?.item ?? [];

    expect(commands).toHaveLength(COMMAND_TYPES.length);
    for (const command of commands) {
      const body = command.request?.body;
      const raw = body?.mode === "raw" ? body.raw : "";
      expect(raw).toContain('"commandId": "cmd_{{$guid}}"');
      expect(raw).not.toContain('"commandId": "cmd_0123456789abcdef"');
    }
  });

  it("uses the v2 import routes and an unauthenticated single-use capability request", () => {
    const streams = createPostmanCollection().item.find((group) => group.name === "Streams")?.item ?? [];
    const request = (name: string) => streams.find((item) => item.name === name)?.request;

    expect(request("Stage Folder Import")?.url).toContain("/__snaperro__/v2/transfers/imports?");
    expect(request("Stage Recording Import")?.url).toContain("/__snaperro__/v2/transfers/recording-imports?");
    expect(request("Use Single-Use Download Capability")).toMatchObject({
      method: "GET",
      auth: { type: "noauth" },
      url: "{{baseUrl}}{{downloadPath}}",
    });
    expect(JSON.stringify(streams)).not.toContain("/__snaperro__/v2/transfers/xfer_");
    expect(JSON.stringify(streams)).not.toContain("/__snaperro__/v2/bodies/aaaaaaaa");
  });
});
