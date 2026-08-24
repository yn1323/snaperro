import { Mutex } from "async-mutex";
import {
  type Event,
  type EventDraft,
  type EventOf,
  EventSchema,
  type EventType,
} from "../../../shared/contracts-v2/events.js";
import {
  EventIdSchema,
  type EventSequence,
  EventSequenceSchema,
  type Revision,
  type RuntimeId,
} from "../../../shared/contracts-v2/primitives.js";
import type {
  EventHubPort,
  EventListener,
  EventSubscription,
  EventWatermark,
  OperationContext,
  Unsubscribe,
} from "../application/ports.js";

export class EventReplayUnavailableError extends Error {
  constructor(
    readonly requested: EventSequence,
    readonly oldestAvailable: EventSequence,
  ) {
    super(`Events after sequence ${requested} are no longer available; oldest retained sequence is ${oldestAvailable}`);
    this.name = "EventReplayUnavailableError";
  }
}

interface Subscriber {
  listener: EventListener;
  queue: Event[];
  tail: Promise<void>;
  draining: boolean;
  coalescing: boolean;
  closed: boolean;
}

const CURRENT_REVISION_EVENT_TYPES = new Set<EventType>([
  "runtime.shutting-down",
  "request.completed",
  "recording.outcome",
]);

export interface InMemoryEventHubOptions {
  runtimeId: RuntimeId;
  initialRevision: Revision;
  replayCapacity?: number;
  shutdownTimeoutMs?: number;
  now?: () => string;
}

async function settlesWithin(promise: Promise<unknown>, timeoutMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const settled = promise.then(
    () => true,
    () => true,
  );
  try {
    return await Promise.race([
      settled,
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export class InMemoryEventHub implements EventHubPort {
  readonly #runtimeId: RuntimeId;
  readonly #replayCapacity: number;
  readonly #shutdownTimeoutMs: number;
  readonly #now: () => string;
  readonly #mutex = new Mutex();
  readonly #events: Event[] = [];
  readonly #subscribers = new Set<Subscriber>();
  #sequence = EventSequenceSchema.parse(0);
  #revision: Revision;
  #closed = false;
  #closePromise: Promise<void> | undefined;

  constructor(options: InMemoryEventHubOptions) {
    if (!Number.isSafeInteger(options.replayCapacity ?? 512) || (options.replayCapacity ?? 512) < 1) {
      throw new Error("replayCapacity must be a positive safe integer");
    }
    if (!Number.isSafeInteger(options.shutdownTimeoutMs ?? 5_000) || (options.shutdownTimeoutMs ?? 5_000) < 1) {
      throw new Error("shutdownTimeoutMs must be a positive safe integer");
    }
    this.#runtimeId = options.runtimeId;
    this.#revision = options.initialRevision;
    this.#replayCapacity = options.replayCapacity ?? 512;
    this.#shutdownTimeoutMs = options.shutdownTimeoutMs ?? 5_000;
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  watermark(): EventWatermark {
    return { runtimeId: this.#runtimeId, sequence: this.#sequence, revision: this.#revision };
  }

  async publish<Type extends EventType>(draft: EventDraft<Type>): Promise<EventOf<Type>> {
    return this.#mutex.runExclusive(async () => {
      if (this.#closed) throw new Error("Event hub is closed");
      // Telemetry is created concurrently with catalog writes. Its caller may
      // observe a watermark that becomes stale before publish acquires this
      // mutex, so bind it to the current revision atomically here.
      const revision = CURRENT_REVISION_EVENT_TYPES.has(draft.type) ? this.#revision : draft.revision;
      if (revision < this.#revision) throw new Error("Event revision cannot move backwards");

      this.#sequence = EventSequenceSchema.parse(this.#sequence + 1);
      this.#revision = revision;
      const event = EventSchema.parse({
        ...draft,
        revision,
        protocolVersion: 2,
        runtimeId: this.#runtimeId,
        id: EventIdSchema.parse(`evt_${String(this.#sequence).padStart(16, "0")}`),
        sequence: this.#sequence,
        occurredAt: this.#now(),
      }) as EventOf<Type>;

      this.#events.push(event);
      if (this.#events.length > this.#replayCapacity)
        this.#events.splice(0, this.#events.length - this.#replayCapacity);

      for (const subscriber of this.#subscribers) this.#enqueue(subscriber, event);
      return event;
    });
  }

  async subscribe(
    listener: EventListener,
    options: OperationContext & { afterSequence?: EventSequence } = {},
  ): Promise<Unsubscribe> {
    return (await this.subscribeWithWatermark(listener, options)).unsubscribe;
  }

  async subscribeWithWatermark(
    listener: EventListener,
    options: OperationContext & { afterSequence?: EventSequence } = {},
  ): Promise<EventSubscription> {
    return this.#mutex.runExclusive(async () => {
      if (this.#closed) throw new Error("Event hub is closed");
      if (options.signal?.aborted) throw options.signal.reason;

      const watermark = this.watermark();
      const afterSequence = options.afterSequence ?? watermark.sequence;
      const oldest = this.#events[0]?.sequence;
      if (oldest !== undefined && afterSequence < oldest - 1) {
        throw new EventReplayUnavailableError(afterSequence, oldest);
      }

      const subscriber: Subscriber = {
        listener,
        queue: [],
        tail: Promise.resolve(),
        draining: false,
        coalescing: false,
        closed: false,
      };
      this.#subscribers.add(subscriber);
      for (const event of this.#events) {
        if (event.sequence > afterSequence) this.#enqueue(subscriber, event);
      }

      const abort = () => {
        void this.#unsubscribe(subscriber).catch(() => undefined);
      };
      options.signal?.addEventListener("abort", abort, { once: true });

      return {
        watermark,
        unsubscribe: async () => {
          options.signal?.removeEventListener("abort", abort);
          await this.#unsubscribe(subscriber);
        },
      };
    });
  }

  close(): Promise<void> {
    if (this.#closePromise) return this.#closePromise;
    this.#closePromise = this.#close();
    return this.#closePromise;
  }

  async #close(): Promise<void> {
    const tails = await this.#mutex.runExclusive(async () => {
      if (this.#closed) return [];
      this.#closed = true;
      const subscribers = [...this.#subscribers];
      this.#subscribers.clear();
      for (const subscriber of subscribers) {
        subscriber.closed = true;
        subscriber.queue.length = 0;
      }
      return subscribers.map((subscriber) => subscriber.tail);
    });
    if (!(await settlesWithin(Promise.allSettled(tails), this.#shutdownTimeoutMs))) {
      throw new Error(`Event subscribers did not settle within ${this.#shutdownTimeoutMs}ms`);
    }
  }

  #enqueue(subscriber: Subscriber, event: Event): void {
    if (subscriber.closed) return;
    if (subscriber.coalescing) {
      subscriber.queue[0] = event;
    } else if (subscriber.queue.length >= this.#replayCapacity) {
      // A slow subscriber must not retain an unbounded Promise chain. Keep only
      // the newest event; its sequence gap tells a conforming client to resync.
      subscriber.queue.length = 0;
      subscriber.queue.push(event);
      subscriber.coalescing = true;
    } else {
      subscriber.queue.push(event);
    }
    if (!subscriber.draining) {
      subscriber.draining = true;
      subscriber.tail = this.#drain(subscriber);
    }
  }

  async #drain(subscriber: Subscriber): Promise<void> {
    try {
      while (subscriber.queue.length > 0) {
        const event = subscriber.queue.shift();
        if (!event) continue;
        subscriber.coalescing = false;
        await subscriber.listener(event);
      }
    } catch {
      subscriber.closed = true;
      subscriber.queue.length = 0;
      this.#subscribers.delete(subscriber);
    } finally {
      subscriber.draining = false;
    }
  }

  async #unsubscribe(subscriber: Subscriber): Promise<void> {
    subscriber.closed = true;
    this.#subscribers.delete(subscriber);
    if (!(await settlesWithin(subscriber.tail, this.#shutdownTimeoutMs))) {
      throw new Error(`Event subscriber did not settle within ${this.#shutdownTimeoutMs}ms`);
    }
  }
}
