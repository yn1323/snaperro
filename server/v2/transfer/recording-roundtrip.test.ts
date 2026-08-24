import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RecordingDraftSchema } from "../../../shared/contracts-v2/entities.js";
import { CommandIdSchema, RevisionSchema, V2_SCHEMA_VERSION } from "../../../shared/contracts-v2/primitives.js";
import { compileConfigV2 } from "../config/config.js";
import { RuntimeCore } from "../runtime/runtime-core.js";
import { writeBlobBytes } from "../store/blob-store.js";

const roots: string[] = [];

async function runtime(name: string): Promise<RuntimeCore> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `snaperro-recording-${name}-`));
  roots.push(root);
  return RuntimeCore.create(
    compileConfigV2(
      {
        configVersion: 2,
        server: {},
        storage: { root, maxImportBytes: 16 * 1024 * 1024 },
        proxy: { url: "https://example.com" },
        apis: { jsonPlaceholder: { name: "Users", target: "https://example.com", routes: ["/users"] } },
      },
      path.join(root, "snaperro.config.ts"),
    ),
  );
}

function commandId(character: string) {
  return CommandIdSchema.parse(`cmd_${character.repeat(16)}`);
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("recording archive portability", () => {
  it("restores one recording and its exact bodies into a different store", async () => {
    const source = await runtime("source");
    const destination = await runtime("destination");
    try {
      const sourceFolder = await source.commands.execute({
        protocolVersion: V2_SCHEMA_VERSION,
        commandId: commandId("a"),
        type: "folder.create",
        expectedRevision: RevisionSchema.parse(0),
        name: "Source",
      });
      const sourceScenario = await source.commands.execute({
        protocolVersion: V2_SCHEMA_VERSION,
        commandId: commandId("b"),
        type: "scenario.create",
        expectedRevision: sourceFolder.revision,
        folderId: sourceFolder.folder.id,
        name: "Success",
      });
      const requestBytes = Buffer.from('{"z":1,"a":2}', "utf8");
      const responseBytes = Buffer.from([0, 255, 1, 2, 3]);
      const requestBody = await writeBlobBytes(source.store.blobs, requestBytes, {
        mediaType: "application/json",
        contentEncoding: null,
      });
      const responseBody = await writeBlobBytes(source.store.blobs, responseBytes, {
        mediaType: "application/octet-stream",
        contentEncoding: null,
      });
      const created = await source.commands.execute({
        protocolVersion: V2_SCHEMA_VERSION,
        commandId: commandId("c"),
        type: "recording.create",
        scenarioId: sourceScenario.scenario.id,
        expectedScenarioRevision: RevisionSchema.parse(0),
        filename: "portable.json",
        recording: RecordingDraftSchema.parse({
          route: "/users/:id",
          method: "POST",
          request: { pathParams: { id: "1" }, query: [["page", "1"]], headers: [], body: requestBody },
          response: { status: 201, statusText: "Created", headers: [["x-test", "yes"]], body: responseBody },
        }),
      });
      const exported = await source.queries.execute({
        protocolVersion: V2_SCHEMA_VERSION,
        type: "recording.export",
        scenarioId: sourceScenario.scenario.id,
        recordingId: created.recording.id,
      });
      const capability = exported.download.downloadPath.split("/").at(-1) as string;
      const archiveBytes = new Uint8Array(
        await new Response((await source.transfers.openCapability(capability)).stream).arrayBuffer(),
      );

      const destinationFolder = await destination.commands.execute({
        protocolVersion: V2_SCHEMA_VERSION,
        commandId: commandId("d"),
        type: "folder.create",
        expectedRevision: RevisionSchema.parse(0),
        name: "Destination",
      });
      const destinationScenario = await destination.commands.execute({
        protocolVersion: V2_SCHEMA_VERSION,
        commandId: commandId("e"),
        type: "scenario.create",
        expectedRevision: destinationFolder.revision,
        folderId: destinationFolder.folder.id,
        name: "Imported",
      });
      const staged = await destination.transfers.stageRecordingImport(new Blob([archiveBytes]).stream(), {
        filename: exported.download.filename,
        mediaType: "application/zip",
      });
      const imported = await destination.commands.execute({
        protocolVersion: V2_SCHEMA_VERSION,
        commandId: commandId("f"),
        type: "recording.import",
        scenarioId: destinationScenario.scenario.id,
        expectedScenarioRevision: RevisionSchema.parse(0),
        transferId: staged.transferId,
      });

      expect(imported.recording).toMatchObject({
        filename: "portable.json",
        route: "/users/:id",
        method: "POST",
        requestFingerprint: created.recording.requestFingerprint,
        response: { status: 201, statusText: "Created" },
      });
      expect(imported.recording.response.headers).toContainEqual(["x-test", "yes"]);
      expect(imported.recording.id).not.toBe(created.recording.id);
      const importedRequestBody = imported.recording.request.body;
      const importedResponseBody = imported.recording.response.body;
      if (!importedRequestBody || !importedResponseBody) throw new Error("Imported recording lost its body references");
      expect(
        Buffer.from(await new Response(await destination.store.blobs.open(importedRequestBody)).arrayBuffer()),
      ).toEqual(requestBytes);
      expect(
        Buffer.from(await new Response(await destination.store.blobs.open(importedResponseBody)).arrayBuffer()),
      ).toEqual(responseBytes);
      await expect(destination.transfers.claimRecording(staged.transferId, commandId("0"))).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    } finally {
      await Promise.all([source.close(), destination.close()]);
    }
  });
});
