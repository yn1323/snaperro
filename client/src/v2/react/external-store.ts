import { useSyncExternalStore } from "react";

export type StoreListener = () => void;

export interface ReadableExternalStore<State> {
  getSnapshot: () => State;
  subscribe: (listener: StoreListener) => () => void;
}

export class ExternalStore<State> implements ReadableExternalStore<State> {
  #state: State;
  readonly #listeners = new Set<StoreListener>();

  constructor(initialState: State) {
    this.#state = initialState;
  }

  readonly getSnapshot = (): State => this.#state;

  readonly subscribe = (listener: StoreListener): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  set(next: State): void {
    if (Object.is(next, this.#state)) return;
    this.#state = next;
    for (const listener of this.#listeners) listener();
  }

  update(reducer: (state: State) => State): void {
    this.set(reducer(this.#state));
  }
}

export function useExternalStore<State>(store: ReadableExternalStore<State>): State {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
