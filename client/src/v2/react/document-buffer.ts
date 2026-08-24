import type { z } from "zod/v4";

import { ExternalStore, type ReadableExternalStore } from "./external-store";

export interface TextBufferTarget {
  value: string;
}

export interface DocumentBufferSnapshot {
  generation: number;
  dirty: boolean;
  parseError: string | null;
}

export interface ParsedDraft<Value> {
  value: Value;
  mutationVersion: number;
}

/**
 * Keeps large draft text in the native textarea. React subscribes only to the
 * small metadata snapshot, so a 50 MB value is not copied into React state for
 * every key press.
 */
export class DocumentBuffer implements ReadableExternalStore<DocumentBufferSnapshot> {
  readonly #meta = new ExternalStore<DocumentBufferSnapshot>({ generation: 0, dirty: false, parseError: null });
  #target: TextBufferTarget | null = null;
  #detachedText = "";
  #mutationVersion = 0;

  readonly getSnapshot = this.#meta.getSnapshot;
  readonly subscribe = this.#meta.subscribe;

  get mutationVersion(): number {
    return this.#mutationVersion;
  }

  attach(target: TextBufferTarget): () => void {
    this.#target = target;
    target.value = this.#detachedText;
    return () => {
      if (this.#target !== target) return;
      this.#detachedText = target.value;
      this.#target = null;
    };
  }

  load(text: string): void {
    this.#detachedText = text;
    if (this.#target) this.#target.value = text;
    this.#mutationVersion = 0;
    const current = this.#meta.getSnapshot();
    this.#meta.set({ generation: current.generation + 1, dirty: false, parseError: null });
  }

  replaceDraft(text: string): void {
    this.#detachedText = text;
    if (this.#target) this.#target.value = text;
    this.#mutationVersion += 1;
    const current = this.#meta.getSnapshot();
    this.#meta.set({ generation: current.generation + 1, dirty: true, parseError: null });
  }

  clear(): void {
    this.load("");
  }

  markChanged(): void {
    this.#mutationVersion += 1;
    const current = this.#meta.getSnapshot();
    if (!current.dirty || current.parseError !== null) {
      this.#meta.set({ ...current, dirty: true, parseError: null });
    }
  }

  readText(): string {
    return this.#target?.value ?? this.#detachedText;
  }

  parse<Value>(schema: z.ZodType<Value>): ParsedDraft<Value> | null {
    try {
      const value = schema.parse(JSON.parse(this.readText()));
      const current = this.#meta.getSnapshot();
      if (current.parseError !== null) this.#meta.set({ ...current, parseError: null });
      return { value, mutationVersion: this.#mutationVersion };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid JSON document";
      const current = this.#meta.getSnapshot();
      if (current.parseError !== message) this.#meta.set({ ...current, parseError: message });
      return null;
    }
  }

  format(): boolean {
    try {
      const formatted = JSON.stringify(JSON.parse(this.readText()), null, 2);
      this.#detachedText = formatted;
      if (this.#target) this.#target.value = formatted;
      this.#mutationVersion += 1;
      const current = this.#meta.getSnapshot();
      this.#meta.set({ ...current, dirty: true, parseError: null });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid JSON document";
      const current = this.#meta.getSnapshot();
      this.#meta.set({ ...current, parseError: message });
      return false;
    }
  }

  markSaved(submittedMutationVersion: number): void {
    if (submittedMutationVersion !== this.#mutationVersion) return;
    this.#detachedText = this.readText();
    const current = this.#meta.getSnapshot();
    this.#meta.set({ ...current, dirty: false, parseError: null });
  }
}
