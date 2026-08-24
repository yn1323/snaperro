import { describe, expect, it } from "vitest";
import { createProgram } from "./program.js";

describe("createProgram", () => {
  it("uses the injected package version", () => {
    const program = createProgram({ version: "2.0.0-test" });

    expect(program.version()).toBe("2.0.0-test");
  });

  it("registers all user-facing commands", () => {
    const program = createProgram({ version: "2.0.0-test" });
    const commandNames = program.commands.map((command) => command.name());

    expect(commandNames).toEqual(["init", "start", "postman", "demo", "migrate", "doctor"]);
  });

  it("passes migrate options to the action and records its exit code", async () => {
    const calls: unknown[] = [];
    const exitCodes: number[] = [];
    const program = createProgram({
      version: "2.0.0-test",
      migrateAction: async (options) => {
        calls.push(options);
        return 1;
      },
      setExitCode: (code) => exitCodes.push(code),
    });

    await program.parseAsync(
      [
        "node",
        "snaperro",
        "migrate",
        "--source",
        "old",
        "--destination",
        "new",
        "--state",
        "state",
        "--dry-run",
        "--json",
      ],
      { from: "node" },
    );

    expect(calls).toEqual([{ source: "old", destination: "new", state: "state", dryRun: true, json: true }]);
    expect(exitCodes).toEqual([1]);
  });

  it("passes doctor options without calling process.exit", async () => {
    const calls: unknown[] = [];
    const exitCodes: number[] = [];
    const program = createProgram({
      version: "2.0.0-test",
      doctorAction: async (options) => {
        calls.push(options);
        return 0;
      },
      setExitCode: (code) => exitCodes.push(code),
    });

    await program.parseAsync(["node", "snaperro", "doctor", "--config", "v2.ts", "--env", "doctor.env", "--json"], {
      from: "node",
    });

    expect(calls).toEqual([{ config: "v2.ts", env: "doctor.env", json: true }]);
    expect(exitCodes).toEqual([0]);
  });
});
