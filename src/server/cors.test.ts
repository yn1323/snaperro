import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { cors } from "./cors.js";

describe("cors", () => {
  const app = new Hono();
  app.use("*", cors());
  app.get("/test", (c) => c.text("OK"));
  app.post("/test", (c) => c.text("OK"));

  describe("OPTIONS リクエスト", () => {
    it("プリフライトリクエストに対してCORSヘッダーを返す", async () => {
      const res = await app.request("/test", {
        method: "OPTIONS",
        headers: {
          Origin: "http://localhost:3000",
          "Access-Control-Request-Method": "POST",
        },
      });

      expect(res.status).toBe(200);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
      expect(res.headers.get("Access-Control-Allow-Methods")).toBe("*");
      expect(res.headers.get("Access-Control-Allow-Headers")).toBe("*");
    });
  });

  describe("通常のリクエスト", () => {
    it("GETリクエストにCORSヘッダーが付く", async () => {
      const res = await app.request("/test", {
        method: "GET",
        headers: {
          Origin: "http://localhost:3000",
        },
      });

      expect(res.status).toBe(200);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    });

    it("POSTリクエストにCORSヘッダーが付く", async () => {
      const res = await app.request("/test", {
        method: "POST",
        headers: {
          Origin: "http://localhost:3000",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ data: "test" }),
      });

      expect(res.status).toBe(200);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    });
  });
});
