import { describe, expect, it, vi } from "vitest";
import { type ConfigWatcherPort, ConfigWatcherV2 } from "./watcher.js";

class FakeWatcher implements ConfigWatcherPort {
  all: ((eventName: string, changedPath: string) => void) | undefined;
  error: ((error: unknown) => void) | undefined;
  close = vi.fn(async () => undefined);

  on(event: "all" | "error", listener: never): ConfigWatcherPort {
    if (event === "all") this.all = listener as (eventName: string, changedPath: string) => void;
    else this.error = listener as (error: unknown) => void;
    return this;
  }
}

describe("ConfigWatcherV2", () => {
  it("coalesces bursts, ignores unrelated paths, and serializes reload failures", async () => {
    vi.useFakeTimers();
    const port = new FakeWatcher();
    const changed = vi.fn().mockRejectedValueOnce(new Error("invalid config")).mockResolvedValue(undefined);
    const errors = vi.fn();
    const watcher = new ConfigWatcherV2({
      paths: ["/project/snaperro.config.ts", "/project/.env"],
      debounceMs: 10,
      onChange: changed,
      onError: errors,
      watch: () => port,
    });
    watcher.start();

    port.all?.("change", "/project/other.ts");
    port.all?.("change", "/project/snaperro.config.ts");
    port.all?.("change", "/project/.env");
    await vi.advanceTimersByTimeAsync(10);
    await Promise.resolve();
    expect(changed).toHaveBeenCalledOnce();
    expect(errors).toHaveBeenCalledOnce();

    port.all?.("change", "/project/.env");
    await vi.advanceTimersByTimeAsync(10);
    await watcher.stop();
    expect(changed).toHaveBeenCalledTimes(2);
    expect(port.close).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it("waits for reload cleanup and remains concurrent-idempotent when watcher close fails", async () => {
    vi.useFakeTimers();
    const port = new FakeWatcher();
    const watcherCloseError = new Error("watcher close failed");
    const reloadError = new Error("reload error handler failed");
    let rejectWatcherClose: ((error: Error) => void) | undefined;
    port.close.mockImplementation(
      () =>
        new Promise<undefined>((_resolve, reject) => {
          rejectWatcherClose = reject;
        }),
    );
    let rejectReload: ((error: Error) => void) | undefined;
    const watcher = new ConfigWatcherV2({
      paths: ["/project/snaperro.config.ts"],
      debounceMs: 10,
      onChange: vi.fn(
        () =>
          new Promise<void>((_resolve, reject) => {
            rejectReload = reject;
          }),
      ),
      onError: () => {
        throw reloadError;
      },
      watch: () => port,
    });
    watcher.start();
    port.all?.("change", "/project/snaperro.config.ts");
    await vi.advanceTimersByTimeAsync(10);

    const first = watcher.stop();
    const second = watcher.stop();
    expect(first).toBe(second);
    rejectWatcherClose?.(watcherCloseError);
    await Promise.resolve();
    rejectReload?.(new Error("reload failed"));
    await expect(first).rejects.toMatchObject({ errors: [watcherCloseError, reloadError] });
    expect(port.close).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it("bounds shutdown when an in-flight config load never settles", async () => {
    vi.useFakeTimers();
    const port = new FakeWatcher();
    const watcher = new ConfigWatcherV2({
      paths: ["/project/snaperro.config.ts"],
      debounceMs: 10,
      shutdownTimeoutMs: 25,
      onChange: () => new Promise<void>(() => undefined),
      watch: () => port,
    });
    watcher.start();
    port.all?.("change", "/project/snaperro.config.ts");
    await vi.advanceTimersByTimeAsync(10);

    const stopping = watcher.stop();
    const assertion = expect(stopping).rejects.toThrow("did not settle within 25ms");
    await vi.advanceTimersByTimeAsync(25);

    await assertion;
    expect(port.close).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });
});
