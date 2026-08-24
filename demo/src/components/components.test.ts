import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DemoControl } from "../control/demo-control";
import { ControlTokenPrompt } from "./ControlTokenPrompt";
import { Header } from "./Header";
import { ResponsePanel } from "./ResponsePanel";
import { Provider } from "./ui/provider";

describe("secured demo components", () => {
  it("uses a same-origin relative GUI link and accessible token control", () => {
    const markup = renderToStaticMarkup(
      createElement(
        Provider,
        null,
        createElement(Header, {
          mode: "smart",
          onModeChange: () => undefined,
          isLoading: false,
          connection: "connected",
          controlError: null,
          hasControlToken: false,
          onControlTokenClick: () => undefined,
        }),
      ),
    );

    expect(markup).toContain('href="/__snaperro__/client"');
    expect(markup).toContain('aria-label="Configure demo control token"');
    expect(markup).not.toContain(":3333/__snaperro__/client");
    expect(markup).not.toContain("data-testid");
  });

  it("renders a memory-only authentication challenge without the secret", () => {
    const token = "never-render-demo-token";
    const control = new DemoControl();
    control.auth.setToken(token);
    control.auth.requireToken();

    const markup = renderToStaticMarkup(
      createElement(
        Provider,
        null,
        createElement(ControlTokenPrompt, {
          auth: control.auth.getSnapshot(),
          control,
          open: true,
          onClose: () => undefined,
        }),
      ),
    );

    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-label="Demo control token"');
    expect(markup).toContain("kept only in memory");
    expect(markup).not.toContain(token);
    expect(markup).not.toContain("data-testid");
  });

  it("renders response markup as escaped text instead of executable HTML", () => {
    const markup = renderToStaticMarkup(
      createElement(
        Provider,
        null,
        createElement(ResponsePanel, {
          request: { url: "/users", method: "GET" },
          response: {
            status: 200,
            preview: {
              text: '{"value":"<img src=x onerror=alert(1)>"}',
              bytesRead: 44,
              contentLength: null,
              truncated: false,
            },
          },
          mode: "smart",
          isLoading: false,
          error: null,
        }),
      ),
    );

    expect(markup).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(markup).not.toContain("<img src=x");
    expect(markup).not.toContain("data-testid");
  });
});
