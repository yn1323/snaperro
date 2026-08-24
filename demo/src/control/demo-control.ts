import type { AsyncError } from "../../../client/src/v2/async-command";
import {
  CommandIdSchema,
  type Event,
  type Mode,
  type Revision,
  type ServerSnapshot,
  V2_SCHEMA_VERSION,
} from "../../../client/src/v2/contracts";
import { ApiError } from "../../../client/src/v2/infrastructure/api-error";
import type { RealtimeConnectionStatus } from "../../../client/src/v2/infrastructure/realtime-client";
import {
  type ControlTokenInfrastructure,
  type ControlTokenSession,
  createControlTokenInfrastructure,
} from "../../../client/src/v2/react/control-token-session";
import { ExternalStore } from "../../../client/src/v2/react/external-store";

export type DemoConnectionState = RealtimeConnectionStatus | "stopped";

export interface DemoControlState {
  mode: Mode;
  revision: Revision | null;
  connection: DemoConnectionState;
  changingMode: boolean;
  error: AsyncError | null;
}

export interface DemoControlOptions {
  commandId?: () => string;
  infrastructure?: ControlTokenInfrastructure;
}

function defaultCommandId(): string {
  return `cmd_${globalThis.crypto.randomUUID().replace(/-/gu, "")}`;
}

function isRevisionConflict(error: unknown): error is ApiError {
  return error instanceof ApiError && error.code === "REVISION_CONFLICT";
}

export class DemoControl {
  readonly auth: ControlTokenSession;
  readonly state = new ExternalStore<DemoControlState>({
    mode: "smart",
    revision: null,
    connection: "connecting",
    changingMode: false,
    error: null,
  });

  readonly #infrastructure: ControlTokenInfrastructure;
  readonly #commandId: () => string;
  #started = false;
  #generation = 0;
  #connectionController: AbortController | null = null;
  #modeGeneration = 0;
  #modeController: AbortController | null = null;

  constructor(options: DemoControlOptions = {}) {
    this.#infrastructure = options.infrastructure ?? createControlTokenInfrastructure();
    this.auth = this.#infrastructure.session;
    this.#commandId = options.commandId ?? defaultCommandId;
  }

  start(): void {
    if (this.#started) return;
    this.#started = true;
    this.#connect();
  }

  stop(): void {
    this.#cancelModeChange();
    if (!this.#started) return;
    this.#started = false;
    this.#generation += 1;
    this.#connectionController?.abort();
    this.#connectionController = null;
    this.state.update((state) => ({ ...state, connection: "stopped" }));
  }

  reconnect(): void {
    if (!this.#started) {
      this.start();
      return;
    }
    this.#connect();
  }

  updateControlToken(value: string): void {
    this.#cancelModeChange();
    this.auth.setToken(value);
    this.reconnect();
  }

  clearControlToken(): void {
    this.#cancelModeChange();
    this.auth.clearToken();
    this.reconnect();
  }

  async refresh(signal?: AbortSignal): Promise<ServerSnapshot> {
    const snapshot = await this.#infrastructure.http.snapshot({ signal });
    this.#applySnapshot(snapshot);
    this.auth.markAuthorized();
    return snapshot;
  }

  async setMode(mode: Mode): Promise<void> {
    const generation = ++this.#modeGeneration;
    this.#modeController?.abort();
    const controller = new AbortController();
    this.#modeController = controller;
    const isCurrent = () => generation === this.#modeGeneration && !controller.signal.aborted;
    this.state.update((state) => ({ ...state, changingMode: true, error: null }));
    try {
      let revision = this.state.getSnapshot().revision;
      if (revision === null) revision = (await this.refresh(controller.signal)).revision;
      if (!isCurrent()) return;
      const execute = (expectedRevision: Revision) =>
        this.#infrastructure.http.command(
          {
            protocolVersion: V2_SCHEMA_VERSION,
            type: "mode.set",
            commandId: CommandIdSchema.parse(this.#commandId()),
            expectedRevision,
            mode,
          },
          { signal: controller.signal },
        );

      let result: Awaited<ReturnType<typeof execute>>;
      try {
        result = await execute(revision);
      } catch (error) {
        if (!isRevisionConflict(error)) throw error;
        if (!isCurrent()) return;
        const refreshed = await this.refresh(controller.signal);
        if (!isCurrent()) return;
        result = await execute(refreshed.revision);
      }
      if (!isCurrent()) return;
      this.auth.markAuthorized();
      this.state.update((state) =>
        state.revision !== null && result.revision < state.revision
          ? state
          : {
              ...state,
              mode: result.mode,
              revision: result.revision,
              error: null,
            },
      );
    } catch (error) {
      if (!isCurrent() || (error instanceof ApiError && error.code === "ABORTED")) return;
      this.state.update((state) => ({
        ...state,
        error: this.auth.publicError(error),
      }));
      throw error;
    } finally {
      if (isCurrent()) {
        this.#modeController = null;
        this.state.update((state) => ({ ...state, changingMode: false }));
      }
    }
  }

  #cancelModeChange(): void {
    this.#modeGeneration += 1;
    this.#modeController?.abort();
    this.#modeController = null;
    this.state.update((state) => (state.changingMode ? { ...state, changingMode: false } : state));
  }

  #connect(): void {
    this.#generation += 1;
    const generation = this.#generation;
    this.#connectionController?.abort();
    const controller = new AbortController();
    this.#connectionController = controller;
    this.state.update((state) => ({
      ...state,
      connection: state.revision === null ? "connecting" : "reconnecting",
      error: null,
    }));

    void this.refresh(controller.signal).catch((error: unknown) => {
      if (generation !== this.#generation || controller.signal.aborted) return;
      this.#acceptError(error);
    });
    void this.#infrastructure.realtime
      .subscribe(
        {
          onStatus: (connection) => {
            if (generation !== this.#generation) return;
            this.state.update((state) => ({ ...state, connection }));
          },
          onError: (error) => {
            if (generation !== this.#generation) return;
            this.#acceptError(error);
          },
          onEvent: (event) => {
            if (generation !== this.#generation) return;
            this.#acceptEvent(event);
          },
        },
        { signal: controller.signal },
      )
      .catch((error: unknown) => {
        if (generation !== this.#generation || controller.signal.aborted) return;
        this.#acceptError(error);
      });
  }

  #applySnapshot(snapshot: ServerSnapshot): void {
    this.state.update((state) =>
      state.revision !== null && snapshot.revision < state.revision
        ? state
        : {
            ...state,
            mode: snapshot.mode,
            revision: snapshot.revision,
            error: null,
          },
    );
  }

  #acceptEvent(event: Event): void {
    this.auth.markAuthorized();
    if (event.type === "runtime.connected") {
      this.#applySnapshot(event.payload);
      return;
    }
    this.state.update((state) => {
      const acceptsRevision = state.revision === null || event.revision >= state.revision;
      return {
        ...state,
        mode: acceptsRevision && event.type === "mode.changed" ? event.payload.mode : state.mode,
        revision: acceptsRevision ? event.revision : state.revision,
        connection: event.type === "runtime.shutting-down" ? "stopped" : state.connection,
        error: null,
      };
    });
  }

  #acceptError(error: unknown): void {
    if (error instanceof ApiError && error.code === "ABORTED") return;
    this.state.update((state) => ({ ...state, error: this.auth.publicError(error) }));
  }
}
