import type { AsyncError } from "../async-command";
import { ApiError } from "../infrastructure/api-error";
import { V2HttpClient, type V2HttpClientOptions } from "../infrastructure/http-client";
import { V2RealtimeClient, type V2RealtimeClientOptions } from "../infrastructure/realtime-client";
import { ExternalStore, type ReadableExternalStore } from "./external-store";

export interface ControlTokenState {
  hasToken: boolean;
  required: boolean;
}

export interface ControlTokenSession extends ReadableExternalStore<ControlTokenState> {
  setToken(value: string): void;
  clearToken(): void;
  requireToken(): void;
  markAuthorized(): void;
  observeError(error: unknown): boolean;
  publicError(error: unknown): AsyncError;
}

export interface ControlTokenInfrastructureOptions {
  http?: Omit<V2HttpClientOptions, "authorization" | "onUnauthorized">;
  realtime?: Omit<V2RealtimeClientOptions, "authorization">;
}

export interface ControlTokenInfrastructure {
  session: ControlTokenSession;
  http: V2HttpClient;
  realtime: V2RealtimeClient;
}

function normalizeToken(value: string): string {
  const token = value.trim();
  if (!token) throw new TypeError("A control token is required");
  if (/[\r\n]/u.test(token)) throw new TypeError("The control token contains invalid characters");
  return token;
}

export function isUnauthorizedError(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 401 || error.code === "UNAUTHORIZED");
}

/**
 * Keeps the token in this page instance only. The authorization provider stays
 * inside this factory and is handed directly to the HTTP and SSE clients.
 */
export function createControlTokenInfrastructure(
  options: ControlTokenInfrastructureOptions = {},
): ControlTokenInfrastructure {
  const state = new ExternalStore<ControlTokenState>({ hasToken: false, required: false });
  let token: string | null = null;
  let tokenEpoch = 0;

  const publish = (required: boolean): void => {
    state.set({ hasToken: token !== null, required });
  };
  const redact = (value: string): string =>
    token && value.includes(token) ? value.split(token).join("[REDACTED]") : value;

  const session: ControlTokenSession = {
    getSnapshot: state.getSnapshot,
    subscribe: state.subscribe,
    setToken(value) {
      token = normalizeToken(value);
      tokenEpoch += 1;
      publish(false);
    },
    clearToken() {
      token = null;
      tokenEpoch += 1;
      publish(false);
    },
    requireToken() {
      publish(true);
    },
    markAuthorized() {
      if (state.getSnapshot().required) publish(false);
    },
    observeError(error) {
      if (!isUnauthorizedError(error)) return false;
      publish(true);
      return true;
    },
    publicError(error) {
      if (isUnauthorizedError(error)) {
        return {
          name: "ApiError",
          message: "A valid control token is required",
          code: "UNAUTHORIZED",
        };
      }
      if (error instanceof Error) {
        const code = "code" in error && typeof error.code === "string" ? error.code : undefined;
        return {
          name: error.name,
          message: redact(error.message),
          ...(code ? { code } : {}),
        };
      }
      return { name: "Error", message: typeof error === "string" ? redact(error) : "Unknown error" };
    },
  };

  const authorization = (): string | null => (token ? `Bearer ${token}` : null);
  const http = new V2HttpClient({
    ...options.http,
    authorization: () => ({ value: authorization(), epoch: tokenEpoch }),
    onUnauthorized: (error, request) => {
      if (request.authorizationEpoch === tokenEpoch) session.observeError(error);
    },
  });
  const realtime = new V2RealtimeClient({ ...options.realtime, authorization });

  return { session, http, realtime };
}
