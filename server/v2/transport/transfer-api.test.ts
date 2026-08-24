import { describe, expect, it, vi } from "vitest";
import { Sha256Schema, TransferIdSchema } from "../../../shared/contracts-v2/primitives.js";
import { EntityNotFoundError } from "../domain/errors.js";
import type { CapabilityDownloadPort, FolderTransferPort } from "./transfer-api.js";
import { createDownloadApi, createTransferApi } from "./transfer-api.js";

const transferId = TransferIdSchema.parse("xfer_0123456789abcdef");

function transfers(): FolderTransferPort {
  return {
    stageImport: vi.fn(async (stream, metadata) => {
      expect(await new Response(stream).text()).toBe("zip bytes");
      expect(metadata).toEqual({ filename: "Team.zip", mediaType: "application/zip" });
      return {
        transferId,
        suggestedName: "Team",
        scenariosCount: 2,
        size: 9,
        sha256: Sha256Schema.parse("a".repeat(64)),
      };
    }),
    stageRecordingImport: vi.fn(async () => ({
      transferId,
      filename: "users.json",
      size: 9,
      sha256: Sha256Schema.parse("b".repeat(64)),
    })),
  };
}

function downloads(): CapabilityDownloadPort {
  return {
    openCapability: vi.fn(async () => ({
      filename: `Team 'A' (copy)*.zip`,
      mediaType: "application/zip" as const,
      contentEncoding: null,
      size: 3,
      stream: new Blob([new Uint8Array([0, 1, 255])]).stream(),
    })),
  };
}

describe("createTransferApi", () => {
  it("stages a raw ZIP upload without multipart buffering", async () => {
    const target = transfers();
    const response = await createTransferApi(target).request("/transfers/imports?filename=Team.zip", {
      method: "POST",
      headers: { "content-type": "application/zip" },
      body: "zip bytes",
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ transferId, scenariosCount: 2 });
    expect(target.stageImport).toHaveBeenCalledOnce();
  });

  it("streams a prepared download with an injection-safe filename", async () => {
    const target = downloads();
    const capability = "a".repeat(43);
    const response = await createDownloadApi(target).request(`/${capability}`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain(
      "filename*=UTF-8''Team%20%27A%27%20%28copy%29%2A.zip",
    );
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([0, 1, 255]));
  });

  it("rejects HEAD without consuming a single-use download capability", async () => {
    const target = downloads();
    const response = await createDownloadApi(target).request(`/${"a".repeat(43)}`, { method: "HEAD" });

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET");
    expect(target.openCapability).not.toHaveBeenCalled();
  });

  it("validates content type and transfer IDs before delegation", async () => {
    const target = transfers();
    const upload = await createTransferApi(target).request("/transfers/imports?filename=Team.zip", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "bad",
    });

    expect(upload.status).toBe(400);
    expect(target.stageImport).not.toHaveBeenCalled();
  });

  it.each([
    ["folder", "/transfers/imports?filename=Team.zip", "stageImport"],
    ["recording", "/transfers/recording-imports?filename=users.zip", "stageRecordingImport"],
  ] as const)("rejects an oversized declared %s import before staging", async (_kind, route, method) => {
    const target = transfers();
    const response = await createTransferApi(target, { maxUploadBytes: 3 }).request(route, {
      method: "POST",
      headers: { "content-type": "application/zip", "content-length": "4" },
      body: "zip",
    });

    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ error: { code: "PAYLOAD_LIMIT_EXCEEDED" } });
    expect(target[method]).not.toHaveBeenCalled();
  });

  it.each([
    ["folder", "/transfers/imports?filename=Team.zip", "stageImport"],
    ["recording", "/transfers/recording-imports?filename=users.zip", "stageRecordingImport"],
  ] as const)("rejects an invalid or combined %s Content-Length before staging", async (_kind, route, method) => {
    const target = transfers();
    const response = await createTransferApi(target, { maxUploadBytes: 10 }).request(route, {
      method: "POST",
      headers: { "content-type": "application/zip", "content-length": "3, 3" },
      body: "zip",
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "INVALID_ARGUMENT" } });
    expect(target[method]).not.toHaveBeenCalled();
  });

  it("returns the same 404 envelope for malformed and unknown capabilities", async () => {
    const target: CapabilityDownloadPort = {
      openCapability: vi.fn(async () => {
        throw new EntityNotFoundError("download", "capability");
      }),
    };
    const malformed = await createDownloadApi(target).request("/bad");
    const unknown = await createDownloadApi(target).request(`/${"z".repeat(43)}`);

    expect(malformed.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(await malformed.json()).toEqual(await unknown.json());
  });
});
