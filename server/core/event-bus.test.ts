import { afterEach, describe, expect, it, vi } from "vitest";
import { eventBus } from "./event-bus.js";

describe("SSEEventBus", () => {
  const unsubscribers: Array<() => void> = [];

  afterEach(() => {
    // Clean up all subscriptions
    for (const unsubscribe of unsubscribers) {
      unsubscribe();
    }
    unsubscribers.length = 0;
  });

  describe("subscribe", () => {
    it("receives emitted events", () => {
      const callback = vi.fn();
      const unsubscribe = eventBus.subscribe(callback);
      unsubscribers.push(unsubscribe);

      eventBus.emitSSE("mode_changed", { mode: "mock" });

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "mode_changed",
          data: { mode: "mock" },
        }),
      );
    });

    it("includes timestamp in events", () => {
      const callback = vi.fn();
      const unsubscribe = eventBus.subscribe(callback);
      unsubscribers.push(unsubscribe);

      const before = new Date().toISOString();
      eventBus.emitSSE("pattern_changed", { pattern: "test" });
      const after = new Date().toISOString();

      const event = callback.mock.calls[0][0];
      expect(event.timestamp).toBeDefined();
      expect(event.timestamp >= before).toBe(true);
      expect(event.timestamp <= after).toBe(true);
    });

    it("returns unsubscribe function", () => {
      const callback = vi.fn();
      const unsubscribe = eventBus.subscribe(callback);

      unsubscribe();

      eventBus.emitSSE("mode_changed", { mode: "proxy" });
      expect(callback).not.toHaveBeenCalled();
    });

    it("supports multiple subscribers", () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();
      const unsubscribe1 = eventBus.subscribe(callback1);
      const unsubscribe2 = eventBus.subscribe(callback2);
      unsubscribers.push(unsubscribe1, unsubscribe2);

      eventBus.emitSSE("file_created", { pattern: "test", filename: "test.json" });

      expect(callback1).toHaveBeenCalledTimes(1);
      expect(callback2).toHaveBeenCalledTimes(1);
    });

    it("unsubscribing one does not affect others", () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();
      const unsubscribe1 = eventBus.subscribe(callback1);
      const unsubscribe2 = eventBus.subscribe(callback2);
      unsubscribers.push(unsubscribe2);

      unsubscribe1();

      eventBus.emitSSE("pattern_deleted", { name: "test" });

      expect(callback1).not.toHaveBeenCalled();
      expect(callback2).toHaveBeenCalledTimes(1);
    });
  });

  describe("emitSSE", () => {
    it("emits connected event", () => {
      const callback = vi.fn();
      const unsubscribe = eventBus.subscribe(callback);
      unsubscribers.push(unsubscribe);

      eventBus.emitSSE("connected", {
        mode: "proxy",
        currentPattern: null,
        patterns: [],
        folders: [],
        files: [],
      });

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "connected",
          data: expect.objectContaining({
            mode: "proxy",
            currentPattern: null,
          }),
        }),
      );
    });

    it("emits file_created event", () => {
      const callback = vi.fn();
      const unsubscribe = eventBus.subscribe(callback);
      unsubscribers.push(unsubscribe);

      eventBus.emitSSE("file_created", {
        pattern: "test-pattern",
        filename: "GET_users.json",
        endpoint: "/users",
        method: "GET",
      });

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "file_created",
          data: {
            pattern: "test-pattern",
            filename: "GET_users.json",
            endpoint: "/users",
            method: "GET",
          },
        }),
      );
    });

    it("emits file_updated event", () => {
      const callback = vi.fn();
      const unsubscribe = eventBus.subscribe(callback);
      unsubscribers.push(unsubscribe);

      eventBus.emitSSE("file_updated", {
        pattern: "test-pattern",
        filename: "POST_users.json",
        endpoint: "/users",
        method: "POST",
      });

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "file_updated",
          data: {
            pattern: "test-pattern",
            filename: "POST_users.json",
            endpoint: "/users",
            method: "POST",
          },
        }),
      );
    });

    it("emits pattern_created event", () => {
      const callback = vi.fn();
      const unsubscribe = eventBus.subscribe(callback);
      unsubscribers.push(unsubscribe);

      eventBus.emitSSE("pattern_created", { name: "new-pattern" });

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "pattern_created",
          data: { name: "new-pattern" },
        }),
      );
    });

    it("emits folder_renamed event", () => {
      const callback = vi.fn();
      const unsubscribe = eventBus.subscribe(callback);
      unsubscribers.push(unsubscribe);

      eventBus.emitSSE("folder_renamed", { oldName: "old", newName: "new" });

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "folder_renamed",
          data: { oldName: "old", newName: "new" },
        }),
      );
    });

    it("emits multiple events in order", () => {
      const events: string[] = [];
      const callback = vi.fn((event) => events.push(event.type));
      const unsubscribe = eventBus.subscribe(callback);
      unsubscribers.push(unsubscribe);

      eventBus.emitSSE("mode_changed", { mode: "record" });
      eventBus.emitSSE("pattern_changed", { pattern: "test" });
      eventBus.emitSSE("file_created", { pattern: "test", filename: "test.json" });

      expect(events).toEqual(["mode_changed", "pattern_changed", "file_created"]);
    });
  });
});
