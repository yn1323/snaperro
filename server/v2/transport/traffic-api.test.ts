import { describe, expect, it, vi } from "vitest";
import { UpstreamUnavailableError } from "../domain/errors.js";
import { createTrafficApi } from "./traffic-api.js";

describe("createTrafficApi", () => {
  it("passes a streaming request through and returns raw response bytes", async () => {
    const execute = vi.fn(async (request) => {
      expect(request.method).toBe("POST");
      expect(request.url).toBe("http://localhost/files?part=1");
      expect(new TextDecoder().decode(await new Response(request.body).arrayBuffer())).toBe("request");
      return {
        status: 206,
        statusText: "Partial Content",
        headers: [["content-type", "application/octet-stream"]] as Array<[string, string]>,
        body: new Blob([new Uint8Array([0, 255])]).stream(),
      };
    });

    const response = await createTrafficApi({ execute }).request("/files?part=1", {
      method: "POST",
      body: "request",
    });

    expect(response.status).toBe(206);
    expect(response.headers.get("content-type")).toBe("application/octet-stream");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([0, 255]));
  });

  it("maps typed traffic failures without leaking their cause", async () => {
    const response = await createTrafficApi({
      execute: vi.fn(async () => {
        throw new UpstreamUnavailableError("Upstream unavailable", new Error("secret socket details"));
      }),
    }).request("/users");

    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain("secret socket details");
  });

  it.each([
    [204, "No Content"],
    [205, "Reset Content"],
    [304, "Not Modified"],
  ] as const)("suppresses an upstream body for HTTP %i", async (status, statusText) => {
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new TextEncoder().encode("invalid upstream body"));
      },
    });
    const response = await createTrafficApi({
      execute: vi.fn(async () => ({
        status,
        statusText,
        headers: [
          ["content-type", "application/json"],
          ["content-encoding", "gzip"],
          ["content-length", "999"],
        ] as Array<[string, string]>,
        body,
      })),
    }).request("/no-content");

    expect(response.status).toBe(status);
    expect(await response.text()).toBe("");
    expect(response.headers.get("content-type")).toBe("application/json");
    if (status === 204 || status === 205) {
      expect(response.headers.has("content-encoding")).toBe(false);
      expect(response.headers.has("content-length")).toBe(false);
    } else {
      expect(response.headers.get("content-encoding")).toBe("gzip");
      expect(response.headers.get("content-length")).toBe("999");
    }
  });
});
