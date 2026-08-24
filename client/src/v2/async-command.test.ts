import { describe, expect, it } from "vitest";

import { createAsyncCommandState, reduceAsyncCommand } from "./async-command";

describe("async command reducer", () => {
  it("tracks pending, success, and reset states", () => {
    let state = createAsyncCommandState<{ id: string }>();
    state = reduceAsyncCommand(state, { type: "started", executionId: 1 });
    expect(state.status).toBe("pending");

    state = reduceAsyncCommand(state, {
      type: "succeeded",
      executionId: 1,
      result: { id: "created" },
    });
    expect(state).toMatchObject({ status: "success", result: { id: "created" } });

    state = reduceAsyncCommand(state, { type: "reset" });
    expect(state).toEqual(createAsyncCommandState());
  });

  it("ignores stale completions and preserves structured errors", () => {
    let state = createAsyncCommandState<string>();
    state = reduceAsyncCommand(state, { type: "started", executionId: 1 });
    state = reduceAsyncCommand(state, { type: "started", executionId: 2 });

    const stale = reduceAsyncCommand(state, { type: "succeeded", executionId: 1, result: "old" });
    expect(stale).toBe(state);

    const error = Object.assign(new Error("conflict"), { code: "REVISION_CONFLICT" });
    const failed = reduceAsyncCommand(state, { type: "failed", executionId: 2, error });
    expect(failed.status).toBe("error");
    expect(failed.error).toEqual({
      name: "Error",
      message: "conflict",
      code: "REVISION_CONFLICT",
    });
  });
});
