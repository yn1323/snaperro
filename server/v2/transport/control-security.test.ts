import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { controlSecurity } from "./control-security.js";

function createApp(options: { allowedOrigins?: string[]; controlToken?: string } = {}) {
  const app = new Hono();
  app.use(
    "/control/*",
    controlSecurity({
      serverOrigin: "http://localhost",
      allowedOrigins: options.allowedOrigins ?? [],
      controlToken: options.controlToken,
    }),
  );
  app.get("/control/status", (context) => context.json({ status: "ok" }));
  return app;
}

describe("controlSecurity", () => {
  it("allows same-origin requests", async () => {
    const response = await createApp().request("http://localhost/control/status", {
      headers: { Origin: "http://localhost" },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost");
  });

  it("rejects an unlisted cross-origin request", async () => {
    const response = await createApp().request("http://localhost/control/status", {
      headers: { Origin: "https://malicious.example" },
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: { code: "ORIGIN_FORBIDDEN", message: "Origin is not allowed", retryable: false },
    });
  });

  it("does not trust a matching attacker-controlled Host header", async () => {
    const response = await createApp().request("http://rebind.attacker/control/status", {
      headers: { Origin: "http://rebind.attacker" },
    });

    expect(response.status).toBe(403);
  });

  it("allows an explicitly configured origin", async () => {
    const response = await createApp({ allowedOrigins: ["https://tools.example/path-is-ignored"] }).request(
      "http://localhost/control/status",
      { headers: { Origin: "https://tools.example" } },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("https://tools.example");
    expect(response.headers.get("access-control-expose-headers")).toContain("Content-Disposition");
  });

  it("requires a bearer token when configured", async () => {
    const app = createApp({ controlToken: "a-secure-local-token" });

    const unauthorized = await app.request("http://localhost/control/status");
    const authorized = await app.request("http://localhost/control/status", {
      headers: { Authorization: "Bearer a-secure-local-token" },
    });

    expect(unauthorized.status).toBe(401);
    expect(await unauthorized.json()).toEqual({
      error: { code: "UNAUTHORIZED", message: "A valid control token is required", retryable: false },
    });
    expect(authorized.status).toBe(200);
  });

  it("answers an allowed preflight without authentication", async () => {
    const response = await createApp({
      allowedOrigins: ["https://tools.example"],
      controlToken: "a-secure-local-token",
    }).request("http://localhost/control/status", {
      method: "OPTIONS",
      headers: { Origin: "https://tools.example" },
    });

    expect(response.status).toBe(204);
  });
});
