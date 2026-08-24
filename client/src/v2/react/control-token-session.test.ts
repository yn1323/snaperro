import { describe, expect, it, vi } from "vitest";

import { ApiError } from "../infrastructure/api-error";
import { snapshotAt } from "../test-fixtures";
import { createControlTokenInfrastructure } from "./control-token-session";

describe("control token infrastructure", () => {
  it("keeps the token only in the current page instance and exposes status without the secret", () => {
    const token = "a-private-control-token";
    const first = createControlTokenInfrastructure();

    first.session.setToken(token);

    expect(first.session.getSnapshot()).toEqual({ hasToken: true, required: false });
    expect(JSON.stringify(first.session.getSnapshot())).not.toContain(token);
    expect(first.session).not.toHaveProperty("authorizationHeader");

    const reloadedPage = createControlTokenInfrastructure();
    expect(reloadedPage.session.getSnapshot()).toEqual({ hasToken: false, required: false });
  });

  it("hands its private authorization provider directly to the HTTP and SSE clients", async () => {
    const token = "memory-only-control-token";
    const httpRequest = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${token}`);
      return new Response(JSON.stringify(snapshotAt()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    const streamController = new AbortController();
    const sseRequest = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${token}`);
      streamController.abort();
      return new Response("", { status: 200, headers: { "Content-Type": "text/event-stream" } });
    });
    const infrastructure = createControlTokenInfrastructure({
      http: { fetch: httpRequest as typeof globalThis.fetch },
      realtime: { fetch: sseRequest as typeof globalThis.fetch },
    });
    infrastructure.session.setToken(token);

    await infrastructure.http.snapshot();
    await infrastructure.realtime.subscribe({ onEvent: () => undefined }, { signal: streamController.signal });

    expect(httpRequest).toHaveBeenCalledOnce();
    expect(sseRequest).toHaveBeenCalledOnce();
  });

  it("raises an authentication challenge only when observed and redacts its token from public errors", () => {
    const token = "never-show-this-token";
    const { session } = createControlTokenInfrastructure();
    session.setToken(token);

    const rejection = new ApiError(`Rejected ${token}`, { code: "UNAUTHORIZED", status: 401 });
    const publicError = session.publicError(rejection);

    expect(session.getSnapshot()).toEqual({ hasToken: true, required: false });
    session.observeError(rejection);
    expect(session.getSnapshot()).toEqual({ hasToken: true, required: true });
    expect(publicError).toMatchObject({ code: "UNAUTHORIZED", message: "A valid control token is required" });
    expect(JSON.stringify(publicError)).not.toContain(token);
    expect(session.publicError(new Error(`Unexpected ${token}`)).message).toBe("Unexpected [REDACTED]");
  });

  it("ignores an unauthorized response from a superseded token epoch", async () => {
    let finishOldRequest: ((response: Response) => void) | undefined;
    const request = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((resolve) => {
          expect(new Headers(init?.headers).get("authorization")).toBe("Bearer old-token");
          finishOldRequest = resolve;
        }),
    );
    const infrastructure = createControlTokenInfrastructure({
      http: { fetch: request as typeof globalThis.fetch },
    });
    infrastructure.session.setToken("old-token");
    const oldRequest = infrastructure.http.snapshot();
    await vi.waitFor(() => expect(finishOldRequest).toBeTypeOf("function"));

    infrastructure.session.setToken("replacement-token");
    infrastructure.session.markAuthorized();
    finishOldRequest?.(
      new Response(
        JSON.stringify({
          error: { code: "UNAUTHORIZED", message: "A valid control token is required", retryable: false },
        }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      ),
    );

    await expect(oldRequest).rejects.toMatchObject({ code: "UNAUTHORIZED", status: 401 });
    expect(infrastructure.session.getSnapshot()).toEqual({ hasToken: true, required: false });

    request.mockImplementationOnce(async (_input, init) => {
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer replacement-token");
      return new Response(
        JSON.stringify({
          error: { code: "UNAUTHORIZED", message: "A valid control token is required", retryable: false },
        }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      );
    });
    await expect(infrastructure.http.snapshot()).rejects.toMatchObject({ code: "UNAUTHORIZED", status: 401 });
    expect(infrastructure.session.getSnapshot()).toEqual({ hasToken: true, required: true });
  });

  it("rejects empty and multiline token values", () => {
    const { session } = createControlTokenInfrastructure();

    expect(() => session.setToken("   ")).toThrow("A control token is required");
    expect(() => session.setToken("token\nheader")).toThrow("invalid characters");
    expect(session.getSnapshot()).toEqual({ hasToken: false, required: false });
  });
});
