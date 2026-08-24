import { describe, expect, it, vi } from "vitest";
import { RevisionSchema } from "../../../shared/contracts-v2/primitives.js";
import { InvalidArgumentError } from "../domain/errors.js";
import {
  ApplicationCommandBus,
  type ApplicationCommandBusDependencies,
  ApplicationQueryBus,
  type QueryHandlerMap,
} from "./bus.js";
import { applicationTestIds, catalogFixture } from "./test-doubles.js";

const unsupported = async (): Promise<never> => {
  throw new Error("unexpected handler");
};

function commandHandlers() {
  const setMode = vi.fn(async (command) => ({ revision: command.expectedRevision, mode: command.mode }));
  const handlers: ApplicationCommandBusDependencies = {
    catalog: {
      setMode,
      selectScenario: unsupported,
      createFolder: unsupported,
      renameFolder: unsupported,
      deleteFolder: unsupported,
    },
    scenarios: { create: unsupported, rename: unsupported, duplicate: unsupported, delete: unsupported },
    recordings: { create: unsupported, update: unsupported, delete: unsupported },
    recordingImport: { execute: unsupported },
    folderImport: { execute: unsupported },
  };
  return { handlers, setMode };
}

describe("application buses", () => {
  it("runtime-validates and dispatches commands to exactly one typed handler", async () => {
    const { handlers, setMode } = commandHandlers();
    const bus = new ApplicationCommandBus(handlers);
    const context = { signal: new AbortController().signal };
    const command = {
      protocolVersion: 2 as const,
      commandId: applicationTestIds.command,
      type: "mode.set" as const,
      expectedRevision: RevisionSchema.parse(3),
      mode: "record" as const,
    };

    await expect(bus.execute(command, context)).resolves.toEqual({ revision: 3, mode: "record" });
    expect(setMode).toHaveBeenCalledWith(command, context);

    await expect(bus.execute({ ...command, mode: "invalid" } as never)).rejects.toBeInstanceOf(InvalidArgumentError);
    expect(setMode).toHaveBeenCalledTimes(1);
  });

  it("dispatches parsed queries through the replaceable query handler map", async () => {
    const folderList = vi.fn(async () => ({
      revision: RevisionSchema.parse(0),
      folders: catalogFixture().folders,
    }));
    const handlers: QueryHandlerMap = {
      "runtime.snapshot": unsupported,
      "folder.list": folderList,
      "folder.export": unsupported,
      "scenario.list": unsupported,
      "scenario.get": unsupported,
      "recording.list": unsupported,
      "recording.search": unsupported,
      "recording.get": unsupported,
      "recording.body": unsupported,
      "recording.export": unsupported,
      "body.download": unsupported,
    };
    const bus = new ApplicationQueryBus(handlers);
    const query = { protocolVersion: 2 as const, type: "folder.list" as const };

    const result = await bus.execute(query);

    expect(result.folders).toHaveLength(1);
    expect(folderList).toHaveBeenCalledWith(query, {});
  });
});
