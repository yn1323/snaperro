import { COMMAND_TYPES, type CommandType } from "../shared/contracts-v2/commands.js";
import { QUERY_TYPES, type QueryType } from "../shared/contracts-v2/queries.js";

interface PostmanRequest {
  method: string;
  auth?: { type: "noauth" };
  header?: Array<{ key: string; value: string }>;
  body?:
    | { mode: "raw"; raw: string; options?: { raw: { language: string } } }
    | { mode: "file"; file: { src: string } };
  url: string;
  description?: string;
}

interface PostmanItem {
  name: string;
  request?: PostmanRequest;
  item?: PostmanItem[];
}

const ids = {
  folder: "fld_0123456789abcdef",
  scenario: "scn_0123456789abcdef",
  recording: "rec_0123456789abcdef",
  transfer: "xfer_0123456789abcdef",
};

const postmanCommandId = "cmd_{{$guid}}";

const recordingDraft = {
  route: "/users/:id",
  method: "GET",
  request: { pathParams: { id: "1" }, query: [], headers: [], body: null },
  response: { status: 200, statusText: "OK", headers: [["content-type", "application/json"]], body: null },
};

const commandBodies: Record<CommandType, Record<string, unknown>> = {
  "mode.set": { expectedRevision: 0, mode: "smart" },
  "scenario.select": { expectedRevision: 0, scenarioId: ids.scenario },
  "folder.create": { expectedRevision: 0, name: "Team" },
  "folder.rename": { expectedRevision: 0, folderId: ids.folder, name: "Renamed Team" },
  "folder.delete": { expectedRevision: 0, folderId: ids.folder },
  "folder.import": { expectedRevision: 0, transferId: ids.transfer, name: "Imported Team" },
  "scenario.create": { expectedRevision: 0, folderId: ids.folder, name: "Success" },
  "scenario.rename": { expectedRevision: 0, scenarioId: ids.scenario, name: "Renamed Scenario" },
  "scenario.duplicate": {
    expectedRevision: 0,
    scenarioId: ids.scenario,
    destinationFolderId: ids.folder,
    name: "Success copy",
  },
  "scenario.delete": { expectedRevision: 0, scenarioId: ids.scenario },
  "recording.create": {
    scenarioId: ids.scenario,
    expectedScenarioRevision: 0,
    filename: "get_users_001.json",
    recording: recordingDraft,
  },
  "recording.import": {
    scenarioId: ids.scenario,
    expectedScenarioRevision: 0,
    transferId: ids.transfer,
  },
  "recording.update": {
    scenarioId: ids.scenario,
    recordingId: ids.recording,
    expectedScenarioRevision: 0,
    expectedContentRevision: 0,
    filename: "get_users_001.json",
    recording: recordingDraft,
  },
  "recording.delete": {
    scenarioId: ids.scenario,
    recordingId: ids.recording,
    expectedScenarioRevision: 0,
    expectedContentRevision: 0,
  },
};

const queryBodies: Record<QueryType, Record<string, unknown>> = {
  "runtime.snapshot": {},
  "folder.list": {},
  "folder.export": { folderId: ids.folder },
  "scenario.list": { folderId: ids.folder },
  "scenario.get": { scenarioId: ids.scenario },
  "recording.list": { scenarioId: ids.scenario, limit: 100 },
  "recording.search": { scenarioId: ids.scenario, text: "users", limit: 100 },
  "recording.get": { scenarioId: ids.scenario, recordingId: ids.recording },
  "recording.body": { scenarioId: ids.scenario, recordingId: ids.recording, target: "response" },
  "recording.export": { scenarioId: ids.scenario, recordingId: ids.recording },
  "body.download": {
    body: {
      sha256: "a".repeat(64),
      size: 0,
      mediaType: "application/octet-stream",
      contentEncoding: null,
    },
    filename: "response.body",
  },
};

function jsonItem(name: string, path: string, value: Record<string, unknown>): PostmanItem {
  return {
    name,
    request: {
      method: "POST",
      header: [{ key: "Content-Type", value: "application/json" }],
      body: {
        mode: "raw",
        raw: JSON.stringify(value, null, 2),
        options: { raw: { language: "json" } },
      },
      url: `{{baseUrl}}${path}`,
    },
  };
}

export function createPostmanCollection() {
  return {
    info: {
      _postman_id: "snaperro-v2-control-api",
      name: "snaperro 2.0 Control API",
      description:
        "Typed v2 control API. Replace IDs and revisions with values from the snapshot/query responses. Set controlToken when the server requires it.",
      schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    },
    auth: {
      type: "bearer",
      bearer: [{ key: "token", value: "{{controlToken}}", type: "string" }],
    },
    variable: [
      { key: "baseUrl", value: "http://127.0.0.1:3333", type: "string" },
      { key: "controlToken", value: "", type: "string" },
      { key: "downloadPath", value: "/__snaperro__/downloads/<capability>", type: "string" },
    ],
    item: [
      {
        name: "Runtime",
        item: [
          {
            name: "Get Runtime Snapshot",
            request: { method: "GET", url: "{{baseUrl}}/__snaperro__/v2/snapshot" },
          },
          {
            name: "Realtime Event Stream",
            request: {
              method: "GET",
              header: [{ key: "Accept", value: "text/event-stream" }],
              url: "{{baseUrl}}/__snaperro__/v2/events",
            },
          },
        ],
      },
      {
        name: "Commands",
        item: COMMAND_TYPES.map((type) =>
          jsonItem(type, "/__snaperro__/v2/commands", {
            protocolVersion: 2,
            commandId: postmanCommandId,
            type,
            ...commandBodies[type],
          }),
        ),
      },
      {
        name: "Queries",
        item: QUERY_TYPES.map((type) =>
          jsonItem(type, "/__snaperro__/v2/queries", {
            protocolVersion: 2,
            type,
            ...queryBodies[type],
          }),
        ),
      },
      {
        name: "Streams",
        item: [
          {
            name: "Upload Body",
            request: {
              method: "POST",
              header: [{ key: "Content-Type", value: "application/octet-stream" }],
              body: { mode: "raw", raw: "raw body bytes" },
              url: "{{baseUrl}}/__snaperro__/v2/bodies",
            },
          },
          {
            name: "Stage Folder Import",
            request: {
              method: "POST",
              header: [{ key: "Content-Type", value: "application/zip" }],
              body: { mode: "file", file: { src: "" } },
              url: "{{baseUrl}}/__snaperro__/v2/transfers/imports?filename=Team.zip",
            },
          },
          {
            name: "Stage Recording Import",
            request: {
              method: "POST",
              header: [{ key: "Content-Type", value: "application/zip" }],
              body: { mode: "file", file: { src: "" } },
              url: "{{baseUrl}}/__snaperro__/v2/transfers/recording-imports?filename=recording.snaperro.zip",
            },
          },
          {
            name: "Use Single-Use Download Capability",
            request: {
              method: "GET",
              auth: { type: "noauth" },
              description:
                "Copy downloadPath from folder.export, recording.export, or body.download into the collection variable. The capability expires quickly and can be claimed once.",
              url: "{{baseUrl}}{{downloadPath}}",
            },
          },
        ],
      },
    ] satisfies PostmanItem[],
  };
}
