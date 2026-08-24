import { describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";

import { DocumentBuffer, type TextBufferTarget } from "./document-buffer";

describe("DocumentBuffer", () => {
  it("keeps a 50 MiB draft in the native target without reading it on every key press", () => {
    const buffer = new DocumentBuffer();
    const largeText = "x".repeat(50 * 1024 * 1024);
    let nativeValue = "";
    let reads = 0;
    const target = {
      get value() {
        reads += 1;
        return nativeValue;
      },
      set value(value: string) {
        nativeValue = value;
      },
    } satisfies TextBufferTarget;
    const listener = vi.fn();
    buffer.subscribe(listener);

    buffer.load(largeText);
    const detach = buffer.attach(target);
    listener.mockClear();
    for (let index = 0; index < 1_000; index++) buffer.markChanged();

    expect(reads).toBe(0);
    expect(listener).toHaveBeenCalledOnce();
    expect(buffer.getSnapshot().dirty).toBe(true);
    expect(buffer.readText()).toHaveLength(largeText.length);
    expect(reads).toBe(1);
    detach();
  });

  it("does not clear dirty state when the user edits after a save was submitted", () => {
    const buffer = new DocumentBuffer();
    const target = { value: "" };
    buffer.load('{"name":"first"}');
    buffer.attach(target);
    target.value = '{"name":"submitted"}';
    buffer.markChanged();
    const submitted = buffer.parse(z.object({ name: z.string() }).strict());
    expect(submitted?.value).toEqual({ name: "submitted" });

    target.value = '{"name":"newer"}';
    buffer.markChanged();
    buffer.markSaved(submitted?.mutationVersion ?? -1);
    expect(buffer.getSnapshot().dirty).toBe(true);
    expect(buffer.readText()).toBe('{"name":"newer"}');
  });

  it("validates only on demand and can replace a body reference as one draft update", () => {
    const buffer = new DocumentBuffer();
    const target = { value: "" };
    buffer.attach(target);
    buffer.load("not json");

    expect(buffer.parse(z.object({ ok: z.boolean() }))).toBeNull();
    expect(buffer.getSnapshot().parseError).toBeTruthy();

    buffer.replaceDraft('{"ok":true}');
    expect(buffer.getSnapshot()).toMatchObject({ dirty: true, parseError: null });
    expect(buffer.parse(z.object({ ok: z.boolean() }))?.value).toEqual({ ok: true });
  });
});
