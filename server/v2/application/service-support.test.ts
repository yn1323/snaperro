import { describe, expect, it, vi } from "vitest";
import type { LoggerPort } from "./ports.js";
import { runBestEffortPostCommit } from "./service-support.js";

describe("runBestEffortPostCommit", () => {
  it("bounds a cleanup that never settles and reports the timeout", async () => {
    vi.useFakeTimers();
    const logger = { error: vi.fn() } as unknown as LoggerPort;
    const cleanup = vi.fn(() => new Promise<void>(() => undefined));
    const completion = runBestEffortPostCommit(cleanup, logger, "cleanup failed", { id: "item" }, 25);

    await vi.advanceTimersByTimeAsync(25);

    await expect(completion).resolves.toBeUndefined();
    expect(cleanup).toHaveBeenCalledOnce();
    expect(logger.error).toHaveBeenCalledWith("cleanup failed", {
      id: "item",
      error: expect.objectContaining({ message: "Best-effort cleanup did not settle within 25ms" }),
    });
    vi.useRealTimers();
  });
});
