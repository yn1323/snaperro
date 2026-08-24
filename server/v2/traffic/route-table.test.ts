import { describe, expect, it } from "vitest";
import { AmbiguousRouteError, InvalidRouteError, RouteTable } from "./route-table.js";

const api = (routes: string[]) => ({ target: "https://example.com", routes });

describe("RouteTable", () => {
  it("prefers a static route over a parameter route regardless of declaration order", () => {
    const routes = new RouteTable({ users: api(["/users/:id", "/users/me"]) });

    expect(routes.match("GET", "/users/me")).toMatchObject({ route: "/users/me", pathParams: {} });
  });

  it("matches method-specific routes and decodes parameters", () => {
    const routes = new RouteTable({ users: api(["GET /users/:id", "POST /users"]) });

    expect(routes.match("GET", "/users/a%20b")).toMatchObject({
      route: "/users/:id",
      pathParams: { id: "a b" },
    });
    expect(routes.match("DELETE", "/users/a%20b")).toBeNull();
  });

  it("rejects ambiguous parameter routes at config compilation time", () => {
    expect(() => new RouteTable({ first: api(["/users/:id"]), second: api(["/users/:userId"]) })).toThrow(
      AmbiguousRouteError,
    );
  });

  it("rejects crossed parameter routes that overlap with equal precedence", () => {
    expect(() => new RouteTable({ first: api(["/users/:id"]), second: api(["/:entity/me"]) })).toThrow(
      AmbiguousRouteError,
    );
  });

  it("prefers a method-specific route over a generic route with the same path specificity", () => {
    const routes = new RouteTable({ generic: api(["/users/:id"]), get: api(["GET /:entity/me"]) });

    expect(routes.match("GET", "/users/me")?.apiKey).toBe("get");
    expect(routes.match("POST", "/users/me")?.apiKey).toBe("generic");
  });

  it("prefers path specificity before method specificity", () => {
    const routes = new RouteTable({ generic: api(["GET /users/:id"]), static: api(["/users/me"]) });

    expect(routes.match("GET", "/users/me")?.apiKey).toBe("static");
  });

  it("allows the same shape for disjoint methods", () => {
    const routes = new RouteTable({ first: api(["GET /users/:id"]), second: api(["POST /users/:userId"]) });

    expect(routes.match("GET", "/users/1")?.apiKey).toBe("first");
    expect(routes.match("POST", "/users/1")?.apiKey).toBe("second");
  });

  it.each([
    "TRACE /users",
    "users",
    "/users/:",
    "/users/:id/:id",
    "/users/:id.json",
    "/users/",
  ])("rejects invalid route %s", (route) => {
    expect(() => new RouteTable({ users: api([route]) })).toThrow(InvalidRouteError);
  });
});
