import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { V2AppController } from "./app-controller";
import { useV2ControlTokenState, useV2ServerState, V2AppProvider } from "./app-provider";

function ConnectionProbe() {
  const state = useV2ServerState();
  return createElement("output", { "aria-label": "Server connection" }, state.connection);
}

function AuthProbe() {
  const state = useV2ControlTokenState();
  return createElement("output", { "aria-label": "Control token status" }, JSON.stringify(state));
}

describe("V2AppProvider hooks", () => {
  it("exposes a focused external-store snapshot to an accessible component", () => {
    const controller = new V2AppController();
    controller.server.update((state) => ({ ...state, connection: "resyncing" }));

    const markup = renderToStaticMarkup(createElement(V2AppProvider, { controller }, createElement(ConnectionProbe)));

    expect(markup).toContain('aria-label="Server connection"');
    expect(markup).toContain("resyncing");
    expect(markup).not.toContain("data-testid");
  });

  it("fails clearly when a v2 hook is rendered outside its provider", () => {
    expect(() => renderToStaticMarkup(createElement(ConnectionProbe))).toThrow(/V2AppProvider/u);
  });

  it("exposes token status without exposing the secret value", () => {
    const token = "provider-private-token";
    const controller = new V2AppController();
    controller.auth.setToken(token);

    const markup = renderToStaticMarkup(createElement(V2AppProvider, { controller }, createElement(AuthProbe)));

    expect(markup).toContain('aria-label="Control token status"');
    expect(markup).toContain("hasToken");
    expect(markup).not.toContain(token);
  });
});
